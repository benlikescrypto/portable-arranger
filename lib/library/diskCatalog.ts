import { audio } from "arrangerbox-audio"
import { Directory, File, Paths } from "expo-file-system"

import { asDirectory, categoryGuess, findSetFolder, isDirectory, isSetName } from "@/lib/library/pa4x"
import type { LibraryKind, PadItem, SoundItem, StyleItem } from "@/lib/types"

export type DiskItem = {
  kind: LibraryKind
  name: string
  category: string
  fileName: string
  setPath: string
  setName: string
}

export type DiskCatalog = {
  setName: string
  sounds: DiskItem[]
  styles: DiskItem[]
  pads: DiskItem[]
}

export type LoadResult = {
  ok: boolean
  engineId: number
  reason: string
}

const DISK_SOUND = 100000
const DISK_STYLE = 200000
const DISK_PAD = 300000

function nativePath(file: File | Directory) {
  const uri = file.uri
  if (uri.startsWith("file://")) return decodeURIComponent(uri.replace(/^file:\/\//, ""))
  return uri
}

function fileUri(path: string) {
  if (path.startsWith("file:")) return path
  return `file://${path.replace(/\\/g, "/")}`
}

function norm(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "")
}

function asciiName(bytes: Uint8Array, off: number, n: number) {
  let out = ""
  for (let i = 0; i < n && off + i < bytes.length; i++) {
    const c = bytes[off + i]
    if (c === 0) break
    if (c >= 32 && c < 127) out += String.fromCharCode(c)
  }
  return out.trim()
}

function parseKmpNames(bytes: Uint8Array) {
  const names: string[] = []
  for (let i = 0; i + 24 < bytes.length; i++) {
    if (bytes[i] !== 0x4d || bytes[i + 1] !== 0x53 || bytes[i + 2] !== 0x50 || bytes[i + 3] !== 0x31) continue
    const name = asciiName(bytes, i + 8, 16)
    if (name.length >= 2) names.push(name)
  }
  return names
}

function parseKorfNames(bytes: Uint8Array) {
  const names: string[] = []
  const tryLen = (off: number) => {
    if (off + 4 > bytes.length) return
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (const be of [true, false]) {
      const len = be ? view.getUint32(off, false) : view.getUint32(off, true)
      if (len < 24 || len % 24 !== 0 || off + 4 + len > bytes.length) continue
      const entries = len / 24
      if (entries < 1 || entries > 256) continue
      for (let e = 0; e < entries; e++) {
        const row = off + 4 + e * 24
        const kind = bytes[row + 18]
        if (kind !== 2 && kind !== 0) continue
        const name = asciiName(bytes, row, 16)
        if (name.length >= 2) names.push(name)
      }
      if (names.length) return
    }
  }
  tryLen(32)
  if (names.length) return names
  for (let i = 0; i < Math.min(bytes.length, 48) - 4; i++) {
    if (bytes[i] === 0x4b && bytes[i + 1] === 0x4f && bytes[i + 2] === 0x52 && bytes[i + 3] === 0x46) {
      tryLen(i + 8)
      break
    }
  }
  return names
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const key = norm(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

async function namesFromFile(file: File, kind: LibraryKind) {
  const ext = file.name.toUpperCase()
  try {
    if (ext.endsWith(".KMP") && (file.size ?? 0) < 8_000_000) {
      const parsed = uniqueNames(parseKmpNames(await file.bytes()))
      if (parsed.length) return parsed
    }
    if ((kind === "style" || kind === "pad") && (file.size ?? 0) < 2_000_000) {
      const parsed = uniqueNames(parseKorfNames(await file.bytes()))
      if (parsed.length) return parsed
    }
  } catch {
    // File stem is enough for the square; native catalog fills real KORF names.
  }
  return [stem(file.name)]
}

function pushItem(items: DiskItem[], item: DiskItem) {
  if (items.some((row) => row.kind === item.kind && norm(row.name) === norm(item.name))) return
  items.push(item)
}

async function walkDiskSet(dir: Directory, setName: string, setPath: string, into: DiskCatalog) {
  let children: Array<Directory | File> = []
  try {
    children = dir.list()
  } catch {
    return
  }
  for (const child of children) {
    if (!child.name || child.name.startsWith(".")) continue
    if (isDirectory(child) || isSetName(child.name)) {
      await walkDiskSet(asDirectory(child), setName, setPath, into)
      continue
    }
    const file = child as File
    const upper = file.name.toUpperCase()
    let kind: LibraryKind | null = null
    if (/\.(KMP|WAV|KSF)$/i.test(upper)) kind = "sound"
    else if (/\.(STY|STG|MID|SMF)$/i.test(upper)) kind = "style"
    else if (/\.PAD$/i.test(upper)) kind = "pad"
    if (!kind) continue
    const names = await namesFromFile(file, kind)
    for (const name of names) {
      pushItem(kind === "sound" ? into.sounds : kind === "pad" ? into.pads : into.styles, {
        kind,
        name,
        category: categoryGuess(name, kind === "sound" ? "Imported" : "Style"),
        fileName: file.name,
        setPath,
        setName,
      })
    }
  }
}

function parseCatalogFile(raw: string, setName: string, setPath: string): DiskCatalog | null {
  try {
    const json = JSON.parse(raw) as {
      items?: { kind?: string; name?: string; category?: string; file?: string }[]
    }
    if (!Array.isArray(json.items)) return null
    const out: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
    for (const item of json.items) {
      const kind = item.kind === "pad" ? "pad" : item.kind === "sound" ? "sound" : "style"
      const name = item.name?.trim()
      if (!name) continue
      pushItem(kind === "sound" ? out.sounds : kind === "pad" ? out.pads : out.styles, {
        kind,
        name,
        category: item.category || categoryGuess(name, kind === "sound" ? "Imported" : "Style"),
        fileName: item.file || "",
        setPath,
        setName,
      })
    }
    return out
  } catch {
    return null
  }
}

function listSavedSetDirs() {
  const root = new Directory(Paths.document, "sets")
  if (!root.exists) return []
  const out: Directory[] = []
  try {
    for (const child of root.list()) {
      if (!child.name || child.name.startsWith(".")) continue
      if (isDirectory(child) || isSetName(child.name)) out.push(asDirectory(child))
    }
  } catch {
    return out
  }
  return out
}

async function catalogOneSet(dir: Directory): Promise<DiskCatalog> {
  const setFolder = findSetFolder(dir)
  const setName = setFolder.name.replace(/\.SET$/i, "") || "Imported"
  const setPath = nativePath(setFolder)
  const empty: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  try {
    const raw = await audio.listPa4xCatalog(setPath)
    const summary = JSON.parse(raw) as { ok?: number; file?: string }
    if (summary.ok && summary.file) {
      const file = new File(fileUri(summary.file))
      if (file.exists) {
        const parsed = parseCatalogFile(await Promise.resolve(file.text()), setName, setPath)
        if (parsed && parsed.sounds.length + parsed.styles.length + parsed.pads.length > 0) return parsed
      }
    }
  } catch {
    // Current IPA has no catalog native; walk names from disk.
  }
  await walkDiskSet(setFolder, setName, setPath, empty)
  return empty
}

export async function loadDiskCatalog(): Promise<DiskCatalog> {
  const dirs = listSavedSetDirs()
  const merged: DiskCatalog = { setName: "", sounds: [], styles: [], pads: [] }
  for (const dir of dirs) {
    const next = await catalogOneSet(dir)
    if (!merged.setName) merged.setName = next.setName
    for (const item of next.sounds) pushItem(merged.sounds, item)
    for (const item of next.styles) pushItem(merged.styles, item)
    for (const item of next.pads) pushItem(merged.pads, item)
  }
  return merged
}

function isFactory(source?: string) {
  return (source ?? "FACTORY").toUpperCase() === "FACTORY"
}

export function mergeSounds(engine: SoundItem[], disk: DiskItem[]): SoundItem[] {
  const out: SoundItem[] = engine.map((item) => ({
    ...item,
    loaded: true,
    engineId: item.id,
    source: item.source ?? "FACTORY",
    bank: isFactory(item.source) ? "FACTORY" : item.source,
  }))
  let nextId = Math.max(DISK_SOUND, ...out.map((item) => item.id + 1), DISK_SOUND)
  for (const item of disk) {
    const hit = out.find((row) => !isFactory(row.source) && norm(row.name) === norm(item.name))
    if (hit) {
      hit.setPath = item.setPath
      hit.fileName = item.fileName
      continue
    }
    out.push({
      id: nextId++,
      name: item.name,
      category: item.category,
      source: "IMPORTED",
      bank: "IMPORTED",
      loaded: false,
      setPath: item.setPath,
      fileName: item.fileName,
    })
  }
  return out
}

export function mergeStyles(engine: StyleItem[], disk: DiskItem[]): StyleItem[] {
  const out: StyleItem[] = engine.map((item) => ({
    ...item,
    loaded: true,
    engineId: item.id,
    source: item.source ?? "FACTORY",
    bank: isFactory(item.source) ? "FACTORY" : "IMPORTED",
  }))
  let nextId = Math.max(DISK_STYLE, ...out.map((item) => item.id + 1), DISK_STYLE)
  for (const item of disk) {
    const hit = out.find((row) => !isFactory(row.source) && norm(row.name) === norm(item.name))
    if (hit) {
      hit.setPath = item.setPath
      hit.fileName = item.fileName
      continue
    }
    out.push({
      id: nextId++,
      name: item.name,
      category: item.category === "Style" ? "World" : item.category,
      tempo: 0,
      source: "IMPORTED",
      bank: "IMPORTED",
      loaded: false,
      setPath: item.setPath,
      fileName: item.fileName,
    })
  }
  return out
}

export function mergePads(engine: StyleItem[], disk: DiskItem[]): PadItem[] {
  const loadedNames = new Set(
    engine.filter((item) => !isFactory(item.source)).map((item) => norm(item.name))
  )
  const out: PadItem[] = []
  let nextId = DISK_PAD
  for (const item of disk) {
    const loaded = loadedNames.has(norm(item.name))
    const engineHit = engine.find((row) => !isFactory(row.source) && norm(row.name) === norm(item.name))
    out.push({
      id: engineHit?.id ?? nextId++,
      name: item.name,
      category: item.category,
      source: "IMPORTED",
      bank: "IMPORTED",
      loaded,
      engineId: engineHit?.id,
      setPath: item.setPath,
      fileName: item.fileName,
    })
  }
  return out
}

function parseReport(raw: string): LoadResult {
  try {
    const json = JSON.parse(raw) as { ok?: number; engineId?: number; reason?: string; patches?: number; styles?: number }
    const engineId = json.engineId ?? -1
    const ok = (json.ok ?? 0) === 1 && engineId >= 0
    return { ok, engineId, reason: json.reason?.trim() || (ok ? "" : "Could not load this item.") }
  } catch {
    return { ok: false, engineId: -1, reason: "Could not load this item." }
  }
}

function childPath(setPath: string, fileName: string) {
  if (!fileName) return setPath
  const slash = setPath.includes("\\") ? "\\" : "/"
  return `${setPath.replace(/[\\/]$/, "")}${slash}${fileName}`
}

export async function loadDiskItem(item: {
  kind: LibraryKind
  name: string
  setPath?: string
  fileName?: string
}): Promise<LoadResult> {
  if (item.setPath) {
    const named = await audio.loadPa4xNamed(item.setPath, item.kind, item.name)
    const result = parseReport(named)
    if (result.ok) return result
    if (!/cannot load one item/i.test(result.reason)) return result
  }
  const fileName = item.fileName ?? ""
  const path = item.setPath ? childPath(item.setPath, fileName) : ""
  if (/\.(WAV)$/i.test(fileName) && path) {
    const id = await audio.loadWav(path, item.name, categoryGuess(item.name, "Imported"))
    return id >= 0
      ? { ok: true, engineId: id, reason: "" }
      : { ok: false, engineId: -1, reason: "WAV did not load." }
  }
  if (/\.(MID|SMF)$/i.test(fileName) && path) {
    return parseReport(await audio.loadPa4xSet(path))
  }
  if (item.kind === "style" || item.kind === "pad") {
    return {
      ok: false,
      engineId: -1,
      reason:
        item.kind === "pad"
          ? "Pad Record > Export SMF, then Import that MID."
          : "Style Record > Export SMF, then Import that MID.",
    }
  }
  return {
    ok: false,
    engineId: -1,
    reason: "This app build cannot load one User sound yet. Keep the old sound playing.",
  }
}

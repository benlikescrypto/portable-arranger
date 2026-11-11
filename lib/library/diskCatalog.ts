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

function norm(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "")
}

function isGenericStem(name: string) {
  return /^(ram|pcm|sound|style|pad|multismp|multisample|samples)$/i.test(name.trim())
}

function instrumentName(raw: string) {
  let name = raw.trim()
  for (let pass = 0; pass < 4; pass++) {
    let next = name.replace(/[\s_-]+(l|r|m|left|right|mono)$/i, "")
    next = next.replace(/[\s_-]+(v[1-8]|vel[1-8]|ff|mf|mp|pp)$/i, "")
    next = next.replace(/[\s_-]+[A-G](?:#|b)?[0-8]$/i, "")
    next = next.trim()
    if (next.length < 3 || next === name) break
    name = next
  }
  return name
}

function pushItem(items: DiskItem[], item: DiskItem) {
  if (items.some((row) => row.kind === item.kind && norm(row.name) === norm(item.name))) return
  items.push(item)
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

function u32be(bytes: Uint8Array, off: number) {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
}

function printableName(bytes: Uint8Array, off: number, n: number) {
  let start = -1
  let end = -1
  for (let i = 0; i < n && off + i < bytes.length; i++) {
    const c = bytes[off + i]
    if (c >= 32 && c < 127 && c !== 92) {
      if (start < 0) start = i
      end = i
    } else if (start >= 0) {
      break
    }
  }
  if (start < 0 || end - start + 1 < 3) return ""
  let out = ""
  for (let i = start; i <= end; i++) out += String.fromCharCode(bytes[off + i])
  out = out.replace(/ +$/g, "")
  let letters = 0
  for (const ch of out) if (/[A-Za-z]/.test(ch)) letters++
  if (letters < 2 || out.length < 3 || out.length > 24) return ""
  return out
}

function parsePcgNames(bytes: Uint8Array) {
  const names: string[] = []
  const seen = new Set<string>()
  const consider = (name: string) => {
    if (!name || isGenericStem(name)) return
    const up = name.toUpperCase()
    if (up.includes(".KMP") || up.includes(".KSF") || up.includes(".PCM")) return
    if (name.includes("Z110A") || name.includes("v3.")) return
    const key = norm(name)
    if (seen.has(key)) return
    seen.add(key)
    names.push(name)
  }
  const korf = bytes.length >= 24 && bytes[0] === 1 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0x14
  if (korf) {
    for (let i = 0; i + 32 < bytes.length; i++) {
      if (!(bytes[i] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 5 && bytes[i + 6] === 0 && bytes[i + 7] === 0x1c)) {
        continue
      }
      consider(printableName(bytes, i + 8, 24))
    }
    if (names.length) return names
  }
  const isChunkId = (off: number) => {
    for (let k = 0; k < 4; k++) {
      const c = bytes[off + k]
      if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false
    }
    return true
  }
  for (let i = 0; i + 8 < bytes.length; ) {
    if (isChunkId(i)) {
      const sz = u32be(bytes, i + 4)
      if (sz >= 8 && sz < bytes.length && i + 8 + sz <= bytes.length) {
        const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
        if (id === "PRG1" || id === "PBS1" || id === "DKT1" || id === "CMB1" || id === "PRG2" || id === "PCG1") {
          const payload = i + 8
          for (let p = 0; p + 16 < sz; p += 16) consider(printableName(bytes, payload + p, 24))
        }
        i += 8 + sz
        continue
      }
    }
    i++
  }
  return names
}

function parseKmpGroupedNames(bytes: Uint8Array) {
  const names: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 32 <= bytes.length; i++) {
    if (bytes[i] < 65 || bytes[i] >= 127) continue
    if (!/[A-Za-z]/.test(String.fromCharCode(bytes[i]))) continue
    if (i > 0) {
      const prev = bytes[i - 1]
      if (
        (prev >= 48 && prev <= 57) ||
        (prev >= 65 && prev <= 90) ||
        (prev >= 97 && prev <= 122) ||
        prev === 32 ||
        prev === 45
      ) {
        continue
      }
    }
    const name = asciiName(bytes, i, 16)
    if (name.length < 4 || isGenericStem(name) || name.includes("Z110A") || name.includes("v3.")) continue
    let letters = 0
    for (const ch of name) if (/[A-Za-z]/.test(ch)) letters++
    if (letters < 3) continue
    const rate = (bytes[i + 28] << 8) | bytes[i + 29]
    if (rate !== 44100 && rate !== 48000 && rate !== 32000 && rate !== 22050) continue
    const key = norm(name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function parseKmpNames(bytes: Uint8Array) {
  const names: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 24 < bytes.length; ) {
    if (bytes[i] !== 0x4d || bytes[i + 1] !== 0x53 || bytes[i + 2] !== 0x50 || bytes[i + 3] !== 0x31) {
      i++
      continue
    }
    const sz = u32be(bytes, i + 4)
    if (sz < 18 || i + 8 + sz > bytes.length) {
      i++
      continue
    }
    let name = asciiName(bytes, i + 8, 16)
    let cursor = i + 8 + sz
    let confirmed = false
    if (
      cursor + 8 <= bytes.length &&
      bytes[cursor] === 0x4e &&
      bytes[cursor + 1] === 0x41 &&
      bytes[cursor + 2] === 0x4d &&
      bytes[cursor + 3] === 0x45
    ) {
      const nsz = u32be(bytes, cursor + 4)
      if (cursor + 8 + nsz <= bytes.length) {
        const longer = asciiName(bytes, cursor + 8, Math.min(24, nsz))
        if (longer) name = longer
        cursor += 8 + nsz
        confirmed = true
      }
    }
    if (
      cursor + 4 <= bytes.length &&
      bytes[cursor] === 0x52 &&
      bytes[cursor + 1] === 0x4c &&
      bytes[cursor + 2] === 0x50 &&
      bytes[cursor + 3] === 0x31
    ) {
      confirmed = true
    }
    if (!confirmed) {
      i = Math.max(cursor, i + 8)
      continue
    }
    const key = norm(name)
    if (name.length >= 2 && !isGenericStem(name) && !seen.has(key)) {
      seen.add(key)
      names.push(name)
    }
    i = Math.max(cursor, i + 8)
  }
  if (names.length) return names
  return parseKmpGroupedNames(bytes)
}

function childNamed(parent: Directory, want: string) {
  try {
    for (const child of parent.list()) {
      if (!child.name || child.name.startsWith(".")) continue
      if (child.name.toUpperCase() !== want) continue
      if (isDirectory(child) || isSetName(child.name)) return asDirectory(child)
    }
  } catch {
    return null
  }
  return null
}

async function namesFromKmp(file: File) {
  const size = typeof file.size === "number" ? file.size : 0
  if (size > 32 * 1024 * 1024) return []
  try {
    const bytes = await Promise.resolve(file.bytes())
    return parseKmpNames(bytes)
  } catch {
    return []
  }
}

async function namesFromPcg(file: File) {
  const size = typeof file.size === "number" ? file.size : 0
  if (size > 32 * 1024 * 1024) return []
  try {
    const bytes = await Promise.resolve(file.bytes())
    return parsePcgNames(bytes)
  } catch {
    return []
  }
}

function collectFiles(dir: Directory, test: (name: string) => boolean, out: File[]) {
  try {
    for (const child of dir.list()) {
      if (!child.name || child.name.startsWith(".")) continue
      if (isDirectory(child) || isSetName(child.name)) {
        collectFiles(asDirectory(child), test, out)
        continue
      }
      if (test(child.name)) out.push(child as File)
    }
  } catch {
    // Native catalog still lists SOUND/KMP.
  }
}

async function readCatalogAtPath(path: string, setName: string, setPath: string) {
  if (!path) return null
  try {
    const uri = path.startsWith("file:") ? path : `file://${path.replace(/\\/g, "/")}`
    const file = new File(uri)
    if (!file.exists) return null
    return parseCatalogFile(await Promise.resolve(file.text()), setName, setPath)
  } catch {
    return null
  }
}

function mergeCatalog(from: DiskCatalog | null, into: DiskCatalog) {
  if (!from) return
  for (const item of from.sounds) pushItem(into.sounds, item)
  for (const item of from.styles) pushItem(into.styles, item)
  for (const item of from.pads) pushItem(into.pads, item)
}

async function ingestNativeCatalog(path: string, setName: string, setPath: string, into: DiskCatalog) {
  try {
    const raw = await audio.listPa4xCatalog(path)
    console.log("[catalog] native", path, String(raw).slice(0, 280))
    let report: { file?: string } = {}
    try {
      report = JSON.parse(String(raw)) as { file?: string }
    } catch {
      report = {}
    }
    const cached = await readCatalogAtPath(report.file || `${path.replace(/\\/g, "/")}/.arrangerbox-cache/catalog.json`, setName, setPath)
    mergeCatalog(cached, into)
  } catch (error) {
    console.log("[catalog] native failed", path, error)
  }
}

async function mergeCachedCatalog(
  folder: Directory,
  setName: string,
  setPath: string,
  into: DiskCatalog
) {
  const cached = await readCachedCatalog(folder, setName, setPath)
  if (!cached) return
  for (const item of cached.sounds) pushItem(into.sounds, item)
  for (const item of cached.styles) pushItem(into.styles, item)
  for (const item of cached.pads) pushItem(into.pads, item)
}

async function namesFromManifest(setFolder: Directory, setName: string, setPath: string, into: DiskCatalog) {
  try {
    const file = new File(new Directory(setFolder, ".arrangerbox-cache"), "manifest.txt")
    if (!file.exists) return
    const text = await Promise.resolve(file.text())
    const lines = text.split(/\r?\n/)
    let i = 0
    while (i < lines.length && !/^P\s+\d+/.test(lines[i])) i++
    const count = parseInt(lines[i]?.match(/^P\s+(\d+)/)?.[1] || "0", 10)
    i++
    for (let p = 0; p < count && i < lines.length; p++) {
      const name = (lines[i++] || "").trim()
      const cat = (lines[i++] || "").trim() || "Imported"
      i++
      const zones = parseInt(lines[i++] || "0", 10)
      if (zones > 0) i += zones
      if (!name || isGenericStem(name)) continue
      pushItem(into.sounds, {
        kind: "sound",
        name,
        category: cat === "Imported" ? categoryGuess(name, "Imported") : cat,
        fileName: "",
        setPath,
        setName,
      })
    }
  } catch {
    // Catalog still walks SET files below.
  }
}

async function walkDiskSet(dir: Directory, setName: string, setPath: string, into: DiskCatalog, sounds: boolean) {
  let children: Array<Directory | File> = []
  try {
    children = dir.list()
  } catch {
    return
  }
  for (const child of children) {
    if (!child.name || child.name.startsWith(".")) continue
    if (isDirectory(child) || isSetName(child.name)) {
      await walkDiskSet(asDirectory(child), setName, setPath, into, sounds)
      continue
    }
    const file = child as File
    const upper = file.name.toUpperCase()
    if (/\.(WAV|KSF|PCG)$/i.test(upper)) continue
    if (/\.KMP$/i.test(upper) && !sounds) continue
    if (/\.KMP$/i.test(upper)) {
      const names = (await namesFromKmp(file)).map(instrumentName)
      const list = names.length ? names : isGenericStem(stem(file.name)) ? [] : [instrumentName(stem(file.name))]
      for (const name of list) {
        pushItem(into.sounds, {
          kind: "sound",
          name,
          category: categoryGuess(name, "Imported"),
          fileName: file.name,
          setPath,
          setName,
        })
      }
      continue
    }
    let kind: LibraryKind | null = null
    if (/\.(WAV|KSF)$/i.test(upper)) kind = "sound"
    else if (/\.(STY|STG|MID|SMF)$/i.test(upper)) kind = "style"
    else if (/\.PAD$/i.test(upper)) kind = "pad"
    if (!kind) continue
    const name = instrumentName(stem(file.name))
    if (isGenericStem(name)) continue
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
      if (!name || isGenericStem(name)) continue
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
      out.push(asDirectory(child))
    }
  } catch {
    return out
  }
  return out
}

async function readCachedCatalog(setFolder: Directory, setName: string, setPath: string) {
  try {
    const cacheFile = new File(new Directory(setFolder, ".arrangerbox-cache"), "catalog.json")
    if (!cacheFile.exists) return null
    return parseCatalogFile(await Promise.resolve(cacheFile.text()), setName, setPath)
  } catch {
    return null
  }
}

function writeCatalogJson(folder: Directory, into: DiskCatalog) {
  try {
    const cache = new Directory(folder, ".arrangerbox-cache")
    if (!cache.exists) cache.create({ intermediates: true })
    const file = new File(cache, "catalog.json")
    if (!file.exists) file.create()
    const items = [
      ...into.sounds.map((item) => ({
        kind: "sound",
        name: item.name,
        category: item.category,
        file: item.fileName,
      })),
      ...into.styles.map((item) => ({
        kind: "style",
        name: item.name,
        category: item.category,
        file: item.fileName,
      })),
      ...into.pads.map((item) => ({
        kind: "pad",
        name: item.name,
        category: item.category,
        file: item.fileName,
      })),
    ]
    file.write(JSON.stringify({ ok: 1, items }))
  } catch (error) {
    console.log("[catalog] write cache failed", error)
  }
}

async function catalogOneSet(dir: Directory): Promise<DiskCatalog> {
  const setFolder = findSetFolder(dir)
  const setName = setFolder.name.replace(/\.SET$/i, "") || "Imported"
  const setPath = nativePath(setFolder)
  const into: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  const soundDir = childNamed(setFolder, "SOUND")
  const pcgs: File[] = []
  const kmps: File[] = []
  collectFiles(setFolder, (name) => /\.PCG$/i.test(name), pcgs)
  collectFiles(setFolder, (name) => /\.KMP$/i.test(name), kmps)
  console.log("[catalog] set", {
    setName,
    setPath,
    listing: (() => {
      try {
        return setFolder.list().map((item) => item.name)
      } catch (error) {
        return [`list failed: ${error instanceof Error ? error.message : String(error)}`]
      }
    })(),
    soundDir: soundDir ? nativePath(soundDir) : "",
    pcg: pcgs.map((file) => file.name),
    kmp: kmps.map((file) => file.name),
  })
  await walkDiskSet(setFolder, setName, setPath, into, true)
  if (into.sounds.length === 0) {
    for (const kmp of kmps.slice(0, 8)) await ingestNativeCatalog(nativePath(kmp), setName, setPath, into)
  }
  console.log("[catalog] pcg files ignored for the sound list", pcgs.map((file) => file.name))
  writeCatalogJson(setFolder, into)
  console.log("[catalog] done", setName, {
    sounds: into.sounds.length,
    styles: into.styles.length,
    pads: into.pads.length,
    sample: into.sounds.slice(0, 8).map((item) => item.name),
  })
  return into
}

export async function cachedFileName(setPath: string | undefined, kind: LibraryKind, name: string) {
  if (!setPath || !name) return undefined
  try {
    const cacheFile = new File(new Directory(setPath, ".arrangerbox-cache"), "catalog.json")
    if (!cacheFile.exists) return undefined
    const parsed = parseCatalogFile(await Promise.resolve(cacheFile.text()), "", setPath)
    const list = kind === "sound" ? parsed?.sounds : kind === "pad" ? parsed?.pads : parsed?.styles
    return list?.find((item) => norm(item.name) === norm(name))?.fileName
  } catch {
    return undefined
  }
}

export function setPathForName(setName?: string) {
  const root = new Directory(Paths.document, "sets")
  if (!root.exists) return undefined
  try {
    if (setName) {
      for (const name of [setName, `${setName}.SET`, setName.replace(/\.SET$/i, "")]) {
        const dir = new Directory(root, name)
        if (dir.exists) return nativePath(findSetFolder(asDirectory(dir)))
      }
    }
    const dirs = listSavedSetDirs()
    if (!dirs.length) return undefined
    return nativePath(findSetFolder(dirs[0]))
  } catch {
    return undefined
  }
}

let lastDiskCatalog: DiskCatalog | null = null

export function lastLoadedDiskCatalog(): DiskCatalog {
  return lastDiskCatalog ?? { setName: "", sounds: [], styles: [], pads: [] }
}

export async function loadDiskCatalog(): Promise<DiskCatalog> {
  const dirs = listSavedSetDirs()
  console.log(
    "[catalog] saved sets",
    dirs.map((dir) => dir.uri)
  )
  const merged: DiskCatalog = { setName: "", sounds: [], styles: [], pads: [] }
  for (const dir of dirs) {
    const next = await catalogOneSet(dir)
    if (!merged.setName) merged.setName = next.setName
    for (const item of next.sounds) pushItem(merged.sounds, item)
    for (const item of next.styles) pushItem(merged.styles, item)
    for (const item of next.pads) pushItem(merged.pads, item)
  }
  lastDiskCatalog = merged
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

function scoreName(have: string, want: string) {
  const a = norm(have)
  const b = norm(want)
  if (!a || !b) return 0
  if (a === b) return 1000
  if (a.length >= 5 && b.length >= 5) {
    if (a.includes(b)) return 400 + b.length
    if (b.includes(a)) return 300 + a.length
  }
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  return p >= 5 ? 100 + p : 0
}

export async function loadDiskItem(item: {
  kind: LibraryKind
  name: string
  setPath?: string
  fileName?: string
}): Promise<LoadResult> {
  if (item.setPath) {
    const raw = await audio.loadPa4xNamed(item.setPath, item.kind, item.name)
    console.log("[load]", item.kind, item.name, String(raw).slice(0, 240))
    const result = parseReport(raw)
    if (result.ok || !/cannot load one item/i.test(result.reason)) return result
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

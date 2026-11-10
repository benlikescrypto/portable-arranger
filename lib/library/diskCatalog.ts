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

function catalogHasRealNames(catalog: DiskCatalog | null) {
  if (!catalog) return false
  const items = [...catalog.sounds, ...catalog.styles, ...catalog.pads]
  return items.some((item) => !isGenericStem(item.name))
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
    if (/\.(WAV|KSF)$/i.test(upper)) kind = "sound"
    else if (/\.(MID|SMF)$/i.test(upper)) kind = "style"
    else continue
    const name = stem(file.name)
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
      if (isDirectory(child) || isSetName(child.name)) out.push(asDirectory(child))
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

async function catalogOneSet(dir: Directory): Promise<DiskCatalog> {
  const setFolder = findSetFolder(dir)
  const setName = setFolder.name.replace(/\.SET$/i, "") || "Imported"
  const setPath = nativePath(setFolder)
  const empty: DiskCatalog = { setName, sounds: [], styles: [], pads: [] }
  const cached = await readCachedCatalog(setFolder, setName, setPath)
  if (catalogHasRealNames(cached)) return cached!
  try {
    await audio.listPa4xCatalog(setPath)
  } catch {
    // Filename fallback below still lists WAV/SMF.
  }
  const nativeCatalog = await readCachedCatalog(setFolder, setName, setPath)
  if (catalogHasRealNames(nativeCatalog)) return nativeCatalog!
  await walkDiskSet(setFolder, setName, setPath, empty)
  return empty
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

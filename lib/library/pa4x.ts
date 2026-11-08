import { Directory, File } from "expo-file-system"

import type { SoundItem, StyleItem } from "@/lib/types"

export type SetFile = {
  relativePath: string
  size: number
  kind: string
}

export type ImportedLibrary = {
  setName: string
  adapterId: string
  adapterName: string
  sounds: SoundItem[]
  styles: StyleItem[]
  samplesLoaded: number
  skippedSamples: number
  patchesLoaded: number
  stylesLoaded: number
  compressedDecoded: number
  reason: string
  files: SetFile[]
}

export function isDirectory(item: Directory | File): item is Directory {
  return typeof (item as Directory).list === "function"
}

export function isSetName(name: string) {
  return name.toUpperCase().endsWith(".SET")
}

export function asDirectory(item: Directory | File): Directory {
  return isDirectory(item) ? item : new Directory(item.uri)
}

export function looksLikeSet(dir: Directory): boolean {
  try {
    const names = new Set(dir.list().map((item) => item.name.toUpperCase()))
    return ["SOUND", "STYLE", "PCM", "KEYBOARDSET"].filter((name) => names.has(name)).length >= 2
  } catch {
    return isSetName(dir.name)
  }
}

export function findSetFolder(root: Directory, depth = 0): Directory {
  if (isSetName(root.name) || looksLikeSet(root)) return root
  if (depth >= 4) return root
  try {
    for (const child of root.list()) {
      if (isSetName(child.name)) return asDirectory(child)
      if (!isDirectory(child) && !isSetName(child.name)) continue
      const dir = asDirectory(child)
      if (looksLikeSet(dir)) return dir
      const nested = findSetFolder(dir, depth + 1)
      if (nested !== dir && (isSetName(nested.name) || looksLikeSet(nested))) return nested
    }
  } catch {
    return root
  }
  return root
}

export function matchesPa4x(root: Directory): boolean {
  if (root.name.toUpperCase().endsWith(".SET")) return true
  const names = new Set(root.list().map((item) => item.name.toUpperCase()))
  if (["SOUND", "STYLE", "PCM"].some((name) => names.has(name))) return true
  return [...names].some((name) => name.endsWith(".PCG") || name.endsWith(".STY") || name.endsWith(".PCM"))
}

export function categoryGuess(name: string, fallback: string): string {
  const n = name.toLowerCase()
  if (["piano", "grand", "epiano", "e.piano", "rhodes", "wurly"].some((k) => n.includes(k))) return "Piano"
  if (["violin", "string", "viola", "cello"].some((k) => n.includes(k))) return "Strings"
  if (
    ["oud", "ney", "kanun", "darbuka", "riq", "saz", "bouzouki", "duduk", "mizrahi", "arabic", "orient", "israeli", "baladi"].some(
      (k) => n.includes(k)
    )
  ) {
    return "Oriental"
  }
  if (n.includes("bass")) return "Bass"
  if (["brass", "trumpet", "trombone", "horn"].some((k) => n.includes(k))) return "Brass"
  if (["sax", "flute", "clarinet"].some((k) => n.includes(k))) return "Woodwind"
  if (["organ", "hammond"].some((k) => n.includes(k))) return "Organ"
  if (["pad", "lead", "synth"].some((k) => n.includes(k))) return "Synth"
  if (["drum", "kit", "perc"].some((k) => n.includes(k))) return "Percussion"
  if (n.includes("guitar")) return "Guitar"
  return fallback
}

export function fileKind(name: string): string {
  const upper = name.toUpperCase()
  if (upper.endsWith(".PCG")) return "SOUND"
  if (upper.endsWith(".STY")) return "STYLE"
  if (upper.endsWith(".PCM")) return "PCM"
  if (upper.endsWith(".KMP")) return "MULTISAMPLE"
  if (upper.endsWith(".KSF")) return "SAMPLE"
  if (upper.endsWith(".PRF")) return "KEYBOARD SET"
  if (upper.endsWith(".PAD")) return "PAD"
  if (upper.endsWith(".WAV")) return "WAV"
  if (upper.endsWith(".MID") || upper.endsWith(".SMF")) return "MIDI"
  if (upper.endsWith(".STG")) return "STYLE"
  if (upper.endsWith(".KST")) return "SET"
  return "FILE"
}

export async function inspectPa4x(root: Directory): Promise<ImportedLibrary> {
  const setName = root.name.replace(/\.SET$/i, "") || "Imported SET"
  const files: SetFile[] = []
  const sounds: SoundItem[] = []
  const styles: StyleItem[] = []

  await walk(root, "", async (rel, item) => {
    const name = item.name
    const kind = fileKind(name)
    const size = "size" in item && typeof item.size === "number" ? item.size : 0
    files.push({ relativePath: rel, size, kind })
    if (!isDirectory(item) && name.toUpperCase().endsWith(".STY")) {
      styles.push({
        id: styles.length,
        name: name.replace(/\.[^.]+$/, ""),
        category: "Style",
        tempo: 0,
        bank: name,
        source: "PA4X SET",
      })
    }
  })

  return {
    setName,
    adapterId: "korg-pa4x",
    adapterName: "Korg PA4X",
    sounds,
    styles,
    samplesLoaded: 0,
    skippedSamples: 0,
    patchesLoaded: 0,
    stylesLoaded: 0,
    compressedDecoded: 0,
    reason: "",
    files,
  }
}

export async function walk(
  dir: Directory,
  prefix: string,
  visit: (rel: string, item: Directory | File) => Promise<void> | void
) {
  for (const child of dir.list()) {
    const rel = prefix ? `${prefix}/${child.name}` : child.name
    await visit(rel, child)
    if (isDirectory(child)) await walk(child, rel, visit)
  }
}

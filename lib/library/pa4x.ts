import { Directory, File } from "expo-file-system"

import { extractKorgNames } from "@/lib/library/binaryNames"
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
  files: SetFile[]
}

export function isDirectory(item: Directory | File): item is Directory {
  return typeof (item as Directory).list === "function"
}

export function looksLikeSet(dir: Directory): boolean {
  const names = new Set(
    dir.list().map((item) => item.name.toUpperCase())
  )
  return ["SOUND", "STYLE", "PCM", "KEYBOARDSET"].filter((name) => names.has(name)).length >= 2
}

export function findSetFolder(root: Directory, depth = 0): Directory {
  if (root.name.toUpperCase().endsWith(".SET") || looksLikeSet(root)) return root
  if (depth >= 4) return root
  for (const child of root.list()) {
    if (!isDirectory(child)) continue
    if (child.name.toUpperCase().endsWith(".SET") || looksLikeSet(child)) return child
    const nested = findSetFolder(child, depth + 1)
    if (nested !== child && (nested.name.toUpperCase().endsWith(".SET") || looksLikeSet(nested))) return nested
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
    if (!isDirectory(item) && [".PCG", ".STY", ".PRF", ".PAD"].some((ext) => name.toUpperCase().endsWith(ext))) {
      const raw = await item.bytes()
      const slice = raw.subarray(0, Math.min(raw.length, 4_000_000))
      const names = extractKorgNames(slice)
      const bank = name.replace(/\.[^.]+$/, "")
      if (name.toUpperCase().endsWith(".STY")) {
        for (const n of names) {
          styles.push({
            id: 10_000 + styles.length,
            name: n,
            category: categoryGuess(n, "Style"),
            tempo: 100,
            bank,
            source: "PA4X SET",
          })
        }
      } else {
        for (const n of names) {
          sounds.push({
            id: 10_000 + sounds.length,
            name: n,
            category: categoryGuess(n, name.toUpperCase().endsWith(".PAD") ? "Pad" : "Imported"),
            bank,
            source: "PA4X SET",
          })
        }
      }
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

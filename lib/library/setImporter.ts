import { audio } from "arrangerbox-audio"
import { Directory, File, Paths } from "expo-file-system"

import {
  findSetFolder,
  inspectPa4x,
  isDirectory,
  matchesPa4x,
  type ImportedLibrary,
} from "@/lib/library/pa4x"

export type ImportProgress = {
  message: string
  fraction: number
}

function nativePath(file: File): string {
  const uri = file.uri
  if (uri.startsWith("file://")) return decodeURIComponent(uri.replace(/^file:\/\//, ""))
  return uri
}

function isCancel(error: unknown): boolean {
  const text = `${(error as { code?: string; message?: string })?.code ?? ""} ${(error as { message?: string })?.message ?? error}`
  return /cancel/i.test(text)
}

async function copyTree(
  src: Directory,
  dest: Directory,
  onFile: (file: File, rel: string) => void
) {
  dest.create({ intermediates: true, idempotent: true })
  for (const child of src.list()) {
    if (isDirectory(child)) {
      await copyTree(child, new Directory(dest, child.name), onFile)
    } else {
      const out = new File(dest, child.name)
      await child.copy(out, { overwrite: true })
      onFile(out, child.name)
    }
  }
}

export async function importPa4xSet(onProgress: (progress: ImportProgress) => void): Promise<ImportedLibrary | null> {
  let picked: Directory
  try {
    picked = await Directory.pickDirectoryAsync()
  } catch (error) {
    if (isCancel(error)) return null
    throw error
  }

  const setFolder = findSetFolder(picked)
  if (!matchesPa4x(setFolder) && !setFolder.name.toUpperCase().endsWith(".SET")) {
    onProgress({ message: "That folder does not look like a Korg PA4X SET. Importing it anyway.", fraction: 0.04 })
  }

  onProgress({ message: `Reading ${setFolder.name}…`, fraction: 0.05 })
  const inspected = await inspectPa4x(setFolder)
  onProgress({
    message: `Found ${inspected.sounds.length} sounds, ${inspected.styles.length} styles`,
    fraction: 0.18,
  })

  const dest = new Directory(Paths.document, "sets", inspected.setName)
  if (dest.exists) dest.delete()
  dest.create({ intermediates: true, idempotent: true })

  const loadable: File[] = []
  let copied = 0
  await copyTree(setFolder, dest, (file) => {
    copied++
    const upper = file.name.toUpperCase()
    if (upper.endsWith(".WAV") || upper.endsWith(".KSF") || upper.endsWith(".PCM")) loadable.push(file)
    if (copied % 8 === 0) {
      onProgress({
        message: `Copying ${file.name}`,
        fraction: 0.18 + 0.5 * Math.min(1, copied / 400),
      })
    }
  })

  let samples = 0
  for (let i = 0; i < loadable.length; i++) {
    const file = loadable[i]
    onProgress({
      message: `Loading ${file.name}`,
      fraction: 0.7 + 0.28 * ((i + 1) / Math.max(loadable.length, 1)),
    })
    const path = nativePath(file)
    const name = file.name.replace(/\.[^.]+$/, "")
    const upper = file.name.toUpperCase()
    if (upper.endsWith(".WAV")) {
      if ((await audio.loadWav(path, name, "Imported")) >= 0) samples++
    } else if (upper.endsWith(".KSF")) {
      if ((await audio.loadKsf(path, name, "Imported")) >= 0) samples++
    } else if (upper.endsWith(".PCM")) {
      samples += await audio.scanPcmBank(path)
    }
  }

  onProgress({ message: "Ready", fraction: 1 })
  return { ...inspected, samplesLoaded: samples }
}

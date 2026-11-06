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

function nativePath(file: File | Directory): string {
  const uri = file.uri
  if (uri.startsWith("file://")) return decodeURIComponent(uri.replace(/^file:\/\//, ""))
  return uri
}

function isCancel(error: unknown): boolean {
  const text = `${(error as { code?: string; message?: string })?.code ?? ""} ${(error as { message?: string })?.message ?? error}`
  return /cancel/i.test(text)
}

async function copyTree(src: Directory, dest: Directory, onCopied: (copied: number, name: string) => void) {
  dest.create({ intermediates: true, idempotent: true })
  let copied = 0
  const walkCopy = async (from: Directory, to: Directory) => {
    to.create({ intermediates: true, idempotent: true })
    for (const child of from.list()) {
      if (isDirectory(child)) {
        await walkCopy(child, new Directory(to, child.name))
      } else {
        const out = new File(to, child.name)
        await child.copy(out, { overwrite: true })
        copied++
        onCopied(copied, child.name)
      }
    }
  }
  await walkCopy(src, dest)
}

function parseReport(raw: string) {
  try {
    return JSON.parse(raw) as {
      ok?: number
      samples?: number
      patches?: number
      styles?: number
      compressed?: number
      skipped?: number
    }
  } catch {
    return {}
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
    onProgress({
      message: "That folder does not look like a Korg PA4X SET. Importing the selected folder anyway.",
      fraction: 0.04,
    })
  }

  const setName = setFolder.name.replace(/\.SET$/i, "") || "Imported SET"
  onProgress({ message: `Copying ${setFolder.name}…`, fraction: 0.06 })

  const dest = new Directory(Paths.document, "sets", setName)
  if (dest.exists) dest.delete()
  dest.create({ intermediates: true, idempotent: true })
  await copyTree(setFolder, dest, (copied, name) => {
    if (copied % 8 === 0) {
      onProgress({
        message: `Copying ${name}`,
        fraction: 0.06 + 0.52 * Math.min(1, copied / 400),
      })
    }
  })

  onProgress({ message: "Reading SET names…", fraction: 0.62 })
  const inspected = await inspectPa4x(dest)

  onProgress({ message: "Loading PCM, KMP, PCG and STY into the engine…", fraction: 0.72 })
  const report = parseReport(await audio.loadPa4xSet(nativePath(dest)))

  onProgress({ message: "Ready", fraction: 1 })
  return {
    ...inspected,
    setName: inspected.setName || setName,
    samplesLoaded: report.samples ?? 0,
    skippedSamples: report.skipped ?? 0,
    patchesLoaded: report.patches ?? 0,
    stylesLoaded: report.styles ?? 0,
    compressedDecoded: report.compressed ?? 0,
  }
}

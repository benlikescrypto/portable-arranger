import { audio } from "arrangerbox-audio"
import { Directory, File, Paths } from "expo-file-system"

import { inspectPa4x, type ImportedLibrary } from "@/lib/library/pa4x"

export type ImportProgress = {
  message: string
  fraction: number
}

function nativePath(file: File | Directory): string {
  const uri = file.uri
  if (uri.startsWith("file://")) return decodeURIComponent(uri.replace(/^file:\/\//, ""))
  return uri
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\.SET$/i, "") || "Imported"
}

function copyFileName(name: string) {
  const trimmed = (name || "style").replace(/[\\/:*?"<>|]/g, "_")
  if (/\.[A-Za-z0-9]{1,8}$/.test(trimmed)) return trimmed
  return `${trimmed}.STY`
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
      pcgFiles?: number
      pcgNames?: number
      missing?: number
      reason?: string
    }
  } catch {
    return {}
  }
}

function finishImport(
  inspected: ImportedLibrary,
  setName: string,
  report: ReturnType<typeof parseReport>
): ImportedLibrary {
  return {
    ...inspected,
    setName: inspected.setName || setName,
    samplesLoaded: report.samples ?? 0,
    skippedSamples: report.skipped ?? 0,
    patchesLoaded: report.patches ?? 0,
    stylesLoaded: report.styles ?? 0,
    compressedDecoded: report.compressed ?? 0,
    reason: report.reason ?? "",
  }
}

async function loadCopiedFolder(
  dest: Directory,
  setName: string,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportedLibrary> {
  onProgress({ message: "Reading PA4X names…", fraction: 0.62 })
  const inspected = await inspectPa4x(dest)
  onProgress({ message: "Loading STY, PCM, KMP and PCG into the engine…", fraction: 0.72 })
  const report = parseReport(await audio.loadPa4xSet(nativePath(dest)))
  onProgress({ message: "Ready", fraction: 1 })
  return finishImport(inspected, setName, report)
}

async function importFiles(onProgress: (progress: ImportProgress) => void): Promise<ImportedLibrary | null> {
  const picked = await File.pickFileAsync({
    multipleFiles: true,
    mimeTypes: ["*/*"],
  })
  if (picked.canceled || !picked.result.length) return null

  const files = picked.result
  const first = files[0].name.replace(/\.[^.]+$/, "")
  const setName = safeName(files.length === 1 ? first : `${first} +${files.length - 1}`)
  onProgress({ message: `Copying ${files.length} file${files.length === 1 ? "" : "s"}…`, fraction: 0.08 })

  const dest = new Directory(Paths.document, "sets", setName)
  if (dest.exists) dest.delete()
  dest.create({ intermediates: true, idempotent: true })
  for (let i = 0; i < files.length; i++) {
    const src = files[i]
    const destName = copyFileName(src.name)
    await src.copy(new File(dest, destName), { overwrite: true })
    onProgress({
      message: `Copying ${destName}`,
      fraction: 0.08 + 0.5 * ((i + 1) / files.length),
    })
  }
  return loadCopiedFolder(dest, setName, onProgress)
}

export async function importPa4xSet(onProgress: (progress: ImportProgress) => void): Promise<ImportedLibrary | null> {
  return importFiles(onProgress)
}

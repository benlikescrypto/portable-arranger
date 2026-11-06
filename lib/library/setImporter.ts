import { audio } from "arrangerbox-audio"
import { Directory, File, Paths } from "expo-file-system"

import { findSetFolder, inspectPa4x, isDirectory, type ImportedLibrary } from "@/lib/library/pa4x"

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

function isCanceled(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error)
  return /cancel|cancell?ed|dismiss|abort/i.test(msg)
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
  const setFolder = findSetFolder(dest)
  onProgress({ message: `Reading ${setFolder.name}…`, fraction: 0.62 })
  const inspected = await inspectPa4x(setFolder)
  onProgress({ message: "Loading STY, PCM, KMP and PCG into the engine…", fraction: 0.72 })
  const report = parseReport(await audio.loadPa4xSet(nativePath(setFolder)))
  onProgress({ message: "Ready", fraction: 1 })
  return finishImport(inspected, setName, report)
}

function prepareDest(setName: string) {
  const dest = new Directory(Paths.document, "sets", setName)
  if (dest.exists) dest.delete()
  dest.create({ intermediates: true, idempotent: true })
  return dest
}

function countFiles(dir: Directory): number {
  let n = 0
  for (const child of dir.list()) {
    if (child.name.startsWith(".")) continue
    n += isDirectory(child) ? countFiles(child) : 1
  }
  return n
}

async function copyTree(
  src: Directory,
  dest: Directory,
  onFile: (copied: number, name: string, total: number) => void,
  state: { copied: number; total: number }
) {
  dest.create({ intermediates: true, idempotent: true })
  for (const child of src.list()) {
    if (!child.name || child.name.startsWith(".")) continue
    if (isDirectory(child)) {
      await copyTree(child, new Directory(dest, child.name), onFile, state)
      continue
    }
    await child.copy(new File(dest, child.name), { overwrite: true })
    state.copied += 1
    onFile(state.copied, child.name, state.total)
  }
}

async function importDirectory(
  picked: Directory,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportedLibrary> {
  onProgress({ message: `Opening ${picked.name}…`, fraction: 0.04 })
  let setFolder = picked
  try {
    setFolder = findSetFolder(picked)
  } catch {
    setFolder = picked
  }
  const setName = safeName(setFolder.name)
  let total = 1
  try {
    total = Math.max(1, countFiles(setFolder))
  } catch {
    total = 1
  }
  onProgress({
    message: `Copying ${setFolder.name} (${total} file${total === 1 ? "" : "s"})…`,
    fraction: 0.08,
  })

  const dest = prepareDest(setName)
  try {
    await copyTree(
      setFolder,
      dest,
      (copied, name, all) => {
        onProgress({
          message: `Copying ${name}`,
          fraction: 0.08 + 0.5 * (copied / Math.max(1, all)),
        })
      },
      { copied: 0, total }
    )
  } catch {
    if (dest.exists) dest.delete()
    dest.create({ intermediates: true, idempotent: true })
    await setFolder.copy(dest, { overwrite: true })
    onProgress({ message: `Copied ${setFolder.name}`, fraction: 0.58 })
  }
  return loadCopiedFolder(dest, setName, onProgress)
}

async function pickSetFolder(): Promise<Directory | null> {
  if (typeof Directory.pickDirectoryAsync !== "function") return null
  try {
    return await Directory.pickDirectoryAsync()
  } catch (error) {
    if (isCanceled(error)) return null
    throw error
  }
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

  const dest = prepareDest(setName)
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
  onProgress({ message: "Pick a PA4X .SET folder…", fraction: 0 })
  const folder = await pickSetFolder()
  if (folder) return importDirectory(folder, onProgress)
  onProgress({ message: "Or pick STY / MID / WAV / SFZ files…", fraction: 0 })
  return importFiles(onProgress)
}

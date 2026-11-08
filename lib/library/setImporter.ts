import { audio } from "arrangerbox-audio"
import { device } from "arrangerbox-device"
import { Directory, File, Paths } from "expo-file-system"
import { Platform } from "react-native"

import {
  asDirectory,
  findSetFolder,
  inspectPa4x,
  isDirectory,
  isSetName,
  type ImportedLibrary,
} from "@/lib/library/pa4x"

export type ImportProgress = {
  message: string
  fraction: number
}

export type ImportMode = "folder" | "files"

function logImport(...args: unknown[]) {
  console.log("[import]", ...args)
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

function isStyleFileName(name: string) {
  return /\.(STY|MID|SMF)$/i.test(name)
}

function* walkStyleFiles(dir: Directory): Generator<File> {
  try {
    for (const child of dir.list()) {
      if (child.name.startsWith(".")) continue
      if (isDirectory(child) || isSetName(child.name)) {
        yield* walkStyleFiles(asDirectory(child))
        continue
      }
      if (isStyleFileName(child.name)) yield child as File
    }
  } catch (error) {
    logImport("walkStyleFiles failed", dir.uri, error)
  }
}

function asciiMagic(bytes: Uint8Array, n = 8) {
  const slice = bytes.subarray(0, Math.min(n, bytes.length))
  const ascii = Array.from(slice)
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
    .join("")
  const hex = Array.from(slice)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")
  return `${ascii} ${hex}`.trim()
}

async function peekFile(file: File) {
  try {
    const bytes = await file.bytes()
    const size = file.size ?? bytes.length
    const info = `${file.name} ${size}B magic=${asciiMagic(bytes)}`
    logImport("peek", info)
    return info
  } catch (error) {
    const info = `${file.name} peek failed: ${error instanceof Error ? error.message : String(error)}`
    logImport("peek", info)
    return info
  }
}

async function peekFolder(dir: Directory) {
  const peeks: string[] = []
  try {
    for (const child of dir.list()) {
      if (isDirectory(child) || isSetName(child.name)) {
        peeks.push(...(await peekFolder(asDirectory(child))))
        if (peeks.length >= 4) break
        continue
      }
      if (isStyleFileName(child.name)) {
        peeks.push(await peekFile(child))
        if (peeks.length >= 4) break
      }
    }
  } catch (error) {
    logImport("peekFolder failed", dir.uri, error)
  }
  return peeks
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
  report: ReturnType<typeof parseReport>,
  extraReason = ""
): ImportedLibrary {
  const reason = [report.reason ?? "", extraReason].filter(Boolean).join(" ")
  return {
    ...inspected,
    setName: inspected.setName || setName,
    samplesLoaded: report.samples ?? 0,
    skippedSamples: report.skipped ?? 0,
    patchesLoaded: report.patches ?? 0,
    stylesLoaded: report.styles ?? 0,
    compressedDecoded: report.compressed ?? 0,
    reason,
  }
}

async function loadCopiedFolder(
  dest: Directory,
  setName: string,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportedLibrary> {
  const setFolder = findSetFolder(dest)
  logImport("load", {
    dest: dest.uri,
    set: setFolder.uri,
    name: setFolder.name,
    listing: (() => {
      try {
        return setFolder.list().map((item) => `${item.name}${isDirectory(item) || isSetName(item.name) ? "/" : ""}`)
      } catch (error) {
        return [`list failed: ${error instanceof Error ? error.message : String(error)}`]
      }
    })(),
  })
  onProgress({ message: `Reading ${setFolder.name}…`, fraction: 0.62 })
  const inspected = await inspectPa4x(setFolder)
  const peeks = await peekFolder(setFolder)
  onProgress({ message: "Loading STY, PCM, KMP and PCG into the engine…", fraction: 0.72 })
  let raw = await audio.loadPa4xSet(nativePath(setFolder))
  logImport("engine", raw)
  let report = parseReport(raw)
  if ((report.styles ?? 0) === 0) {
    try {
      for (const child of walkStyleFiles(setFolder)) {
        const again = await audio.loadPa4xSet(nativePath(child))
        logImport("engine-file", child.name, again)
        const next = parseReport(again)
        if ((next.styles ?? 0) > (report.styles ?? 0)) {
          raw = again
          report = next
        }
      }
    } catch (error) {
      logImport("per-file retry failed", error)
    }
  }
  onProgress({ message: "Ready", fraction: 1 })
  const extra =
    (report.styles ?? 0) === 0 && peeks.length
      ? peeks.join(" · ")
      : peeks.length
        ? ""
        : "Copied folder had no STY files."
  return finishImport(inspected, setName, report, extra)
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
    if (isDirectory(child) || isSetName(child.name)) n += countFiles(asDirectory(child))
    else n += 1
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
    if (isDirectory(child) || isSetName(child.name)) {
      await copyTree(asDirectory(child), new Directory(dest, child.name), onFile, state)
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
  logImport("picked folder", picked.uri, picked.name, "exists", picked.exists)
  onProgress({ message: `Opening ${picked.name}…`, fraction: 0.04 })
  let setFolder = picked
  try {
    setFolder = findSetFolder(picked)
  } catch (error) {
    logImport("findSetFolder failed", error)
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
  } catch (error) {
    logImport("copyTree failed, trying directory.copy", error)
    if (dest.exists) dest.delete()
    dest.create({ intermediates: true, idempotent: true })
    await setFolder.copy(dest, { overwrite: true })
    onProgress({ message: `Copied ${setFolder.name}`, fraction: 0.58 })
  }
  return loadCopiedFolder(dest, setName, onProgress)
}

async function pickSetFolderJs(): Promise<Directory | null> {
  if (typeof Directory.pickDirectoryAsync !== "function") return null
  try {
    return await Directory.pickDirectoryAsync()
  } catch (error) {
    logImport("Directory.pickDirectoryAsync", error)
    if (isCanceled(error)) return null
    throw error
  }
}

async function importNativeFolder(onProgress: (progress: ImportProgress) => void): Promise<ImportedLibrary | null> {
  if (Platform.OS !== "ios") return null
  const pick = device.pickAndCopyImportFolder()
  if (!pick) return null
  onProgress({ message: "Pick the .SET folder, then tap Open…", fraction: 0 })
  const result = await pick
  logImport("native folder pick", result)
  if (!result || result.canceled) return null
  if (result.error && result.error !== "android-js-picker") {
    throw new Error(result.error)
  }
  if (!result.uri && !result.path) return null
  const dest = new Directory(result.uri || result.path || "")
  if (!dest.exists) {
    throw new Error(`Copied folder missing: ${result.uri || result.path}`)
  }
  onProgress({
    message: `Copied ${result.name || dest.name} (${result.files ?? "?"} files)…`,
    fraction: 0.6,
  })
  return loadCopiedFolder(dest, safeName(result.name || dest.name), onProgress)
}

async function importFiles(onProgress: (progress: ImportProgress) => void): Promise<ImportedLibrary | null> {
  const picked = await File.pickFileAsync({
    multipleFiles: true,
    mimeTypes: ["*/*"],
  })
  if (picked.canceled || !picked.result.length) return null

  const files = picked.result
  logImport(
    "picked files",
    files.map((file) => ({ name: file.name, uri: file.uri, size: file.size }))
  )

  const setFile = files.find((file) => isSetName(file.name))
  if (setFile && files.length === 1) {
    return importDirectory(asDirectory(setFile), onProgress)
  }

  const first = files[0].name.replace(/\.[^.]+$/, "")
  const setName = safeName(files.length === 1 ? first : `${first} +${files.length - 1}`)
  onProgress({ message: `Copying ${files.length} file${files.length === 1 ? "" : "s"}…`, fraction: 0.08 })

  const dest = prepareDest(setName)
  for (let i = 0; i < files.length; i++) {
    const src = files[i]
    if (isSetName(src.name)) {
      await copyTree(asDirectory(src), new Directory(dest, src.name), () => undefined, { copied: 0, total: 1 })
      continue
    }
    const destName = copyFileName(src.name)
    await src.copy(new File(dest, destName), { overwrite: true })
    await peekFile(new File(dest, destName))
    onProgress({
      message: `Copying ${destName}`,
      fraction: 0.08 + 0.5 * ((i + 1) / files.length),
    })
  }
  return loadCopiedFolder(dest, setName, onProgress)
}

export async function importPa4xSet(
  mode: ImportMode,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportedLibrary | null> {
  if (mode === "files") {
    onProgress({ message: "Pick PA4X STY, Style Record SMF, or SET samples…", fraction: 0 })
    return importFiles(onProgress)
  }

  onProgress({ message: "Pick a PA4X .SET folder, then tap Open…", fraction: 0 })
  try {
    const nativeLib = await importNativeFolder(onProgress)
    if (nativeLib) return nativeLib
  } catch (error) {
    logImport("native folder pick failed, trying JS picker", error)
  }

  const folder = await pickSetFolderJs()
  if (!folder) return null
  return importDirectory(folder, onProgress)
}

import { Directory, File } from "expo-file-system"

import { aiRoot, jobFolder, nativePath, type AiKind, type AiManifest } from "./client"

/** One finished AI result kept on the device (Documents/ai/<id>/ + ai/library.json). */
export type AiEntry = {
  id: string
  kind: AiKind
  name: string
  created: number
  manifest: AiManifest
}

/** A job that was uploaded but not yet downloaded (survives an app restart). */
export type AiPending = { id: string; kind: AiKind; name: string; started: number }

type Saved = { entries: AiEntry[]; pending: AiPending[] }

function indexFile() {
  return new File(aiRoot(), "library.json")
}

export async function readAiLibrary(): Promise<Saved> {
  try {
    const f = indexFile()
    if (!f.exists) return { entries: [], pending: [] }
    const raw = JSON.parse(await f.text()) as Partial<Saved>
    const entries = (raw.entries ?? []).filter((e) => new Directory(aiRoot(), e.id).exists)
    return { entries, pending: raw.pending ?? [] }
  } catch {
    return { entries: [], pending: [] }
  }
}

export function writeAiLibrary(saved: Saved) {
  try {
    const f = indexFile()
    if (!f.exists) f.create({ intermediates: true })
    f.write(JSON.stringify(saved))
  } catch {
    // best effort (web preview)
  }
}

export function removeAiFiles(id: string) {
  try {
    const dir = jobFolder(id)
    if (dir.exists) dir.delete()
  } catch {
    // already gone
  }
}

/** Native paths of the files the engine loads for an entry. */
export function enginePaths(entry: AiEntry) {
  const dir = jobFolder(entry.id)
  return {
    styles: entry.manifest.styles.map((s) => ({ ...s, path: nativePath(new File(dir, s.file)) })),
    sounds: entry.manifest.sounds.map((s) => ({ ...s, path: nativePath(new File(dir, s.file)) })),
  }
}

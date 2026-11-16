import { Directory, File, Paths, UploadType } from "expo-file-system"

import { accessToken } from "@/lib/supabase"

import { aiConfig } from "./config"

export type AiKind = "drums" | "sounds"

export type AiSection = { role: string; bar0: number; bar1: number; start: number; end: number; cluster: number }

export type AiZone = { root: number; lo: number; hi: number; tune: number; loop: boolean; seconds: number }

export type AiSound = {
  name: string
  category: string
  stem: string
  file: string
  sustained: boolean
  zones: AiZone[]
  range: [number, number]
  segments: [number, number][]
}

export type AiManifest = {
  kind: AiKind
  name: string
  duration: number
  bpm?: number
  meter?: number
  bars?: number
  barTimes?: number[]
  sections?: AiSection[]
  fills?: { bar: number; into: number | null }[]
  elements?: Record<string, { bar0: number; bar1: number; source: string }>
  timeline?: { stem: string; category: string; start: number; end: number }[]
  styles: { name: string; file: string; type: "audio" | "gm" }[]
  sounds: AiSound[]
  files: string[]
  sizes?: Record<string, number>
  seconds?: number
}

export type AiJobStatus = "queued" | "running" | "done" | "error"

export type AiJob = {
  id: string
  kind: AiKind
  name: string
  status: AiJobStatus
  stage: string
  progress: number
  message: string
  created: number
  updated: number
  result?: AiManifest
}

export class AiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/** The signed-in user's Supabase access token; the server checks it on every call. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken()
  if (!token) throw new AiError("Sign in to use ArrangerBox AI.")
  return { Authorization: `Bearer ${token}` }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = path === "/v1/health" ? {} : await authHeaders()
  let res: Response
  try {
    res = await fetch(aiConfig.url + path, { ...init, headers: { ...auth, ...(init?.headers ?? {}) } })
  } catch {
    throw new AiError("No connection to the ArrangerBox AI server.")
  }
  if (!res.ok) {
    let detail = ""
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? ""
    } catch {
      // not JSON
    }
    throw new AiError(detail || `The AI server answered ${res.status}.`, res.status)
  }
  return (await res.json()) as T
}

export async function serverOnline(): Promise<boolean> {
  try {
    const r = await api<{ ok: boolean }>("/v1/health")
    return r.ok === true
  } catch {
    return false
  }
}

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  aif: "audio/aiff",
  aiff: "audio/aiff",
}

export function mimeOf(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return MIME[ext] ?? "application/octet-stream"
}

/** Uploads the song and starts a job. Resolves with the job id. */
export async function startJob(
  song: File,
  kind: AiKind,
  name: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const task = song.createUploadTask(`${aiConfig.url}/v1/jobs`, {
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    httpMethod: "POST",
    headers: await authHeaders(),
    parameters: { kind, name },
    mimeType: mimeOf(song.name),
    sessionType: "foreground",
    signal,
    // Native progress counts arrive as BigInt on iOS.
    onProgress: (p) => {
      const sent = Number(p.bytesSent)
      const total = Number(p.totalBytes)
      onProgress(total > 0 ? Math.min(1, sent / total) : 0)
    },
  })
  let result
  try {
    result = await task.uploadAsync()
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error
    throw new AiError("The upload failed. Check the connection and try again.")
  }
  let body: { id?: string; detail?: string } = {}
  try {
    body = JSON.parse(result.body)
  } catch {
    // not JSON
  }
  if (result.status < 200 || result.status >= 300 || !body.id) {
    throw new AiError(body.detail || `Upload refused (${result.status}).`)
  }
  return body.id
}

export const getJob = (id: string) => api<AiJob>(`/v1/jobs/${id}`)

export async function deleteJob(id: string) {
  try {
    await api(`/v1/jobs/${id}`, { method: "DELETE" })
  } catch {
    // results expire on the server anyway
  }
}

export function aiRoot() {
  const dir = new Directory(Paths.document, "ai")
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

export function jobFolder(id: string) {
  return new Directory(aiRoot(), id)
}

/** Downloads every result file of a finished job into Documents/ai/<id>/. */
export async function downloadResult(job: AiJob, onProgress: (fraction: number) => void): Promise<Directory> {
  const manifest = job.result
  if (!manifest) throw new AiError("The job has no result.")
  const dir = jobFolder(job.id)
  if (dir.exists) dir.delete()
  dir.create({ intermediates: true, idempotent: true })
  const names = [...manifest.files]
  const sizes = manifest.sizes ?? {}
  const total = names.reduce((a, n) => a + (sizes[n] ?? 1), 0) || 1
  let done = 0
  const headers = await authHeaders()
  for (const name of names) {
    const dest = new File(dir, name)
    const task = File.createDownloadTask(`${aiConfig.url}/v1/jobs/${job.id}/files/${encodeURIComponent(name)}`, dest, {
      headers,
      sessionType: "foreground",
      onProgress: (p) => onProgress(Math.min(1, (done + (Number(p.bytesWritten) || 0)) / total)),
    })
    let file: File | null = null
    try {
      file = await task.downloadAsync()
    } catch {
      file = null
    }
    if (!file || !file.exists) throw new AiError(`Could not download ${name}.`)
    done += sizes[name] ?? 1
    onProgress(done / total)
  }
  new File(dir, "manifest.json").write(JSON.stringify(manifest))
  return dir
}

/** Fetches a demo song (rendered on the server from original MIDI) into the cache. */
export async function fetchDemo(name: "demo_groove.mp3" | "demo_keys.mp3" | "demo_waltz.mp3"): Promise<File> {
  const dest = new File(Paths.cache, name)
  if (dest.exists && dest.size > 10000) return dest
  if (dest.exists) dest.delete()
  const task = File.createDownloadTask(`${aiConfig.url}/v1/demo/${name}`, dest, {
    headers: await authHeaders(),
    sessionType: "foreground",
  })
  const file = await task.downloadAsync().catch(() => null)
  if (!file || !file.exists || file.size < 10000) throw new AiError("Could not download the demo song.")
  return file
}

export function nativePath(entry: File | Directory) {
  let uri = entry.uri || ""
  uri = uri.replace(/^file:\/\/localhost/i, "file://")
  if (uri.startsWith("file://")) return decodeURIComponent(uri.replace(/^file:\/\//, ""))
  return uri
}

import { audio, isAudioNativeAvailable } from "arrangerbox-audio"
import { File } from "expo-file-system"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  AiError,
  deleteJob,
  downloadResult,
  fetchDemo,
  getJob,
  serverOnline,
  startJob,
  type AiJob,
  type AiKind as AnyAiKind,
} from "@/lib/ai/client"
import { aiConfigured } from "@/lib/ai/config"
import { enginePaths, readAiLibrary, removeAiFiles, writeAiLibrary, type AiEntry, type AiPending } from "@/lib/ai/library"
import type { useArranger } from "@/hooks/useArranger"

type Vm = ReturnType<typeof useArranger>
// The drum-style and sound builders (parked until their step of the AI pipeline is retested).
type AiKind = Exclude<AnyAiKind, "stems">

export type AiPhase = "uploading" | "queued" | "processing" | "downloading" | "loading" | "done" | "error"

export type AiActive = {
  kind: AiKind
  name: string
  phase: AiPhase
  /** 0..1 over the whole job (upload, GPU, download, load). */
  progress: number
  stage: string
  message: string
  jobId?: string
  entryId?: string
  startedAt: number
}

/** Engine ids of a loaded entry (styles in manifest order, sounds in manifest order). */
export type AiLoaded = { styleIds: number[]; soundIds: number[]; warning?: string }

export const AI_STAGES: { id: string; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "separate", label: "Separate" },
  { id: "analyze", label: "Analyze" },
  { id: "build", label: "Build" },
  { id: "download", label: "Download" },
  { id: "load", label: "Load" },
]

/** Server stage -> the step shown in the app. */
export function stepOf(a: AiActive): number {
  if (a.phase === "uploading") return 0
  if (a.phase === "queued") return 1
  if (a.phase === "downloading") return 4
  if (a.phase === "loading") return 5
  if (a.phase === "done") return 6
  const s = a.stage
  if (s === "start" || s === "decode" || s === "separate" || s === "queued") return 1
  if (s === "beats" || s === "sections" || s === "tag" || s === "notes") return 2
  return 3
}

const POLL_MS = 1500
// The engine cannot unload, so load each saved entry once per app run.
const loadedOnce = new Map<string, AiLoaded>()
let booted = false

function parseReport(raw: string): { ok?: number; id?: number; kits?: number; kitsFailed?: number; reason?: string } {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function useAiLab(vm: Vm) {
  const vmRef = useRef(vm)
  vmRef.current = vm
  const [online, setOnline] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<AiEntry[]>([])
  const [active, setActive] = useState<Record<AiKind, AiActive | null>>({ drums: null, sounds: null })
  const [loaded, setLoaded] = useState<Record<string, AiLoaded>>({})
  const entriesRef = useRef<AiEntry[]>([])
  const pendingRef = useRef<AiPending[]>([])
  const cancelled = useRef<Record<AiKind, boolean>>({ drums: false, sounds: false })
  const aborts = useRef<Record<AiKind, AbortController | null>>({ drums: null, sounds: null })
  const alive = useRef(true)

  const persist = useCallback(() => {
    writeAiLibrary({ entries: entriesRef.current, pending: pendingRef.current })
  }, [])

  const patch = useCallback((kind: AiKind, fields: Partial<AiActive> | null) => {
    if (!alive.current) return
    setActive((a) => ({ ...a, [kind]: fields === null ? null : ({ ...(a[kind] as AiActive), ...fields } as AiActive) }))
  }, [])

  const loadIntoEngine = useCallback(async (entry: AiEntry): Promise<AiLoaded> => {
    const hit = loadedOnce.get(entry.id)
    if (hit) return hit
    const out: AiLoaded = { styleIds: [], soundIds: [] }
    if (!isAudioNativeAvailable) {
      out.warning = "The audio engine is not in this build."
      return out
    }
    const paths = enginePaths(entry)
    for (const st of paths.styles) {
      const rep = parseReport(await audio.loadAbStyle(st.path))
      if (rep.ok && rep.id != null) {
        out.styleIds.push(rep.id)
        if (st.type === "audio" && rep.kits === undefined) {
          out.warning = "This app build plays the GM version only. Install the new build for the song's own drum sound."
        } else if (rep.kitsFailed) {
          out.warning = `${rep.kitsFailed} drum kit file(s) did not load.`
        }
      } else {
        out.styleIds.push(-1)
        out.warning = rep.reason || "A style did not load."
      }
    }
    for (const sd of paths.sounds) {
      const rep = parseReport(await audio.loadSfz(sd.path))
      out.soundIds.push(rep.ok && rep.id != null ? rep.id : -1)
      if (!rep.ok) out.warning = rep.reason || "A sound did not load."
    }
    loadedOnce.set(entry.id, out)
    return out
  }, [])

  const finish = useCallback(
    async (kind: AiKind, job: AiJob) => {
      patch(kind, { phase: "downloading", progress: 0.86, message: "Downloading the result" })
      await downloadResult(job, (f) => patch(kind, { progress: 0.86 + 0.09 * f }))
      const entry: AiEntry = { id: job.id, kind, name: job.name, created: Date.now(), manifest: job.result! }
      entriesRef.current = [entry, ...entriesRef.current.filter((e) => e.id !== entry.id)]
      pendingRef.current = pendingRef.current.filter((p) => p.id !== job.id)
      persist()
      if (alive.current) setEntries(entriesRef.current)
      patch(kind, { phase: "loading", progress: 0.96, message: "Loading into the arranger" })
      const ids = await loadIntoEngine(entry)
      if (alive.current) setLoaded((l) => ({ ...l, [entry.id]: ids }))
      vmRef.current.refreshCatalog()
      if (kind === "drums" && ids.styleIds[0] >= 0) vmRef.current.selectStyle(ids.styleIds[0], false)
      void deleteJob(job.id)
      const m = job.result!
      const summary =
        kind === "drums"
          ? `${m.bpm} BPM · ${m.meter}/4 · ${m.sections?.length ?? 0} sections`
          : `${m.sounds.length} sound${m.sounds.length === 1 ? "" : "s"}`
      patch(kind, { phase: "done", progress: 1, entryId: entry.id, message: ids.warning || summary })
    },
    [loadIntoEngine, patch, persist]
  )

  const follow = useCallback(
    async (kind: AiKind, id: string) => {
      for (;;) {
        if (!alive.current || cancelled.current[kind]) return
        let job: AiJob
        try {
          job = await getJob(id)
        } catch (error) {
          if (error instanceof AiError && error.status === 404) {
            pendingRef.current = pendingRef.current.filter((p) => p.id !== id)
            persist()
            patch(kind, { phase: "error", message: error.message })
            return
          }
          // A lost connection (or signed out) is not a failed job: keep waiting.
          patch(kind, { message: error instanceof Error ? `${error.message} Retrying…` : "Retrying…" })
          await new Promise((r) => setTimeout(r, POLL_MS * 2))
          continue
        }
        if (job.status === "error") {
          pendingRef.current = pendingRef.current.filter((p) => p.id !== id)
          persist()
          patch(kind, { phase: "error", message: job.message || "Processing failed." })
          return
        }
        if (job.status === "done" && job.result) {
          await finish(kind, job)
          return
        }
        patch(kind, {
          phase: job.status === "queued" ? "queued" : "processing",
          stage: job.stage,
          message: job.message || (job.status === "queued" ? "Waiting for a GPU" : "Working"),
          progress: 0.15 + 0.7 * (job.progress || 0),
        })
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    },
    [finish, patch, persist]
  )

  const run = useCallback(
    async (kind: AiKind, song: File, name: string) => {
      cancelled.current[kind] = false
      const ctl = new AbortController()
      aborts.current[kind] = ctl
      setActive((a) => ({
        ...a,
        [kind]: { kind, name, phase: "uploading", progress: 0, stage: "upload", message: "Uploading the song", startedAt: Date.now() },
      }))
      try {
        const id = await startJob(song, kind, name, (f) => patch(kind, { progress: 0.15 * f }), ctl.signal)
        if (cancelled.current[kind]) {
          void deleteJob(id)
          return
        }
        pendingRef.current = [...pendingRef.current, { id, kind, name, started: Date.now() }]
        persist()
        patch(kind, { jobId: id, phase: "queued", progress: 0.15, message: "Waiting for a GPU" })
        await follow(kind, id)
      } catch (error) {
        if (cancelled.current[kind]) return
        const message = error instanceof AiError || error instanceof Error ? error.message : "Something went wrong."
        patch(kind, { phase: "error", message })
      } finally {
        aborts.current[kind] = null
      }
    },
    [follow, patch, persist]
  )

  const pickAndRun = useCallback(
    async (kind: AiKind) => {
      let picked
      try {
        picked = await File.pickFileAsync({ mimeTypes: ["audio/*"] })
      } catch {
        return
      }
      if (!picked || picked.canceled) return
      const res = (picked as { result: File | File[] }).result
      const song = Array.isArray(res) ? res[0] : res
      if (!song) return
      const name = song.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Song"
      await run(kind, song, name)
    },
    [run]
  )

  const runDemo = useCallback(
    async (kind: AiKind) => {
      setActive((a) => ({
        ...a,
        [kind]: { kind, name: "Demo", phase: "uploading", progress: 0, stage: "upload", message: "Fetching the demo song", startedAt: Date.now() },
      }))
      try {
        const song = await fetchDemo(kind === "drums" ? "demo_groove.mp3" : "demo_keys.mp3")
        await run(kind, song, kind === "drums" ? "Demo Groove" : "Demo Keys")
      } catch (error) {
        patch(kind, { phase: "error", message: error instanceof Error ? error.message : "Demo failed." })
      }
    },
    [patch, run]
  )

  const cancel = useCallback(
    (kind: AiKind) => {
      cancelled.current[kind] = true
      aborts.current[kind]?.abort()
      setActive((a) => {
        const id = a[kind]?.jobId
        if (id) {
          void deleteJob(id)
          pendingRef.current = pendingRef.current.filter((p) => p.id !== id)
          persist()
        }
        return { ...a, [kind]: null }
      })
    },
    [persist]
  )

  const dismiss = useCallback((kind: AiKind) => setActive((a) => ({ ...a, [kind]: null })), [])

  const remove = useCallback(
    (id: string) => {
      removeAiFiles(id)
      entriesRef.current = entriesRef.current.filter((e) => e.id !== id)
      persist()
      setEntries(entriesRef.current)
    },
    [persist]
  )

  const ensureLoaded = useCallback(
    async (entry: AiEntry) => {
      const ids = await loadIntoEngine(entry)
      setLoaded((l) => ({ ...l, [entry.id]: ids }))
      vmRef.current.refreshCatalog()
      return ids
    },
    [loadIntoEngine]
  )

  // Boot: reload saved results into the engine and resume jobs that were running.
  const ready = vm.state.arrangerReady
  useEffect(() => {
    alive.current = true
    if (!ready) return
    let stop = false
    void (async () => {
      const saved = await readAiLibrary()
      if (stop) return
      entriesRef.current = saved.entries
      pendingRef.current = saved.pending
      setEntries(saved.entries)
      if (!booted) {
        booted = true
        const ids: Record<string, AiLoaded> = {}
        for (const e of saved.entries) ids[e.id] = await loadIntoEngine(e)
        if (saved.entries.length) vmRef.current.refreshCatalog()
        if (!stop) setLoaded(ids)
        for (const p of saved.pending.filter((x) => Date.now() - x.started < 24 * 3600 * 1000)) {
          setActive((a) =>
            a[p.kind]
              ? a
              : { ...a, [p.kind]: { kind: p.kind, name: p.name, phase: "queued", progress: 0.15, stage: "queued", message: "Checking the job", jobId: p.id, startedAt: p.started } }
          )
          void follow(p.kind, p.id)
        }
      } else {
        const ids: Record<string, AiLoaded> = {}
        for (const e of saved.entries) {
          const hit = loadedOnce.get(e.id)
          if (hit) ids[e.id] = hit
        }
        setLoaded(ids)
      }
      if (aiConfigured()) setOnline(await serverOnline())
      else setOnline(false)
    })()
    return () => {
      stop = true
      alive.current = false
    }
  }, [ready, follow, loadIntoEngine])

  return { online, configured: aiConfigured(), entries, active, loaded, pickAndRun, runDemo, cancel, dismiss, remove, ensureLoaded }
}

export type AiLab = ReturnType<typeof useAiLab>

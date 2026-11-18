import { audio, EngineCmd, isAudioNativeAvailable } from "arrangerbox-audio"
import { Directory, File } from "expo-file-system"
import { useCallback, useEffect, useRef, useState } from "react"

import { AiError, aiRoot, deleteJob, downloadResult, fetchDemo, getJob, jobFolder, nativePath, serverOnline, startJob, type AiJob, type AiManifest } from "@/lib/ai/client"
import { aiConfigured } from "@/lib/ai/config"

/**
 * The AI tab, step 1: upload a song, split it into Demucs stems on the GPU server, and
 * play the stems in sync on the device (StemPlayer in the engine) to judge the split.
 * Later steps (drum style, sounds) build on the same song.
 */

export type AiSong = { id: string; name: string; created: number; manifest: AiManifest }
type Pending = { id: string; name: string; started: number }
type Saved = { songs: AiSong[]; pending: Pending[] }

export type SongPhase = "uploading" | "queued" | "processing" | "downloading" | "done" | "error"

export type SongJob = {
  name: string
  phase: SongPhase
  /** 0..1 over upload, GPU and download. */
  progress: number
  stage: string
  message: string
  jobId?: string
  songId?: string
  startedAt: number
}

/** What plays: the original mix, or the stems (with mute / solo per stem). */
export type ListenMode = "original" | "stems"

export type StemPlayerState = {
  songId: string | null
  loading: boolean
  error: string | null
  mode: ListenMode
  muted: boolean[]
  solo: number | null
}

const POLL_MS = 1500

function indexFile() {
  return new File(aiRoot(), "songs.json")
}

async function readSaved(): Promise<Saved> {
  try {
    const f = indexFile()
    if (!f.exists) return { songs: [], pending: [] }
    const raw = JSON.parse(await f.text()) as Partial<Saved>
    return { songs: (raw.songs ?? []).filter((s) => new Directory(aiRoot(), s.id).exists), pending: raw.pending ?? [] }
  } catch {
    return { songs: [], pending: [] }
  }
}

function writeSaved(saved: Saved) {
  try {
    const f = indexFile()
    if (!f.exists) f.create({ intermediates: true })
    f.write(JSON.stringify(saved))
  } catch {
    // best effort (web preview)
  }
}

/** Engine gains for the stem player: track 0 is the original, 1.. the stems. */
export function stemGains(count: number, p: Pick<StemPlayerState, "mode" | "muted" | "solo">): number[] {
  return Array.from({ length: count }, (_, i) => {
    if (p.mode === "original") return i === 0 ? 1 : 0
    if (i === 0) return 0
    if (p.solo != null) return p.solo === i ? 1 : 0
    return p.muted[i] ? 0 : 1
  })
}

export function useAiSongs() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [songs, setSongs] = useState<AiSong[]>([])
  const [job, setJob] = useState<SongJob | null>(null)
  const [player, setPlayer] = useState<StemPlayerState>({ songId: null, loading: false, error: null, mode: "stems", muted: [], solo: null })
  const songsRef = useRef<AiSong[]>([])
  const pendingRef = useRef<Pending[]>([])
  const cancelled = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const playerRef = useRef(player)
  playerRef.current = player

  const persist = useCallback(() => writeSaved({ songs: songsRef.current, pending: pendingRef.current }), [])
  const patchJob = useCallback((fields: Partial<SongJob>) => {
    if (alive.current) setJob((j) => (j ? { ...j, ...fields } : j))
  }, [])

  const applyGains = useCallback((p: StemPlayerState) => {
    const song = songsRef.current.find((s) => s.id === p.songId)
    const n = song?.manifest.stems?.length ?? 0
    stemGains(n, p).forEach((g, i) => audio.control(EngineCmd.StemGain, i, 0, g))
  }, [])

  const updatePlayer = useCallback(
    (fn: (p: StemPlayerState) => StemPlayerState) => {
      const next = fn(playerRef.current)
      playerRef.current = next
      setPlayer(next)
      applyGains(next)
    },
    [applyGains]
  )

  /** Decodes a song's stems into the engine (replaces the loaded song). */
  const open = useCallback(
    async (id: string) => {
      const song = songsRef.current.find((s) => s.id === id)
      if (!song?.manifest.stems?.length) return
      if (!isAudioNativeAvailable || !audio.hasStemPlayer()) {
        setPlayer((p) => ({ ...p, songId: null, error: "This app build has no stem player. Install the new build to listen." }))
        return
      }
      if (playerRef.current.songId === id) return
      setPlayer((p) => ({ ...p, songId: null, loading: true, error: null }))
      const dir = jobFolder(id)
      const paths = song.manifest.stems.map((t) => nativePath(new File(dir, t.file)))
      let rep: { ok?: number; reason?: string } = {}
      try {
        rep = JSON.parse(await audio.loadStems(paths))
      } catch {
        rep = { ok: 0, reason: "The stems did not load." }
      }
      if (!alive.current) return
      if (!rep.ok) {
        setPlayer((p) => ({ ...p, loading: false, error: rep.reason || "The stems did not load." }))
        return
      }
      const n = song.manifest.stems.length
      const next: StemPlayerState = { songId: id, loading: false, error: null, mode: "stems", muted: new Array(n).fill(false), solo: null }
      playerRef.current = next
      setPlayer(next)
      applyGains(next)
    },
    [applyGains]
  )

  const finish = useCallback(
    async (j: AiJob) => {
      patchJob({ phase: "downloading", progress: 0.85, message: "Downloading the stems" })
      await downloadResult(j, (f) => patchJob({ progress: 0.85 + 0.15 * f }))
      const song: AiSong = { id: j.id, name: j.name, created: Date.now(), manifest: j.result! }
      songsRef.current = [song, ...songsRef.current.filter((s) => s.id !== song.id)]
      pendingRef.current = pendingRef.current.filter((p) => p.id !== j.id)
      persist()
      if (alive.current) setSongs(songsRef.current)
      void deleteJob(j.id)
      const m = j.result!
      patchJob({
        phase: "done",
        progress: 1,
        songId: song.id,
        message: `${(m.stems?.length ?? 1) - 1} stems${m.cut ? ` · first ${Math.round(m.duration / 60)} min only` : ""}`,
      })
      await open(song.id)
    },
    [open, patchJob, persist]
  )

  const follow = useCallback(
    async (id: string) => {
      for (;;) {
        if (!alive.current || cancelled.current) return
        let j: AiJob
        try {
          j = await getJob(id)
        } catch (error) {
          if (error instanceof AiError && error.status === 404) {
            pendingRef.current = pendingRef.current.filter((p) => p.id !== id)
            persist()
            patchJob({ phase: "error", message: error.message })
            return
          }
          patchJob({ message: error instanceof Error ? `${error.message} Retrying…` : "Retrying…" })
          await new Promise((r) => setTimeout(r, POLL_MS * 2))
          continue
        }
        if (j.status === "error") {
          pendingRef.current = pendingRef.current.filter((p) => p.id !== id)
          persist()
          patchJob({ phase: "error", message: j.message || "Processing failed." })
          return
        }
        if (j.status === "done" && j.result) {
          try {
            await finish(j)
          } catch (error) {
            patchJob({ phase: "error", message: error instanceof Error ? error.message : "Download failed." })
          }
          return
        }
        patchJob({
          phase: j.status === "queued" ? "queued" : "processing",
          stage: j.stage,
          message: j.message || (j.status === "queued" ? "Waiting for a GPU" : "Working"),
          progress: 0.12 + 0.73 * (j.progress || 0),
        })
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    },
    [finish, patchJob, persist]
  )

  const run = useCallback(
    async (song: File, name: string) => {
      cancelled.current = false
      const ctl = new AbortController()
      abort.current = ctl
      setJob({ name, phase: "uploading", progress: 0, stage: "upload", message: "Uploading the song", startedAt: Date.now() })
      try {
        const id = await startJob(song, "stems", name, (f) => patchJob({ progress: 0.12 * f }), ctl.signal)
        if (cancelled.current) {
          void deleteJob(id)
          return
        }
        pendingRef.current = [...pendingRef.current, { id, name, started: Date.now() }]
        persist()
        patchJob({ jobId: id, phase: "queued", progress: 0.12, message: "Waiting for a GPU" })
        await follow(id)
      } catch (error) {
        if (cancelled.current) return
        patchJob({ phase: "error", message: error instanceof Error ? error.message : "Something went wrong." })
      } finally {
        abort.current = null
      }
    },
    [follow, patchJob, persist]
  )

  const pickAndRun = useCallback(async () => {
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
    await run(song, name)
  }, [run])

  const runDemo = useCallback(async () => {
    setJob({ name: "Demo", phase: "uploading", progress: 0, stage: "upload", message: "Fetching the demo song", startedAt: Date.now() })
    try {
      await run(await fetchDemo("demo_keys.mp3"), "Demo Keys")
    } catch (error) {
      patchJob({ phase: "error", message: error instanceof Error ? error.message : "Demo failed." })
    }
  }, [patchJob, run])

  const cancel = useCallback(() => {
    cancelled.current = true
    abort.current?.abort()
    setJob((j) => {
      if (j?.jobId) {
        void deleteJob(j.jobId)
        pendingRef.current = pendingRef.current.filter((p) => p.id !== j.jobId)
        persist()
      }
      return null
    })
  }, [persist])

  const dismiss = useCallback(() => setJob(null), [])

  const remove = useCallback(
    (id: string) => {
      if (playerRef.current.songId === id) {
        audio.control(EngineCmd.StemPlay, 0, 0, 0)
        void audio.clearStems()
        setPlayer((p) => ({ ...p, songId: null }))
      }
      try {
        const dir = jobFolder(id)
        if (dir.exists) dir.delete()
      } catch {
        // already gone
      }
      songsRef.current = songsRef.current.filter((s) => s.id !== id)
      persist()
      setSongs(songsRef.current)
    },
    [persist]
  )

  /** Something else (a note audition) took over the stem player: the song is no longer loaded. */
  const release = useCallback(() => {
    const next = { ...playerRef.current, songId: null, loading: false }
    playerRef.current = next
    setPlayer(next)
  }, [])

  // Transport.
  const play = useCallback((on: boolean) => audio.control(EngineCmd.StemPlay, 0, 0, on ? 1 : 0), [])
  const seek = useCallback((seconds: number) => audio.control(EngineCmd.StemSeek, 0, 0, Math.max(0, seconds)), [])
  const setMode = useCallback((mode: ListenMode) => updatePlayer((p) => ({ ...p, mode })), [updatePlayer])
  const toggleMute = useCallback(
    (i: number) => updatePlayer((p) => ({ ...p, mode: "stems", solo: null, muted: p.muted.map((m, k) => (k === i ? !m : m)) })),
    [updatePlayer]
  )
  const toggleSolo = useCallback((i: number) => updatePlayer((p) => ({ ...p, mode: "stems", solo: p.solo === i ? null : i })), [updatePlayer])

  // Boot: saved songs, and jobs still running from before a restart.
  useEffect(() => {
    alive.current = true
    let stop = false
    void (async () => {
      const saved = await readSaved()
      if (stop) return
      songsRef.current = saved.songs
      pendingRef.current = saved.pending.filter((p) => Date.now() - p.started < 24 * 3600 * 1000)
      setSongs(saved.songs)
      const p = pendingRef.current[0]
      if (p) {
        setJob({ name: p.name, phase: "queued", progress: 0.12, stage: "queued", message: "Checking the job", jobId: p.id, startedAt: p.started })
        void follow(p.id)
      }
      setOnline(aiConfigured() ? await serverOnline() : false)
    })()
    return () => {
      stop = true
      alive.current = false
    }
  }, [follow])

  return {
    online,
    configured: aiConfigured(),
    canPlay: isAudioNativeAvailable && audio.hasStemPlayer(),
    songs,
    job,
    player,
    pickAndRun,
    runDemo,
    cancel,
    dismiss,
    remove,
    open,
    release,
    play,
    seek,
    setMode,
    toggleMute,
    toggleSolo,
  }
}

export type AiSongs = ReturnType<typeof useAiSongs>

import { audio, EngineCmd, isAudioNativeAvailable } from "arrangerbox-audio"
import { Directory, File } from "expo-file-system"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  AiError,
  deleteJob,
  downloadResult,
  getJob,
  jobFolder,
  nativePath,
  notesFields,
  startJob,
  startNotesJob,
  type AiJob,
  type AiManifest,
  type AiNoteMode,
  type AiNotesDoc,
} from "@/lib/ai/client"
import { telemetryNow } from "@/lib/telemetry"

import type { AiSong, AiSongs } from "./useAiSongs"

/**
 * The AI tab, step 2a: choose a stretch of one stem, find its notes on the server (Basic
 * Pitch, then every start moved to the exact sample), and audition each note from its cut.
 * Results live inside the song's folder: Documents/ai/<song>/notes/<job>/.
 */

export const MIN_STRETCH = 0.5
export const MAX_STRETCH = 120

export type Stretch = { stem: number; start: number; end: number; mode: AiNoteMode | "" }

export type NotesResult = { id: string; songId: string; created: number; manifest: AiManifest }

export type SearchPhase = "sending" | "queued" | "working" | "downloading" | "done" | "error"
export type NotesSearch = { phase: SearchPhase; progress: number; message: string; jobId?: string; startedAt: number; viaMp3?: boolean }

const POLL_MS = 1200

function notesRoot(songId: string) {
  const dir = new Directory(jobFolder(songId), "notes")
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

function indexFile(songId: string) {
  return new File(notesRoot(songId), "index.json")
}

function readIndex(songId: string): NotesResult[] {
  try {
    const f = indexFile(songId)
    if (!f.exists) return []
    const list = JSON.parse(f.textSync()) as NotesResult[]
    return list.filter((r) => new Directory(notesRoot(songId), r.id).exists)
  } catch {
    return []
  }
}

function writeIndex(songId: string, list: NotesResult[]) {
  try {
    const f = indexFile(songId)
    if (!f.exists) f.create({ intermediates: true })
    f.write(JSON.stringify(list))
  } catch {
    // best effort
  }
}

/** A sensible first stretch: the soloed stem, else the loudest stem that is not drums. */
function defaultStretch(song: AiSong, solo: number | null, pos: number): Stretch {
  const stems = song.manifest.stems ?? []
  let stem = solo != null && solo > 0 ? solo : 0
  if (!stem) {
    let best = -Infinity
    stems.forEach((t, i) => {
      if (i > 0 && t.key !== "drums" && t.share_db > best) {
        best = t.share_db
        stem = i
      }
    })
  }
  const d = song.manifest.duration
  const start = Math.min(Math.max(0, pos), Math.max(0, d - 10))
  return { stem: stem || 1, start, end: Math.min(d, start + 20), mode: "" }
}

export function useAiNotes(ai: AiSongs) {
  const [songId, setSongId] = useState<string | null>(null)
  const [stretch, setStretch] = useState<Stretch | null>(null)
  const [search, setSearch] = useState<NotesSearch | null>(null)
  const [results, setResults] = useState<NotesResult[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [doc, setDoc] = useState<AiNotesDoc | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [auditioning, setAuditioning] = useState<string | null>(null)
  const [modes, setModes] = useState<Record<string, AiNoteMode>>({})
  const alive = useRef(true)
  const cancelled = useRef(false)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedCrop = useRef<string | null>(null)

  const song = ai.songs.find((s) => s.id === songId) ?? null

  // Follow the song the stem player has open; keep the last one while a crop is auditioned.
  useEffect(() => {
    const id = ai.player.songId
    if (!id || id === songId) return
    const s = ai.songs.find((x) => x.id === id)
    if (!s) return
    setSongId(id)
    setStretch(defaultStretch(s, ai.player.solo, 0))
    setResults(readIndex(id))
    setOpenId(null)
    setDoc(null)
    setSelected(null)
    setSearch(null)
  }, [ai.player.songId, ai.player.solo, ai.songs, songId])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (stopTimer.current) clearTimeout(stopTimer.current)
    }
  }, [])

  const patch = useCallback((fields: Partial<NotesSearch>) => {
    if (alive.current) setSearch((s) => (s ? { ...s, ...fields } : s))
  }, [])

  // Stretch editing.
  const update = useCallback((fn: (s: Stretch) => Stretch) => setStretch((s) => (s ? fn(s) : s)), [])
  const setStem = useCallback((stem: number) => update((s) => ({ ...s, stem })), [update])
  const setMode = useCallback((mode: AiNoteMode | "") => update((s) => ({ ...s, mode })), [update])
  const setStart = useCallback(
    (t: number) =>
      update((s) => {
        const d = song?.manifest.duration ?? 0
        const start = Math.max(0, Math.min(t, d - MIN_STRETCH))
        const end = Math.min(Math.max(s.end, start + MIN_STRETCH), start + MAX_STRETCH, d)
        return { ...s, start, end }
      }),
    [song, update]
  )
  const setEnd = useCallback(
    (t: number) =>
      update((s) => {
        const d = song?.manifest.duration ?? 0
        const end = Math.min(d, Math.max(t, MIN_STRETCH))
        const start = Math.max(0, Math.min(s.start, end - MIN_STRETCH), end - MAX_STRETCH)
        return { ...s, start, end }
      }),
    [song, update]
  )
  const markStart = useCallback(() => setStart(telemetryNow().stemPos), [setStart])
  const markEnd = useCallback(() => setEnd(telemetryNow().stemPos), [setEnd])

  /** Plays the stretch on the song's stems with the chosen stem soloed. */
  const previewStretch = useCallback(async () => {
    if (!song || !stretch) return
    if (ai.player.songId !== song.id) {
      loadedCrop.current = null
      setAuditioning(null)
      await ai.open(song.id)
    }
    if (ai.player.solo !== stretch.stem) ai.toggleSolo(stretch.stem)
    ai.seek(stretch.start)
    ai.play(true)
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = setTimeout(() => ai.play(false), (stretch.end - stretch.start) * 1000 + 150)
  }, [ai, song, stretch])

  const finish = useCallback(
    async (j: AiJob, sid: string) => {
      patch({ phase: "downloading", progress: 0.9, message: "Downloading the notes" })
      const dir = new Directory(notesRoot(sid), j.id)
      await downloadResult(j, (f) => patch({ progress: 0.9 + 0.1 * f }), dir)
      void deleteJob(j.id)
      const r: NotesResult = { id: j.id, songId: sid, created: Date.now(), manifest: j.result! }
      const list = [r, ...readIndex(sid).filter((x) => x.id !== r.id)]
      writeIndex(sid, list)
      if (!alive.current) return
      setResults(list)
      const m = j.result!
      patch({
        phase: "done",
        progress: 1,
        message: `${m.count ?? 0} notes · ${m.keys?.length ?? 0} keys · ${m.exact ?? 0} exact`,
      })
      setOpenId(r.id)
      setDoc(JSON.parse(new File(dir, "notes.json").textSync()) as AiNotesDoc)
      setSelected(null)
    },
    [patch]
  )

  const follow = useCallback(
    async (id: string, sid: string) => {
      for (;;) {
        if (!alive.current || cancelled.current) return
        let j: AiJob
        try {
          j = await getJob(id)
        } catch (error) {
          if (error instanceof AiError && error.status === 404) {
            patch({ phase: "error", message: error.message })
            return
          }
          await new Promise((r) => setTimeout(r, POLL_MS * 2))
          continue
        }
        if (j.status === "error") {
          patch({ phase: "error", message: j.message || "Finding notes failed." })
          return
        }
        if (j.status === "done" && j.result) {
          try {
            await finish(j, sid)
          } catch (error) {
            patch({ phase: "error", message: error instanceof Error ? error.message : "Download failed." })
          }
          return
        }
        patch({
          phase: j.status === "queued" ? "queued" : "working",
          message: j.message || "Working",
          progress: 0.1 + 0.8 * (j.progress || 0),
        })
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    },
    [finish, patch]
  )

  const find = useCallback(async () => {
    if (!song || !stretch) return
    const stem = song.manifest.stems?.[stretch.stem]
    if (!stem) return
    cancelled.current = false
    const req = {
      songId: song.id,
      stem: stem.key,
      start: stretch.start,
      end: stretch.end,
      mode: stretch.mode,
      name: `${song.name} · ${stem.label}`,
    }
    setSearch({ phase: "sending", progress: 0.02, message: "Starting", startedAt: Date.now() })
    let id: string
    try {
      try {
        id = await startNotesJob(req)
      } catch (error) {
        if (!(error instanceof AiError && error.status === 410)) throw error
        // The server no longer keeps this song's lossless stems: send the MP3 (timing then
        // approximate, never "exact").
        patch({ viaMp3: true, message: "Uploading the stem (the server's lossless copy has expired)" })
        const file = new File(jobFolder(song.id), stem.file)
        id = await startJob(file, "notes", req.name, (f) => patch({ progress: 0.02 + 0.08 * f }), undefined, notesFields(req))
      }
    } catch (error) {
      patch({ phase: "error", message: error instanceof Error ? error.message : "Could not start." })
      return
    }
    patch({ jobId: id, phase: "queued", progress: 0.1, message: "Waiting for the server" })
    await follow(id, song.id)
  }, [follow, patch, song, stretch])

  const cancel = useCallback(() => {
    cancelled.current = true
    setSearch((s) => {
      if (s?.jobId) void deleteJob(s.jobId)
      return null
    })
  }, [])

  const dismiss = useCallback(() => setSearch(null), [])

  const openResult = useCallback(
    (id: string) => {
      if (!songId) return
      try {
        const f = new File(new Directory(notesRoot(songId), id), "notes.json")
        setDoc(JSON.parse(f.textSync()) as AiNotesDoc)
        setOpenId(id)
        setSelected(null)
      } catch {
        setDoc(null)
        setOpenId(null)
      }
    },
    [songId]
  )

  const closeResult = useCallback(() => {
    setOpenId(null)
    setDoc(null)
    setSelected(null)
  }, [])

  const removeResult = useCallback(
    (id: string) => {
      if (!songId) return
      try {
        const dir = new Directory(notesRoot(songId), id)
        if (dir.exists) dir.delete()
      } catch {
        // already gone
      }
      if (loadedCrop.current === id) {
        audio.control(EngineCmd.StemPlay, 0, 0, 0)
        loadedCrop.current = null
        setAuditioning(null)
      }
      const list = readIndex(songId).filter((r) => r.id !== id)
      writeIndex(songId, list)
      setResults(list)
      if (openId === id) {
        setOpenId(null)
        setDoc(null)
      }
    },
    [openId, songId]
  )

  /** Loads the stretch's audio (crop.mp3) into the stem player, in place of the song. */
  const ensureCrop = useCallback(async (): Promise<boolean> => {
    if (!songId || !openId) return false
    if (loadedCrop.current === openId) return true
    if (!isAudioNativeAvailable || !audio.hasStemPlayer()) return false
    const path = nativePath(new File(new Directory(notesRoot(songId), openId), "crop.mp3"))
    let rep: { ok?: number } = {}
    try {
      rep = JSON.parse(await audio.loadStems([path]))
    } catch {
      rep = {}
    }
    if (!rep.ok) return false
    audio.control(EngineCmd.StemGain, 0, 0, 1)
    loadedCrop.current = openId
    ai.release()
    setAuditioning(openId)
    return true
  }, [ai, openId, songId])

  const stop = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = null
    audio.control(EngineCmd.StemPlay, 0, 0, 0)
  }, [])

  /** Plays one note from its cut point to its end (plus a short tail). */
  const playNote = useCallback(
    async (i: number) => {
      const n = doc?.notes[i]
      if (!n) return
      setSelected(i)
      if (!(await ensureCrop())) return
      if (stopTimer.current) clearTimeout(stopTimer.current)
      // The player fades in over 6 ms after a seek: start 10 ms early so the cut is heard whole.
      audio.control(EngineCmd.StemSeek, 0, 0, Math.max(0, n.cut - 0.01))
      audio.control(EngineCmd.StemPlay, 0, 0, 1)
      const len = Math.min(4, Math.max(0.15, n.end - n.cut) + 0.3)
      stopTimer.current = setTimeout(() => audio.control(EngineCmd.StemPlay, 0, 0, 0), len * 1000)
    },
    [doc, ensureCrop]
  )

  const playStretch = useCallback(async () => {
    if (!doc || !(await ensureCrop())) return
    if (stopTimer.current) clearTimeout(stopTimer.current)
    audio.control(EngineCmd.StemSeek, 0, 0, 0)
    audio.control(EngineCmd.StemPlay, 0, 0, 1)
  }, [doc, ensureCrop])

  /** Back to the whole song's stems. */
  const backToSong = useCallback(async () => {
    stop()
    loadedCrop.current = null
    setAuditioning(null)
    if (songId) await ai.open(songId)
  }, [ai, songId, stop])

  const chooseMode = useCallback((id: string, mode: AiNoteMode) => setModes((m) => ({ ...m, [id]: mode })), [])

  return {
    song,
    stretch,
    setStem,
    setMode,
    setStart,
    setEnd,
    markStart,
    markEnd,
    previewStretch,
    search,
    find,
    cancel,
    dismiss,
    results,
    openId,
    doc,
    openResult,
    closeResult,
    removeResult,
    selected,
    setSelected,
    playNote,
    playStretch,
    stop,
    auditioning,
    backToSong,
    modes,
    chooseMode,
  }
}

export type AiNotes = ReturnType<typeof useAiNotes>

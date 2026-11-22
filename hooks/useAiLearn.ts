import { audio } from "arrangerbox-audio"
import { File } from "expo-file-system"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { jobFolder, nativePath } from "@/lib/ai/client"
import { measureTuning, trackNotes } from "@/lib/ai/noteTrack"
import type { AiSong, AiSongs } from "@/hooks/useAiSongs"

/**
 * AI Notes: the note one stem is playing right now, found on the device with SwiftF0 (no
 * server). The notes of a stem are read once, as soon as it is picked, and kept next to the
 * stems on the device; the AI tab then shows the note under the play position.
 *
 * SwiftF0 follows one voice at a time, so it reads vocals, bass and lead lines well; on a
 * stem with chords (other, piano, guitar) it follows the strongest note.
 */

/** One note. `midi` is the nearest key. */
export type LearnNote = { s: number; e: number; midi: number }

export type LearnDoc = {
  v: number
  stem: string
  seconds: number
  notes: LearnNote[]
  /** The recording's tuning against A = 440, semitones (allowed for when naming notes). */
  tuning: number
  found: number
}

const DOC_VERSION = 3

/** Pitch range and note-length penalty per stem (SwiftF0 segment_notes pitch_hold_ms). */
const RANGES: Record<string, { fmin: number; fmax: number; hold: number }> = {
  vocals: { fmin: 65, fmax: 1400, hold: 80 },
  bass: { fmin: 46.875, fmax: 420, hold: 100 },
  guitar: { fmin: 70, fmax: 1400, hold: 80 },
}
const FULL = { fmin: 46.875, fmax: 2093.75, hold: 80 }

/** The stem whose notes are shown. */
export const NOTES_STEM = "other"

/** Stems with notes to show (not the mix, not drums). */
export function learnableStems(song: AiSong | null) {
  return (song?.manifest.stems ?? []).filter((t) => t.key !== "original" && t.key !== "drums")
}

function docFile(songId: string, stem: string) {
  return new File(jobFolder(songId), `learn_${stem}.json`)
}

function readDoc(songId: string, stem: string): LearnDoc | null {
  try {
    const f = docFile(songId, stem)
    if (!f.exists) return null
    const d = JSON.parse(f.textSync()) as LearnDoc
    return d.v === DOC_VERSION ? d : null
  } catch {
    return null
  }
}

function writeDoc(songId: string, d: LearnDoc) {
  try {
    const f = docFile(songId, d.stem)
    if (!f.exists) f.create({ intermediates: true })
    f.write(JSON.stringify(d))
  } catch {
    // best effort: the notes are read again next time
  }
}

/** Notes from SwiftF0's 16 ms pitch line (see lib/ai/noteTrack): quick enough for fast ornaments. */
function buildDoc(stem: string, raw: { seconds: number; hop: number; line: number[] }): LearnDoc {
  const tuning = measureTuning(raw.line)
  return { v: DOC_VERSION, stem, seconds: raw.seconds, notes: trackNotes(raw.line, raw.hop || 0.016, tuning), tuning, found: Date.now() }
}

/** Index of the last note starting at or before `t` (-1 if none). */
export function noteAt(notes: LearnNote[], t: number) {
  let lo = 0
  let hi = notes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].s <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export type LearnStatus = "idle" | "finding" | "ready" | "error"

export function useAiLearn(ai: AiSongs) {
  const song = ai.songs.find((s) => s.id === ai.player.songId) ?? null
  const stems = useMemo(() => learnableStems(song), [song])
  const available = audio.hasNoteFinder()
  const [stem, setStemState] = useState<string | null>(null)
  const [status, setStatus] = useState<LearnStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [doc, setDoc] = useState<LearnDoc | null>(null)
  const findSeq = useRef(0)

  const find = useCallback(
    async (key: string) => {
      if (!song) return
      const t = song.manifest.stems?.find((x) => x.key === key)
      if (!t) return
      const seq = ++findSeq.current
      setStatus("finding")
      setError(null)
      const r = RANGES[key] ?? FULL
      let raw: { ok?: number; reason?: string; seconds: number; hop: number; line: number[] }
      try {
        raw = JSON.parse(await audio.findNotes(nativePath(new File(jobFolder(song.id), t.file)), r.fmin, r.fmax, r.hold))
      } catch (e) {
        raw = { ok: 0, reason: e instanceof Error ? e.message : "The notes could not be read.", seconds: 0, hop: 0, line: [] }
      }
      if (seq !== findSeq.current) return
      if (!raw.ok) {
        setStatus("error")
        setError(raw.reason || "The notes could not be read.")
        return
      }
      const d = buildDoc(key, raw)
      writeDoc(song.id, d)
      setDoc(d)
      setStatus("ready")
    },
    [song]
  )

  /** Pick a stem: its saved notes show at once; otherwise they are read now. */
  const pick = useCallback(
    (key: string | null) => {
      findSeq.current++ // drop any read still running for the previous stem
      setStemState(key)
      setError(null)
      const d = song && key ? readDoc(song.id, key) : null
      setDoc(d)
      setStatus(d ? "ready" : "idle")
      if (!d && key && available) void find(key)
    },
    [available, find, song]
  )

  // A new song: its notes always come from the "other" stem (the instruments that are not
  // vocals, drums or bass). Songs separated before that stem existed use their first stem.
  useEffect(() => {
    if (!song) {
      findSeq.current++
      setStemState(null)
      setDoc(null)
      setStatus("idle")
      return
    }
    const first = stems.find((t) => t.key === NOTES_STEM) ?? stems[0]
    pick(first?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id])

  return {
    available,
    song,
    stems,
    stem,
    setStem: pick,
    status,
    error,
    doc,
    retry: () => (stem ? void find(stem) : undefined),
  }
}

export type AiLearn = ReturnType<typeof useAiLearn>

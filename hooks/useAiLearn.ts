import { audio, EngineCmd } from "arrangerbox-audio"
import { File } from "expo-file-system"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { jobFolder, nativePath } from "@/lib/ai/client"
import type { AiSong, AiSongs } from "@/hooks/useAiSongs"
import { onKeyPress, onTelemetry, telemetryNow } from "@/lib/telemetry"

/**
 * AI Learn: the notes of one stem, found on the device with SwiftF0 (no server), shown in
 * time with the stem player so they can be played along on the keyboard.
 *
 * SwiftF0 follows one voice at a time, so it reads vocals, bass and lead lines well; on a
 * stem with chords (piano, guitar, other) it follows the strongest note. The notes are found
 * once per stem and kept next to the stems on the device.
 */

/** One note to play. `midi` is the nearest key; `cents` how far the singer was from it. */
export type LearnNote = { s: number; e: number; midi: number; cents: number; target: boolean }

export type LearnDoc = {
  v: number
  stem: string
  seconds: number
  hop: number
  notes: LearnNote[]
  /** SwiftF0's pitch line, one value per `hop` seconds: MIDI cents when voiced, 0 when not. */
  line: number[]
  /** Lowest and highest key among the notes to play (5th..95th percentile edges kept). */
  lo: number
  hi: number
  fmin: number
  fmax: number
  hold: number
  found: number
}

const DOC_VERSION = 1
/** Notes shorter than this are drawn but not asked for: ornaments, slides, breaths. */
const MIN_TARGET_S = 0.08
/** A press counts for a note from this long before it starts to this long after it ends. */
const EARLY_S = 0.25
const LATE_S = 0.12
/** Wait mode stops the song this long into a note you have not played yet. */
const WAIT_AFTER_S = 0.03

/** Pitch range and note-length penalty per stem (SwiftF0 segment_notes pitch_hold_ms). */
const RANGES: Record<string, { fmin: number; fmax: number; hold: number }> = {
  vocals: { fmin: 65, fmax: 1400, hold: 80 },
  bass: { fmin: 46.875, fmax: 420, hold: 100 },
  guitar: { fmin: 70, fmax: 1400, hold: 80 },
}
const FULL = { fmin: 46.875, fmax: 2093.75, hold: 80 }

/** Stems with a line to learn (not the mix, not drums). */
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
    // best effort: the notes are found again next time
  }
}

function buildDoc(stem: string, raw: { seconds: number; hop: number; notes: [number, number, number][]; line: number[] }, r: typeof FULL): LearnDoc {
  const notes: LearnNote[] = raw.notes.map(([s, e, m]) => {
    const midi = Math.round(m)
    return { s, e, midi, cents: Math.round((m - midi) * 100), target: e - s >= MIN_TARGET_S }
  })
  const keys = notes.filter((n) => n.target).map((n) => n.midi).sort((a, b) => a - b)
  const pick = (q: number) => keys[Math.min(keys.length - 1, Math.max(0, Math.floor(q * (keys.length - 1))))] ?? 60
  return {
    v: DOC_VERSION,
    stem,
    seconds: raw.seconds,
    hop: raw.hop,
    notes,
    line: raw.line,
    lo: keys.length ? Math.min(pick(0.02), pick(0.5) - 6) : 55,
    hi: keys.length ? Math.max(pick(0.98), pick(0.5) + 6) : 72,
    fmin: r.fmin,
    fmax: r.fmax,
    hold: r.hold,
    found: Date.now(),
  }
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
export type LastPress = { note: number; ok: boolean; at: number }

export function useAiLearn(ai: AiSongs) {
  const song = ai.songs.find((s) => s.id === ai.player.songId) ?? null
  const stems = useMemo(() => learnableStems(song), [song])
  const [stem, setStemState] = useState<string | null>(null)
  const [status, setStatus] = useState<LearnStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [doc, setDoc] = useState<LearnDoc | null>(null)
  const [wait, setWait] = useState(false)
  const [anyOctave, setAnyOctave] = useState(true)
  const [hits, setHits] = useState<ReadonlySet<number>>(new Set())
  const [wrong, setWrong] = useState(0)
  const [lastPress, setLastPress] = useState<LastPress | null>(null)
  const [waiting, setWaiting] = useState<number | null>(null)

  const docRef = useRef(doc)
  docRef.current = doc
  const hitsRef = useRef(new Set<number>())
  const skipped = useRef(new Set<number>())
  const waitRef = useRef(wait)
  waitRef.current = wait
  const octRef = useRef(anyOctave)
  octRef.current = anyOctave
  const waitingRef = useRef<number | null>(null)
  const pausedAt = useRef(0)
  const findSeq = useRef(0)

  const resetScore = useCallback(() => {
    hitsRef.current = new Set()
    skipped.current = new Set()
    waitingRef.current = null
    setHits(new Set())
    setWrong(0)
    setWaiting(null)
    setLastPress(null)
  }, [])

  const pick = useCallback(
    (key: string | null) => {
      setStemState(key)
      resetScore()
      setError(null)
      const d = song && key ? readDoc(song.id, key) : null
      setDoc(d)
      setStatus(d ? "ready" : "idle")
    },
    [resetScore, song]
  )

  // A new song: start on its vocals (or the first stem that is not silent).
  useEffect(() => {
    if (!song) {
      setStemState(null)
      setDoc(null)
      setStatus("idle")
      return
    }
    const audible = stems.filter((t) => t.share_db > -40)
    const first = audible.find((t) => t.key === "vocals") ?? audible.find((t) => t.key === "bass") ?? audible[0] ?? stems[0]
    pick(first?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id])

  const find = useCallback(async () => {
    if (!song || !stem) return
    const t = song.manifest.stems?.find((x) => x.key === stem)
    if (!t) return
    const seq = ++findSeq.current
    setStatus("finding")
    setError(null)
    const r = RANGES[stem] ?? FULL
    let raw: { ok?: number; reason?: string; seconds: number; hop: number; notes: [number, number, number][]; line: number[] }
    try {
      raw = JSON.parse(await audio.findNotes(nativePath(new File(jobFolder(song.id), t.file)), r.fmin, r.fmax, r.hold))
    } catch (e) {
      raw = { ok: 0, reason: e instanceof Error ? e.message : "Note finding failed.", seconds: 0, hop: 0, notes: [], line: [] }
    }
    if (seq !== findSeq.current) return
    if (!raw.ok) {
      setStatus("error")
      setError(raw.reason || "Note finding failed.")
      return
    }
    const d = buildDoc(stem, raw, r)
    writeDoc(song.id, d)
    resetScore()
    setDoc(d)
    setStatus("ready")
  }, [resetScore, song, stem])

  // Key presses: a note you play counts for the note sounding now (or about to start).
  useEffect(() => {
    if (!doc) return
    return onKeyPress((key) => {
      const d = docRef.current
      if (!d) return
      const pos = telemetryNow().stemPos
      const matches = (n: LearnNote) => n.midi === key || (octRef.current && (n.midi - key) % 12 === 0)
      let best = -1
      const w = waitingRef.current
      if (w != null && matches(d.notes[w])) best = w
      else {
        for (let i = Math.max(0, noteAt(d.notes, pos + EARLY_S)); i >= 0; i--) {
          const n = d.notes[i]
          if (n.e + LATE_S < pos - 2) break
          if (!n.target || hitsRef.current.has(i)) continue
          if (n.s - EARLY_S <= pos && pos <= n.e + LATE_S && matches(n)) {
            best = i
            if (n.s <= pos) break // prefer the note already sounding
          }
        }
      }
      const ok = best >= 0
      setLastPress({ note: key, ok, at: Date.now() })
      if (!ok) {
        setWrong((x) => x + 1)
        return
      }
      hitsRef.current.add(best)
      setHits(new Set(hitsRef.current))
      if (waitingRef.current === best) {
        waitingRef.current = null
        setWaiting(null)
        audio.control(EngineCmd.StemPlay, 0, 0, 1)
      }
    })
  }, [doc])

  // Wait mode: stop the song at each note until it is played.
  useEffect(() => {
    if (!doc) return
    return onTelemetry((t) => {
      const d = docRef.current
      if (!d) return
      const w = waitingRef.current
      if (w != null) {
        // Pressing Play while waiting skips the note (the engine takes a poll or two to stop).
        if (t.stemPlaying && !hitsRef.current.has(w) && Date.now() - pausedAt.current > 300) {
          skipped.current.add(w)
          waitingRef.current = null
          setWaiting(null)
        }
        return
      }
      if (!waitRef.current || !t.stemPlaying) return
      const pos = t.stemPos
      for (let i = noteAt(d.notes, pos); i >= 0; i--) {
        const n = d.notes[i]
        if (n.s < pos - EARLY_S) break
        if (!n.target || hitsRef.current.has(i) || skipped.current.has(i)) continue
        if (pos >= n.s + WAIT_AFTER_S) {
          audio.control(EngineCmd.StemPlay, 0, 0, 0)
          pausedAt.current = Date.now()
          waitingRef.current = i
          setWaiting(i)
          return
        }
      }
    })
  }, [doc])

  const toggleWait = useCallback(() => {
    setWait((w) => {
      if (w && waitingRef.current != null) {
        waitingRef.current = null
        setWaiting(null)
      }
      return !w
    })
  }, [])

  const stemIndex = song?.manifest.stems?.findIndex((t) => t.key === stem) ?? -1

  return {
    available: audio.hasNoteFinder(),
    song,
    stems,
    stem,
    stemIndex,
    setStem: pick,
    status,
    error,
    doc,
    find,
    wait,
    toggleWait,
    anyOctave,
    toggleAnyOctave: () => setAnyOctave((x) => !x),
    hits,
    wrong,
    lastPress,
    waiting,
    resetScore,
  }
}

export type AiLearn = ReturnType<typeof useAiLearn>

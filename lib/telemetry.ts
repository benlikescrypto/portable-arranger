import { audio, EngineQuery } from "arrangerbox-audio"
import { useSyncExternalStore } from "react"

/**
 * Fast engine read-back (beat, bar, booked element, meters, chord) for the display.
 * One poll feeds every subscriber, so only the widgets that read it re-render,
 * not the whole arranger tree.
 */
export type Telemetry = {
  tick: number
  playing: boolean
  section: number
  booked: number
  variation: number
  beat: number
  bar: number
  fade: number
  chordRoot: number
  chordType: number
  chordHeld: boolean
  bassRoot: number
  voices: number
  peakL: number
  peakR: number
  activity: number[]
  metroBeat: number
  tempo: number
  live: boolean
  /** AI stem player (StemPlayer in the engine). */
  stemPos: number
  stemLen: number
  stemPlaying: boolean
  stemLevels: number[]
  /** Stem player speed 0.5..1 (pitch kept); 0 when this app build cannot change it. */
  stemSpeed: number
  /** Keyboard note-ons so far (MIDI in and the on-screen keys); see onKeyPress. */
  pressSeq: number
  /** When this was read (performance.now(), ms): positions can be carried forward from it. */
  at: number
}

const empty: Telemetry = {
  tick: 0,
  playing: false,
  section: 4,
  booked: 0,
  variation: 1,
  beat: 0,
  bar: 0,
  fade: 1,
  chordRoot: 0,
  chordType: 0,
  chordHeld: false,
  bassRoot: -1,
  voices: 0,
  peakL: 0,
  peakR: 0,
  activity: new Array(16).fill(0),
  metroBeat: -1,
  tempo: 120,
  live: false,
  stemPos: 0,
  stemLen: 0,
  stemPlaying: false,
  stemLevels: new Array(8).fill(0),
  stemSpeed: 0,
  pressSeq: 0,
  at: 0,
}

let current: Telemetry = empty
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
// Meters fall back smoothly instead of jumping to the instantaneous peak.
let holdL = 0
let holdR = 0

function poll() {
  const snap = audio.snapshot()
  const q = audio.queryAll()
  const live = !!snap
  const peakL = q[EngineQuery.PeakL] ?? 0
  const peakR = q[EngineQuery.PeakR] ?? 0
  holdL = Math.max(peakL, holdL * 0.82)
  holdR = Math.max(peakR, holdR * 0.82)
  const next: Telemetry = {
    tick: current.tick + 1,
    playing: snap?.playing ?? false,
    section: snap?.section ?? current.section,
    booked: q[EngineQuery.Booked] ?? 0,
    variation: q[EngineQuery.Variation] ?? current.variation,
    beat: q[EngineQuery.Beat] ?? 0,
    bar: q[EngineQuery.Bar] ?? 0,
    fade: q[EngineQuery.Fade] ?? 1,
    chordRoot: snap?.chordRoot ?? 0,
    chordType: snap?.chordType ?? 0,
    chordHeld: (q[EngineQuery.ChordHeld] ?? 0) > 0.5,
    bassRoot: q[EngineQuery.BassRoot] ?? -1,
    voices: q[EngineQuery.Voices] ?? 0,
    peakL: holdL,
    peakR: holdR,
    activity: q.length > EngineQuery.Activity ? q.slice(EngineQuery.Activity, EngineQuery.Activity + 16) : empty.activity,
    metroBeat: q[EngineQuery.MetroBeat] ?? -1,
    tempo: snap?.tempo ?? current.tempo,
    live,
    stemPos: q[EngineQuery.StemPos] ?? 0,
    stemLen: q[EngineQuery.StemLen] ?? 0,
    stemPlaying: (q[EngineQuery.StemPlaying] ?? 0) > 0.5,
    stemLevels: q.length > EngineQuery.StemLevel ? q.slice(EngineQuery.StemLevel, EngineQuery.StemLevel + 8) : empty.stemLevels,
    pressSeq: q[EngineQuery.PressSeq] ?? current.pressSeq,
    stemSpeed: q[EngineQuery.StemSpeed] ?? 0,
    at: performance.now(),
  }
  emitPresses(q)
  current = next
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  if (!timer) timer = setInterval(poll, 33)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function snapshot() {
  return current
}

/** Subscribe to one derived value; the component re-renders only when it changes. */
export function useTelemetry<T>(select: (t: Telemetry) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(current),
    () => select(empty)
  )
}

/** A clock for blinking LEDs (booked elements), ~2 Hz, in step with the poll. */
export function useBlink() {
  return useTelemetry((t) => Math.floor(t.tick / 8) % 2 === 0)
}

export function telemetryNow() {
  return snapshot()
}

// Key presses (AI Learn): the engine keeps the last 8 note-ons in a ring and counts them.
const pressListeners = new Set<(note: number) => void>()
let lastPressSeq: number | null = null

function emitPresses(q: number[]) {
  if (q.length <= EngineQuery.Press + 7) return
  const seq = q[EngineQuery.PressSeq] ?? 0
  if (lastPressSeq == null || seq < lastPressSeq) {
    lastPressSeq = seq // first read, or the counter wrapped: nothing new to report
    return
  }
  const fresh = Math.min(8, seq - lastPressSeq)
  for (let n = seq - fresh; n < seq; n++) {
    const note = q[EngineQuery.Press + (n % 8)] ?? -1
    if (note >= 0) pressListeners.forEach((fn) => fn(note))
  }
  lastPressSeq = seq
}

/** Calls `fn` with the sounding note of every key pressed (polled with the display, ~30 Hz). */
export function onKeyPress(fn: (note: number) => void) {
  pressListeners.add(fn)
  const unsubscribe = subscribe(() => {})
  return () => {
    pressListeners.delete(fn)
    unsubscribe()
  }
}

/** Calls `fn` after every poll (~30 Hz) while subscribed; for logic, not rendering. */
export function onTelemetry(fn: (t: Telemetry) => void) {
  return subscribe(() => fn(current))
}

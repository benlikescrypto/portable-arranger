/**
 * Turns SwiftF0's pitch line (one value per 16 ms frame) into the notes to name on screen,
 * fast enough for quick ornaments and runs (Middle Eastern singing and lead lines).
 *
 * The whole stem is read before it plays, so a note change can be confirmed over a couple of
 * frames and then dated back to the frame where it really began: the display waits for
 * nothing. What it guards against:
 * - vibrato and wide ornaments: the pitch must leave the current key by a margin;
 * - one-frame glitches (octave jumps, consonants): a change must hold CONFIRM frames;
 * - short breaks in the line (consonants, breaths): gaps up to BRIDGE frames stay one note;
 * - recordings not tuned to A = 440: the song's own tuning is measured and allowed for.
 */

/** One note to show: start and end in seconds, `midi` the key. */
export type TrackNote = { s: number; e: number; midi: number }

/** Frames a new key must hold before it counts (2 x 16 ms). */
const CONFIRM = 2
/** Unvoiced frames bridged inside a note (3 x 16 ms). */
const BRIDGE = 3
/** How far past the half-way point to the next key the pitch must go, in semitones. */
const MARGIN = 0.15
/** The song's tuning is only corrected within this many semitones (a quarter tone is 0.5). */
const MAX_TUNING = 0.35

/**
 * The song's tuning against A = 440, in semitones (-0.35..0.35): where the voiced frames sit
 * between keys, most often. `line` holds MIDI x 100 per frame, 0 when unvoiced.
 */
export function measureTuning(line: ArrayLike<number>): number {
  const BINS = 20 // 5-cent bins over one semitone
  const h = new Array<number>(BINS).fill(0)
  let voiced = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (!c) continue
    const m = c / 100
    const frac = m - Math.round(m) // -0.5 .. 0.5
    h[((Math.floor((frac + 0.5) * BINS) % BINS) + BINS) % BINS]++
    voiced++
  }
  if (voiced < 60) return 0
  const at = (b: number) => h[((b % BINS) + BINS) % BINS]
  let best = -1
  let bestScore = -1
  for (let b = 0; b < BINS; b++) {
    const center = (b + 0.5) / BINS - 0.5
    if (Math.abs(center) > MAX_TUNING) continue
    const score = at(b - 1) + 2 * at(b) + at(b + 1)
    if (score > bestScore) {
      bestScore = score
      best = b
    }
  }
  if (best < 0) return 0
  // Refine with the weighted mean of the peak and its neighbours.
  let sum = 0
  let w = 0
  for (let d = -1; d <= 1; d++) {
    const n = at(best + d)
    sum += n * ((best + d + 0.5) / BINS - 0.5)
    w += n
  }
  const t = w > 0 ? sum / w : 0
  return Math.abs(t) < 0.05 ? 0 : Math.max(-MAX_TUNING, Math.min(MAX_TUNING, t))
}

/** Notes from the pitch line. `hop` is the frame period in seconds (SwiftF0: 0.016). */
export function trackNotes(line: ArrayLike<number>, hop: number, tuning = measureTuning(line)): TrackNote[] {
  const out: TrackNote[] = []
  const n = line.length
  let cur: number | null = null // key being shown
  let curStart = 0 // first frame of the current note
  let lastVoiced = -1 // last voiced frame of the current note
  let pend: number | null = null // key trying to take over
  let pendStart = 0
  let pendCount = 0
  let gap = 0

  const close = (endFrame: number) => {
    if (cur != null && endFrame > curStart) out.push({ s: curStart * hop, e: endFrame * hop, midi: cur })
    cur = null
  }

  for (let f = 0; f < n; f++) {
    const c = line[f]
    if (!c) {
      gap++
      pend = null
      pendCount = 0
      if (cur != null && gap > BRIDGE) close(lastVoiced + 1)
      continue
    }
    gap = 0
    const m = c / 100 - tuning
    const k = Math.round(m)
    if (cur == null) {
      // A note starts: it must hold CONFIRM frames (drops one-frame blips), dated from its first.
      if (pend === k) pendCount++
      else {
        pend = k
        pendStart = f
        pendCount = 1
      }
      if (pendCount >= CONFIRM) {
        cur = k
        curStart = pendStart
        lastVoiced = f
        pend = null
        pendCount = 0
      }
      continue
    }
    lastVoiced = f
    if (Math.abs(m - cur) < 0.5 + MARGIN || k === cur) {
      pend = null // still on the current key (vibrato, slide back)
      pendCount = 0
      continue
    }
    if (pend === k) pendCount++
    else {
      pend = k
      pendStart = f
      pendCount = 1
    }
    if (pendCount >= CONFIRM) {
      close(pendStart)
      cur = k
      curStart = pendStart
      pend = null
      pendCount = 0
    }
  }
  if (cur != null) close(lastVoiced + 1)
  return out
}

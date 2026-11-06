export const Pa = {
  bg: "#0B0C0E",
  bgRaised: "#121418",
  panel: "#181B20",
  panelAlt: "#1F232A",
  stroke: "#2C3138",
  text: "#F4F5F7",
  muted: "#9AA3AE",
  dim: "#6B7380",
  orange: "#FF7A18",
  blue: "#4EA3FF",
  green: "#3DDC84",
  red: "#E85D4C",
  gold: "#FFC857",
  purple: "#C77DFF",
  meter: "#7CDB9B",
  keyWhite: "#EDE7DC",
  keyBlack: "#16181C",
} as const

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const
export const CHORD_TYPES = ["", "m", "7", "m7", "M7", "sus4", "dim"] as const

export function noteName(n: number) {
  const pc = ((n % 12) + 12) % 12
  return `${NOTE_NAMES[pc]}${Math.floor(n / 12) - 1}`
}

export function chordLabel(root: number, type: number) {
  const pc = ((root % 12) + 12) % 12
  return `${NOTE_NAMES[pc]}${CHORD_TYPES[Math.max(0, Math.min(type, CHORD_TYPES.length - 1))]}`
}

export const Sections = {
  INTRO1: 1,
  INTRO2: 2,
  INTRO3: 3,
  VAR1: 4,
  VAR2: 5,
  VAR3: 6,
  VAR4: 7,
  FILL1: 8,
  FILL2: 9,
  FILL3: 10,
  FILL4: 11,
  BREAK: 12,
  END1: 13,
  END2: 14,
  END3: 15,
} as const

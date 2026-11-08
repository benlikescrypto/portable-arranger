export const Pa = {
  bg: "#07080A",
  bgRaised: "#101216",
  panel: "#14171C",
  panelAlt: "#1B1F26",
  stroke: "#2A3038",
  text: "#F5F6F8",
  muted: "#8E959F",
  dim: "#6A717A",
  orange: "#FF8A3D",
  blue: "#6AA8FF",
  green: "#3DDC84",
  red: "#FF5C4A",
  gold: "#F0C35A",
  purple: "#C77DFF",
  meter: "#7CDB9B",
} as const

/** PA4X Style Play LCD colors, sampled from the hardware screen. */
export const Lcd = {
  bezel: "#0B0C0E",
  bg: "#5C6772",
  bgDeep: "#4E5964",
  cell: "#66727C",
  line: "#3C4650",
  header: "#C4A56B",
  headerText: "#2B2416",
  text: "#F4F6F8",
  muted: "#D5DCE2",
  dim: "#B7C0C8",
  green: "#7EE0B8",
  red: "#E24A4A",
  orange: "#E39B45",
  mute: "#EDEDED",
} as const

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const
export const CHORD_TYPES = ["", "m", "7", "m7", "M7", "sus4", "dim", "6", "m6", "9", "sus2", "aug"] as const

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

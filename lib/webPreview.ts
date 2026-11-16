import type { SoundItem, StyleItem } from "@/lib/types"

/**
 * Names shown when the UI runs without the native engine (web preview / design
 * checks). Nothing plays: the web build has no audio engine.
 */
const SOUNDS: [string, string][] = [
  ["Concert Grand", "Piano"],
  ["Pop Piano", "Piano"],
  ["Electric Piano", "Electric"],
  ["Jazz Organ", "Organ"],
  ["Rock Organ", "Organ"],
  ["Concert Strings", "Strings"],
  ["Chamber Strings", "Strings"],
  ["Warm Pad", "Synth"],
  ["Brass Section", "Brass"],
  ["Tenor Sax", "Woodwind"],
  ["Nylon Guitar", "Guitar"],
  ["Clean Electric", "Guitar"],
  ["Distorted Guitar", "Guitar"],
  ["Accordion", "Oriental"],
  ["Kanun", "Oriental"],
  ["Oud", "Oriental"],
  ["Finger Bass", "Bass"],
  ["Standard Kit", "Percussion"],
  ["Symphonic Strings", "Strings"],
  ["Vibraphone", "Mallets"],
]

const STYLES: [string, string, number][] = [
  ["Pop Ballad", "Pop", 76],
  ["Modern Pop", "Pop", 104],
  ["Unplugged", "Ballad", 88],
  ["Swing Jazz", "Jazz", 132],
  ["Bossa Nova", "Latin", 120],
  ["Dance Floor", "Dance", 126],
  ["Oriental Pop", "Oriental", 98],
  ["Country Shuffle", "Country", 112],
]

export function previewSounds(): SoundItem[] {
  return SOUNDS.map(([name, category], id) => ({ id, name, category, source: "FACTORY", bank: "FACTORY", loaded: true, engineId: id }))
}

export function previewStyles(): StyleItem[] {
  return STYLES.map(([name, category, tempo], id) => ({
    id,
    name,
    category,
    tempo,
    source: "FACTORY",
    bank: "FACTORY",
    loaded: true,
    engineId: id,
  }))
}

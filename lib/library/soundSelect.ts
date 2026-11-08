import type { SoundItem } from "@/lib/types"

export const SOUND_BANKS = ["Factory", "Legacy", "GM/XG", "User"] as const
export type SoundBank = (typeof SOUND_BANKS)[number]

export const SOUND_CATS_LEFT = ["Piano", "E. Piano", "Guitar", "Organ", "Strings & Vocal", "Accordion"] as const
export const SOUND_CATS_RIGHT = [
  "Brass",
  "Sax",
  "Wood-wind",
  "Synth Pad",
  "Synth Lead",
  "Ethnic",
  "Bass",
  "Drum & SFX",
] as const
export const SOUND_CATEGORIES = [...SOUND_CATS_LEFT, ...SOUND_CATS_RIGHT] as const
export type SoundSelectCategory = (typeof SOUND_CATEGORIES)[number]

export const SOUND_PAGE_SIZE = 8

export function paSoundCategory(sound: Pick<SoundItem, "name" | "category">): SoundSelectCategory {
  const n = sound.name.toLowerCase()
  const c = sound.category
  if (c === "Piano") return "Piano"
  if (c === "Electric") return "E. Piano"
  if (c === "Guitar") return "Guitar"
  if (c === "Organ") return "Organ"
  if (n.includes("accordion") || n.includes("bandoneon") || n.includes("musette")) return "Accordion"
  if (c === "Strings" || n.includes("choir") || n.includes("vocal")) return "Strings & Vocal"
  if (c === "Brass") return "Brass"
  if (n.includes("sax")) return "Sax"
  if (c === "Woodwind") return "Wood-wind"
  if (
    c === "Synth" &&
    (n.includes("pad") || n.includes("atmosphere") || n.includes("texture") || n.includes("choir") || n.includes("strings"))
  ) {
    return "Synth Pad"
  }
  if (c === "Synth") return "Synth Lead"
  if (c === "Oriental") return "Ethnic"
  if (c === "Bass") return "Bass"
  if (c === "Percussion") return "Drum & SFX"
  return "Ethnic"
}

export function soundsInBank(sounds: SoundItem[], bank: SoundBank) {
  return sounds.filter((item) => {
    const src = (item.source ?? "FACTORY").toUpperCase()
    const factory = src === "FACTORY"
    if (bank === "Factory") return factory
    if (bank === "User") return !factory
    return false
  })
}

export function soundsInCategory(sounds: SoundItem[], category: SoundSelectCategory) {
  return sounds.filter((item) => paSoundCategory(item) === category)
}

export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / SOUND_PAGE_SIZE))
}

export function soundsOnPage(sounds: SoundItem[], page: number) {
  const start = page * SOUND_PAGE_SIZE
  return sounds.slice(start, start + SOUND_PAGE_SIZE)
}

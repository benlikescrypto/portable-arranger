import type { PadItem } from "@/lib/types"

export const PAD_CATS_LEFT = ["Hit", "Sequence", "Guitar", "Percussion"] as const
export const PAD_CATS_RIGHT = ["Synth", "Ethnic", "Vocal", "SFX"] as const
export const PAD_CATEGORIES = [...PAD_CATS_LEFT, ...PAD_CATS_RIGHT] as const

export function paPadCategory(pad: Pick<PadItem, "name" | "category">): string {
  const n = pad.name.toLowerCase()
  if (["hit", "shot", "crash", "sting", "stab"].some((k) => n.includes(k))) return "Hit"
  if (n.includes("guitar")) return "Guitar"
  if (["drum", "perc", "conga", "darbuka", "riq", "kit"].some((k) => n.includes(k))) return "Percussion"
  if (["pad", "lead", "synth"].some((k) => n.includes(k))) return "Synth"
  if (["choir", "vocal", "voice"].some((k) => n.includes(k))) return "Vocal"
  if (["sfx", "fx", "noise"].some((k) => n.includes(k))) return "SFX"
  if (
    ["oud", "ney", "kanun", "orient", "arabic", "mizrahi", "saz"].some((k) => n.includes(k)) ||
    pad.category === "Oriental"
  ) {
    return "Ethnic"
  }
  if ((PAD_CATEGORIES as readonly string[]).includes(pad.category)) return pad.category
  return "Sequence"
}

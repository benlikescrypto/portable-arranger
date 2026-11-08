import type { StyleItem } from "@/lib/types"

export const STYLE_CATS_LEFT = ["Pop", "Rock", "Ballad", "Dance", "Funk", "Jazz"] as const
export const STYLE_CATS_RIGHT = ["Latin", "Oriental", "World", "Country", "Gospel", "R&B"] as const
export const STYLE_CATEGORIES = [...STYLE_CATS_LEFT, ...STYLE_CATS_RIGHT] as const

export function paStyleCategory(style: Pick<StyleItem, "category" | "source">): string {
  if ((style.source ?? "").toUpperCase() === "IMPORTED") return "World"
  const c = style.category === "Disco" ? "Dance" : style.category
  if ((STYLE_CATEGORIES as readonly string[]).includes(c)) return c
  return "World"
}

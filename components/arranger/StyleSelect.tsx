import { BankPadSelect } from "@/components/arranger/BankPadSelect"
import { paStyleCategory, STYLE_CATS_LEFT, STYLE_CATS_RIGHT } from "@/lib/library/styleSelect"
import type { StyleItem } from "@/lib/types"

type Props = {
  styles: StyleItem[]
  activeId: number
  onSelect: (id: number) => void
  onClose: () => void
}

export function StyleSelect({ styles, activeId, onSelect, onClose }: Props) {
  return (
    <BankPadSelect
      title="STYLE SELECT"
      catsLeft={STYLE_CATS_LEFT}
      catsRight={STYLE_CATS_RIGHT}
      items={styles}
      activeId={activeId}
      categorize={paStyleCategory}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}

import { BankPadSelect } from "@/components/arranger/BankPadSelect"
import { PAD_CATS_LEFT, PAD_CATS_RIGHT, paPadCategory } from "@/lib/library/padSelect"
import type { PadItem } from "@/lib/types"

type Props = {
  pads: PadItem[]
  activeId: number
  loadingId: number | null
  loadingProgress: number
  onSelect: (id: number) => void
  onClose: () => void
}

export function PadSelect({ pads, activeId, loadingId, loadingProgress, onSelect, onClose }: Props) {
  return (
    <BankPadSelect
      title="PAD SELECT"
      catsLeft={PAD_CATS_LEFT}
      catsRight={PAD_CATS_RIGHT}
      items={pads}
      activeId={activeId}
      categorize={paPadCategory}
      loadingId={loadingId}
      loadingProgress={loadingProgress}
      onSelect={onSelect}
      onClose={onClose}
      emptyHint="Import a SET or Pad Record SMF, then tap a User pad to load it."
    />
  )
}

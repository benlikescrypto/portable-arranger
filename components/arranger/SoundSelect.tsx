import { BankPadSelect } from "@/components/arranger/BankPadSelect"
import { paSoundCategory, SOUND_CATS_LEFT, SOUND_CATS_RIGHT } from "@/lib/library/soundSelect"
import type { SoundItem } from "@/lib/types"

const PART_LABELS = ["Upper 1", "Upper 2", "Upper 3", "Lower"] as const

type Props = {
  part: 0 | 1 | 2 | 3
  sounds: SoundItem[]
  activeId: number
  loadingId?: number | null
  loadingProgress?: number
  onSelect: (id: number) => void
  onClose: () => void
  emptyHint?: string
}

export function SoundSelect({
  part,
  sounds,
  activeId,
  loadingId,
  loadingProgress,
  onSelect,
  onClose,
  emptyHint,
}: Props) {
  return (
    <BankPadSelect
      title="SOUND SELECT"
      partLabel={PART_LABELS[part]}
      catsLeft={SOUND_CATS_LEFT}
      catsRight={SOUND_CATS_RIGHT}
      items={sounds}
      activeId={activeId}
      categorize={paSoundCategory}
      loadingId={loadingId}
      loadingProgress={loadingProgress}
      onSelect={onSelect}
      onClose={onClose}
      emptyHint={emptyHint}
    />
  )
}

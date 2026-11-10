import { useEffect, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { Lcd } from "@/constants/theme"
import { pageCount, SOUND_BANKS, SOUND_PAGE_SIZE, type SoundBank } from "@/lib/library/soundSelect"

export type PadEntry = {
  id: number
  name: string
  category: string
  source?: string
  loaded?: boolean
  loadError?: string
}

type Props = {
  title: string
  partLabel?: string
  catsLeft: readonly string[]
  catsRight: readonly string[]
  items: PadEntry[]
  activeId: number
  categorize: (item: PadEntry) => string
  onSelect: (id: number) => void
  onClose: () => void
  emptyHint?: string
  loadingId?: number | null
  loadingProgress?: number
}

function inBank(items: PadEntry[], bank: SoundBank) {
  return items.filter((item) => {
    const factory = (item.source ?? "FACTORY").toUpperCase() === "FACTORY"
    if (bank === "Factory") return factory
    if (bank === "User") return !factory
    return false
  })
}

function pageOf(items: PadEntry[], id: number) {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return 0
  return Math.floor(index / SOUND_PAGE_SIZE)
}

export function BankPadSelect({
  title,
  partLabel,
  catsLeft,
  catsRight,
  items,
  activeId,
  categorize,
  onSelect,
  onClose,
  emptyHint,
  loadingId = null,
  loadingProgress = 0,
}: Props) {
  const current = items.find((item) => item.id === activeId)
  const initialBank: SoundBank = (current?.source ?? "FACTORY").toUpperCase() === "FACTORY" ? "Factory" : "User"
  const initialCategory = current ? categorize(current) : catsLeft[0]
  const [bank, setBank] = useState<SoundBank>(initialBank)
  const [category, setCategory] = useState(initialCategory)
  const [page, setPage] = useState(() =>
    pageOf(
      inBank(items, initialBank).filter((item) => categorize(item) === initialCategory),
      activeId
    )
  )

  const bankItems = useMemo(() => inBank(items, bank), [items, bank])
  const categoryItems = useMemo(
    () => bankItems.filter((item) => categorize(item) === category),
    [bankItems, category, categorize]
  )
  const pages = pageCount(categoryItems.length)
  const safePage = Math.min(page, pages - 1)
  const pads = categoryItems.slice(safePage * SOUND_PAGE_SIZE, safePage * SOUND_PAGE_SIZE + SOUND_PAGE_SIZE)

  useEffect(() => {
    setPage(pageOf(categoryItems, activeId))
  }, [bank, category])

  const pickCategory = (next: string) => {
    setCategory(next)
    if (bank === "Legacy" || bank === "GM/XG") setBank("Factory")
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.lcd}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.banks}>
            {SOUND_BANKS.map((item) => (
              <Pressable
                key={item}
                onPress={() => setBank(item)}
                accessibilityRole="button"
                accessibilityLabel={item}
                style={[styles.bank, bank === item && styles.bankOn]}
              >
                <Text style={[styles.bankLabel, bank === item && styles.bankLabelOn]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          {partLabel ? <Text style={styles.part}>{partLabel}</Text> : null}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Exit" style={styles.exit}>
            <Text style={styles.exitLabel}>EXIT</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.catCol}>
            {catsLeft.map((item) => (
              <CategoryCell key={item} label={item} active={category === item} onPress={() => pickCategory(item)} />
            ))}
          </View>

          <View style={styles.center}>
            <View style={styles.grid}>
              {[0, 1, 2, 3].map((row) => (
                <View key={row} style={styles.gridRow}>
                  {[0, 1].map((col) => {
                    const i = row * 2 + col
                    const pad = pads[i]
                    const loading = pad != null && pad.id === loadingId
                    const loaded = pad?.loaded !== false
                    return (
                      <Pressable
                        key={i}
                        disabled={!pad}
                        onPress={() => pad && onSelect(pad.id)}
                        accessibilityRole="button"
                        accessibilityLabel={pad?.name ?? "Empty"}
                        style={({ pressed }) => [
                          styles.pad,
                          !pad && styles.padEmpty,
                          pad && !loaded && styles.padUnloaded,
                          pad?.id === activeId && styles.padOn,
                          loading && styles.padLoading,
                          pressed && pad && styles.pressed,
                        ]}
                      >
                        {loading ? (
                          <View
                            pointerEvents="none"
                            style={[styles.padFill, { height: `${Math.max(8, Math.round(loadingProgress * 100))}%` }]}
                          />
                        ) : null}
                        <Text style={[styles.padName, !pad && styles.padNameEmpty]} numberOfLines={2}>
                          {pad?.name ?? ""}
                        </Text>
                        {pad && !loaded && !loading ? (
                          <Text style={styles.padMeta} numberOfLines={1}>
                            {pad.loadError ? "Need SMF" : "Tap to load"}
                          </Text>
                        ) : null}
                        {loading ? (
                          <Text style={styles.padMeta} numberOfLines={1}>
                            {`${Math.round(loadingProgress * 100)}%`}
                          </Text>
                        ) : null}
                      </Pressable>
                    )
                  })}
                </View>
              ))}
            </View>
            <View style={styles.pages}>
              {Array.from({ length: pages }).map((_, i) => (
                <Pressable key={i} onPress={() => setPage(i)} style={[styles.pageTab, safePage === i && styles.pageTabOn]}>
                  <Text style={[styles.pageLabel, safePage === i && styles.pageLabelOn]}>{`P${i + 1}`}</Text>
                </Pressable>
              ))}
            </View>
            {bank === "Legacy" || bank === "GM/XG" ? (
              <Text style={styles.emptyBank}>No {bank} bank in ArrangerBox.</Text>
            ) : bank === "User" && categoryItems.length === 0 && emptyHint ? (
              <Text style={styles.emptyBank}>{emptyHint}</Text>
            ) : null}
          </View>

          <View style={styles.catCol}>
            {catsRight.map((item) => (
              <CategoryCell key={item} label={item} active={category === item} onPress={() => pickCategory(item)} />
            ))}
          </View>
        </View>
      </View>
    </View>
  )
}

function CategoryCell({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.cat, active && styles.catOn]}
    >
      <Text style={[styles.catLabel, active && styles.catLabelOn]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  lcd: {
    flex: 1,
    backgroundColor: Lcd.bg,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1A1D22",
  },
  header: {
    height: 34,
    backgroundColor: Lcd.bgDeep,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Lcd.line,
  },
  title: { color: Lcd.dim, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  banks: { flex: 1, flexDirection: "row", gap: 4 },
  bank: {
    paddingHorizontal: 8,
    height: 22,
    justifyContent: "center",
    backgroundColor: Lcd.cell,
  },
  bankOn: { backgroundColor: Lcd.tabOn },
  bankLabel: { color: Lcd.muted, fontSize: 11, fontWeight: "700" },
  bankLabelOn: { color: Lcd.headerText },
  part: { color: Lcd.text, fontSize: 12, fontWeight: "700" },
  exit: {
    paddingHorizontal: 10,
    height: 22,
    justifyContent: "center",
    backgroundColor: Lcd.cell,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  exitLabel: { color: Lcd.text, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  body: { flex: 1, flexDirection: "row" },
  catCol: { width: 78, backgroundColor: Lcd.bgDeep },
  cat: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Lcd.line,
  },
  catOn: { backgroundColor: Lcd.catOn },
  catLabel: { color: Lcd.text, fontSize: 11, fontWeight: "700", lineHeight: 13 },
  catLabelOn: { color: "#0E2A2E" },
  center: { flex: 1, padding: 6, gap: 6 },
  grid: { flex: 1 },
  gridRow: { flex: 1, flexDirection: "row" },
  pad: {
    flex: 1,
    backgroundColor: Lcd.pad,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: 3,
    borderColor: "#9A3535",
    borderTopColor: "#E07A7A",
    borderLeftColor: "#D66A6A",
    overflow: "hidden",
  },
  padEmpty: { backgroundColor: "#8A3A3A", borderTopColor: "#A05050", borderLeftColor: "#944848" },
  padUnloaded: { opacity: 0.78 },
  padOn: { backgroundColor: Lcd.padOn, borderColor: Lcd.tabOn },
  padLoading: { borderColor: Lcd.tabOn },
  padFill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(232, 196, 90, 0.55)",
  },
  padName: { color: Lcd.text, fontSize: 15, fontWeight: "800", textAlign: "center", zIndex: 1 },
  padNameEmpty: { color: "transparent" },
  padMeta: { color: Lcd.muted, fontSize: 10, fontWeight: "700", marginTop: 4, zIndex: 1 },
  pages: { flexDirection: "row", justifyContent: "center", gap: 10, height: 22, alignItems: "center" },
  pageTab: { paddingHorizontal: 6, paddingVertical: 2 },
  pageTabOn: { borderBottomWidth: 2, borderBottomColor: Lcd.tabOn },
  pageLabel: { color: Lcd.dim, fontSize: 12, fontWeight: "800" },
  pageLabelOn: { color: Lcd.text },
  emptyBank: { color: Lcd.muted, fontSize: 11, fontWeight: "600", textAlign: "center" },
  pressed: { opacity: 0.9 },
})

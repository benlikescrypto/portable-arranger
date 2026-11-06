import type { ReactNode } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Pa } from "@/constants/theme"
import type { SoundItem, StyleItem } from "@/lib/types"

type Props = {
  title: string
  query: string
  category: string
  categories: string[]
  filter: "all" | "factory" | "imported"
  onQuery: (q: string) => void
  onCategory: (c: string) => void
  onFilter: (f: "all" | "factory" | "imported") => void
  onClose: () => void
  children: ReactNode
}

export function LibrarySheet({
  title,
  query,
  category,
  categories,
  filter,
  onQuery,
  onCategory,
  onFilter,
  onClose,
  children,
}: Props) {
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        styles.sheet,
        {
          paddingTop: Math.max(insets.top, 8) + 4,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
        },
      ]}
    >
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
          <Text style={styles.closeLabel}>CLOSE</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={onQuery}
        placeholder="Search"
        placeholderTextColor={Pa.dim}
        style={styles.search}
      />
      <View style={styles.row}>
        {(["all", "factory", "imported"] as const).map((f) => (
          <Pressable key={f} onPress={() => onFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
            <Text style={[styles.chipLabel, filter === f && styles.chipLabelOn]}>{f.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {categories.map((c) => (
          <Pressable key={c} onPress={() => onCategory(c)} style={[styles.chip, category === c && styles.chipOn]}>
            <Text style={[styles.chipLabel, category === c && styles.chipLabelOn]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={styles.body} contentContainerStyle={styles.grid}>
        {children}
      </ScrollView>
    </View>
  )
}

export function LibraryItem({
  name,
  meta,
  active,
  favorite,
  onPress,
  onLongPress,
  onFavorite,
  width,
}: {
  name: string
  meta: string
  active?: boolean
  favorite?: boolean
  onPress: () => void
  onLongPress?: () => void
  onFavorite?: () => void
  width?: `${number}%` | number
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.item, active && styles.itemOn, width != null ? { width, minWidth: 0 } : null]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {onFavorite ? (
        <Pressable onPress={onFavorite} hitSlop={8}>
          <Text style={{ color: favorite ? Pa.gold : Pa.dim }}>{favorite ? "★" : "☆"}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  )
}

export function filterLibrary<T extends SoundItem | StyleItem>(
  items: T[],
  query: string,
  category: string,
  filter: "all" | "factory" | "imported",
  favorites: number[],
  recent: number[]
): T[] {
  const q = query.trim().toLowerCase()
  return items.filter((item) => {
    if (category === "Favorites") return favorites.includes(item.id)
    if (category === "Recent") return recent.includes(item.id)
    if (category !== "All" && item.category !== category) return false
    const src = (item.source ?? "FACTORY").toUpperCase()
    if (filter === "factory" && src !== "FACTORY") return false
    if (filter === "imported" && src === "FACTORY") return false
    if (!q) return true
    return item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
  })
}

export function libraryItemWidth(windowWidth: number): `${number}%` {
  if (windowWidth < 520) return "100%"
  if (windowWidth < 900) return "48%"
  return "31%"
}

const styles = StyleSheet.create({
  sheet: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Pa.bg,
    gap: 8,
    zIndex: 20,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { color: Pa.orange, fontWeight: "900", fontSize: 16, letterSpacing: 1.4, flex: 1 },
  close: { height: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: Pa.stroke, justifyContent: "center" },
  closeLabel: { color: Pa.text, fontWeight: "800" },
  search: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Pa.stroke,
    color: Pa.text,
    paddingHorizontal: 12,
    backgroundColor: Pa.panel,
  },
  row: { flexDirection: "row", gap: 6, alignItems: "center" },
  chip: { height: 32, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: Pa.stroke, justifyContent: "center" },
  chipOn: { backgroundColor: Pa.orange, borderColor: Pa.orange },
  chipLabel: { color: Pa.muted, fontSize: 11, fontWeight: "700" },
  chipLabelOn: { color: Pa.bg },
  body: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 16 },
  item: {
    width: "31%",
    minWidth: 160,
    flexGrow: 1,
    backgroundColor: Pa.panel,
    borderWidth: 1,
    borderColor: Pa.stroke,
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemOn: { borderColor: Pa.orange, backgroundColor: "#2A1C10" },
  itemName: { color: Pa.text, fontWeight: "700", fontSize: 14 },
  itemMeta: { color: Pa.muted, fontSize: 11, marginTop: 2 },
})

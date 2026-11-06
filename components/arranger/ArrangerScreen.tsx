import { useMemo, useState } from "react"
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  filterLibrary,
  LibraryItem,
  LibrarySheet,
  libraryItemWidth,
} from "@/components/arranger/LibrarySheet"
import { SelectCard } from "@/components/arranger/SelectCard"
import { Pa } from "@/constants/theme"
import { useArranger } from "@/hooks/useArranger"

export function ArrangerScreen() {
  const vm = useArranger()
  const s = vm.state
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const landscape = width > height
  const [picker, setPicker] = useState<"sound" | "style" | null>(null)
  const [page, setPage] = useState(0)
  const [pagerW, setPagerW] = useState(0)

  const style = s.styles.find((item) => item.id === s.styleId)
  const sound = s.sounds.find((item) => item.id === s.upper1)
  const itemWidth = libraryItemWidth(width)
  const padX = Math.max(insets.left, 20)
  const padYTop = Math.max(insets.top, 12)
  const padYBot = Math.max(insets.bottom, 14)
  const slideW = pagerW || Math.max(1, width - padX - Math.max(insets.right, 20))
  const hasImported =
    s.sounds.some((item) => (item.source ?? "FACTORY") !== "FACTORY") ||
    s.styles.some((item) => (item.source ?? "FACTORY") !== "FACTORY")

  const soundCats = useMemo(
    () => ["All", "Favorites", ...Array.from(new Set(s.sounds.map((item) => item.category)))],
    [s.sounds]
  )
  const styleCats = useMemo(
    () => ["All", "Favorites", ...Array.from(new Set(s.styles.map((item) => item.category)))],
    [s.styles]
  )
  const shownSounds = filterLibrary(s.sounds, s.query, s.category, s.libraryFilter, s.favorites, s.recentSounds)
  const shownStyles = filterLibrary(s.styles, s.query, s.category, s.libraryFilter, s.favorites, s.recentStyles)

  const openSound = () => {
    vm.setQuery("")
    vm.setCategory("All")
    vm.setMode("SOUND")
    setPicker("sound")
  }
  const openStyle = () => {
    vm.setQuery("")
    vm.setCategory("All")
    vm.setMode("PAD")
    setPicker("style")
  }
  const closePicker = () => {
    vm.setMode("STYLE")
    setPicker(null)
  }

  const onPage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, slideW))
    setPage(next === 1 ? 1 : 0)
  }

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: padYTop,
          paddingBottom: padYBot,
          paddingLeft: padX,
          paddingRight: Math.max(insets.right, 20),
        },
      ]}
    >
      <View style={styles.top}>
        <Text style={styles.brand}>ArrangerBox</Text>
        <Pressable onPress={vm.importSet} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.importLabel}>Import</Text>
        </Pressable>
      </View>

      {s.importing ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(s.importProgress * 100)}%` }]} />
        </View>
      ) : s.importMessage ? (
        <Text style={styles.status} numberOfLines={1}>
          {s.importMessage}
        </Text>
      ) : null}

      <ScrollView
        horizontal
        pagingEnabled
        bounces={false}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setPagerW(event.nativeEvent.layout.width)}
        onMomentumScrollEnd={onPage}
        scrollEventThrottle={16}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
      >
        <View style={[styles.slide, { width: slideW }]}>
          <View style={[styles.picks, landscape && styles.picksWide]}>
            <SelectCard kicker="Sound" title={sound?.name ?? "Concert Grand"} subtitle={sound?.category} onPress={openSound} />
            <SelectCard
              kicker="Style"
              title={style?.name ?? "No Style"}
              subtitle={style ? `${style.category} · ${Math.round(style.tempo)} BPM` : undefined}
              onPress={openStyle}
            />
          </View>
          <Text style={styles.hint}>Swipe for Start</Text>
        </View>

        <View style={[styles.slide, styles.playSlide, { width: slideW }]}>
          <Text style={styles.playKicker} numberOfLines={1}>
            {style?.name ?? "Style"}
          </Text>
          <Pressable
            onPress={vm.toggleStart}
            accessibilityRole="button"
            accessibilityLabel={s.playing ? "Stop style" : "Start style"}
            style={({ pressed }) => [
              styles.start,
              { backgroundColor: s.playing ? Pa.red : Pa.text },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.startLabel, { color: s.playing ? Pa.text : Pa.bg }]}>
              {s.playing ? "Stop" : "Start"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.dots} accessibilityRole="tablist">
        <View style={[styles.dot, page === 0 && styles.dotOn]} />
        <View style={[styles.dot, page === 1 && styles.dotOn]} />
      </View>

      {picker === "sound" ? (
        <LibrarySheet
          title="Sounds"
          query={s.query}
          category={s.category}
          categories={soundCats}
          filter={s.libraryFilter}
          showSourceFilter={hasImported}
          onQuery={vm.setQuery}
          onCategory={vm.setCategory}
          onFilter={vm.setLibraryFilter}
          onClose={closePicker}
        >
          {shownSounds.map((item) => (
            <LibraryItem
              key={item.id}
              name={item.name}
              meta={item.category}
              active={item.id === s.upper1}
              favorite={s.favorites.includes(item.id)}
              width={itemWidth}
              onPress={() => {
                vm.selectSound(item.id, 0)
                closePicker()
              }}
              onFavorite={() => vm.toggleFavorite(item.id)}
            />
          ))}
        </LibrarySheet>
      ) : null}

      {picker === "style" ? (
        <LibrarySheet
          title="Styles"
          query={s.query}
          category={s.category}
          categories={styleCats}
          filter={s.libraryFilter}
          showSourceFilter={hasImported}
          onQuery={vm.setQuery}
          onCategory={vm.setCategory}
          onFilter={vm.setLibraryFilter}
          onClose={closePicker}
        >
          {shownStyles.map((item) => (
            <LibraryItem
              key={item.id}
              name={item.name}
              meta={`${item.category} · ${Math.round(item.tempo)} BPM`}
              active={item.id === s.styleId}
              favorite={s.favorites.includes(item.id)}
              width={itemWidth}
              onPress={() => {
                vm.selectStyle(item.id)
                closePicker()
              }}
              onFavorite={() => vm.toggleFavorite(item.id)}
            />
          ))}
        </LibrarySheet>
      ) : null}

      {s.mode === "SET" ? (
        <LibrarySheet
          title="Imported"
          query=""
          category="All"
          categories={["All"]}
          filter="all"
          showSourceFilter={false}
          onQuery={() => undefined}
          onCategory={() => undefined}
          onFilter={() => undefined}
          onClose={() => vm.setMode("STYLE")}
        >
          <Text style={styles.empty}>{s.importReport || s.importMessage || "Nothing imported yet."}</Text>
        </LibrarySheet>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Pa.bg },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  brand: {
    color: Pa.text,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  importLabel: { color: Pa.muted, fontSize: 15, fontWeight: "600" },
  status: { color: Pa.dim, fontSize: 12, marginBottom: 8 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Pa.stroke,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: { height: "100%", backgroundColor: Pa.orange },
  pager: { flex: 1 },
  pagerContent: { flexGrow: 1 },
  slide: {
    alignSelf: "stretch",
    justifyContent: "center",
    paddingBottom: 8,
  },
  playSlide: { alignItems: "center" },
  picks: { flex: 1, gap: 12, justifyContent: "center" },
  picksWide: { flexDirection: "row" },
  hint: {
    color: Pa.dim,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 18,
  },
  playKicker: {
    color: Pa.muted,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 22,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  start: {
    minWidth: 220,
    height: 88,
    paddingHorizontal: 48,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  startLabel: { fontSize: 28, fontWeight: "800", letterSpacing: 0.2 },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingTop: 10,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Pa.stroke },
  dotOn: { backgroundColor: Pa.text, width: 18 },
  pressed: { opacity: 0.82 },
  empty: { color: Pa.muted, fontSize: 15, padding: 8 },
})

import { useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { LevelBar } from "@/components/arranger/LevelBar"
import {
  filterLibrary,
  LibraryItem,
  LibrarySheet,
  libraryItemWidth,
} from "@/components/arranger/LibrarySheet"
import { SelectCard } from "@/components/arranger/SelectCard"
import { Pa, Sections, chordLabel } from "@/constants/theme"
import { useArranger } from "@/hooks/useArranger"

function Seg({
  label,
  active,
  onPress,
  wide,
}: {
  label: string
  active?: boolean
  onPress: () => void
  wide?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.seg,
        wide && styles.segWide,
        active && styles.segOn,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.segLabel, active && styles.segLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

export function ArrangerScreen() {
  const vm = useArranger()
  const s = vm.state
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const landscape = width > height
  const compact = height < 520 || (landscape && height < 430)
  const [picker, setPicker] = useState<"sound" | "style" | null>(null)

  const style = s.styles.find((item) => item.id === s.styleId)
  const sound = s.sounds.find((item) => item.id === s.upper1)
  const itemWidth = libraryItemWidth(width)
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

  const varN = s.section >= 4 && s.section <= 7 ? s.section - 3 : s.variation
  const introOn = s.section >= 1 && s.section <= 3
  const fillOn = s.section >= 8 && s.section <= 11
  const endOn = s.section >= 13

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

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 10),
          paddingBottom: Math.max(insets.bottom, 12),
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
        },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.midi}>
          <View style={[styles.midiDot, s.midiConnected && styles.midiDotOn]} />
          <Text style={styles.midiLabel} numberOfLines={1}>
            {s.midiConnected ? s.midiName : "No MIDI"}
          </Text>
        </View>
        <Pressable onPress={vm.importSet} hitSlop={8} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={styles.linkLabel}>Import</Text>
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

      <View style={[styles.picks, landscape && styles.picksWide]}>
        <SelectCard kicker="Sound" title={sound?.name ?? "Concert Grand"} subtitle={sound?.category} onPress={openSound} />
        <SelectCard
          kicker="Style"
          title={style?.name ?? "No Style"}
          subtitle={style ? `${style.category} · ${Math.round(style.tempo)} BPM` : undefined}
          onPress={openStyle}
        />
      </View>

      <View style={[styles.stage, landscape && styles.stageWide, compact && styles.stageCompact]}>
        <View style={styles.chordBlock}>
          <Text style={styles.kicker}>Chord</Text>
          <Text style={[styles.chord, compact && styles.chordCompact]}>{chordLabel(s.chordRoot, s.chordType)}</Text>
          <View style={styles.tempoRow}>
            <Pressable onPress={() => vm.nudgeTempo(-1)} hitSlop={10} style={styles.tempoHit}>
              <Text style={styles.tempoHitLabel}>−</Text>
            </Pressable>
            <Text style={styles.tempo}>{Math.round(s.tempo)}</Text>
            <Pressable onPress={() => vm.nudgeTempo(1)} hitSlop={10} style={styles.tempoHit}>
              <Text style={styles.tempoHitLabel}>+</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={vm.toggleStart}
          accessibilityRole="button"
          accessibilityLabel={s.playing ? "Stop" : "Start"}
          style={({ pressed }) => [
            styles.start,
            compact && styles.startCompact,
            { backgroundColor: s.playing ? Pa.red : Pa.text },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.startLabel, { color: s.playing ? Pa.text : Pa.bg }]}>
            {s.playing ? "Stop" : "Start"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.transport}>
        <Seg label="Intro" active={introOn} onPress={() => vm.book(Sections.INTRO1)} wide />
        {[1, 2, 3, 4].map((n) => (
          <Seg key={n} label={String(n)} active={varN === n && !introOn && !fillOn && !endOn} onPress={() => vm.book(3 + n)} />
        ))}
        <Seg label="Fill" active={fillOn} onPress={() => vm.book(7 + Math.max(1, varN))} wide />
        <Seg label="End" active={endOn} onPress={() => vm.book(Sections.END1)} wide />
      </View>

      <View style={styles.mix}>
        <LevelBar label="You" value={s.mixer.keyboard} onChange={(v) => vm.setMixer(0, v)} />
        <LevelBar label="Band" value={s.mixer.acc} onChange={vm.setAccVolume} />
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
              onLongPress={() => vm.previewSound(item.id)}
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
  root: { flex: 1, backgroundColor: Pa.bg, gap: 14 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  midi: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flex: 1 },
  midiDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Pa.stroke },
  midiDotOn: { backgroundColor: Pa.green },
  midiLabel: { color: Pa.muted, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  link: { paddingVertical: 8, paddingHorizontal: 4 },
  linkLabel: { color: Pa.text, fontSize: 15, fontWeight: "600" },
  status: { color: Pa.dim, fontSize: 12 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: Pa.stroke, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Pa.orange },
  picks: { flexDirection: "column", gap: 10 },
  picksWide: { flexDirection: "row" },
  stage: {
    flex: 1,
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
  },
  stageWide: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8 },
  stageCompact: { minHeight: 96, gap: 12, flex: 0.8 },
  chordBlock: { alignItems: "center" },
  kicker: {
    color: Pa.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  chord: {
    color: Pa.text,
    fontSize: 72,
    fontWeight: "700",
    letterSpacing: -2,
    lineHeight: 80,
  },
  chordCompact: { fontSize: 44, lineHeight: 50 },
  tempoRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 4 },
  tempo: { color: Pa.muted, fontSize: 22, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 44, textAlign: "center" },
  tempoHit: { width: 36, height: 36, borderRadius: 18, backgroundColor: Pa.panel, alignItems: "center", justifyContent: "center" },
  tempoHitLabel: { color: Pa.text, fontSize: 22, fontWeight: "600", marginTop: -1 },
  start: {
    minWidth: 168,
    height: 64,
    paddingHorizontal: 36,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  startCompact: { height: 52, minWidth: 140 },
  startLabel: { fontSize: 20, fontWeight: "800", letterSpacing: 0.4 },
  transport: { flexDirection: "row", gap: 8 },
  seg: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: Pa.panel,
    alignItems: "center",
    justifyContent: "center",
  },
  segWide: { flex: 1.35 },
  segOn: { backgroundColor: Pa.text },
  segLabel: { color: Pa.text, fontSize: 15, fontWeight: "700" },
  segLabelOn: { color: Pa.bg },
  pressed: { opacity: 0.82 },
  mix: { gap: 10, paddingBottom: 4 },
  empty: { color: Pa.muted, fontSize: 15, padding: 8 },
})

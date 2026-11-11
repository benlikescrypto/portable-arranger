import { useEffect, useMemo, useRef, useState, type ElementRef } from "react"
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

import { LibrarySheet } from "@/components/arranger/LibrarySheet"
import { MiniKeyboard } from "@/components/arranger/MiniKeyboard"
import { SoundSelect } from "@/components/arranger/SoundSelect"
import { StylePlayHome } from "@/components/arranger/StylePlayHome"
import { PadSelect } from "@/components/arranger/PadSelect"
import { StyleSelect } from "@/components/arranger/StyleSelect"
import { Lcd, Pa } from "@/constants/theme"
import { useArranger } from "@/hooks/useArranger"
import type { SoundItem } from "@/lib/types"

function soundById(sounds: SoundItem[], id: number | null | undefined) {
  if (id == null) return undefined
  return sounds.find((item) => item.id === id)
}

function soundName(sounds: SoundItem[], names: string[], fallback: string) {
  for (const name of names) {
    const hit = sounds.find((item) => item.name === name)
    if (hit) return hit.name
  }
  return fallback
}

export function ArrangerScreen() {
  const vm = useArranger()
  const s = vm.state
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [picker, setPicker] = useState<"sound" | "style" | "pad" | null>(null)
  const [soundPart, setSoundPart] = useState<0 | 1 | 2 | 3>(0)
  const [page, setPage] = useState(0)
  const [pagerW, setPagerW] = useState(0)
  const pagerRef = useRef<ElementRef<typeof ScrollView>>(null)

  const style = s.styles.find((item) => item.id === s.styleId)
  const padX = Math.max(insets.left, 10)
  const padYTop = Math.max(insets.top, 8)
  const padYBot = Math.max(insets.bottom, 8)
  const slideW = pagerW || Math.max(1, width - padX - Math.max(insets.right, 10))
  const stsPads = useMemo(
    () => [
      { n: 1, name: soundName(s.sounds, ["Distorted Guitar", "Overdrive Guitar"], "STS 1") },
      { n: 2, name: soundName(s.sounds, ["Jazz Organ", "Rock Organ"], "STS 2") },
      { n: 3, name: soundName(s.sounds, ["Concert Grand", "Pop Piano"], "STS 3") },
      { n: 4, name: soundName(s.sounds, ["Accordion", "Kanun"], "STS 4") },
    ],
    [s.sounds]
  )

  const showLeft = () => {
    pagerRef.current?.scrollTo({ x: 0, animated: true })
    setPage(0)
  }

  const openSound = (part: 0 | 1 | 2 | 3) => {
    setSoundPart(part)
    vm.setQuery("")
    vm.setCategory("All")
    vm.setMode("SOUND")
    setPicker("sound")
    showLeft()
  }
  const openStyle = () => {
    vm.setQuery("")
    vm.setCategory("All")
    vm.setMode("STYLE")
    setPicker("style")
    showLeft()
  }
  const openPads = () => {
    vm.setQuery("")
    vm.setCategory("All")
    vm.setMode("PAD")
    setPicker("pad")
    showLeft()
  }
  const closePicker = () => {
    vm.setMode("STYLE")
    vm.setLibraryFilter("all")
    setPicker(null)
  }

  useEffect(() => {
    if (s.mode === "PAD") setPicker("pad")
    if (s.mode === "SOUND") setPicker("sound")
  }, [s.mode])

  const onPage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, slideW))
    setPage(next === 1 ? 1 : 0)
  }

  const activeSoundId = soundPart === 1 ? s.upper2 : soundPart === 2 ? s.upper3 : soundPart === 3 ? s.lower : s.upper1

  if (!s.arrangerReady) return null

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: padYTop,
          paddingBottom: padYBot,
          paddingLeft: padX,
          paddingRight: Math.max(insets.right, 10),
        },
      ]}
    >
      <View style={styles.bezelTop}>
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
        ref={pagerRef}
        horizontal
        pagingEnabled
        bounces={false}
        directionalLockEnabled
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setPagerW(event.nativeEvent.layout.width)}
        onMomentumScrollEnd={onPage}
        scrollEventThrottle={16}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
      >
        <View style={[styles.slide, { width: slideW }]}>
          {picker === "sound" ? (
            <SoundSelect
              part={soundPart}
              sounds={s.sounds}
              activeId={typeof activeSoundId === "number" ? activeSoundId : s.upper1}
              onSelect={(id) => vm.selectSound(id, soundPart)}
              onClose={closePicker}
              emptyHint={
                s.sounds.some((item) => (item.source ?? "FACTORY").toUpperCase() !== "FACTORY")
                  ? "Tap a gray User square to load that sound."
                  : s.setName
                    ? `No User sound names from ${s.setName}. Import the SET again.`
                    : "Import a PA4X SET. User sounds show here, gray until you tap one."
              }
            />
          ) : picker === "style" ? (
            <StyleSelect
              styles={s.styles}
              activeId={s.styleId}
              onSelect={vm.selectStyle}
              onClose={closePicker}
            />
          ) : picker === "pad" ? (
            <PadSelect
              pads={s.pads}
              activeId={s.padId}
              onSelect={vm.selectPad}
              onClose={closePicker}
            />
          ) : (
            <StylePlayHome
              style={style}
              tempo={s.tempo}
              sts={s.sts}
              kbdName={s.setName || "My Setting"}
              kbdIndex={0}
              upper1={soundById(s.sounds, s.upper1)}
              upper2={soundById(s.sounds, s.upper2)}
              upper3={soundById(s.sounds, s.upper3)}
              lower={soundById(s.sounds, s.lower)}
              upper2On={s.upper2On}
              upper3On={s.upper3On}
              lowerOn={s.lowerOn}
              split={s.split}
              mixer={s.mixer}
              stsPads={stsPads}
              onOpenStyle={openStyle}
              onOpenPads={openPads}
              onOpenSound={openSound}
              onTogglePart={vm.togglePart}
              onSts={vm.setSts}
              onTempo={vm.nudgeTempo}
              onSplit={vm.setSplit}
              onMixer={vm.setMixer}
              onAccVolume={vm.setAccVolume}
            />
          )}
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
          <MiniKeyboard onNoteOn={vm.playNote} onNoteOff={vm.releaseNote} />
        </View>
      </ScrollView>

      <View style={styles.dots} accessibilityRole="tablist">
        <View style={[styles.dot, page === 0 && styles.dotOn]} />
        <View style={[styles.dot, page === 1 && styles.dotOn]} />
      </View>

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
  root: { flex: 1, backgroundColor: Lcd.bezel },
  bezelTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  brand: {
    color: Pa.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  importLabel: { color: Pa.muted, fontSize: 15, fontWeight: "600" },
  status: { color: Pa.dim, fontSize: 12, marginBottom: 8, paddingHorizontal: 4 },
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
    flex: 1,
    paddingBottom: 4,
  },
  playSlide: { alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
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
    paddingTop: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Pa.stroke },
  dotOn: { backgroundColor: Pa.text, width: 18 },
  pressed: { opacity: 0.82 },
  empty: { color: Pa.muted, fontSize: 15, padding: 8 },
})

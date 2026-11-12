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
import { VolumeFader } from "@/components/arranger/VolumeFader"
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
  const { width, height } = useWindowDimensions()
  const landscape = width > height
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

  // In landscape the faders run the full slide height beside the keyboard; in
  // portrait they flank the Start button.
  const styleFader = (
    <VolumeFader
      label="STYLE"
      value={Math.max(s.mixer.drums, s.mixer.bass, s.mixer.acc, s.mixer.pad)}
      onChange={vm.setStyleVolume}
    />
  )
  const soundFader = <VolumeFader label="SOUND" value={s.mixer.keyboard} onChange={(v) => vm.setMixer(0, v)} />

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
        <Text style={styles.status} numberOfLines={1}>
          {s.importMessage}
        </Text>
        <Pressable
          onPress={vm.importSet}
          hitSlop={10}
          style={({ pressed }) => [styles.importBtn, pressed && styles.pressed]}
        >
          <Text style={styles.importLabel}>Import</Text>
        </Pressable>
      </View>

      {s.importing ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(s.importProgress * 100)}%` }]} />
        </View>
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

        <View style={[styles.slide, styles.playSlide, landscape && styles.playSlideWide, { width: slideW }]}>
          {landscape ? <View style={styles.sideFader}>{styleFader}</View> : null}
          <View style={styles.playMain}>
            <View style={styles.playPanel}>
              <View style={styles.playHeader}>
                <Text style={styles.playStyle} numberOfLines={1}>
                  {style?.name ?? "No Style"}
                </Text>
                <Text style={styles.playTempo}>{`♩ = ${Math.round(s.tempo)}`}</Text>
              </View>
              <View style={styles.playRow}>
                {landscape ? null : <View style={styles.playFader}>{styleFader}</View>}
                <View style={styles.playCenter}>
                  <Pressable
                    onPress={vm.toggleStart}
                    accessibilityRole="button"
                    accessibilityLabel={s.playing ? "Stop style" : "Start style"}
                    style={({ pressed }) => [
                      styles.start,
                      landscape && styles.startCompact,
                      s.playing ? styles.startOn : null,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.startLed, s.playing && styles.startLedOn]} />
                    <Text style={[styles.startLabel, landscape && styles.startLabelCompact]}>
                      {s.playing ? "STOP" : "START"}
                    </Text>
                  </Pressable>
                </View>
                {landscape ? null : <View style={styles.playFader}>{soundFader}</View>}
              </View>
            </View>
            <MiniKeyboard
              onNoteOn={vm.playNote}
              onNoteOff={vm.releaseNote}
              style={landscape ? styles.keysLandscape : styles.keysPortrait}
            />
          </View>
          {landscape ? <View style={styles.sideFader}>{soundFader}</View> : null}
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
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
    minHeight: 30,
  },
  brand: {
    color: Pa.text,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },
  status: { flex: 1, color: Pa.dim, fontSize: 11, fontWeight: "600", textAlign: "center" },
  importBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Pa.stroke,
    backgroundColor: Pa.bgRaised,
  },
  importLabel: { color: Pa.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
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
  playSlide: { gap: 10 },
  playSlideWide: { flexDirection: "row" },
  playMain: { flex: 1, gap: 10 },
  sideFader: {
    width: 76,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    backgroundColor: Pa.panel,
  },
  playPanel: {
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    backgroundColor: Pa.panel,
    overflow: "hidden",
  },
  playHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    height: 32,
    backgroundColor: Lcd.header,
  },
  playStyle: { flex: 1, color: Lcd.headerText, fontSize: 13, fontWeight: "800" },
  playTempo: { color: Lcd.headerText, fontSize: 13, fontWeight: "800" },
  playRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 14,
  },
  playFader: { width: 64 },
  playCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  start: {
    width: "100%",
    maxWidth: 260,
    aspectRatio: 1.35,
    maxHeight: "100%",
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: Pa.panelAlt,
    borderWidth: 1,
    borderColor: Pa.stroke,
    borderBottomWidth: 4,
    borderBottomColor: "#0A0B0D",
  },
  startCompact: { aspectRatio: 1.9, gap: 8 },
  startOn: { backgroundColor: "#2A1513", borderColor: Pa.red, borderBottomColor: "#5A1E19" },
  startLed: { width: 34, height: 6, borderRadius: 3, backgroundColor: "#3A2420" },
  startLedOn: {
    backgroundColor: Pa.red,
    shadowColor: Pa.red,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  startLabel: { color: Pa.text, fontSize: 30, fontWeight: "900", letterSpacing: 3 },
  startLabelCompact: { fontSize: 24 },
  keysPortrait: { flex: 0.62 },
  keysLandscape: { flex: 1.15 },
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

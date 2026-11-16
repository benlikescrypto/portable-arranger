import { useEffect, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewInstance } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BankPadSelect } from "@/components/arranger/BankPadSelect"
import { MiniKeyboard } from "@/components/arranger/MiniKeyboard"
import { SoundSelect } from "@/components/arranger/SoundSelect"
import { StyleSelect } from "@/components/arranger/StyleSelect"
import {
  ArrangerSwitches,
  EndingGroup,
  FadeGroup,
  FillGroup,
  IntroGroup,
  PadGroup,
  StsGroup,
  TempoGroup,
  TransportGroup,
  TransposeGroup,
  VariationGroup,
  VolumeGroup,
} from "@/components/pro/ControlPanel"
import { AiPage } from "@/components/pro/pages/AiPage"
import { EffectsPage } from "@/components/pro/pages/EffectsPage"
import { GlobalPage } from "@/components/pro/pages/GlobalPage"
import { KbdLibraryPage } from "@/components/pro/pages/KbdLibraryPage"
import { MixerPage } from "@/components/pro/pages/MixerPage"
import { SongBookPage } from "@/components/pro/pages/SongBookPage"
import { StylePlayPage } from "@/components/pro/pages/StylePlayPage"
import { HwButton, Meter } from "@/components/pro/ui"
import { Hw, noteName } from "@/constants/theme"
import { useAiLab } from "@/hooks/useAiLab"
import { useArranger } from "@/hooks/useArranger"
import { usePerformance } from "@/hooks/usePerformance"
import { paSoundCategory, SOUND_CATS_LEFT, SOUND_CATS_RIGHT } from "@/lib/library/soundSelect"
import { pagerLock } from "@/lib/pagerLock"
import { useTelemetry } from "@/lib/telemetry"

type Page = "style" | "songbook" | "mixer" | "fx" | "ai" | "global"
type Overlay =
  | { kind: "style" }
  | { kind: "sound"; part: 0 | 1 | 2 | 3 }
  | { kind: "padSound"; slot: number }
  | { kind: "kbdLibrary" }
  | null

const PAGES: { id: Page; label: string; short: string }[] = [
  { id: "style", label: "STYLE PLAY", short: "STYLE" },
  { id: "songbook", label: "SONGBOOK", short: "SONG" },
  { id: "mixer", label: "MIXER", short: "MIX" },
  { id: "fx", label: "EFFECTS", short: "FX" },
  { id: "ai", label: "AI LAB", short: "AI" },
  { id: "global", label: "GLOBAL", short: "GLOBAL" },
]

export function ProScreen() {
  const vm = useArranger()
  const perf = usePerformance(vm)
  const ai = useAiLab(vm)
  const s = vm.state
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [page, setPage] = useState<Page>("style")
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [slide, setSlide] = useState(0)
  const [pageW, setPageW] = useState(0)
  const [keyStart, setKeyStart] = useState(48)
  const pager = useRef<ScrollViewInstance>(null)
  const userDrag = useRef(false)
  const slideRef = useRef(0)
  slideRef.current = slide
  // Keep the visible slide aligned when the width changes (rotation, split view).
  useEffect(() => {
    if (pageW > 0) pager.current?.scrollTo({ x: slideRef.current * pageW, animated: false })
  }, [pageW])
  const [dragLocked, setDragLocked] = useState(false)
  useEffect(() => pagerLock.subscribe(setDragLocked), [])

  const landscape = width > height
  const wide = landscape && width >= 740
  const compact = width < 420
  const big = Math.min(width, height) >= 700

  if (!s.arrangerReady) return <View style={styles.root} />

  const style = s.styles.find((x) => x.id === s.styleId)
  const kbdName =
    perf.activeSts != null
      ? (perf.stsSlots[perf.activeSts]?.set.name ?? "My Setting")
      : perf.currentSong
        ? (perf.book.songs.find((x) => x.id === perf.currentSong)?.title ?? "My Setting")
        : "My Setting"

  const openPage = (p: Page) => {
    setOverlay(null)
    setPage(p)
  }

  const lcd = (() => {
    if (overlay?.kind === "style") {
      return (
        <StyleSelect
          styles={s.styles}
          activeId={s.styleId}
          onSelect={(id) => perf.selectStyle(id)}
          onClose={() => setOverlay(null)}
        />
      )
    }
    if (overlay?.kind === "sound") {
      const part = overlay.part
      const active = part === 1 ? s.upper2 : part === 2 ? s.upper3 : part === 3 ? s.lower : s.upper1
      return (
        <SoundSelect
          part={part}
          sounds={s.sounds}
          activeId={typeof active === "number" ? active : s.upper1}
          onSelect={(id) => vm.selectSound(id, part)}
          onClose={() => setOverlay(null)}
          emptyHint={
            s.setName
              ? "Tap a gray User sound to load it."
              : "Import a Pa-series SET (Global › Media) to add User sounds."
          }
        />
      )
    }
    if (overlay?.kind === "padSound") {
      const slot = overlay.slot
      const current = s.sounds.find((x) => x.name === perf.prefs.pads[slot]?.sound)
      return (
        <BankPadSelect
          title={`PAD ${slot + 1} SOUND`}
          catsLeft={SOUND_CATS_LEFT}
          catsRight={SOUND_CATS_RIGHT}
          items={s.sounds}
          activeId={current?.id ?? -1}
          categorize={paSoundCategory}
          onSelect={(id) => {
            const hit = s.sounds.find((x) => x.id === id)
            if (hit) perf.setPad(slot, { sound: hit.name, name: hit.name })
          }}
          onClose={() => setOverlay(null)}
        />
      )
    }
    if (overlay?.kind === "kbdLibrary") {
      return <KbdLibraryPage perf={perf} styleName={style?.name ?? ""} onClose={() => setOverlay(null)} />
    }
    switch (page) {
      case "songbook":
        return <SongBookPage perf={perf} wide={wide} />
      case "mixer":
        return <MixerPage vm={vm} perf={perf} />
      case "fx":
        return <EffectsPage vm={vm} perf={perf} />
      case "ai":
        return <AiPage vm={vm} ai={ai} wide={wide} />
      case "global":
        return <GlobalPage vm={vm} perf={perf} />
      default:
        return (
          <StylePlayPage
            vm={vm}
            perf={perf}
            wide={landscape && width >= 560}
            big={big}
            fill={!landscape && height >= 640}
            showMap={big || (wide && width >= 1200)}
            kbdName={kbdName}
            onOpenStyle={() => setOverlay({ kind: "style" })}
            onOpenSound={(part) => setOverlay({ kind: "sound", part })}
            onOpenKbdLibrary={() => setOverlay({ kind: "kbdLibrary" })}
            onOpenPadSound={(slot) => setOverlay({ kind: "padSound", slot })}
          />
        )
    }
  })()

  const panelProps = { vm, perf, compact }
  const gutter = {
    paddingLeft: Math.max(insets.left, 8),
    paddingRight: Math.max(insets.right, 8),
  }

  const goSlide = (i: number) => {
    userDrag.current = false
    setSlide(i)
    pager.current?.scrollTo({ x: i * pageW, animated: true })
  }

  // Slide 1: the display, like the Pa screen (mode keys + LCD pages).
  const displaySlide = (
    <View style={[styles.slide, gutter, { width: pageW }]}>
      <ModeKeys page={overlay ? null : page} onPage={openPage} short={width < 900} />
      <View style={styles.lcdWrap}>{lcd}</View>
    </View>
  )

  // Slide 2: the hardware control panel, with room to breathe.
  const grow = big ? styles.pairFill : undefined
  const controlsSlide = (
    <ScrollView
      style={{ width: pageW }}
      contentContainerStyle={[styles.controls, (wide || big) && styles.controlsFill, gutter]}
      showsVerticalScrollIndicator={false}
    >
      {wide ? (
        <>
          <View style={[styles.pair, styles.pairFill]}>
            <IntroGroup {...panelProps} style={{ flex: 3 }} />
            <VariationGroup {...panelProps} style={{ flex: 4 }} />
            <FillGroup {...panelProps} style={{ flex: 3.4 }} />
            <EndingGroup {...panelProps} style={{ flex: 3 }} />
          </View>
          <View style={[styles.pair, styles.pairFill]}>
            <TransportGroup {...panelProps} style={{ flex: 4 }} />
            <FadeGroup {...panelProps} style={{ flex: 2 }} />
            <StsGroup {...panelProps} style={{ flex: 5 }} />
          </View>
          <View style={[styles.pair, styles.pairFill]}>
            <TempoGroup {...panelProps} style={styles.flex} />
            <TransposeGroup {...panelProps} style={styles.flex} />
            <ArrangerSwitches {...panelProps} style={{ flex: 1.3 }} />
            {width >= 1000 ? <VolumeGroup {...panelProps} style={{ flex: 1.2 }} /> : null}
          </View>
          <PadGroup {...panelProps} style={styles.pairFill} />
          {width < 1000 ? <VolumeGroup {...panelProps} /> : null}
        </>
      ) : (
        <>
          <View style={[styles.pair, grow]}>
            <IntroGroup {...panelProps} style={styles.flex} />
            <EndingGroup {...panelProps} style={styles.flex} />
          </View>
          <VariationGroup {...panelProps} style={grow} />
          <View style={[styles.pair, grow]}>
            <FillGroup {...panelProps} style={{ flex: 3 }} />
            <FadeGroup {...panelProps} style={{ flex: 2 }} />
          </View>
          <TransportGroup {...panelProps} style={grow} />
          <View style={[styles.pair, grow]}>
            <TempoGroup {...panelProps} style={styles.flex} />
            <TransposeGroup {...panelProps} style={styles.flex} />
          </View>
          <StsGroup {...panelProps} style={grow} />
          <PadGroup {...panelProps} style={grow} />
          <ArrangerSwitches {...panelProps} style={grow} />
          <VolumeGroup {...panelProps} />
        </>
      )}
    </ScrollView>
  )

  // Slide 3: a full-size playing keyboard.
  const octaves = width >= 1100 ? 4 : width >= 700 ? 3 : 2
  const lowest = 24
  const highest = 108 - octaves * 12
  const keyFrom = Math.min(highest, keyStart)
  const keysSlide = (
    <View style={[styles.slide, gutter, { width: pageW }]}>
      <View style={styles.keysBar}>
        <HwButton
          label="◀ OCT"
          compact
          onPress={() => setKeyStart(Math.max(lowest, keyFrom - 12))}
          style={styles.keysBtn}
        />
        <Text style={styles.keysRange}>
          {noteName(keyFrom)} – {noteName(keyFrom + octaves * 12)}
        </Text>
        <HwButton
          label="OCT ▶"
          compact
          onPress={() => setKeyStart(Math.min(highest, keyFrom + 12))}
          style={styles.keysBtn}
        />
      </View>
      <View style={styles.keys}>
        {slide === 2 ? (
          <MiniKeyboard
            onNoteOn={vm.playNote}
            onNoteOff={vm.releaseNote}
            startNote={keyFrom}
            octaves={octaves}
            style={styles.flex}
          />
        ) : null}
      </View>
    </View>
  )

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 6),
          paddingBottom: Math.max(insets.bottom, 6),
        },
      ]}
    >
      <View style={gutter}>
        <TopBar
          slide={slide}
          onSlide={goSlide}
          narrow={width < 520}
          setName={s.setName}
          midi={s.midiConnected}
          status={s.importing ? s.importMessage : ""}
        />
      </View>
      <View style={styles.flex} onLayout={(e) => setPageW(Math.round(e.nativeEvent.layout.width))}>
        {pageW > 0 ? (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            // Sliding a finger on the keyboard must play keys, not change slides.
            scrollEnabled={slide !== 2 && !dragLocked}
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={() => {
              userDrag.current = true
            }}
            onMomentumScrollEnd={(e) => {
              // Only a finger swipe picks the slide; programmatic scrolls also end here.
              if (!userDrag.current) return
              userDrag.current = false
              setSlide(Math.max(0, Math.min(2, Math.round(e.nativeEvent.contentOffset.x / pageW))))
            }}
            keyboardShouldPersistTaps="handled"
            style={styles.flex}
          >
            {displaySlide}
            {controlsSlide}
            {keysSlide}
          </ScrollView>
        ) : null}
      </View>
    </View>
  )
}

const SLIDES = ["DISPLAY", "CONTROLS", "KEYS"]

function ModeKeys({ page, onPage, short }: { page: Page | null; onPage: (p: Page) => void; short: boolean }) {
  return (
    <View style={styles.modes}>
      {PAGES.map((p) => (
        <HwButton
          key={p.id}
          label={short ? p.short : p.label}
          led={page === p.id ? "on" : "off"}
          ledColor="amber"
          compact
          onPress={() => onPage(p.id)}
          style={styles.modeKey}
        />
      ))}
    </View>
  )
}

function TopBar({
  slide,
  onSlide,
  setName,
  midi,
  status,
  narrow,
}: {
  slide: number
  onSlide: (i: number) => void
  setName: string
  midi: boolean
  status: string
  narrow: boolean
}) {
  return (
    <View style={styles.top}>
      {narrow ? null : (
        <View style={styles.brand}>
          <Text style={styles.brandText}>ARRANGER</Text>
          <Text style={styles.brandBox}>BOX</Text>
        </View>
      )}
      <View style={styles.slides}>
        {SLIDES.map((label, i) => (
          <HwButton
            key={label}
            label={label}
            led={slide === i ? "on" : "off"}
            ledColor="blue"
            compact
            onPress={() => onSlide(i)}
            style={styles.modeKey}
          />
        ))}
      </View>
      <View style={styles.status}>
        {status || setName ? (
          <Text style={styles.statusText} numberOfLines={1}>
            {status || setName}
          </Text>
        ) : null}
        <View style={styles.midi}>
          <View style={[styles.midiLed, midi && styles.midiLedOn]} />
          <Text style={styles.midiText}>MIDI</Text>
        </View>
        {narrow ? null : <OutputMeter />}
      </View>
    </View>
  )
}

function OutputMeter() {
  const l = useTelemetry((t) => Math.round(Math.min(1, t.peakL) * 10) / 10)
  const r = useTelemetry((t) => Math.round(Math.min(1, t.peakR) * 10) / 10)
  return (
    <View style={styles.outMeter} accessibilityLabel="Output level">
      <Meter level={l} segments={10} horizontal />
      <Meter level={r} segments={10} horizontal />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Hw.chassis },
  flex: { flex: 1 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
    minHeight: 38,
  },
  brand: { flexDirection: "row", alignItems: "baseline" },
  brandText: {
    color: Hw.label,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2.4,
  },
  brandBox: {
    color: Hw.ledAmber,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2.4,
  },
  slides: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: "row",
    gap: 5,
    maxWidth: 440,
  },
  modes: { flexDirection: "row", gap: 5, marginBottom: 6 },
  modeKey: { minHeight: 34 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
    marginLeft: "auto",
  },
  statusText: {
    color: Hw.sub,
    fontSize: 10.5,
    fontWeight: "700",
    maxWidth: 220,
    flexShrink: 1,
  },
  midi: { alignItems: "center", gap: 2 },
  midiLed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Hw.ledGreenOff,
  },
  midiLedOn: { backgroundColor: Hw.ledGreen },
  midiText: {
    color: Hw.sub,
    fontSize: 7.5,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  outMeter: { width: 54, gap: 3 },
  slide: { flex: 1 },
  lcdWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    padding: 5,
    borderRadius: 10,
    backgroundColor: "#050607",
    borderWidth: 1,
    borderColor: "#2A2D33",
  },
  controls: { gap: 12, paddingTop: 2, paddingBottom: 16 },
  controlsFill: { flexGrow: 1 },
  pairFill: { flexGrow: 1, maxHeight: 190 },
  pair: { flexDirection: "row", gap: 12 },
  keysBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  keysBtn: { flexGrow: 0, flexShrink: 0, flexBasis: 96, minHeight: 34 },
  keysRange: {
    flex: 1,
    textAlign: "center",
    color: Hw.ledAmber,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
  keys: { flex: 1, borderRadius: 8, overflow: "hidden" },
})

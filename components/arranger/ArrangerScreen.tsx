import { useEffect, useRef, useState, type ComponentRef } from "react"
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

import { Led } from "@/components/arranger/Led"
import {
  filterLibrary,
  LibraryItem,
  LibrarySheet,
  libraryItemWidth,
} from "@/components/arranger/LibrarySheet"
import { PaButton } from "@/components/arranger/PaButton"
import { PartTile } from "@/components/arranger/PartTile"
import { VolumeFader } from "@/components/arranger/VolumeFader"
import { Pa, Sections, chordLabel } from "@/constants/theme"
import { useArranger } from "@/hooks/useArranger"

export function ArrangerScreen() {
  const vm = useArranger()
  const s = vm.state
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const pager = useRef<ComponentRef<typeof ScrollView>>(null)
  const [page, setPage] = useState(0)
  const stacked = width < 700
  const short = height < 520
  const style = s.styles.find((item) => item.id === s.styleId)
  const soundName = (id: number | null) =>
    id == null ? "—" : (s.sounds.find((item) => item.id === id)?.name ?? "—")
  const soundCats = ["All", "Favorites", "Recent", ...Array.from(new Set(s.sounds.map((item) => item.category)))]
  const styleCats = ["All", "Favorites", "Recent", ...Array.from(new Set(s.styles.map((item) => item.category)))]
  const shownSounds = filterLibrary(s.sounds, s.query, s.category, s.libraryFilter, s.favorites, s.recentSounds)
  const shownStyles = filterLibrary(s.styles, s.query, s.category, s.libraryFilter, s.favorites, s.recentStyles)
  const browsePart = s.mode === "SOUND" ? (s.upper3On && s.upper3 != null ? 2 : 0) : 0
  const itemWidth = libraryItemWidth(width)

  const pagePad = {
    width,
    height,
    paddingTop: Math.max(insets.top, 8),
    paddingBottom: Math.max(insets.bottom, 10) + 18,
    paddingLeft: Math.max(insets.left, 10),
    paddingRight: Math.max(insets.right, 10),
  }

  useEffect(() => {
    pager.current?.scrollTo({ x: page * width, animated: false })
  }, [width, height, page])

  const onPage = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width))
    setPage(next)
  }

  const elem = (id: number, label: string, accent: string, extra?: object) => (
    <PaButton
      key={label}
      label={label}
      onPress={() => vm.book(id)}
      active={s.section === id}
      accent={accent}
      style={[styles.elem, short && styles.elemShort, extra]}
    />
  )

  return (
    <View style={styles.root}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPage}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.page, pagePad]}>
          <View style={[styles.top, stacked && styles.topStacked]}>
            <Text style={styles.mode}>STYLE PLAY</Text>
            {!stacked ? (
              <Text style={styles.status} numberOfLines={1}>
                {s.importMessage || "Swipe right for START / VOLUME"}
              </Text>
            ) : null}
            <Led on={s.midiConnected} color={Pa.green} label={s.midiConnected ? s.midiName.slice(0, 8) : "MIDI"} />
            <PaButton label="SOUND" accent={Pa.gold} onPress={() => vm.setMode("SOUND")} style={styles.media} />
            <PaButton label="MEDIA" accent={Pa.blue} onPress={vm.importSet} style={styles.media} />
          </View>
          {stacked ? (
            <Text style={styles.status} numberOfLines={1}>
              {s.importMessage || "Swipe right for START / VOLUME"}
            </Text>
          ) : null}

          {s.importing ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(s.importProgress * 100)}%` }]} />
            </View>
          ) : null}

          <View style={[styles.play, stacked && styles.playStacked]}>
            <View style={[styles.elements, stacked && styles.elementsStacked, short && !stacked && styles.elementsShort]}>
              <Text style={styles.group}>INTRO</Text>
              <View style={styles.row}>
                {elem(Sections.INTRO1, "1", Pa.orange)}
                {elem(Sections.INTRO2, "2", Pa.orange)}
                {elem(Sections.INTRO3, "3", Pa.orange)}
              </View>
              <Text style={styles.group}>VARIATION</Text>
              <View style={styles.row}>
                {elem(Sections.VAR1, "1", Pa.orange, styles.var)}
                {elem(Sections.VAR2, "2", Pa.orange, styles.var)}
                {stacked ? elem(Sections.VAR3, "3", Pa.orange, styles.var) : null}
                {stacked ? elem(Sections.VAR4, "4", Pa.orange, styles.var) : null}
              </View>
              {!stacked ? (
                <View style={styles.row}>
                  {elem(Sections.VAR3, "3", Pa.orange, styles.var)}
                  {elem(Sections.VAR4, "4", Pa.orange, styles.var)}
                </View>
              ) : null}
              <Text style={styles.group}>FILL / BREAK</Text>
              <View style={styles.row}>
                {elem(Sections.FILL1, "1", Pa.orange)}
                {elem(Sections.FILL2, "2", Pa.orange)}
                {elem(Sections.FILL3, "3", Pa.orange)}
                {elem(Sections.FILL4, "4", Pa.orange)}
                {elem(Sections.BREAK, "BRK", Pa.gold, styles.break)}
              </View>
              <Text style={styles.group}>ENDING</Text>
              <View style={styles.row}>
                {elem(Sections.END1, "1", Pa.red)}
                {elem(Sections.END2, "2", Pa.red)}
                {elem(Sections.END3, "3", Pa.red)}
              </View>
            </View>

            <View style={[styles.touch, stacked && styles.touchStacked]}>
              <Text style={styles.kicker}>STYLE</Text>
              <Text style={[styles.styleName, short && styles.styleNameShort]} numberOfLines={1}>
                {style?.name ?? "No Style"}
              </Text>
              <View style={styles.chordRow}>
                <View>
                  <Text style={styles.kicker}>CHORD</Text>
                  <Text style={[styles.chord, short && styles.chordShort]}>{chordLabel(s.chordRoot, s.chordType)}</Text>
                </View>
                <View style={styles.tempoBox}>
                  <Text style={styles.kicker}>TEMPO</Text>
                  <Text style={[styles.tempo, short && styles.tempoShort]}>{Math.round(s.tempo)}</Text>
                </View>
              </View>
              <View style={styles.row}>
                {[1, 2, 3, 4].map((n) => (
                  <PaButton
                    key={n}
                    label={`STS ${n}`}
                    active={s.sts === n}
                    accent={Pa.blue}
                    onPress={() => vm.setSts(n)}
                    style={styles.sts}
                  />
                ))}
              </View>
              <View style={[styles.parts, stacked && styles.partsStacked]}>
                {(
                  [
                    {
                      title: "UPPER 1",
                      name: soundName(s.upper1),
                      on: true,
                      selected: true,
                      accent: Pa.orange,
                      onPress: () => vm.setMode("SOUND"),
                      onToggle: () => undefined,
                    },
                    {
                      title: "UPPER 2",
                      name: soundName(s.upper2),
                      on: s.upper2On,
                      selected: false,
                      accent: Pa.blue,
                      onPress: () => vm.selectSound(s.upper2 ?? 7, 1),
                      onToggle: () => vm.togglePart(1),
                    },
                    {
                      title: "UPPER 3",
                      name: soundName(s.upper3),
                      on: s.upper3On,
                      selected: false,
                      accent: Pa.purple,
                      onPress: () => vm.setMode("SOUND"),
                      onToggle: () => vm.togglePart(2),
                    },
                    {
                      title: "LOWER",
                      name: soundName(s.lower),
                      on: s.lowerOn,
                      selected: false,
                      accent: Pa.gold,
                      onPress: () => vm.selectSound(s.lower, 3),
                      onToggle: () => vm.togglePart(3),
                    },
                  ] as const
                ).map((part) => (
                  <View key={part.title} style={stacked ? styles.partHalf : styles.partFlex}>
                    <PartTile
                      title={part.title}
                      name={part.name}
                      on={part.on}
                      selected={part.selected}
                      accent={part.accent}
                      onPress={part.onPress}
                      onToggle={part.onToggle}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.row}>
                <Text style={styles.kicker}>STYLES</Text>
                <PaButton label="BROWSE" accent={Pa.blue} onPress={() => vm.setMode("PAD")} style={styles.sts} />
              </View>
              <ScrollView style={styles.styleList} contentContainerStyle={styles.styleGrid}>
                {s.styles.length === 0 ? (
                  <Text style={styles.empty}>Factory styles load with the engine. MEDIA imports PA4X SET folders.</Text>
                ) : (
                  s.styles.map((item) => (
                    <PaButton
                      key={item.id}
                      label={item.name}
                      active={item.id === s.styleId}
                      onPress={() => vm.selectStyle(item.id)}
                      style={styles.styleChip}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </View>

        <View style={[styles.page, pagePad]}>
          <View style={[styles.top, stacked && styles.topStacked]}>
            <Text style={styles.mode}>CONTROL PANEL</Text>
            <Text style={styles.status} numberOfLines={1}>
              START, VOLUME — swipe left for Style Play
            </Text>
          </View>
          <View style={[styles.panel, stacked && styles.panelStacked]}>
            <View style={[styles.transport, stacked && styles.transportStacked]}>
              <Pressable
                onPress={vm.toggleStart}
                style={[styles.start, short && styles.startShort, { backgroundColor: s.playing ? Pa.red : Pa.green }]}
              >
                <Text style={[styles.startLabel, short && styles.startLabelShort]}>
                  {s.playing ? "STOP" : "START / STOP"}
                </Text>
              </Pressable>
              <View style={styles.row}>
                <PaButton
                  label="SYNCHRO START"
                  active={s.synchro}
                  accent={Pa.blue}
                  onPress={vm.toggleSynchro}
                  style={styles.panelBtn}
                />
                <PaButton
                  label="AUTO FILL"
                  active={s.autoFill}
                  accent={Pa.gold}
                  onPress={vm.toggleAutoFill}
                  style={styles.panelBtn}
                />
              </View>
              <View style={styles.row}>
                <PaButton label="TEMPO −" onPress={() => vm.nudgeTempo(-1)} style={styles.panelBtn} />
                <Text style={styles.tempo}>{Math.round(s.tempo)}</Text>
                <PaButton label="TEMPO +" onPress={() => vm.nudgeTempo(1)} style={styles.panelBtn} />
              </View>
              <View style={styles.row}>
                <PaButton label={`TRANSPOSE ${s.transpose}`} onPress={() => vm.transpose(1)} style={styles.panelBtn} />
                <PaButton label="T−" onPress={() => vm.transpose(-1)} style={styles.panelBtn} />
                <PaButton label={`OCT ${s.octave}`} onPress={() => vm.setOctave(1)} style={styles.panelBtn} />
                <PaButton label="O−" onPress={() => vm.setOctave(-1)} style={styles.panelBtn} />
              </View>
            </View>
            <View style={[styles.faders, stacked && styles.fadersStacked]}>
              <VolumeFader label={"KEYBOARD\nVOLUME"} value={s.mixer.keyboard} onChange={(v) => vm.setMixer(0, v)} />
              <VolumeFader label={"ACC.\nVOLUME"} value={s.mixer.acc} onChange={vm.setAccVolume} />
              <VolumeFader label={"MASTER\nVOLUME"} value={s.mixer.master} onChange={(v) => vm.setMixer(5, v)} />
              <VolumeFader label={"REVERB"} value={s.reverb} onChange={(v) => vm.setFx(0, v)} />
              <VolumeFader label={"CHORUS"} value={s.chorus} onChange={(v) => vm.setFx(1, v)} />
              <VolumeFader label={"DELAY"} value={s.delay} onChange={(v) => vm.setFx(2, v)} />
            </View>
          </View>
        </View>
      </ScrollView>

      {s.mode === "SOUND" ? (
        <LibrarySheet
          title="INSTRUMENTS"
          query={s.query}
          category={s.category}
          categories={soundCats}
          filter={s.libraryFilter}
          onQuery={vm.setQuery}
          onCategory={vm.setCategory}
          onFilter={vm.setLibraryFilter}
          onClose={() => vm.setMode("STYLE")}
        >
          {shownSounds.map((item) => (
            <LibraryItem
              key={item.id}
              name={item.name}
              meta={`${item.category} · ${item.source ?? "FACTORY"}`}
              active={item.id === s.upper1}
              favorite={s.favorites.includes(item.id)}
              width={itemWidth}
              onPress={() => {
                vm.selectSound(item.id, browsePart)
                vm.setMode("STYLE")
              }}
              onLongPress={() => vm.previewSound(item.id)}
              onFavorite={() => vm.toggleFavorite(item.id)}
            />
          ))}
        </LibrarySheet>
      ) : null}

      {s.mode === "PAD" ? (
        <LibrarySheet
          title="STYLES"
          query={s.query}
          category={s.category}
          categories={styleCats}
          filter={s.libraryFilter}
          onQuery={vm.setQuery}
          onCategory={vm.setCategory}
          onFilter={vm.setLibraryFilter}
          onClose={() => vm.setMode("STYLE")}
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
                vm.setMode("STYLE")
              }}
              onFavorite={() => vm.toggleFavorite(item.id)}
            />
          ))}
        </LibrarySheet>
      ) : null}

      {s.mode === "SET" ? (
        <LibrarySheet
          title="IMPORT"
          query=""
          category="All"
          categories={["All"]}
          filter="all"
          onQuery={() => undefined}
          onCategory={() => undefined}
          onFilter={() => undefined}
          onClose={() => vm.setMode("STYLE")}
        >
          <Text style={styles.empty}>{s.importReport || s.importMessage || "No import yet."}</Text>
          {s.setFiles.slice(0, 40).map((file) => (
            <Text key={file} style={styles.empty}>
              {file}
            </Text>
          ))}
        </LibrarySheet>
      ) : null}

      <View
        pointerEvents="none"
        style={[
          styles.dots,
          {
            bottom: Math.max(insets.bottom, 6),
            left: Math.max(insets.left, 0),
            right: Math.max(insets.right, 0),
          },
        ]}
      >
        <View style={[styles.dot, page === 0 && styles.dotOn]} />
        <View style={[styles.dot, page === 1 && styles.dotOn]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Pa.bg },
  page: { backgroundColor: Pa.bg, gap: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  topStacked: { flexWrap: "wrap" },
  mode: { color: Pa.orange, fontWeight: "900", fontSize: 14, letterSpacing: 1.6 },
  status: { color: Pa.muted, fontSize: 12, flex: 1, minWidth: 80 },
  media: { width: 88, height: 44 },
  play: { flex: 1, flexDirection: "row", gap: 10, minHeight: 0 },
  playStacked: { flexDirection: "column" },
  elements: {
    width: 220,
    backgroundColor: Pa.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    padding: 8,
    gap: 5,
  },
  elementsShort: { width: 168 },
  elementsStacked: { width: "100%" },
  touch: {
    flex: 1,
    backgroundColor: Pa.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    padding: 12,
    gap: 8,
    minWidth: 0,
    minHeight: 0,
  },
  touchStacked: { flex: 1 },
  group: { color: Pa.dim, fontSize: 9, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  elem: { flex: 1, minHeight: 40, paddingHorizontal: 4 },
  elemShort: { minHeight: 34 },
  var: { minHeight: 52 },
  break: { minHeight: 40, flex: 1.2 },
  kicker: { color: Pa.orange, fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  styleName: { color: Pa.text, fontSize: 26, fontWeight: "800" },
  styleNameShort: { fontSize: 20 },
  chordRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  chord: { color: Pa.green, fontSize: 42, fontWeight: "900", lineHeight: 46 },
  chordShort: { fontSize: 28, lineHeight: 32 },
  tempoBox: { alignItems: "flex-end" },
  tempo: { color: Pa.gold, fontSize: 28, fontWeight: "900" },
  tempoShort: { fontSize: 22 },
  sts: { flex: 1, height: 40 },
  parts: { flexDirection: "row", gap: 6 },
  partsStacked: { flexWrap: "wrap" },
  partFlex: { flex: 1, minWidth: 0 },
  partHalf: { width: "48%", flexGrow: 1 },
  styleList: { flex: 1, minHeight: 0 },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 8 },
  styleChip: { height: 44, minWidth: 120 },
  empty: { color: Pa.muted, fontSize: 14 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Pa.stroke, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Pa.orange },
  panel: { flex: 1, flexDirection: "row", gap: 14, minHeight: 0 },
  panelStacked: { flexDirection: "column" },
  transport: { flex: 1.2, gap: 10, justifyContent: "center" },
  transportStacked: { flex: 0, justifyContent: "flex-start" },
  start: {
    height: 96,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  startShort: { height: 72 },
  startLabel: { color: Pa.bg, fontSize: 28, fontWeight: "900", letterSpacing: 1.4 },
  startLabelShort: { fontSize: 22 },
  panelBtn: { flex: 1, height: 52 },
  faders: {
    width: 420,
    maxWidth: "48%",
    flexDirection: "row",
    gap: 8,
    backgroundColor: Pa.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    padding: 12,
  },
  fadersStacked: { width: "100%", maxWidth: "100%", flex: 1, minHeight: 160 },
  dots: {
    position: "absolute",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Pa.stroke },
  dotOn: { backgroundColor: Pa.orange },
})

import { useState } from "react"
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
import { filterLibrary, LibraryItem, LibrarySheet } from "@/components/arranger/LibrarySheet"
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
  const [page, setPage] = useState(0)
  const style = s.styles.find((item) => item.id === s.styleId)
  const soundName = (id: number | null) =>
    id == null ? "—" : (s.sounds.find((item) => item.id === id)?.name ?? "—")
  const soundCats = ["All", "Favorites", "Recent", ...Array.from(new Set(s.sounds.map((item) => item.category)))]
  const styleCats = ["All", "Favorites", "Recent", ...Array.from(new Set(s.styles.map((item) => item.category)))]
  const shownSounds = filterLibrary(s.sounds, s.query, s.category, s.libraryFilter, s.favorites, s.recentSounds)
  const shownStyles = filterLibrary(s.styles, s.query, s.category, s.libraryFilter, s.favorites, s.recentStyles)
  const browsePart = s.mode === "SOUND" ? (s.upper3On && s.upper3 != null ? 2 : 0) : 0

  const pagePad = {
    width,
    height,
    paddingTop: Math.max(insets.top, 8),
    paddingBottom: Math.max(insets.bottom, 10),
    paddingLeft: Math.max(insets.left, 10),
    paddingRight: Math.max(insets.right, 10),
  }

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
      style={[styles.elem, extra]}
    />
  )

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPage}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.page, pagePad]}>
          <View style={styles.top}>
            <Text style={styles.mode}>STYLE PLAY</Text>
            <Text style={styles.status} numberOfLines={1}>
              {s.importMessage || "Swipe right for START / VOLUME"}
            </Text>
            <Led on={s.midiConnected} color={Pa.green} label={s.midiConnected ? s.midiName.slice(0, 8) : "MIDI"} />
            <PaButton label="SOUND" accent={Pa.gold} onPress={() => vm.setMode("SOUND")} style={styles.media} />
            <PaButton label="MEDIA" accent={Pa.blue} onPress={vm.importSet} style={styles.media} />
          </View>

          {s.importing ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(s.importProgress * 100)}%` }]} />
            </View>
          ) : null}

          <View style={styles.play}>
            <View style={styles.elements}>
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
              </View>
              <View style={styles.row}>
                {elem(Sections.VAR3, "3", Pa.orange, styles.var)}
                {elem(Sections.VAR4, "4", Pa.orange, styles.var)}
              </View>
              <Text style={styles.group}>FILL / BREAK</Text>
              <View style={styles.row}>
                {elem(Sections.FILL1, "1", Pa.orange)}
                {elem(Sections.FILL2, "2", Pa.orange)}
                {elem(Sections.FILL3, "3", Pa.orange)}
                {elem(Sections.FILL4, "4", Pa.orange)}
              </View>
              {elem(Sections.BREAK, "BREAK", Pa.gold, styles.break)}
              <Text style={styles.group}>ENDING</Text>
              <View style={styles.row}>
                {elem(Sections.END1, "1", Pa.red)}
                {elem(Sections.END2, "2", Pa.red)}
                {elem(Sections.END3, "3", Pa.red)}
              </View>
            </View>

            <View style={styles.touch}>
              <Text style={styles.kicker}>STYLE</Text>
              <Text style={styles.styleName} numberOfLines={1}>
                {style?.name ?? "No Style"}
              </Text>
              <View style={styles.chordRow}>
                <View>
                  <Text style={styles.kicker}>CHORD</Text>
                  <Text style={styles.chord}>{chordLabel(s.chordRoot, s.chordType)}</Text>
                </View>
                <View style={styles.tempoBox}>
                  <Text style={styles.kicker}>TEMPO</Text>
                  <Text style={styles.tempo}>{Math.round(s.tempo)}</Text>
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
              <View style={styles.parts}>
                <PartTile
                  title="UPPER 1"
                  name={soundName(s.upper1)}
                  on
                  selected
                  accent={Pa.orange}
                  onPress={() => vm.setMode("SOUND")}
                  onToggle={() => undefined}
                />
                <PartTile
                  title="UPPER 2"
                  name={soundName(s.upper2)}
                  on={s.upper2On}
                  selected={false}
                  accent={Pa.blue}
                  onPress={() => vm.selectSound(s.upper2 ?? 7, 1)}
                  onToggle={() => vm.togglePart(1)}
                />
                <PartTile
                  title="UPPER 3"
                  name={soundName(s.upper3)}
                  on={s.upper3On}
                  selected={false}
                  accent={Pa.purple}
                  onPress={() => vm.setMode("SOUND")}
                  onToggle={() => vm.togglePart(2)}
                />
                <PartTile
                  title="LOWER"
                  name={soundName(s.lower)}
                  on={s.lowerOn}
                  selected={false}
                  accent={Pa.gold}
                  onPress={() => vm.selectSound(s.lower, 3)}
                  onToggle={() => vm.togglePart(3)}
                />
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
          <View style={styles.top}>
            <Text style={styles.mode}>CONTROL PANEL</Text>
            <Text style={styles.status}>START, SYNCHRO, VOLUME — swipe left for Style Play</Text>
          </View>
          <View style={styles.panel}>
            <View style={styles.transport}>
              <Pressable
                onPress={vm.toggleStart}
                style={[styles.start, { backgroundColor: s.playing ? Pa.red : Pa.green }]}
              >
                <Text style={styles.startLabel}>{s.playing ? "STOP" : "START / STOP"}</Text>
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
            <View style={styles.faders}>
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

      <View pointerEvents="none" style={[styles.dots, { bottom: Math.max(insets.bottom, 6) }]}>
        <View style={[styles.dot, page === 0 && styles.dotOn]} />
        <View style={[styles.dot, page === 1 && styles.dotOn]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Pa.bg },
  page: { backgroundColor: Pa.bg, gap: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  mode: { color: Pa.orange, fontWeight: "900", fontSize: 14, letterSpacing: 1.6 },
  status: { color: Pa.muted, fontSize: 12, flex: 1 },
  media: { width: 96, height: 44 },
  play: { flex: 1, flexDirection: "row", gap: 10, minHeight: 0 },
  elements: {
    width: 220,
    backgroundColor: Pa.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    padding: 8,
    gap: 5,
  },
  touch: {
    flex: 1,
    backgroundColor: Pa.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    padding: 12,
    gap: 8,
    minWidth: 0,
  },
  group: { color: Pa.dim, fontSize: 9, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  elem: { flex: 1, minHeight: 40, paddingHorizontal: 4 },
  var: { minHeight: 52 },
  break: { minHeight: 40 },
  kicker: { color: Pa.orange, fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  styleName: { color: Pa.text, fontSize: 26, fontWeight: "800" },
  chordRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  chord: { color: Pa.green, fontSize: 42, fontWeight: "900", lineHeight: 46 },
  tempoBox: { alignItems: "flex-end" },
  tempo: { color: Pa.gold, fontSize: 28, fontWeight: "900" },
  sts: { flex: 1, height: 40 },
  parts: { flexDirection: "row", gap: 6 },
  styleList: { flex: 1, minHeight: 0 },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 8 },
  styleChip: { height: 44, minWidth: 120 },
  empty: { color: Pa.muted, fontSize: 14 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Pa.stroke, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Pa.orange },
  panel: { flex: 1, flexDirection: "row", gap: 14, minHeight: 0 },
  transport: { flex: 1.2, gap: 10, justifyContent: "center" },
  start: {
    height: 96,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  startLabel: { color: Pa.bg, fontSize: 28, fontWeight: "900", letterSpacing: 1.4 },
  panelBtn: { flex: 1, height: 56 },
  faders: {
    width: 420,
    flexDirection: "row",
    gap: 8,
    backgroundColor: Pa.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Pa.stroke,
    padding: 12,
  },
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Pa.stroke },
  dotOn: { backgroundColor: Pa.orange },
})

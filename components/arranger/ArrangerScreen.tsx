import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import { Led } from "@/components/arranger/Led"
import { OnscreenKeyboard } from "@/components/arranger/OnscreenKeyboard"
import { PaButton } from "@/components/arranger/PaButton"
import { PartTile } from "@/components/arranger/PartTile"
import { chordLabel, noteName, Pa, Sections } from "@/constants/theme"
import { useArranger } from "@/hooks/useArranger"
import type { Mode } from "@/lib/types"

const MODES: Mode[] = ["STYLE", "SOUND", "PAD", "MIXER", "PERF", "SET"]
const MODE_COLOR: Record<Mode, string> = {
  STYLE: Pa.orange,
  SOUND: Pa.blue,
  PAD: Pa.purple,
  MIXER: Pa.meter,
  PERF: Pa.gold,
  SET: Pa.text,
}

export function ArrangerScreen() {
  const vm = useArranger()
  const s = vm.state
  const soundName = (id: number | null) => s.sounds.find((item) => item.id === id)?.name ?? "—"
  const style = s.styles.find((item) => item.id === s.styleId)

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <View>
          <Text style={styles.brand}>ARRANGERBOX</Text>
          <Text style={styles.sub}>
            {s.adapterName}  ·  {s.setName}
          </Text>
        </View>
        <View style={styles.modes}>
          {MODES.map((mode) => (
            <PaButton
              key={mode}
              label={mode}
              active={s.mode === mode}
              accent={MODE_COLOR[mode]}
              onPress={() => vm.setMode(mode)}
              style={styles.modeBtn}
            />
          ))}
        </View>
        <Led on={s.midiConnected} color={Pa.green} label={s.midiName.slice(0, 10)} />
        <Led on={s.nativeReady} color={Pa.blue} label={`${Math.round(s.latencyMs)} ms`} />
        <PaButton label="LOAD SET" accent={Pa.blue} onPress={vm.importSet} style={styles.wide} />
        <PaButton label="KEYS" active={s.showKeyboard} onPress={vm.toggleKeyboard} style={styles.narrow} />
      </View>

      <View style={styles.parts}>
        <PartTile title="UPPER 1" name={soundName(s.upper1)} on selected={s.mode === "SOUND"} accent={Pa.orange} onPress={() => vm.setMode("SOUND")} onToggle={() => undefined} />
        <PartTile title="UPPER 2" name={soundName(s.upper2)} on={s.upper2On} selected={false} accent={Pa.blue} onPress={() => vm.selectSound(s.upper2 ?? 7, 1)} onToggle={() => vm.togglePart(1)} />
        <PartTile title="UPPER 3" name={soundName(s.upper3)} on={s.upper3On} selected={false} accent={Pa.purple} onPress={() => s.upper3 != null && vm.selectSound(s.upper3, 2)} onToggle={() => vm.togglePart(2)} />
        <PartTile title="LOWER" name={soundName(s.lower)} on={s.lowerOn} selected={false} accent={Pa.gold} onPress={() => vm.selectSound(s.lower, 3)} onToggle={() => vm.togglePart(3)} />
        <View style={styles.splitBox}>
          <Text style={styles.muted}>SPLIT  {noteName(s.split)}</Text>
          <Text style={styles.splitText}>TRANSPOSE  {s.transpose > 0 ? `+${s.transpose}` : s.transpose}</Text>
          <View style={styles.row}>
            <PaButton label="−" onPress={() => vm.transpose(-1)} />
            <PaButton label="+" onPress={() => vm.transpose(1)} />
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.stylePanel}>
          <Text style={styles.orangeLabel}>STYLE PLAY</Text>
          <Text style={styles.styleName} numberOfLines={1}>
            {style?.name ?? "—"}
          </Text>
          <View style={styles.row}>
            <Text style={styles.tempo}>{Math.round(s.tempo)} BPM</Text>
            <PaButton label="−" onPress={() => vm.nudgeTempo(-1)} style={styles.tiny} />
            <PaButton label="+" onPress={() => vm.nudgeTempo(1)} style={styles.tiny} />
            <View style={{ flex: 1 }} />
            <View>
              <Text style={styles.muted}>CHORD</Text>
              <Text style={styles.chord}>{chordLabel(s.chordRoot, s.chordType)}</Text>
            </View>
          </View>
          <View style={styles.row}>
            {[1, 2, 3, 4].map((n) => (
              <PaButton key={n} label={`STS ${n}`} active={s.sts === n} accent={Pa.blue} onPress={() => vm.setSts(n)} />
            ))}
          </View>
          <Text style={styles.dim}>INTRO</Text>
          <View style={styles.row}>
            <PaButton label="INTRO 1" active={s.section === Sections.INTRO1} onPress={() => vm.book(Sections.INTRO1)} />
            <PaButton label="INTRO 2" active={s.section === Sections.INTRO2} onPress={() => vm.book(Sections.INTRO2)} />
            <PaButton label="INTRO 3" active={s.section === Sections.INTRO3} onPress={() => vm.book(Sections.INTRO3)} />
          </View>
          <Text style={styles.dim}>VARIATION</Text>
          <View style={styles.row}>
            {[Sections.VAR1, Sections.VAR2, Sections.VAR3, Sections.VAR4].map((id, i) => (
              <PaButton
                key={id}
                label={`VAR ${i + 1}`}
                active={s.variation === i + 1 && s.section >= 4 && s.section <= 7}
                booked={s.section === id}
                onPress={() => vm.book(id)}
                style={styles.varBtn}
              />
            ))}
          </View>
          <Text style={styles.dim}>FILL / BREAK</Text>
          <View style={styles.row}>
            <PaButton label="FILL 1" active={s.section === Sections.FILL1} onPress={() => vm.book(Sections.FILL1)} />
            <PaButton label="FILL 2" active={s.section === Sections.FILL2} onPress={() => vm.book(Sections.FILL2)} />
            <PaButton label="FILL 3" active={s.section === Sections.FILL3} onPress={() => vm.book(Sections.FILL3)} />
            <PaButton label="FILL 4" active={s.section === Sections.FILL4} onPress={() => vm.book(Sections.FILL4)} />
            <PaButton label="BREAK" active={s.section === Sections.BREAK} accent={Pa.gold} onPress={() => vm.book(Sections.BREAK)} />
          </View>
          <Text style={styles.dim}>ENDING</Text>
          <View style={styles.row}>
            <PaButton label="ENDING 1" accent={Pa.red} active={s.section === Sections.END1} onPress={() => vm.book(Sections.END1)} />
            <PaButton label="ENDING 2" accent={Pa.red} active={s.section === Sections.END2} onPress={() => vm.book(Sections.END2)} />
            <PaButton label="ENDING 3" accent={Pa.red} active={s.section === Sections.END3} onPress={() => vm.book(Sections.END3)} />
          </View>
          <View style={styles.row}>
            <PaButton label="SYNC START" active={s.synchro} accent={Pa.blue} onPress={vm.toggleSynchro} />
            <PaButton label="AUTO FILL" active={s.autoFill} accent={Pa.gold} onPress={vm.toggleAutoFill} />
          </View>
          <PaButton
            label={s.playing ? "STOP" : "START"}
            active={s.playing}
            accent={s.playing ? Pa.red : Pa.green}
            onPress={vm.toggleStart}
            style={styles.start}
          />
        </View>

        <View style={styles.browser}>
          <Browser s={s} vm={vm} />
        </View>
      </View>

      <View style={styles.mixer}>
        <Text style={styles.meterLabel}>MIXER</Text>
        {(
          [
            ["KB", s.mixer.keyboard, 0],
            ["DRM", s.mixer.drums, 1],
            ["BAS", s.mixer.bass, 2],
            ["ACC", s.mixer.acc, 3],
            ["PAD", s.mixer.pad, 4],
            ["MST", s.mixer.master, 5],
          ] as const
        ).map(([lab, gain, bus]) => (
          <View key={lab} style={styles.strip}>
            <Text style={styles.stripLab}>{lab}</Text>
            <MixerFader value={gain} onChange={(v) => vm.setMixer(bus, v)} />
          </View>
        ))}
      </View>

      {s.showKeyboard ? (
        <OnscreenKeyboard
          onNoteOn={(n, v) => vm.noteOn(n + s.transpose, v)}
          onNoteOff={(n) => vm.noteOff(n + s.transpose)}
        />
      ) : null}
    </View>
  )
}

function MixerFader({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View
      style={styles.faderTrack}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => onChange(Math.max(0, Math.min(1.2, (e.nativeEvent.locationX / 120) * 1.2)))}
      onResponderMove={(e) => onChange(Math.max(0, Math.min(1.2, (e.nativeEvent.locationX / 120) * 1.2)))}
    >
      <View style={[styles.faderFill, { width: `${Math.min(100, (value / 1.2) * 100)}%` }]} />
    </View>
  )
}

function Browser({
  s,
  vm,
}: {
  s: ReturnType<typeof useArranger>["state"]
  vm: ReturnType<typeof useArranger>
}) {
  if (s.mode === "MIXER") {
    return <Text style={styles.bodyText}>Live balance for keyboard, drums, bass, accompaniment and pads.</Text>
  }
  if (s.mode === "PERF") {
    return (
      <View>
        <Text style={[styles.orangeLabel, { color: Pa.gold }]}>PERFORMANCES</Text>
        <Text style={styles.bodyText}>One-tap recall of sound, style, tempo and mixer.</Text>
      </View>
    )
  }
  if (s.mode === "SET") {
    return (
      <View style={{ flex: 1 }}>
        <Text style={styles.orangeLabel}>SET LIBRARY</Text>
        <Text style={styles.bodyText}>
          Load a Korg PA4X .SET folder from USB or Files. Names, styles and WAV/KSF/PCM samples are imported without
          converting the SET.
        </Text>
        <Text style={styles.bodyText}>{s.importMessage || "No SET loaded yet. Tap LOAD SET."}</Text>
        {s.importing || s.importProgress > 0 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(s.importProgress * 100)}%` }]} />
          </View>
        ) : null}
        <ScrollView style={{ marginTop: 10 }}>
          {s.setFiles.map((line) => (
            <Text key={line} style={styles.fileLine}>
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>
    )
  }

  const isStyle = s.mode === "STYLE"
  const items = isStyle
    ? s.styles.filter(
        (item) =>
          (s.category === "All" || item.category === s.category) &&
          (!s.query || item.name.toLowerCase().includes(s.query.toLowerCase()))
      )
    : s.sounds.filter((item) => {
        const catOk =
          s.category === "All" ? true : s.category === "Favorites" ? s.favorites.includes(item.id) : item.category === s.category
        const padOk = s.mode === "PAD" ? item.category === "Percussion" : true
        return catOk && padOk && (!s.query || item.name.toLowerCase().includes(s.query.toLowerCase()))
      })
  const categories = ["All", ...(isStyle ? s.styles : s.sounds).map((item) => item.category)].filter(
    (v, i, a) => a.indexOf(v) === i
  )

  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.orangeLabel, { color: isStyle ? Pa.orange : Pa.blue }]}>{isStyle ? "STYLES" : "SOUNDS"}</Text>
      <TextInput
        value={s.query}
        onChangeText={vm.setQuery}
        placeholder="Search"
        placeholderTextColor={Pa.dim}
        style={styles.search}
      />
      <ScrollView horizontal style={{ flexGrow: 0, marginBottom: 8 }}>
        {categories.slice(0, 10).map((c) => (
          <PaButton key={c} label={c.toUpperCase()} active={s.category === c} onPress={() => vm.setCategory(c)} style={styles.cat} />
        ))}
      </ScrollView>
      <ScrollView>
        <View style={styles.grid}>
          {items.map((item) => (
            <PaButton
              key={item.id}
              label={item.name}
              active={isStyle ? item.id === s.styleId : item.id === s.upper1}
              accent={isStyle ? Pa.orange : Pa.blue}
              onPress={() => (isStyle ? vm.selectStyle(item.id) : vm.selectSound(item.id, 0))}
              style={styles.card}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Pa.bg, padding: 10, gap: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Pa.bgRaised, borderRadius: 12, borderWidth: 1, borderColor: Pa.stroke, paddingHorizontal: 12, paddingVertical: 8 },
  brand: { color: Pa.orange, fontWeight: "900", fontSize: 13, letterSpacing: 1.4 },
  sub: { color: Pa.muted, fontSize: 11 },
  modes: { flexDirection: "row", flex: 1, gap: 4 },
  modeBtn: { minHeight: 32 },
  wide: { maxWidth: 96, minWidth: 88 },
  narrow: { maxWidth: 56 },
  parts: { flexDirection: "row", gap: 8 },
  splitBox: { width: 168, backgroundColor: Pa.panel, borderRadius: 10, borderWidth: 1, borderColor: Pa.stroke, padding: 8 },
  splitText: { color: Pa.text, fontSize: 13, fontWeight: "600" },
  body: { flex: 1, flexDirection: "row", gap: 8 },
  stylePanel: { width: 340, backgroundColor: Pa.panel, borderRadius: 14, borderWidth: 1, borderColor: Pa.stroke, padding: 10, gap: 6 },
  browser: { flex: 1, backgroundColor: Pa.panel, borderRadius: 14, borderWidth: 1, borderColor: Pa.stroke, padding: 10 },
  orangeLabel: { color: Pa.orange, fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  styleName: { color: Pa.text, fontSize: 22, fontWeight: "700" },
  tempo: { color: Pa.gold, fontSize: 20, fontWeight: "900", marginRight: 8 },
  chord: { color: Pa.green, fontSize: 22, fontWeight: "900" },
  muted: { color: Pa.muted, fontSize: 10, fontWeight: "700" },
  dim: { color: Pa.dim, fontSize: 9, letterSpacing: 1, marginTop: 4 },
  row: { flexDirection: "row", gap: 4, alignItems: "center" },
  tiny: { maxWidth: 36, minHeight: 32 },
  varBtn: { minHeight: 56 },
  start: { minHeight: 62 },
  mixer: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Pa.panel, borderRadius: 12, borderWidth: 1, borderColor: Pa.stroke, paddingHorizontal: 12, paddingVertical: 6 },
  meterLabel: { color: Pa.meter, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  strip: { flex: 1, flexDirection: "row", alignItems: "center" },
  stripLab: { color: Pa.muted, fontSize: 10, fontWeight: "700", width: 28 },
  search: { backgroundColor: Pa.panelAlt, color: Pa.text, borderRadius: 8, paddingHorizontal: 10, height: 40, marginVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  card: { width: 160, minHeight: 48 },
  cat: { minWidth: 72, marginRight: 4 },
  bodyText: { color: Pa.muted, fontSize: 13, marginTop: 8 },
  faderTrack: { flex: 1, height: 18, borderRadius: 9, backgroundColor: Pa.panelAlt, overflow: "hidden" },
  faderFill: { height: "100%", backgroundColor: Pa.orange },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: Pa.stroke, overflow: "hidden", marginTop: 10 },
  progressFill: { height: "100%", backgroundColor: Pa.orange },
  fileLine: { color: Pa.dim, fontSize: 11, marginTop: 4 },
})

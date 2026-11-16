import { isAudioNativeAvailable } from "arrangerbox-audio"
import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { Knob, LcdButton, LcdHeader, LcdTabs, LcdToggle, Segmented } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import type { useArranger } from "@/hooks/useArranger"
import { CHORD_MODES, CHORD_SCANS, VELOCITY_CURVES, type Perf } from "@/hooks/usePerformance"
import { useTelemetry } from "@/lib/telemetry"

type Vm = ReturnType<typeof useArranger>
type Tab = "control" | "arranger" | "media" | "info"

export function GlobalPage({ vm, perf }: { vm: Vm; perf: Perf }) {
  const [tab, setTab] = useState<Tab>("control")
  const s = vm.state
  const p = perf.prefs
  return (
    <View style={styles.lcd}>
      <LcdHeader title="Global" right={tab === "media" ? "Media · Library" : "Settings"} />
      <ScrollView contentContainerStyle={styles.body}>
        {tab === "control" ? (
          <>
            <Section title="Keyboard velocity curve">
              <Segmented options={VELOCITY_CURVES} value={p.velocityCurve} onChange={(i) => perf.setChoice("velocityCurve", i)} />
            </Section>
            <Section title="Chord recognition">
              <Segmented options={CHORD_MODES} value={p.chordMode} onChange={(i) => perf.setChoice("chordMode", i)} />
              <Text style={styles.hint}>
                One Finger: the key you press is the root. Add a black key below for minor, a white key below for a 7th, both for minor 7th.
              </Text>
            </Section>
            <Section title="Chord scan area">
              <Segmented options={CHORD_SCANS} value={p.chordScan} onChange={(i) => perf.setChoice("chordScan", i)} />
              <Text style={styles.hint}>Full scans the whole keyboard and needs three or more keys, so melody lines do not change the chord.</Text>
            </Section>
            <Section title="Metronome">
              <View style={styles.row}>
                <LcdToggle label="Metronome" on={p.metronome} onPress={() => perf.toggle("metronome")} style={styles.flex} />
                <Knob lcd label="CLICK" value={p.metroVolume} max={1.2} onChange={perf.setMetroVolume} size={46} color={Lcd.orange} />
              </View>
            </Section>
          </>
        ) : null}
        {tab === "arranger" ? (
          <>
            <Section title="Style controls">
              <View style={styles.grid}>
                <LcdToggle label="Synchro Start" on={s.synchro} onPress={vm.toggleSynchro} style={styles.cell} />
                <LcdToggle label="Synchro Stop" on={p.synchroStop} onPress={() => perf.toggle("synchroStop")} style={styles.cell} />
                <LcdToggle label="Memory" on={p.memory} onPress={() => perf.toggle("memory")} style={styles.cell} />
                <LcdToggle label="Auto Fill" on={s.autoFill} onPress={vm.toggleAutoFill} style={styles.cell} />
                <LcdToggle label="Bass Inversion" on={p.bassInversion} onPress={() => perf.toggle("bassInversion")} style={styles.cell} />
                <LcdToggle label="Manual Bass" on={p.manualBass} onPress={() => perf.toggle("manualBass")} style={styles.cell} />
                <LcdToggle label="Tempo Lock" on={p.tempoLock} onPress={() => perf.toggle("tempoLock")} style={styles.cell} />
                <LcdToggle label="Split Keyboard" on={p.splitOn} onPress={() => perf.toggle("splitOn")} style={styles.cell} />
              </View>
            </Section>
            <Text style={styles.hint}>
              Variations and endings change on the next bar line. Fills and Break start at once and finish on the bar line. With
              Memory off, bass and accompaniment play only while you hold the chord.
            </Text>
          </>
        ) : null}
        {tab === "media" ? (
          <>
            <Section title="Library">
              <Text style={styles.value}>{s.setName ? `SET: ${s.setName}` : "No SET imported"}</Text>
              <Text style={styles.hint}>{s.importReport || s.importMessage || "Import a Pa-series .SET folder to add User sounds, styles and pads."}</Text>
              <View style={styles.row}>
                <LcdButton label="Import SET / SMF…" primary onPress={vm.importSet} />
              </View>
              {s.importing ? (
                <View style={styles.progress}>
                  <View style={[styles.progressFill, { width: `${Math.round(s.importProgress * 100)}%` }]} />
                </View>
              ) : null}
            </Section>
            <Section title="Contents">
              <Text style={styles.value}>
                {`${s.sounds.length} sounds · ${s.styles.length} styles · ${s.pads.length} pads · ${perf.book.songs.length} songs · ${perf.library.kbdSets.length} keyboard sets`}
              </Text>
            </Section>
          </>
        ) : null}
        {tab === "info" ? <Info vm={vm} /> : null}
      </ScrollView>
      <LcdTabs
        tabs={[
          { id: "control", label: "Controllers" },
          { id: "arranger", label: "Arranger" },
          { id: "media", label: "Media" },
          { id: "info", label: "Info" },
        ]}
        value={tab}
        onChange={setTab}
      />
    </View>
  )
}

function Info({ vm }: { vm: Vm }) {
  const voices = useTelemetry((t) => t.voices)
  const live = useTelemetry((t) => t.live)
  const s = vm.state
  return (
    <>
      <Section title="System">
        <Text style={styles.value}>{`Audio engine: ${isAudioNativeAvailable ? (live ? "running" : "starting") : "not in this build"}`}</Text>
        <Text style={styles.value}>{`Output latency: ${Math.round(s.latencyMs)} ms · Voices: ${Math.round(voices)}`}</Text>
        <Text style={styles.value}>{`MIDI: ${s.midiConnected ? `connected (${s.midiName})` : "no device"}`}</Text>
      </Section>
      <Section title="About">
        <Text style={styles.hint}>
          ArrangerBox 0.3 — a portable arranger. Factory sounds are GeneralUser GS; imported Pa-series SET sounds, styles and
          pads load on demand. Native audio and USB-MIDI need a development build on a real device.
        </Text>
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  lcd: { flex: 1, backgroundColor: Lcd.bg, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#2A3038" },
  body: { padding: 10, gap: 10 },
  section: { gap: 7, padding: 10, borderRadius: 8, backgroundColor: Lcd.bgDeep, borderWidth: 1, borderColor: Lcd.line },
  sectionTitle: { color: Lcd.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  hint: { color: Lcd.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  value: { color: Lcd.text, fontSize: 12.5, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { flexBasis: "48%", flexGrow: 1 },
  progress: { height: 4, borderRadius: 2, backgroundColor: Lcd.line, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Lcd.orange },
})

import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { Fader, Knob, LcdButton, LcdHeader, LcdTabs, Meter } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import type { useArranger } from "@/hooks/useArranger"
import { STRIPS, type Perf, type StripId } from "@/hooks/usePerformance"
import { useTelemetry } from "@/lib/telemetry"

type Vm = ReturnType<typeof useArranger>
type View_ = "all" | "kbd" | "style"

const ACCENT: Partial<Record<StripId, string>> = {
  up1: Lcd.up1,
  up2: Lcd.up2,
  up3: Lcd.up3,
  low: Lcd.low,
  drum: "#E9786A",
  bass: "#E9B86A",
  acc1: "#8FD3E8",
  acc2: "#8FD3E8",
  acc3: "#8FD3E8",
  pad: Lcd.padOn,
  metro: Lcd.dim,
}

export function MixerPage({ vm, perf }: { vm: Vm; perf: Perf }) {
  const [view, setView] = useState<View_>("all")
  const strips = STRIPS.filter((s) => view === "all" || s.group === view || (view === "style" && s.id === "pad"))
  const anySolo = STRIPS.some((s) => perf.prefs.strips[s.id].solo)
  const soundName = (id: StripId) => {
    const s = vm.state
    const pick =
      id === "up1" ? s.upper1 : id === "up2" ? s.upper2 : id === "up3" ? s.upper3 : id === "low" ? s.lower : null
    if (pick == null) return ""
    return s.sounds.find((x) => x.id === pick)?.name ?? ""
  }
  return (
    <View style={styles.lcd}>
      <LcdHeader title="Mixer" right={anySolo ? "SOLO ACTIVE" : "Volume · Pan · Mute · Solo"} />
      <View style={styles.body}>
        <ScrollView horizontal contentContainerStyle={styles.strips} showsHorizontalScrollIndicator={false}>
          {strips.map((def) => {
            const st = perf.prefs.strips[def.id]
            const accent = ACCENT[def.id] ?? Lcd.orange
            const dimmed = st.mute || (anySolo && !st.solo && def.id !== "metro")
            return (
              <View key={def.id} style={[styles.strip, dimmed && styles.stripDim]}>
                <Text style={styles.stripName} numberOfLines={2}>
                  {soundName(def.id) || " "}
                </Text>
                <Knob
                  label="PAN"
                  lcd
                  bipolar
                  size={34}
                  min={-1}
                  max={1}
                  value={st.pan}
                  color={accent}
                  format={(v) =>
                    Math.abs(v) < 0.02 ? "C" : v < 0 ? `L${Math.round(-v * 64)}` : `R${Math.round(v * 64)}`
                  }
                  onChange={(v) => perf.setStrip(def.id, { pan: v })}
                />
                <View style={styles.faderRow}>
                  <ActivityMeter channels={def.channels} />
                  <Fader
                    value={st.gain}
                    color={accent}
                    onChange={(v) => perf.setStrip(def.id, { gain: v })}
                    accessibilityLabel={`${def.label} volume`}
                  />
                </View>
                <Text style={styles.value}>{Math.round((st.gain / 1.27) * 127)}</Text>
                <View style={styles.msRow}>
                  <Pressable
                    onPress={() => perf.setStrip(def.id, { mute: !st.mute })}
                    accessibilityRole="switch"
                    accessibilityLabel={`${def.label} mute`}
                    accessibilityState={{ checked: st.mute }}
                    style={[styles.ms, st.mute && styles.muteOn]}
                  >
                    <Text style={styles.msText}>M</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => perf.setStrip(def.id, { solo: !st.solo })}
                    accessibilityRole="switch"
                    accessibilityLabel={`${def.label} solo`}
                    accessibilityState={{ checked: st.solo }}
                    style={[styles.ms, st.solo && styles.soloOn]}
                  >
                    <Text style={styles.msText}>S</Text>
                  </Pressable>
                </View>
                <View style={[styles.label, { borderTopColor: accent }]}>
                  <Text style={styles.labelText}>{def.label}</Text>
                </View>
              </View>
            )
          })}
          <MasterStrip vm={vm} perf={perf} />
        </ScrollView>
      </View>
      <View style={styles.footer}>
        <View style={styles.flex}>
          <LcdTabs
            tabs={[
              { id: "all", label: "All" },
              { id: "kbd", label: "Keyboard" },
              { id: "style", label: "Style" },
            ]}
            value={view}
            onChange={setView}
          />
        </View>
        <View style={styles.footerBtns}>
          <LcdButton label="Clear Solo" onPress={perf.clearSolo} disabled={!anySolo} />
          <LcdButton label="Reset" onPress={perf.resetMixer} />
        </View>
      </View>
    </View>
  )
}

function ActivityMeter({ channels }: { channels: number[] }) {
  const level = useTelemetry((t) => {
    let m = 0
    for (const ch of channels) m = Math.max(m, t.activity[ch] ?? 0)
    return Math.round(m * 16) / 16
  })
  return <Meter level={level} segments={14} />
}

function MasterStrip({ vm, perf }: { vm: Vm; perf: Perf }) {
  const l = useTelemetry((t) => Math.round(Math.min(1, t.peakL) * 20) / 20)
  const r = useTelemetry((t) => Math.round(Math.min(1, t.peakR) * 20) / 20)
  return (
    <View style={[styles.strip, styles.master]}>
      <Text style={styles.stripName}>OUTPUT</Text>
      <View style={styles.masterMeters}>
        <Meter level={l} segments={18} />
        <Meter level={r} segments={18} />
      </View>
      <View style={styles.faderRow}>
        <Fader
          value={perf.prefs.masterVolume}
          max={1.2}
          color={Lcd.text}
          onChange={perf.setMasterVolume}
          accessibilityLabel="Master volume"
        />
      </View>
      <Text style={styles.value}>{Math.round(perf.prefs.masterVolume * 100)}</Text>
      <View style={[styles.label, { borderTopColor: Lcd.text }]}>
        <Text style={styles.labelText}>MASTER</Text>
      </View>
      <Text style={styles.latency}>{`${Math.round(vm.state.latencyMs)} ms`}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  lcd: {
    flex: 1,
    backgroundColor: Lcd.bg,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2A3038",
  },
  body: { flex: 1, minHeight: 0 },
  flex: { flex: 1 },
  strips: { flexGrow: 1, paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  strip: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 58,
    maxWidth: 110,
    alignItems: "center",
    gap: 4,
    paddingTop: 4,
    paddingBottom: 2,
    borderRadius: 6,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  stripDim: { opacity: 0.55 },
  stripName: {
    color: Lcd.muted,
    fontSize: 8.5,
    fontWeight: "800",
    textAlign: "center",
    height: 22,
    paddingHorizontal: 2,
  },
  faderRow: {
    flex: 1,
    minHeight: 60,
    flexDirection: "row",
    gap: 3,
    alignItems: "stretch",
  },
  value: {
    color: Lcd.text,
    fontSize: 10,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  msRow: { flexDirection: "row", gap: 3 },
  ms: {
    width: 23,
    height: 20,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.cell,
    alignItems: "center",
    justifyContent: "center",
  },
  muteOn: { backgroundColor: Lcd.red, borderColor: Lcd.red },
  soloOn: { backgroundColor: Lcd.tabOn, borderColor: Lcd.tabOn },
  msText: { color: Lcd.text, fontSize: 10, fontWeight: "900" },
  label: {
    alignSelf: "stretch",
    borderTopWidth: 2,
    paddingTop: 3,
    alignItems: "center",
  },
  labelText: {
    color: Lcd.text,
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  master: { width: 70, backgroundColor: "#46515B" },
  masterMeters: { flexDirection: "row", gap: 3, height: 44 },
  latency: { color: Lcd.dim, fontSize: 8, fontWeight: "800" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Lcd.line,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#3A444E",
  },
  footerBtns: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 6,
    alignItems: "center",
  },
})

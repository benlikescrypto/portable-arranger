import { ScrollView, StyleSheet, Text, View } from "react-native"

import { Knob, LcdButton, LcdHeader, Stepper } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import type { useArranger } from "@/hooks/useArranger"
import type { Perf } from "@/hooks/usePerformance"

type Vm = ReturnType<typeof useArranger>

const pct = (v: number) => `${Math.round(v * 100)}`
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`

export function EffectsPage({ vm, perf }: { vm: Vm; perf: Perf }) {
  const s = vm.state
  const p = perf.prefs
  return (
    <View style={styles.lcd}>
      <LcdHeader title="Effects · Master EQ" right="Master FX" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.block}>
          <Text style={styles.blockTitle}>FX A · Ambience</Text>
          <View style={styles.knobs}>
            <Knob lcd label="REVERB" value={s.reverb} onChange={(v) => vm.setFx(0, v)} format={pct} color={Lcd.catOn} size={58} />
            <Knob lcd label="CHORUS" value={s.chorus} onChange={(v) => vm.setFx(1, v)} format={pct} color={Lcd.up2} size={58} />
            <Knob lcd label="DELAY" value={s.delay} onChange={(v) => vm.setFx(2, v)} format={pct} color={Lcd.up3} size={58} />
          </View>
        </View>
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Master EQ</Text>
          <View style={styles.knobs}>
            {(["LOW 90Hz", "MID 1.2k", "HIGH 6.5k"] as const).map((label, band) => (
              <Knob
                key={label}
                lcd
                bipolar
                label={label}
                min={-12}
                max={12}
                step={0.5}
                value={p.eq[band]}
                onChange={(v) => perf.setEq(band, v)}
                format={db}
                color={Lcd.orange}
                size={58}
              />
            ))}
          </View>
          <LcdButton label="Flat" onPress={() => [0, 1, 2].forEach((b) => perf.setEq(b, 0))} style={styles.flat} />
        </View>
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Output</Text>
          <View style={styles.knobs}>
            <Knob lcd label="MASTER" value={p.masterVolume} max={1.2} onChange={perf.setMasterVolume} format={pct} color={Lcd.text} size={58} />
            <Knob
              lcd
              label="KEYBOARD"
              value={s.mixer.keyboard}
              max={1.5}
              onChange={(v) => vm.setMixer(0, v)}
              format={pct}
              color={Lcd.up1}
              size={58}
            />
            <Knob
              lcd
              label="STYLE"
              value={Math.max(s.mixer.drums, s.mixer.bass, s.mixer.acc, s.mixer.pad)}
              max={1.5}
              onChange={vm.setStyleVolume}
              format={pct}
              color={Lcd.green}
              size={58}
            />
          </View>
          <Stepper
            label="FADE IN / OUT TIME"
            value={`${p.fadeSeconds} s`}
            onDec={() => perf.update({ fadeSeconds: Math.max(1, p.fadeSeconds - 1) })}
            onInc={() => perf.update({ fadeSeconds: Math.min(20, p.fadeSeconds + 1) })}
          />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  lcd: { flex: 1, backgroundColor: Lcd.bg, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#2A3038" },
  body: { padding: 10, gap: 10, flexDirection: "row", flexWrap: "wrap" },
  block: {
    flexGrow: 1,
    flexBasis: 240,
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  blockTitle: { color: Lcd.text, fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  knobs: { flexDirection: "row", justifyContent: "space-around", gap: 6 },
  flat: { alignSelf: "flex-end" },
})

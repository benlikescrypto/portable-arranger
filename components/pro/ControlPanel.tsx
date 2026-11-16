import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"

import { HwButton, Knob, PanelGroup, type LedState } from "@/components/pro/ui"
import { Hw, Sections } from "@/constants/theme"
import type { useArranger } from "@/hooks/useArranger"
import type { Perf } from "@/hooks/usePerformance"
import { useBlink, useTelemetry } from "@/lib/telemetry"

type Vm = ReturnType<typeof useArranger>
type Props = {
  vm: Vm
  perf: Perf
  compact?: boolean
  style?: StyleProp<ViewStyle>
}

/** LED for a style element: lit while it plays, blinking while booked. */
function useElementLed(section: number): LedState {
  const current = useTelemetry((t) => t.section)
  const booked = useTelemetry((t) => t.booked)
  const playing = useTelemetry((t) => t.playing)
  if (booked === section) return "blink"
  if (
    current === section &&
    (playing || (section >= Sections.VAR1 && section <= Sections.VAR4) || section <= 3 || section >= 13)
  )
    return "on"
  return "off"
}

function ElementKey({
  vm,
  section,
  label,
  sub,
  compact,
  color = "red",
  name,
}: {
  name?: string
  vm: Vm
  section: number
  label: string
  sub?: string
  compact?: boolean
  color?: "red" | "green" | "amber" | "blue"
}) {
  const led = useElementLed(section)
  const blink = useBlink()
  return (
    <HwButton
      label={label}
      sub={sub}
      led={led}
      blinkPhase={blink}
      ledColor={color}
      compact={compact}
      onPress={() => vm.book(section)}
      accessibilityLabel={name ?? label}
    />
  )
}

export function IntroGroup({ vm, compact, style }: Props) {
  return (
    <PanelGroup title="INTRO" style={style}>
      <ElementKey vm={vm} section={Sections.INTRO1} label="1" name="Intro 1" compact={compact} />
      <ElementKey vm={vm} section={Sections.INTRO2} label="2" name="Intro 2" compact={compact} />
      <ElementKey vm={vm} section={Sections.INTRO3} label="3" name="Intro 3" compact={compact} />
    </PanelGroup>
  )
}

export function EndingGroup({ vm, compact, style }: Props) {
  return (
    <PanelGroup title="ENDING" style={style}>
      <ElementKey vm={vm} section={Sections.END1} label="1" name="Ending 1" compact={compact} />
      <ElementKey vm={vm} section={Sections.END2} label="2" name="Ending 2" compact={compact} />
      <ElementKey vm={vm} section={Sections.END3} label="3" name="Ending 3" compact={compact} />
    </PanelGroup>
  )
}

export function VariationGroup({ vm, compact, style }: Props) {
  return (
    <PanelGroup title="VARIATION" style={style}>
      {[1, 2, 3, 4].map((n) => (
        <ElementKey
          key={n}
          vm={vm}
          section={Sections.VAR1 + n - 1}
          label={String(n)}
          name={`Variation ${n}`}
          compact={compact}
          color="green"
        />
      ))}
    </PanelGroup>
  )
}

export function FillGroup({ vm, compact, style }: Props) {
  return (
    <PanelGroup title="FILL · BREAK" style={style}>
      <ElementKey vm={vm} section={Sections.FILL1} label="FILL 1" compact={compact} color="amber" />
      <ElementKey vm={vm} section={Sections.FILL2} label="FILL 2" compact={compact} color="amber" />
      <ElementKey vm={vm} section={Sections.BREAK} label="BREAK" compact={compact} color="amber" />
    </PanelGroup>
  )
}

export function FadeGroup({ perf, compact, style }: Props) {
  const fade = useTelemetry((t) => t.fade)
  const playing = useTelemetry((t) => t.playing)
  const blink = useBlink()
  const fading = fade < 0.999
  return (
    <PanelGroup title="FADE" style={style}>
      <HwButton
        label="IN"
        led={fading && playing ? "blink" : "off"}
        blinkPhase={blink}
        compact={compact}
        onPress={perf.fadeIn}
      />
      <HwButton label="OUT" led={fading && playing ? "on" : "off"} compact={compact} onPress={perf.fadeOut} />
    </PanelGroup>
  )
}

export function TransportGroup({ vm, perf, compact, style }: Props) {
  const playing = useTelemetry((t) => t.playing)
  const beat = useTelemetry((t) => t.beat)
  const blink = useBlink()
  const s = vm.state
  const startLit = playing ? (beat === 0 ? "on" : blink ? "on" : "off") : s.synchro ? (blink ? "on" : "off") : "off"
  return (
    <PanelGroup title="START · STOP" style={style}>
      <HwButton
        label="SYNC"
        sub="START"
        led={s.synchro ? "on" : "off"}
        ledColor="green"
        compact={compact}
        onPress={vm.toggleSynchro}
      />
      <HwButton
        label="SYNC"
        sub="STOP"
        led={perf.prefs.synchroStop ? "on" : "off"}
        ledColor="green"
        compact={compact}
        onPress={() => perf.toggle("synchroStop")}
      />
      <HwButton
        label={playing ? "STOP" : "START"}
        led={startLit as LedState}
        ledColor="green"
        tone="start"
        compact={compact}
        onPress={vm.toggleStart}
        style={styles.start}
        labelStyle={styles.startLabel}
        accessibilityLabel={playing ? "Stop style" : "Start style"}
      />
    </PanelGroup>
  )
}

export function ArrangerSwitches({ vm, perf, compact, style }: Props) {
  const p = perf.prefs
  return (
    <PanelGroup title="ARRANGER" style={style} row={false}>
      <View style={styles.row}>
        <HwButton
          label="MEMORY"
          led={p.memory ? "on" : "off"}
          compact={compact}
          onPress={() => perf.toggle("memory")}
        />
        <HwButton
          label="AUTO FILL"
          led={vm.state.autoFill ? "on" : "off"}
          compact={compact}
          onPress={vm.toggleAutoFill}
        />
      </View>
      <View style={styles.row}>
        <HwButton
          label="BASS"
          sub="INVERSION"
          led={p.bassInversion ? "on" : "off"}
          compact={compact}
          onPress={() => perf.toggle("bassInversion")}
        />
        <HwButton
          label="MANUAL"
          sub="BASS"
          led={p.manualBass ? "on" : "off"}
          compact={compact}
          onPress={() => perf.toggle("manualBass")}
        />
      </View>
      <View style={styles.row}>
        <HwButton
          label="SPLIT"
          led={p.splitOn ? "on" : "off"}
          compact={compact}
          onPress={() => perf.toggle("splitOn")}
        />
        <HwButton
          label="ENSEMBLE"
          led={p.ensemble > 0 ? "on" : "off"}
          compact={compact}
          onPress={() => perf.setChoice("ensemble", p.ensemble > 0 ? 0 : 3)}
        />
      </View>
    </PanelGroup>
  )
}

export function TempoGroup({ vm, perf, compact, style }: Props) {
  const tempo = useTelemetry((t) => Math.round(t.tempo))
  const live = useTelemetry((t) => t.live)
  const shown = live ? tempo : Math.round(vm.state.tempo)
  const metroBeat = useTelemetry((t) => t.metroBeat)
  const beat = useTelemetry((t) => t.beat)
  const playing = useTelemetry((t) => t.playing)
  const metro = perf.prefs.metronome
  const pulse = playing ? beat : metro ? metroBeat : -1
  return (
    <PanelGroup title="TEMPO" style={style} row={false}>
      <View style={styles.tempoDisplay}>
        <View style={styles.beatDots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.beatDot, pulse === i && (i === 0 ? styles.beatDotDown : styles.beatDotOn)]} />
          ))}
        </View>
        <Text style={styles.tempoValue}>{shown}</Text>
        <Text style={styles.tempoUnit}>BPM</Text>
      </View>
      <View style={styles.row}>
        <HwButton
          label="−"
          compact={compact}
          onPress={() => vm.nudgeTempo(-1)}
          onLongPress={() => vm.nudgeTempo(-10)}
        />
        <HwButton label="TAP" compact={compact} onPress={perf.tapTempo} />
        <HwButton label="+" compact={compact} onPress={() => vm.nudgeTempo(1)} onLongPress={() => vm.nudgeTempo(10)} />
      </View>
      <View style={styles.row}>
        <HwButton
          label="LOCK"
          led={perf.prefs.tempoLock ? "on" : "off"}
          compact={compact}
          onPress={() => perf.toggle("tempoLock")}
        />
        <HwButton
          label="METRO"
          led={metro ? "on" : "off"}
          ledColor="amber"
          compact={compact}
          onPress={() => perf.toggle("metronome")}
        />
      </View>
    </PanelGroup>
  )
}

export function TransposeGroup({ vm, compact, style }: Props) {
  const t = vm.state.transpose
  return (
    <PanelGroup title="TRANSPOSE" style={style} row={false}>
      <View style={styles.row}>
        <HwButton
          label="♭"
          labelStyle={styles.accidental}
          compact={compact}
          onPress={() => vm.transpose(-1)}
          accessibilityLabel="Transpose down"
        />
        <View style={styles.trDisplay}>
          <Text style={styles.trValue}>{t > 0 ? `+${t}` : t}</Text>
        </View>
        <HwButton
          label="♯"
          labelStyle={styles.accidental}
          compact={compact}
          onPress={() => vm.transpose(1)}
          accessibilityLabel="Transpose up"
        />
      </View>
      <View style={styles.row}>
        <HwButton label="OCT −" compact={compact} onPress={() => vm.setOctave(-1)} />
        <HwButton label="OCT +" compact={compact} onPress={() => vm.setOctave(1)} />
      </View>
    </PanelGroup>
  )
}

/** Lays keys out in rows of two (narrow side panels) or one row (the deck). */
function Keys({ grid, children }: { grid?: boolean; children: React.ReactNode[] }) {
  if (!grid) return <>{children}</>
  const rows: React.ReactNode[][] = []
  children.forEach((c, i) => {
    if (i % 2 === 0) rows.push([])
    rows[rows.length - 1].push(c)
  })
  return (
    <>
      {rows.map((r, i) => (
        <View key={i} style={styles.row}>
          {r}
        </View>
      ))}
    </>
  )
}

export function StsGroup({ perf, compact, style, grid }: Props & { grid?: boolean }) {
  return (
    <PanelGroup title="SINGLE TOUCH" style={style} row={!grid}>
      <Keys grid={grid}>
        {perf.stsSlots.map((slot, i) => (
          <HwButton
            key={i}
            label={String(i + 1)}
            sub={slot.set.name}
            led={perf.activeSts === i ? "on" : "off"}
            ledColor="blue"
            compact={compact}
            onPress={() => perf.pressSts(i)}
            onLongPress={() => perf.writeSts(i)}
            accessibilityLabel={`Single Touch ${i + 1}, ${slot.set.name}. Long press to write.`}
          />
        ))}
      </Keys>
    </PanelGroup>
  )
}

export function PadGroup({ perf, compact, style, grid }: Props & { grid?: boolean }) {
  const keys = perf.prefs.pads.map((pad, i) => (
    <HwButton
      key={i}
      label={String(i + 1)}
      sub={pad.name}
      tone="accent"
      compact={compact}
      onPressIn={() => perf.padDown(i)}
      onPressOut={() => perf.padUp(i)}
      accessibilityLabel={`Pad ${i + 1}, ${pad.name}`}
    />
  ))
  const stop = (
    <HwButton
      key="stop"
      label={grid ? "PAD STOP" : "STOP"}
      compact={compact}
      onPress={perf.padsStop}
      accessibilityLabel="Stop pads"
    />
  )
  return (
    <PanelGroup title="PADS" style={style} row={!grid}>
      {grid ? (
        <>
          <Keys grid>{keys}</Keys>
          <View style={styles.row}>{stop}</View>
        </>
      ) : (
        <>
          {keys}
          {stop}
        </>
      )}
    </PanelGroup>
  )
}

export function VolumeGroup({ vm, perf, style }: Props) {
  const m = vm.state.mixer
  return (
    <PanelGroup title="VOLUME" style={style}>
      <View style={styles.knobs}>
        <Knob
          label="MASTER"
          value={perf.prefs.masterVolume}
          max={1.2}
          onChange={perf.setMasterVolume}
          size={40}
          format={(v) => `${Math.round(v * 100)}`}
        />
        <Knob
          label="STYLE"
          value={Math.max(m.drums, m.bass, m.acc, m.pad)}
          max={1.5}
          onChange={vm.setStyleVolume}
          size={40}
          color={Hw.ledGreen}
          format={(v) => `${Math.round(v * 100)}`}
        />
        <Knob
          label="KBD"
          value={m.keyboard}
          max={1.5}
          onChange={(v) => vm.setMixer(0, v)}
          size={40}
          color={Hw.ledBlue}
          format={(v) => `${Math.round(v * 100)}`}
        />
      </View>
    </PanelGroup>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 5, flexGrow: 1 },
  knobs: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  start: { flex: 1.6, backgroundColor: "#24382B", borderColor: "#3E6A4C" },
  startLabel: { fontSize: 14, letterSpacing: 1.6, color: "#E9FFF0" },
  tempoDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Hw.groove,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#23272D",
    paddingHorizontal: 8,
    height: 34,
  },
  beatDots: { flexDirection: "row", gap: 3 },
  beatDot: { width: 7, height: 7, borderRadius: 2, backgroundColor: "#22262B" },
  beatDotOn: { backgroundColor: Hw.ledGreen },
  beatDotDown: { backgroundColor: Hw.ledRed },
  tempoValue: {
    flex: 1,
    textAlign: "right",
    color: Hw.ledAmber,
    fontSize: 20,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  tempoUnit: {
    color: Hw.sub,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  trDisplay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Hw.groove,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#23272D",
  },
  accidental: { fontSize: 22, lineHeight: 26 },
  trValue: {
    color: Hw.ledAmber,
    fontSize: 17,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
})

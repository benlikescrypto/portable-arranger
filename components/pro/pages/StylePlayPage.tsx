import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { Fader, LcdButton, LcdHeader, LcdTabs, LcdToggle, Segmented, Stepper } from "@/components/pro/ui"
import { chordLabel, Lcd, NOTE_NAMES, noteName } from "@/constants/theme"
import type { useArranger } from "@/hooks/useArranger"
import {
  CHORD_MODES,
  CHORD_SCANS,
  ENSEMBLE_MODES,
  SCALES,
  scaleCents,
  VELOCITY_CURVES,
  type Perf,
  type StripId,
} from "@/hooks/usePerformance"
import { useBlink, useTelemetry } from "@/lib/telemetry"
import type { SoundItem } from "@/lib/types"

type Vm = ReturnType<typeof useArranger>
type Tab = "main" | "volume" | "keyboard" | "pads" | "ensemble" | "scale"

const TABS: { id: Tab; label: string }[] = [
  { id: "main", label: "Main" },
  { id: "volume", label: "Volume" },
  { id: "keyboard", label: "Keyboard" },
  { id: "pads", label: "Pads" },
  { id: "ensemble", label: "Ensemble" },
  { id: "scale", label: "Sub Scale" },
]

const SECTION_NAMES: Record<number, string> = {
  1: "INTRO 1",
  2: "INTRO 2",
  3: "INTRO 3",
  4: "VAR 1",
  5: "VAR 2",
  6: "VAR 3",
  7: "VAR 4",
  8: "FILL 1",
  9: "FILL 2",
  10: "FILL 3",
  11: "FILL 4",
  12: "BREAK",
  13: "ENDING 1",
  14: "ENDING 2",
  15: "ENDING 3",
}

const PARTS: { label: string; strip: StripId; accent: string }[] = [
  { label: "UP1", strip: "up1", accent: Lcd.up1 },
  { label: "UP2", strip: "up2", accent: Lcd.up2 },
  { label: "UP3", strip: "up3", accent: Lcd.up3 },
  { label: "LOW", strip: "low", accent: Lcd.low },
]

type Props = {
  vm: Vm
  perf: Perf
  wide: boolean
  showMap?: boolean
  /** Tablet-size LCD: larger type, rows fill the space. */
  big?: boolean
  /** Tall portrait screen: sound rows share the free height instead of scrolling. */
  fill?: boolean
  kbdName: string
  onOpenStyle: () => void
  onOpenSound: (part: 0 | 1 | 2 | 3) => void
  onOpenKbdLibrary: () => void
  onOpenPadSound: (slot: number) => void
}

export function StylePlayPage(props: Props) {
  const [tab, setTab] = useState<Tab>("main")
  const { vm, perf, kbdName } = props
  return (
    <View style={styles.lcd}>
      <LcdHeader title="Style Play" right={`Kbd: ${kbdName}`}>
        <BarBeat />
      </LcdHeader>
      <View style={styles.body}>
        {tab === "main" ? <MainTab {...props} /> : null}
        {tab === "volume" ? <VolumeTab vm={vm} perf={perf} /> : null}
        {tab === "keyboard" ? <KeyboardTab vm={vm} perf={perf} /> : null}
        {tab === "pads" ? <PadsTab perf={perf} vm={vm} onOpenPadSound={props.onOpenPadSound} /> : null}
        {tab === "ensemble" ? <EnsembleTab perf={perf} /> : null}
        {tab === "scale" ? <ScaleTab perf={perf} /> : null}
      </View>
      <LcdTabs tabs={TABS} value={tab} onChange={setTab} />
    </View>
  )
}

function BarBeat() {
  const beat = useTelemetry((t) => t.beat)
  const bar = useTelemetry((t) => t.bar)
  const playing = useTelemetry((t) => t.playing)
  return (
    <View style={styles.barBeat}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[styles.hdrBeat, playing && beat === i && (i === 0 ? styles.hdrBeatDown : styles.hdrBeatOn)]}
        />
      ))}
      <Text style={styles.hdrBar}>{playing ? `M ${bar}` : "M –"}</Text>
    </View>
  )
}

function soundOf(vm: Vm, id: number | null | undefined): SoundItem | undefined {
  if (id == null) return undefined
  return vm.state.sounds.find((x) => x.id === id)
}

function MainTab({
  vm,
  perf,
  wide,
  showMap,
  big = false,
  fill = false,
  kbdName,
  onOpenStyle,
  onOpenSound,
  onOpenKbdLibrary,
}: Props) {
  const s = vm.state
  const style = s.styles.find((x) => x.id === s.styleId)
  const parts = [soundOf(vm, s.upper1), soundOf(vm, s.upper2), soundOf(vm, s.upper3), soundOf(vm, s.lower)]
  const on = [true, s.upper2On, s.upper3On, s.lowerOn]
  const stretch = big || fill
  const Container = wide || stretch ? View : ScrollView
  return (
    <Container
      style={wide ? styles.columns : styles.flex}
      contentContainerStyle={wide || stretch ? undefined : styles.stacked}
    >
      <View style={wide ? styles.left : styles.leftStacked}>
        <Pressable
          onPress={onOpenStyle}
          accessibilityRole="button"
          accessibilityLabel={`Style ${style?.name ?? "none"}. Tap to choose a style.`}
          style={({ pressed }) => [styles.styleBlock, big && B.styleBlock, pressed && styles.pressed]}
        >
          <View style={styles.tag}>
            <Text style={styles.tagText}>STYLE</Text>
          </View>
          <Text style={[styles.styleName, big && B.styleName]} numberOfLines={1} adjustsFontSizeToFit>
            {style?.name ?? "No Style"}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, big && B.meta]} numberOfLines={1}>
              {`${style?.source === "IMPORTED" ? "User" : "Factory"} · ${style?.category ?? "—"}`}
            </Text>
            <Text style={[styles.meta, big && B.meta]}>4/4</Text>
            <TempoBox tempo={s.tempo} locked={perf.prefs.tempoLock} big={big} />
          </View>
          {showMap ? <ElementMap big={big} /> : null}
        </Pressable>
        <ElementStrip big={big} />
        <View style={[styles.infoRow, big && B.infoRow]}>
          <ChordBlock big={big} />
          <View style={styles.miniInfo}>
            <InfoCell big={big} label="TRANSP" value={s.transpose > 0 ? `+${s.transpose}` : String(s.transpose)} />
            <InfoCell big={big} label="SPLIT" value={perf.prefs.splitOn ? noteName(s.split) : "OFF"} />
            <InfoCell big={big} label="OCT" value={s.octave > 0 ? `+${s.octave}` : String(s.octave)} />
          </View>
        </View>
        <Pressable
          onPress={onOpenKbdLibrary}
          accessibilityRole="button"
          accessibilityLabel={`Keyboard set ${kbdName}. Tap for the Keyboard Set library.`}
          style={({ pressed }) => [styles.kbdBlock, big && B.kbdBlock, pressed && styles.pressed]}
        >
          <View style={[styles.tag, styles.tagKbd]}>
            <Text style={styles.tagText}>KBD SET</Text>
          </View>
          <Text style={[styles.kbdName, big && B.kbdName]} numberOfLines={1}>
            {kbdName}
          </Text>
          <Text style={[styles.kbdSub, big && B.kbdSub]}>Library ›</Text>
        </Pressable>
      </View>
      <View style={wide ? styles.right : stretch ? styles.flex : styles.rightStacked}>
        {PARTS.map((p, i) => (
          <PartRow
            key={p.label}
            label={p.label}
            accent={p.accent}
            sound={parts[i]}
            on={on[i]}
            octave={perf.prefs.octaves[i]}
            volume={perf.prefs.strips[p.strip].gain}
            muted={perf.prefs.strips[p.strip].mute}
            channel={i}
            onPress={() => onOpenSound(i as 0 | 1 | 2 | 3)}
            onToggle={i === 0 ? undefined : () => vm.togglePart(i)}
            fixed={!wide && !stretch}
            big={big}
          />
        ))}
      </View>
    </Container>
  )
}

function TempoBox({ tempo, locked, big }: { tempo: number; locked: boolean; big: boolean }) {
  const live = useTelemetry((t) => (t.live ? Math.round(t.tempo) : -1))
  return (
    <View style={[styles.tempoBox, big && B.tempoBox]}>
      <Text style={[styles.tempoNote, big && B.tempoNote]}>♩=</Text>
      <Text style={[styles.tempoValue, big && B.tempoValue]}>{live >= 0 ? live : Math.round(tempo)}</Text>
      {locked ? <Text style={styles.lock}>LOCK</Text> : null}
    </View>
  )
}

const MAP: { group: string; items: [number, string][] }[] = [
  {
    group: "INTRO",
    items: [
      [1, "1"],
      [2, "2"],
      [3, "3"],
    ],
  },
  {
    group: "VARIATION",
    items: [
      [4, "1"],
      [5, "2"],
      [6, "3"],
      [7, "4"],
    ],
  },
  {
    group: "FILL",
    items: [
      [8, "1"],
      [9, "2"],
      [12, "BRK"],
    ],
  },
  {
    group: "ENDING",
    items: [
      [13, "1"],
      [14, "2"],
      [15, "3"],
    ],
  },
]

function ElementMap({ big }: { big: boolean }) {
  const section = useTelemetry((t) => t.section)
  const booked = useTelemetry((t) => t.booked)
  const playing = useTelemetry((t) => t.playing)
  const blink = useBlink()
  return (
    <View style={[styles.map, big && B.map]}>
      {MAP.map((g) => (
        <View key={g.group} style={styles.mapGroup}>
          <Text style={[styles.mapTitle, big && B.mapTitle]}>{g.group}</Text>
          <View style={styles.mapRow}>
            {g.items.map(([sec, label]) => {
              const cur = section === sec
              const bk = booked === sec
              return (
                <View
                  key={sec}
                  style={[
                    styles.mapChip,
                    big && B.mapChip,
                    cur && (playing ? styles.mapChipPlay : styles.mapChipSel),
                    bk && blink && styles.mapChipBooked,
                  ]}
                >
                  <Text style={[styles.mapText, big && B.mapText, (cur || (bk && blink)) && styles.mapTextOn]}>
                    {label}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}

function ElementStrip({ big }: { big: boolean }) {
  const section = useTelemetry((t) => t.section)
  const booked = useTelemetry((t) => t.booked)
  const playing = useTelemetry((t) => t.playing)
  const fade = useTelemetry((t) => t.fade)
  const blink = useBlink()
  return (
    <View style={[styles.elementStrip, big && B.elementStrip]}>
      <View style={[styles.playPill, playing && styles.playPillOn]}>
        <Text style={[styles.playPillText, big && B.playPillText, playing && styles.playPillTextOn]}>
          {playing ? "▶ PLAY" : "■ STOP"}
        </Text>
      </View>
      <Text style={[styles.elementNow, big && B.elementNow]}>{SECTION_NAMES[section] ?? "—"}</Text>
      {booked ? (
        <Text
          style={[styles.elementNext, big && B.elementNow, !blink && { opacity: 0.35 }]}
        >{`› ${SECTION_NAMES[booked] ?? ""}`}</Text>
      ) : null}
      {fade < 0.999 && playing ? <Text style={styles.fadeTag}>{`FADE ${Math.round(fade * 100)}%`}</Text> : null}
    </View>
  )
}

function ChordBlock({ big }: { big: boolean }) {
  const root = useTelemetry((t) => t.chordRoot)
  const type = useTelemetry((t) => t.chordType)
  const held = useTelemetry((t) => t.chordHeld)
  const bass = useTelemetry((t) => t.bassRoot)
  const label = chordLabel(root, type) + (bass >= 0 ? `/${NOTE_NAMES[bass]}` : "")
  return (
    <View style={styles.chord}>
      <Text style={[styles.chordTag, big && B.tag]}>CHORD</Text>
      <Text
        style={[styles.chordName, big && B.chordName, !held && styles.chordMemory]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {label}
      </Text>
    </View>
  )
}

function InfoCell({ label, value, big }: { label: string; value: string; big: boolean }) {
  return (
    <View style={[styles.infoCell, big && B.infoCell]}>
      <Text style={[styles.infoLabel, big && B.tag]}>{label}</Text>
      <Text style={[styles.infoValue, big && B.infoValue]}>{value}</Text>
    </View>
  )
}

function PartRow({
  label,
  accent,
  sound,
  on,
  octave,
  volume,
  muted,
  channel,
  onPress,
  onToggle,
  fixed,
  big,
}: {
  fixed?: boolean
  big?: boolean
  /** Tall portrait screen: sound rows share the free height instead of scrolling. */
  fill?: boolean
  label: string
  accent: string
  sound?: SoundItem
  on: boolean
  octave: number
  volume: number
  muted: boolean
  channel: number
  onPress: () => void
  onToggle?: () => void
}) {
  const activity = useTelemetry((t) => Math.round((t.activity[channel] ?? 0) * 6))
  const active = on && !muted
  const bank = (sound?.source ?? "FACTORY").toUpperCase() === "FACTORY" ? "Factory" : "User"
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${sound?.name ?? "none"}${on ? "" : ", off"}. Tap to choose a sound${onToggle ? ", long press to switch on or off" : ""}.`}
      style={({ pressed }) => [
        styles.partRow,
        fixed ? styles.partRowFixed : styles.partRowFlex,
        big && B.partRow,
        pressed && styles.partPressed,
      ]}
    >
      <View style={[styles.partAccent, { backgroundColor: active ? accent : Lcd.line }]} />
      <View style={styles.partText}>
        <Text style={[styles.partName, big && B.partName, !active && styles.partNameOff]} numberOfLines={1}>
          {sound?.name ?? "—"}
        </Text>
        <Text style={[styles.partMeta, big && B.partMeta]} numberOfLines={1}>
          {`${bank} · ${sound?.category ?? ""}`}
        </Text>
      </View>
      {octave !== 0 ? (
        <View style={styles.octBadge}>
          <Text style={styles.octText}>{octave > 0 ? `+${octave}` : octave}</Text>
        </View>
      ) : null}
      <View style={[styles.actLeds, big && B.meterTall]}>
        {[5, 4, 3, 2, 1, 0].map((i) => (
          <View key={i} style={[styles.actLed, active && i < activity && { backgroundColor: accent }]} />
        ))}
      </View>
      <View style={[styles.volBar, big && B.meterTall]}>
        <View
          style={[
            styles.volFill,
            {
              height: `${Math.min(100, (volume / 1.27) * 100)}%`,
              backgroundColor: accent,
            },
          ]}
        />
      </View>
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          style={[styles.partSwitch, big && B.partSwitch, on && { borderColor: accent }]}
        >
          <Text style={[styles.partSwitchText, big && B.partSwitchText, { color: on ? accent : Lcd.dim }]}>
            {on ? label : "OFF"}
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.partSwitch, big && B.partSwitch, { borderColor: accent }]}>
          <Text style={[styles.partSwitchText, big && B.partSwitchText, { color: accent }]}>{label}</Text>
        </View>
      )}
      {muted ? <Text style={styles.muteTag}>MUTE</Text> : null}
    </Pressable>
  )
}

// ───────────────────────── Tabs ─────────────────────────

function VolumeTab({ vm, perf }: { vm: Vm; perf: Perf }) {
  const strips: { id: StripId; label: string }[] = [
    { id: "up1", label: "UP1" },
    { id: "up2", label: "UP2" },
    { id: "up3", label: "UP3" },
    { id: "low", label: "LOW" },
  ]
  const styleLevel = Math.max(vm.state.mixer.drums, vm.state.mixer.bass, vm.state.mixer.acc, vm.state.mixer.pad)
  return (
    <View style={styles.volPage}>
      {strips.map((st) => {
        const strip = perf.prefs.strips[st.id]
        return (
          <View key={st.id} style={styles.volCol}>
            <Text style={styles.volValue}>{Math.round(strip.gain * 100)}</Text>
            <Fader
              value={strip.gain}
              onChange={(v) => perf.setStrip(st.id, { gain: v })}
              accessibilityLabel={`${st.label} volume`}
            />
            <Pressable
              onPress={() => perf.setStrip(st.id, { mute: !strip.mute })}
              style={[styles.muteBtn, strip.mute && styles.muteBtnOn]}
            >
              <Text style={styles.muteBtnText}>M</Text>
            </Pressable>
            <Text style={styles.volLabel}>{st.label}</Text>
          </View>
        )
      })}
      <View style={styles.volDivider} />
      <View style={styles.volCol}>
        <Text style={styles.volValue}>{Math.round(vm.state.mixer.keyboard * 100)}</Text>
        <Fader
          value={vm.state.mixer.keyboard}
          max={1.5}
          color={Lcd.up1}
          onChange={(v) => vm.setMixer(0, v)}
          accessibilityLabel="Keyboard volume"
        />
        <Text style={styles.volLabel}>KBD</Text>
      </View>
      <View style={styles.volCol}>
        <Text style={styles.volValue}>{Math.round(styleLevel * 100)}</Text>
        <Fader
          value={styleLevel}
          max={1.5}
          color={Lcd.green}
          onChange={vm.setStyleVolume}
          accessibilityLabel="Style volume"
        />
        <Text style={styles.volLabel}>STYLE</Text>
      </View>
    </View>
  )
}

function KeyboardTab({ vm, perf }: { vm: Vm; perf: Perf }) {
  const p = perf.prefs
  const s = vm.state
  return (
    <ScrollView contentContainerStyle={styles.formPage}>
      <Text style={styles.formTitle}>Octave Transpose</Text>
      <View style={styles.formRow}>
        {PARTS.map((part, i) => (
          <Stepper
            key={part.label}
            label={part.label}
            value={p.octaves[i] > 0 ? `+${p.octaves[i]}` : String(p.octaves[i])}
            onDec={() => perf.setOctave(i, p.octaves[i] - 1)}
            onInc={() => perf.setOctave(i, p.octaves[i] + 1)}
            style={styles.flex}
          />
        ))}
      </View>
      <Text style={styles.formTitle}>Split</Text>
      <View style={styles.formRow}>
        <Stepper
          label="SPLIT POINT"
          value={noteName(s.split)}
          onDec={() => vm.setSplit(s.split - 1)}
          onInc={() => vm.setSplit(s.split + 1)}
          style={styles.flex}
        />
        <LcdToggle label="Split keyboard" on={p.splitOn} onPress={() => perf.toggle("splitOn")} style={styles.flex} />
      </View>
      <Text style={styles.formTitle}>Chord Recognition</Text>
      <Segmented options={CHORD_MODES} value={p.chordMode} onChange={(i) => perf.setChoice("chordMode", i)} />
      <Text style={styles.formHint}>Chord scan area</Text>
      <Segmented options={CHORD_SCANS} value={p.chordScan} onChange={(i) => perf.setChoice("chordScan", i)} />
      <Text style={styles.formTitle}>Velocity Curve</Text>
      <Segmented
        options={VELOCITY_CURVES}
        value={p.velocityCurve}
        onChange={(i) => perf.setChoice("velocityCurve", i)}
      />
    </ScrollView>
  )
}

function PadsTab({ perf, vm, onOpenPadSound }: { perf: Perf; vm: Vm; onOpenPadSound: (slot: number) => void }) {
  const modes = ["hit", "chord", "note"] as const
  return (
    <ScrollView contentContainerStyle={styles.formPage}>
      {perf.prefs.pads.map((pad, i) => {
        const sound = vm.state.sounds.find((x) => x.name === pad.sound)
        return (
          <View key={i} style={styles.padRow}>
            <View style={styles.padNum}>
              <Text style={styles.padNumText}>{i + 1}</Text>
            </View>
            <Pressable
              onPress={() => onOpenPadSound(i)}
              style={({ pressed }) => [styles.padSound, pressed && styles.pressed]}
            >
              <Text style={styles.padName} numberOfLines={1}>
                {pad.name}
              </Text>
              <Text style={styles.padMeta} numberOfLines={1}>
                {sound ? pad.sound : `${pad.sound} (not loaded)`}
              </Text>
            </Pressable>
            <Segmented
              options={["Hit", "Chord", "Note"]}
              value={modes.indexOf(pad.mode)}
              onChange={(m) => perf.setPad(i, { mode: modes[m] })}
              style={styles.padMode}
            />
            {pad.mode !== "chord" ? (
              <Stepper
                value={noteName(pad.note)}
                onDec={() => perf.setPad(i, { note: Math.max(0, pad.note - 1) })}
                onInc={() => perf.setPad(i, { note: Math.min(127, pad.note + 1) })}
                style={styles.padNote}
              />
            ) : (
              <Text style={[styles.padMeta, styles.padNote]}>follows chord</Text>
            )}
          </View>
        )
      })}
      <Text style={styles.formHint}>
        Hit pads ring out. Chord pads play the recognised chord and stop when released. Tap a pad name to pick its
        sound.
      </Text>
    </ScrollView>
  )
}

function EnsembleTab({ perf }: { perf: Perf }) {
  const p = perf.prefs
  const info = [
    "Upper 1 plays alone.",
    "Adds one chord tone under the melody.",
    "Adds two close chord tones under the melody.",
    "Adds three chord tones: a full block chord.",
    "Doubles the melody one octave lower.",
  ]
  return (
    <View style={styles.formPage}>
      <Text style={styles.formTitle}>Ensemble (Upper 1 harmony from the left-hand chord)</Text>
      <Segmented options={ENSEMBLE_MODES} value={p.ensemble} onChange={(i) => perf.setChoice("ensemble", i)} />
      <Text style={styles.formHint}>{info[p.ensemble]}</Text>
    </View>
  )
}

function ScaleTab({ perf }: { perf: Perf }) {
  const p = perf.prefs
  const cents = scaleCents(p)
  const blacks = new Set([1, 3, 6, 8, 10])
  return (
    <ScrollView contentContainerStyle={styles.formPage}>
      <Text style={styles.formTitle}>Sub Scale</Text>
      <View style={styles.scaleList}>
        {SCALES.map((sc) => (
          <Pressable
            key={sc.id}
            onPress={() => perf.setScale({ scaleId: sc.id })}
            style={[styles.scaleItem, p.scaleId === sc.id && styles.scaleItemOn]}
          >
            <Text style={[styles.scaleText, p.scaleId === sc.id && styles.scaleTextOn]} numberOfLines={1}>
              {sc.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.formRow}>
        <Stepper
          label="KEY"
          value={NOTE_NAMES[p.scaleKey]}
          onDec={() => perf.setScale({ scaleKey: (p.scaleKey + 11) % 12 })}
          onInc={() => perf.setScale({ scaleKey: (p.scaleKey + 1) % 12 })}
          style={styles.flex}
        />
        <LcdToggle
          label="Also on style tracks"
          on={p.scaleToStyle}
          onPress={() => perf.toggle("scaleToStyle")}
          style={styles.flex}
        />
      </View>
      <Text style={styles.formHint}>
        Tap a key to toggle a quarter tone (−50 cents). Values show the cents now applied.
      </Text>
      <View style={styles.qtKeys}>
        {NOTE_NAMES.map((n, pc) => (
          <Pressable
            key={n}
            onPress={() => perf.toggleQuarterTone(pc)}
            style={[styles.qtKey, blacks.has(pc) && styles.qtKeyBlack, cents[pc] !== 0 && styles.qtKeyOn]}
          >
            <Text style={[styles.qtName, blacks.has(pc) && { color: Lcd.text }]}>{n}</Text>
            <Text style={styles.qtCents}>{cents[pc] === 0 ? "0" : cents[pc] > 0 ? `+${cents[pc]}` : cents[pc]}</Text>
          </Pressable>
        ))}
      </View>
      <LcdButton label="Reset to Equal" onPress={() => perf.setScale({ scaleId: "equal", scaleKey: 0 })} />
    </ScrollView>
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
  pressed: { backgroundColor: Lcd.cell },
  flex: { flex: 1 },

  barBeat: { flexDirection: "row", alignItems: "center", gap: 4 },
  hdrBeat: { width: 9, height: 9, borderRadius: 2, backgroundColor: "#9C8455" },
  hdrBeatOn: { backgroundColor: "#2E6B3F" },
  hdrBeatDown: { backgroundColor: "#B5342A" },
  hdrBar: {
    color: Lcd.headerText,
    fontSize: 11,
    fontWeight: "900",
    marginLeft: 4,
    fontVariant: ["tabular-nums"],
  },

  columns: { flex: 1, flexDirection: "row" },
  stacked: { paddingBottom: 4 },
  rightStacked: {},
  partRowFixed: { flexGrow: 0, flexShrink: 0, flexBasis: "auto", height: 46 },
  left: { flex: 1.1, borderRightWidth: 1, borderRightColor: Lcd.line },
  leftStacked: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
  },
  right: { flex: 1, minHeight: 150 },

  styleBlock: {
    flexGrow: 1,
    minHeight: 64,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
    justifyContent: "center",
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
  },
  tag: {
    position: "absolute",
    top: 5,
    right: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: Lcd.bgDeep,
  },
  tagKbd: { top: 4 },
  tagText: { color: Lcd.dim, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  styleName: {
    color: Lcd.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
    paddingRight: 44,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  meta: { color: Lcd.muted, fontSize: 11, fontWeight: "700", flexShrink: 1 },
  tempoBox: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1.5,
    borderColor: Lcd.orange,
    borderRadius: 5,
    backgroundColor: Lcd.bgDeep,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  tempoNote: { color: Lcd.muted, fontSize: 12, fontWeight: "800" },
  tempoValue: {
    color: Lcd.text,
    fontSize: 17,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    minWidth: 30,
    textAlign: "right",
  },
  lock: { color: Lcd.orange, fontSize: 8, fontWeight: "900", marginLeft: 3 },

  map: { flexDirection: "row", gap: 10, marginTop: 10 },
  mapGroup: { gap: 3 },
  mapTitle: {
    color: Lcd.dim,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  mapRow: { flexDirection: "row", gap: 3 },
  mapChip: {
    minWidth: 24,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 3,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
    alignItems: "center",
    justifyContent: "center",
  },
  mapChipSel: { backgroundColor: Lcd.cell, borderColor: Lcd.text },
  mapChipPlay: { backgroundColor: "#2F7A4A", borderColor: "#7EE0B8" },
  mapChipBooked: { borderColor: Lcd.tabOn, backgroundColor: "#6E6036" },
  mapText: { color: Lcd.dim, fontSize: 9.5, fontWeight: "900" },
  mapTextOn: { color: Lcd.text },
  elementStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    height: 30,
    backgroundColor: Lcd.bgDeep,
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
  },
  playPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Lcd.cell,
  },
  playPillOn: { backgroundColor: "#2F7A4A" },
  playPillText: {
    color: Lcd.muted,
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  playPillTextOn: { color: "#E8FFF0" },
  elementNow: {
    color: Lcd.text,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  elementNext: {
    color: Lcd.tabOn,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  fadeTag: {
    marginLeft: "auto",
    color: Lcd.orange,
    fontSize: 10,
    fontWeight: "900",
  },

  infoRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
    minHeight: 54,
  },
  chord: {
    flex: 1,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: Lcd.line,
  },
  chordTag: {
    color: Lcd.dim,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  chordName: {
    color: Lcd.text,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  chordMemory: { color: Lcd.muted },
  miniInfo: { flexDirection: "row" },
  infoCell: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: Lcd.line,
    gap: 2,
  },
  infoLabel: {
    color: Lcd.dim,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  infoValue: { color: Lcd.text, fontSize: 14, fontWeight: "900" },

  kbdBlock: {
    minHeight: 44,
    paddingHorizontal: 10,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  kbdName: { flex: 1, color: Lcd.green, fontSize: 15, fontWeight: "900" },
  kbdSub: { color: Lcd.dim, fontSize: 10, fontWeight: "800", marginRight: 56 },

  partRowFlex: { flex: 1 },
  partRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
  },
  partPressed: { backgroundColor: Lcd.cell },
  partAccent: { width: 4, alignSelf: "stretch" },
  partText: { flex: 1, minWidth: 0, paddingLeft: 3 },
  partName: { color: Lcd.text, fontSize: 14, fontWeight: "900" },
  partNameOff: { color: Lcd.dim, fontWeight: "700" },
  partMeta: { color: Lcd.dim, fontSize: 9.5, fontWeight: "700", marginTop: 1 },
  octBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: Lcd.orange,
  },
  octText: { color: "#2B1A08", fontSize: 9, fontWeight: "900" },
  actLeds: { width: 6, height: 22, gap: 1.5 },
  actLed: { flex: 1, borderRadius: 1, backgroundColor: Lcd.line },
  volBar: {
    width: 5,
    height: 22,
    borderRadius: 2,
    backgroundColor: Lcd.bgDeep,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  volFill: { width: "100%" },
  partSwitch: {
    minWidth: 34,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Lcd.line,
    alignItems: "center",
  },
  partSwitchText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  muteTag: {
    position: "absolute",
    right: 50,
    top: 4,
    color: Lcd.red,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  volPage: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  volCol: { flex: 1, alignItems: "center", gap: 4 },
  volValue: {
    color: Lcd.text,
    fontSize: 11,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  volLabel: { color: Lcd.muted, fontSize: 9.5, fontWeight: "900" },
  volDivider: { width: 1, backgroundColor: Lcd.line, marginHorizontal: 4 },
  muteBtn: {
    width: 30,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  muteBtnOn: { backgroundColor: Lcd.red, borderColor: Lcd.red },
  muteBtnText: { color: Lcd.text, fontSize: 10, fontWeight: "900" },

  formPage: { padding: 12, gap: 8 },
  formTitle: {
    color: Lcd.text,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  formHint: { color: Lcd.muted, fontSize: 11, fontWeight: "600" },
  formRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },

  padRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  padNum: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: Lcd.pad,
    alignItems: "center",
    justifyContent: "center",
  },
  padNumText: { color: Lcd.text, fontSize: 12, fontWeight: "900" },
  padSound: {
    flex: 1.3,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  padName: { color: Lcd.text, fontSize: 12.5, fontWeight: "900" },
  padMeta: { color: Lcd.dim, fontSize: 10, fontWeight: "700" },
  padMode: { flex: 1.4 },
  padNote: { flex: 0.9, textAlign: "center" },

  scaleList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scaleItem: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  scaleItemOn: { backgroundColor: Lcd.catOn, borderColor: Lcd.catOn },
  scaleText: { color: Lcd.muted, fontSize: 11.5, fontWeight: "800" },
  scaleTextOn: { color: "#0C2427" },
  qtKeys: { flexDirection: "row", gap: 3 },
  qtKey: {
    flex: 1,
    height: 58,
    borderRadius: 4,
    backgroundColor: "#E9ECEF",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 4,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  qtKeyBlack: { backgroundColor: "#22272D" },
  qtKeyOn: { borderColor: Lcd.orange, borderWidth: 2, borderBottomWidth: 5 },
  qtName: { color: "#1C2127", fontSize: 10, fontWeight: "900" },
  qtCents: { color: Lcd.orange, fontSize: 9, fontWeight: "900" },
})

/** Overrides for a tablet-size LCD. */
const B = StyleSheet.create({
  styleBlock: { paddingHorizontal: 18, gap: 6 },
  styleName: { fontSize: 44, letterSpacing: -0.8, paddingRight: 70 },
  meta: { fontSize: 16 },
  tempoBox: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 2,
    borderRadius: 8,
  },
  tempoNote: { fontSize: 18 },
  tempoValue: { fontSize: 30, minWidth: 52 },
  map: { gap: 14, marginTop: 18, flexWrap: "wrap" },
  mapTitle: { fontSize: 11 },
  mapChip: { minWidth: 36, height: 34, borderRadius: 5 },
  mapText: { fontSize: 14 },
  elementStrip: { height: 44, paddingHorizontal: 18, gap: 12 },
  playPillText: { fontSize: 13 },
  elementNow: { fontSize: 19 },
  infoRow: { minHeight: 86 },
  tag: { fontSize: 11 },
  chordName: { fontSize: 46 },
  infoCell: { width: 86 },
  infoValue: { fontSize: 22 },
  kbdBlock: { minHeight: 66, paddingHorizontal: 18 },
  kbdName: { fontSize: 22 },
  kbdSub: { fontSize: 13, marginRight: 80 },
  partRow: { gap: 12, paddingRight: 14 },
  partName: { fontSize: 24 },
  partMeta: { fontSize: 13, marginTop: 3 },
  meterTall: { height: 38, width: 8 },
  partSwitch: { minWidth: 56, paddingVertical: 5, borderRadius: 6 },
  partSwitchText: { fontSize: 13 },
})

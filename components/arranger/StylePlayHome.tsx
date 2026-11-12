import { useState, type ReactNode } from "react"
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native"

import { KeyboardIcon, PadIcon, PianoIcon, StringsIcon } from "@/components/arranger/lcdIcons"
import { Lcd, noteName } from "@/constants/theme"
import type { MixerState, SoundItem, StyleItem } from "@/lib/types"

type Tab = "home" | "volume" | "pad" | "split" | "scale" | "mic"

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Kbd Set" },
  { id: "volume", label: "Volume" },
  { id: "pad", label: "Pad" },
  { id: "split", label: "Split" },
  { id: "scale", label: "Sub Scale" },
  { id: "mic", label: "Mic" },
]

type StsPad = {
  n: number
  name: string
}

type Props = {
  style?: StyleItem
  tempo: number
  sts: number
  kbdName: string
  kbdIndex: number
  upper1?: SoundItem
  upper2?: SoundItem
  upper3?: SoundItem
  lower?: SoundItem
  upper2On: boolean
  upper3On: boolean
  lowerOn: boolean
  split: number
  mixer: MixerState
  stsPads: StsPad[]
  onOpenStyle: () => void
  onOpenPads: () => void
  onOpenSound: (part: 0 | 1 | 2 | 3) => void
  onTogglePart: (part: number) => void
  onSts: (n: number) => void
  onTempo: (delta: number) => void
  onSplit: (note: number) => void
  onMixer: (bus: number, gain: number) => void
  onAccVolume: (gain: number) => void
}

export function StylePlayHome({
  style,
  tempo,
  sts,
  kbdName,
  kbdIndex,
  upper1,
  upper2,
  upper3,
  lower,
  upper2On,
  upper3On,
  lowerOn,
  split,
  mixer,
  stsPads,
  onOpenStyle,
  onOpenPads,
  onOpenSound,
  onTogglePart,
  onSts,
  onTempo,
  onSplit,
  onMixer,
  onAccVolume,
}: Props) {
  const [tab, setTab] = useState<Tab>("home")
  const { width, height } = useWindowDimensions()
  const landscape = width > height

  return (
    <View style={styles.lcd}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Style Play</Text>
        <Text style={styles.headerKbd}>{`Kbd: ${kbdIndex}`}</Text>
      </View>

      {tab === "home" ? (
        <View style={styles.body}>
          <View style={styles.columns}>
            <View style={styles.left}>
              <View style={styles.styleRow}>
                <SideLabel text="STYLE" />
                <Pressable
                  onPress={onOpenStyle}
                  accessibilityRole="button"
                  accessibilityLabel={`Style, ${style?.name ?? "No Style"}`}
                  style={({ pressed }) => [styles.styleBlock, pressed && styles.pressed]}
                >
                  <Text style={styles.styleName} numberOfLines={1}>
                    {style?.name ?? "No Style"}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {`Bank: ${style?.category ?? "—"}`}
                  </Text>
                  <View style={styles.meterRow}>
                    <Text style={styles.meta}>Meter: 4/4</Text>
                    <View style={styles.tempoBox}>
                      <Pressable onPress={() => onTempo(-1)} hitSlop={6}>
                        <Text style={styles.tempoMark}>♩</Text>
                      </Pressable>
                      <Text style={styles.tempoEq}>=</Text>
                      <Pressable onPress={() => onTempo(1)} hitSlop={6}>
                        <Text style={styles.tempoValue}>{Math.round(tempo)}</Text>
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              </View>

              <View style={styles.songRow}>
                <SongPad n={1} />
                <SongPad n={2} />
              </View>

              <View style={styles.kbdRow}>
                <SideLabel text="KBD" />
                <View style={styles.kbdBlock}>
                  <Text style={styles.kbdName} numberOfLines={1}>
                    {kbdName}
                  </Text>
                  <Text style={styles.kbdSub}>Kbd Set Library</Text>
                </View>
              </View>
            </View>

            <View style={styles.right}>
              <SoundRow
                name={upper1?.name ?? "Concert Grand"}
                label="UP1"
                stacked={!landscape}
                accent={Lcd.up1}
                on={true}
                volume={mixer.keyboard}
                icon={<PianoIcon />}
                onPress={() => onOpenSound(0)}
              />
              <SoundRow
                name={upper2?.name ?? "Warm Pad"}
                label="UP2"
                stacked={!landscape}
                accent={Lcd.up2}
                on={upper2On}
                volume={mixer.keyboard}
                muted={!upper2On}
                icon={<PadIcon />}
                onPress={() => onOpenSound(1)}
                onMute={() => onTogglePart(1)}
              />
              <SoundRow
                name={upper3?.name ?? "Concert Strings"}
                label="UP3"
                stacked={!landscape}
                accent={Lcd.up3}
                on={upper3On}
                volume={mixer.keyboard}
                muted={!upper3On}
                icon={<StringsIcon />}
                onPress={() => onOpenSound(2)}
                onMute={() => onTogglePart(2)}
              />
              <SoundRow
                name={lower?.name ?? "Cinematic Strings"}
                label="LOW"
                stacked={!landscape}
                accent={Lcd.low}
                on={lowerOn}
                volume={mixer.keyboard}
                backing={lowerOn}
                icon={<StringsIcon />}
                onPress={() => onOpenSound(3)}
                onMute={() => onTogglePart(3)}
              />
            </View>
          </View>

          <View style={[styles.stsRow, landscape && styles.stsRowCompact]}>
            {stsPads.map((pad) => (
              <Pressable
                key={pad.n}
                onPress={() => onSts(pad.n)}
                accessibilityRole="button"
                accessibilityLabel={`STS ${pad.n}, ${pad.name}`}
                style={({ pressed }) => [styles.stsPad, sts === pad.n && styles.stsOn, pressed && styles.pressed]}
              >
                <View style={styles.stsIcon}>
                  <KeyboardIcon width={landscape ? 26 : 30} height={landscape ? 12 : 14} />
                  <Text style={styles.stsNum}>{pad.n}</Text>
                </View>
                <Text style={styles.stsName} numberOfLines={2}>
                  {pad.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <TabPage
          tab={tab}
          split={split}
          mixer={mixer}
          onSplit={onSplit}
          onMixer={onMixer}
          onAccVolume={onAccVolume}
        />
      )}

      <View style={styles.tabs}>
        {TABS.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => (item.id === "pad" ? onOpenPads() : setTab(item.id))}
            style={[styles.tab, tab === item.id && styles.tabOn]}
          >
            {tab === item.id ? <View style={styles.tabBar} /> : null}
            <Text style={[styles.tabLabel, tab === item.id && styles.tabLabelOn]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function SideLabel({ text }: { text: string }) {
  return (
    <View style={styles.sideLabel}>
      {text.split("").map((ch, i) => (
        <Text key={`${ch}${i}`} style={styles.sideLetter}>
          {ch}
        </Text>
      ))}
    </View>
  )
}

function SongPad({ n }: { n: number }) {
  return (
    <View style={styles.songPad}>
      <View style={styles.songBadge}>
        <Text style={styles.songP}>P</Text>
        <Text style={styles.songN}>{n}</Text>
      </View>
      <Text style={styles.songLabel}>Select Song</Text>
    </View>
  )
}

function SoundRow({
  name,
  label,
  on,
  volume,
  muted,
  backing,
  icon,
  accent,
  stacked,
  onPress,
  onMute,
}: {
  name: string
  label: string
  accent: string
  stacked?: boolean
  on: boolean
  volume: number
  muted?: boolean
  backing?: boolean
  icon: ReactNode
  onPress: () => void
  onMute?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${name}${muted ? ", muted" : backing ? ", backing" : ""}`}
      style={({ pressed }) => [styles.soundRow, pressed && styles.soundRowPressed]}
    >
      <View style={[styles.accent, { backgroundColor: on ? accent : Lcd.line }]} />
      <View style={[styles.soundMain, stacked && styles.soundMainStacked]}>
        <View style={styles.soundText}>
          <Text style={[styles.soundName, !on && styles.soundOff]} numberOfLines={stacked ? 2 : 1}>
            {name}
          </Text>
          {backing ? (
            <Pressable onPress={onMute} hitSlop={6}>
              <Text style={styles.backing}>BACKING</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.soundControls}>
          {muted ? (
            <Pressable onPress={onMute} hitSlop={8} style={styles.muteHit}>
              <Text style={styles.mute}>MUTE</Text>
            </Pressable>
          ) : (
            <VolumeTicks value={on ? volume : 0} color={accent} />
          )}
          <View style={styles.soundIcon}>{icon}</View>
          <View style={[styles.partBadge, { borderColor: on ? accent : Lcd.line }]}>
            <Text style={[styles.partLabel, { color: on ? accent : Lcd.dim }]}>{label}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

function VolumeTicks({ value, color }: { value: number; color: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * 6)
  return (
    <View style={styles.ticks}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={[styles.tick, i < lit && { backgroundColor: color }]} />
      ))}
    </View>
  )
}

function TabPage({
  tab,
  split,
  mixer,
  onSplit,
  onMixer,
  onAccVolume,
}: {
  tab: Tab
  split: number
  mixer: MixerState
  onSplit: (note: number) => void
  onMixer: (bus: number, gain: number) => void
  onAccVolume: (gain: number) => void
}) {
  if (tab === "volume") {
    const faders: { label: string; value: number; set: (v: number) => void }[] = [
      { label: "KBD", value: mixer.keyboard, set: (v) => onMixer(0, v) },
      { label: "DRUM", value: mixer.drums, set: (v) => onMixer(1, v) },
      { label: "BASS", value: mixer.bass, set: (v) => onMixer(2, v) },
      { label: "ACC", value: mixer.acc, set: (v) => onMixer(3, v) },
      { label: "PAD", value: mixer.pad, set: (v) => onMixer(4, v) },
    ]
    return (
      <View style={styles.page}>
        <View style={styles.volRow}>
          {faders.map((fader) => (
            <Pressable
              key={fader.label}
              onPress={() => fader.set(fader.value > 0.05 ? 0 : 1)}
              onLongPress={() => (fader.label === "ACC" ? onAccVolume(fader.value > 0.05 ? 0 : 1) : undefined)}
              style={styles.volCol}
            >
              <Text style={styles.volValue}>{Math.round(fader.value * 100)}</Text>
              <View style={styles.volTrack}>
                <View style={[styles.volFill, { height: `${Math.min(100, fader.value * 100)}%` }]} />
              </View>
              <Text style={styles.volLabel}>{fader.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.pageHint}>Tap a bus to mute / restore.</Text>
      </View>
    )
  }

  if (tab === "split") {
    return (
      <View style={styles.page}>
        <Text style={styles.pageTitle}>Split Point</Text>
        <View style={styles.splitRow}>
          <Pressable onPress={() => onSplit(Math.max(24, split - 1))} style={styles.splitBtn}>
            <Text style={styles.splitBtnLabel}>−</Text>
          </Pressable>
          <Text style={styles.splitNote}>{noteName(split)}</Text>
          <Pressable onPress={() => onSplit(Math.min(84, split + 1))} style={styles.splitBtn}>
            <Text style={styles.splitBtnLabel}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.pageHint}>Notes below this play LOW. Notes at and above play UP1.</Text>
      </View>
    )
  }

  const copy =
    tab === "pad"
      ? "Tap a User pad to load it into RAM. Native PAD files need Pad Record > Export SMF."
      : tab === "scale"
        ? "Sub scale is not implemented."
        : "Mic input is not implemented."

  return (
    <View style={styles.page}>
      <Text style={styles.pageTitle}>{TABS.find((item) => item.id === tab)?.label}</Text>
      <Text style={styles.pageHint}>{copy}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  lcd: {
    flex: 1,
    backgroundColor: Lcd.bg,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2A3038",
  },
  header: {
    height: 30,
    backgroundColor: Lcd.header,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#A88A52",
  },
  headerTitle: { color: Lcd.headerText, fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  headerKbd: { color: Lcd.headerText, fontSize: 12, fontWeight: "800" },
  body: { flex: 1, minHeight: 0 },
  columns: { flex: 1, minHeight: 0, flexDirection: "row" },
  left: { flex: 1.12, borderRightWidth: 1, borderRightColor: Lcd.line },
  right: { flex: 1 },
  // Rows share the column height so nothing is clipped in landscape.
  styleRow: { flex: 1.7, minHeight: 64, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Lcd.line },
  sideLabel: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    backgroundColor: Lcd.bgDeep,
  },
  sideLetter: { color: Lcd.dim, fontSize: 8, fontWeight: "900", lineHeight: 10 },
  styleBlock: { flex: 1, paddingHorizontal: 10, paddingVertical: 6, justifyContent: "center", gap: 2 },
  styleName: { color: Lcd.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  meta: { color: Lcd.muted, fontSize: 11, fontWeight: "600" },
  meterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 8 },
  tempoBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Lcd.orange,
    borderRadius: 6,
    backgroundColor: Lcd.bgDeep,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 4,
  },
  tempoMark: { color: Lcd.text, fontSize: 13, fontWeight: "700" },
  tempoEq: { color: Lcd.muted, fontSize: 11 },
  tempoValue: {
    color: Lcd.text,
    fontSize: 17,
    fontWeight: "900",
    minWidth: 30,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  songRow: { flex: 1, minHeight: 36, maxHeight: 60, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Lcd.line },
  songPad: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 8,
    borderRightWidth: 1,
    borderRightColor: Lcd.line,
  },
  songBadge: {
    width: 20,
    paddingVertical: 2,
    alignItems: "center",
    borderRadius: 4,
    backgroundColor: Lcd.bgDeep,
  },
  songP: { color: Lcd.green, fontSize: 10, fontWeight: "900", lineHeight: 11 },
  songN: { color: Lcd.green, fontSize: 10, fontWeight: "900", lineHeight: 11 },
  songLabel: { color: Lcd.muted, fontSize: 12, fontWeight: "600" },
  kbdRow: { flex: 1, minHeight: 36, maxHeight: 60, flexDirection: "row" },
  kbdBlock: { flex: 1, justifyContent: "center", paddingHorizontal: 10 },
  kbdName: { color: Lcd.green, fontSize: 15, fontWeight: "800" },
  kbdSub: { color: Lcd.dim, fontSize: 10, fontWeight: "600", marginTop: 1 },
  soundRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
  },
  soundMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  soundMainStacked: { flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 8 },
  soundControls: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  soundRowPressed: { backgroundColor: Lcd.cell },
  accent: { width: 4, alignSelf: "stretch" },
  soundText: { flex: 1, minWidth: 0, paddingLeft: 4 },
  soundName: { color: Lcd.text, fontSize: 14, fontWeight: "800" },
  soundOff: { color: Lcd.dim, fontWeight: "600" },
  backing: { color: Lcd.red, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginTop: 1 },
  muteHit: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Lcd.bgDeep,
  },
  mute: { color: Lcd.mute, fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  ticks: { width: 8, height: 22, justifyContent: "flex-end", gap: 1.5 },
  tick: { height: 2, borderRadius: 1, backgroundColor: Lcd.line },
  soundIcon: { width: 28, alignItems: "center" },
  partBadge: {
    minWidth: 32,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
  },
  partLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  stsRow: {
    height: 74,
    flexDirection: "row",
    gap: 6,
    padding: 6,
    backgroundColor: Lcd.bgDeep,
    borderTopWidth: 1,
    borderTopColor: Lcd.line,
  },
  stsRowCompact: { height: 56, padding: 5, gap: 5 },
  stsPad: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 8,
    backgroundColor: Lcd.bg,
    borderWidth: 1,
    borderColor: Lcd.line,
    borderBottomWidth: 3,
    borderBottomColor: "#2F3841",
  },
  stsOn: { backgroundColor: Lcd.cell, borderColor: Lcd.catOn, borderBottomColor: Lcd.catOn },
  stsIcon: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  stsNum: { color: Lcd.text, fontSize: 11, fontWeight: "900" },
  stsName: { color: Lcd.text, fontSize: 10, fontWeight: "700", textAlign: "center", paddingHorizontal: 4 },
  tabs: {
    height: 30,
    flexDirection: "row",
    backgroundColor: "#3A444E",
    borderTopWidth: 1,
    borderTopColor: Lcd.line,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: Lcd.bgDeep },
  tabBar: { position: "absolute", top: 0, left: 10, right: 10, height: 2, borderRadius: 1, backgroundColor: Lcd.tabOn },
  tabLabel: { color: Lcd.dim, fontSize: 10, fontWeight: "700" },
  tabLabelOn: { color: Lcd.text, fontWeight: "800" },
  page: { flex: 1, padding: 16, justifyContent: "center", gap: 12 },
  pageTitle: { color: Lcd.text, fontSize: 18, fontWeight: "700" },
  pageHint: { color: Lcd.muted, fontSize: 13, fontWeight: "600" },
  volRow: { flexDirection: "row", flex: 1, gap: 8 },
  volCol: { flex: 1, alignItems: "center", gap: 6 },
  volValue: { color: Lcd.text, fontSize: 11, fontWeight: "800" },
  volTrack: {
    flex: 1,
    width: 22,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  volFill: { width: "100%", backgroundColor: Lcd.orange },
  volLabel: { color: Lcd.muted, fontSize: 9, fontWeight: "800" },
  splitRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  splitBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Lcd.cell,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  splitBtnLabel: { color: Lcd.text, fontSize: 28, fontWeight: "700" },
  splitNote: { color: Lcd.text, fontSize: 36, fontWeight: "800", minWidth: 80, textAlign: "center" },
  pressed: { opacity: 0.86 },
})

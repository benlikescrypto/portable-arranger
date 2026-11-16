import { useRef, useState, type ReactNode } from "react"
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { Hw, Lcd } from "@/constants/theme"
import { pagerLock } from "@/lib/pagerLock"

// ───────────────────────── Hardware key with LED ─────────────────────────

export type LedState = "off" | "on" | "blink"

type HwButtonProps = {
  label: string
  sub?: string
  led?: LedState
  blinkPhase?: boolean
  ledColor?: "red" | "green" | "amber" | "blue"
  onPress?: () => void
  onLongPress?: () => void
  onPressIn?: () => void
  onPressOut?: () => void
  disabled?: boolean
  tone?: "key" | "start" | "accent"
  compact?: boolean
  style?: StyleProp<ViewStyle>
  labelStyle?: StyleProp<TextStyle>
  accessibilityLabel?: string
}

const LED_ON = {
  red: Hw.ledRed,
  green: Hw.ledGreen,
  amber: Hw.ledAmber,
  blue: Hw.ledBlue,
}
const LED_OFF = {
  red: Hw.ledOff,
  green: Hw.ledGreenOff,
  amber: Hw.ledAmberOff,
  blue: Hw.ledBlueOff,
}

export function HwButton({
  label,
  sub,
  led,
  blinkPhase = true,
  ledColor = "red",
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled,
  tone = "key",
  compact,
  style,
  labelStyle,
  accessibilityLabel,
}: HwButtonProps) {
  const lit = led === "on" || (led === "blink" && blinkPhase)
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      delayLongPress={450}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (sub ? `${label} ${sub}` : label)}
      accessibilityState={{ selected: led === "on", disabled }}
      hitSlop={2}
      style={({ pressed }) => [
        styles.key,
        compact && styles.keyCompact,
        tone === "start" && styles.keyStart,
        tone === "accent" && styles.keyAccent,
        pressed && styles.keyPressed,
        disabled && styles.keyDisabled,
        style,
      ]}
    >
      {led !== undefined ? (
        <View
          style={[
            styles.led,
            compact && styles.ledCompact,
            { backgroundColor: lit ? LED_ON[ledColor] : LED_OFF[ledColor] },
            lit && {
              shadowColor: LED_ON[ledColor],
              shadowOpacity: 0.9,
              shadowRadius: 5,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        />
      ) : null}
      <Text
        style={[styles.keyLabel, compact && styles.keyLabelCompact, labelStyle]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {label}
      </Text>
      {sub ? (
        <Text style={styles.keySub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** A labelled group on the control panel (silk-screen title + bracket line). */
export function PanelGroup({
  title,
  children,
  style,
  row = true,
}: {
  title: string
  children: ReactNode
  style?: StyleProp<ViewStyle>
  row?: boolean
}) {
  return (
    <View style={[styles.group, style]}>
      <View style={styles.groupHead}>
        <View style={styles.groupLine} />
        <Text style={styles.groupTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.groupLine} />
      </View>
      <View style={[row ? styles.groupRow : styles.groupCol]}>{children}</View>
    </View>
  )
}

// ───────────────────────── Knob ─────────────────────────

type KnobProps = {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  size?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  color?: string
  bipolar?: boolean
  lcd?: boolean
}

/** Drag up / down to turn. Double tap resets to the centre (bipolar) or minimum. */
export function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  size = 54,
  format,
  onChange,
  color = Hw.ledAmber,
  bipolar,
  lcd,
}: KnobProps) {
  const start = useRef({ y: 0, v: 0 })
  const lastTap = useRef(0)
  const range = max - min
  const norm = Math.max(0, Math.min(1, (value - min) / (range || 1)))
  const angle = -135 + norm * 270
  const set = (v: number) => {
    const q = Math.round(Math.max(min, Math.min(max, v)) / step) * step
    onChange(Number(q.toFixed(4)))
  }
  const dots = 21
  const centre = bipolar ? 0.5 : 0
  return (
    <View style={[styles.knobWrap, { width: size + 12 }]}>
      <View
        style={{ width: size, height: size }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderRelease={pagerLock.release}
        onResponderTerminate={pagerLock.release}
        onResponderGrant={(e) => {
          pagerLock.hold()
          const now = Date.now()
          if (now - lastTap.current < 280) set(bipolar ? (min + max) / 2 : min)
          lastTap.current = now
          start.current = { y: e.nativeEvent.pageY, v: value }
        }}
        onResponderMove={(e) => {
          const dy = start.current.y - e.nativeEvent.pageY
          set(start.current.v + (dy / 160) * range)
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: format ? format(value) : String(value) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === "increment" ? 1 : -1) * range * 0.05)}
      >
        {Array.from({ length: dots }).map((_, i) => {
          const f = i / (dots - 1)
          const a = ((-135 + f * 270) * Math.PI) / 180
          const r = size / 2 - 2
          const lo = Math.min(centre, norm)
          const hi = Math.max(centre, norm)
          const on = f >= lo - 0.001 && f <= hi + 0.001
          return (
            <View
              key={i}
              pointerEvents="none"
              style={[
                styles.knobDot,
                {
                  left: size / 2 + Math.sin(a) * r - 1.5,
                  top: size / 2 - Math.cos(a) * r - 1.5,
                  backgroundColor: on ? color : lcd ? Lcd.line : "#30343A",
                },
              ]}
            />
          )
        })}
        <View
          pointerEvents="none"
          style={[
            styles.knobBody,
            lcd && styles.knobBodyLcd,
            {
              left: size * 0.17,
              top: size * 0.17,
              width: size * 0.66,
              height: size * 0.66,
              borderRadius: size * 0.33,
              transform: [{ rotate: `${angle}deg` }],
            },
          ]}
        >
          <View
            style={[
              styles.knobMark,
              {
                height: size * 0.2,
                backgroundColor: lcd ? Lcd.text : "#F1F3F5",
              },
            ]}
          />
        </View>
      </View>
      <Text style={[styles.knobValue, lcd && { color: Lcd.text }]} numberOfLines={1}>
        {format ? format(value) : Math.round(value * 100)}
      </Text>
      <Text style={[styles.knobLabel, lcd && { color: Lcd.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

// ───────────────────────── Fader ─────────────────────────

type FaderProps = {
  value: number
  max?: number
  onChange: (v: number) => void
  color?: string
  height?: number
  accessibilityLabel?: string
}

export function Fader({ value, max = 1.27, onChange, color = Lcd.orange, accessibilityLabel }: FaderProps) {
  const h = useRef(1)
  const top = useRef(0)
  const CAP = 22
  const [trackH, setTrackH] = useState(0)
  const pct = Math.max(0, Math.min(1, value / max))
  const travel = Math.max(0, trackH - CAP)
  const setFrom = (pageY: number) => {
    const fromBottom = h.current - (pageY - top.current) - CAP / 2
    const v = (fromBottom / Math.max(1, h.current - CAP)) * max
    onChange(Math.round(Math.max(0, Math.min(max, v)) * 100) / 100)
  }
  return (
    <View
      style={styles.fader}
      onLayout={(e) => {
        h.current = Math.max(1, e.nativeEvent.layout.height)
        setTrackH(e.nativeEvent.layout.height)
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderRelease={pagerLock.release}
      onResponderTerminate={pagerLock.release}
      onResponderGrant={(e) => {
        pagerLock.hold()
        top.current = e.nativeEvent.pageY - e.nativeEvent.locationY
        setFrom(e.nativeEvent.pageY)
      }}
      onResponderMove={(e) => setFrom(e.nativeEvent.pageY)}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 127, now: Math.round(pct * 127) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) =>
        onChange(Math.max(0, Math.min(max, value + (e.nativeEvent.actionName === "increment" ? 0.05 : -0.05))))
      }
    >
      <View pointerEvents="none" style={[styles.faderSlot, { top: CAP / 2, bottom: CAP / 2 }]}>
        <View style={[styles.faderFill, { height: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <View pointerEvents="none" style={[styles.faderUnity, { bottom: CAP / 2 + (travel * 1) / max }]} />
      <View pointerEvents="none" style={[styles.faderCap, { height: CAP, bottom: pct * travel }]}>
        <View style={styles.faderCapLine} />
      </View>
    </View>
  )
}

// ───────────────────────── Meter ─────────────────────────

export function Meter({
  level,
  segments = 12,
  horizontal,
}: {
  level: number
  segments?: number
  horizontal?: boolean
}) {
  const lit = Math.round(Math.max(0, Math.min(1, level)) * segments)
  return (
    <View style={horizontal ? styles.meterH : styles.meterV}>
      {Array.from({ length: segments }).map((_, i) => {
        const idx = horizontal ? i : segments - 1 - i
        const on = idx < lit
        const zone = idx / segments
        const color = zone > 0.85 ? "#FF4B3E" : zone > 0.65 ? "#FFC23D" : "#47E08A"
        return (
          <View key={i} style={[horizontal ? styles.segH : styles.segV, { backgroundColor: on ? color : "#1F242A" }]} />
        )
      })}
    </View>
  )
}

// ───────────────────────── LCD widgets ─────────────────────────

export function LcdTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.tab, on && styles.tabOn]}
          >
            {on ? <View style={styles.tabBar} /> : null}
            <Text style={[styles.tabLabel, on && styles.tabLabelOn]} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function LcdHeader({ title, right, children }: { title: string; right?: string; children?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerMid}>{children}</View>
      {right ? (
        <Text style={styles.headerRight} numberOfLines={1}>
          {right}
        </Text>
      ) : null}
    </View>
  )
}

/** Radio row of LCD buttons (the on-screen equivalent of a parameter list). */
export function Segmented({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly string[]
  value: number
  onChange: (i: number) => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.seg, style]} accessibilityRole="radiogroup">
      {options.map((o, i) => (
        <Pressable
          key={o}
          onPress={() => onChange(i)}
          accessibilityRole="radio"
          accessibilityState={{ checked: i === value }}
          style={[styles.segItem, i === value && styles.segItemOn, i > 0 && styles.segDivider]}
        >
          <Text style={[styles.segLabel, i === value && styles.segLabelOn]} numberOfLines={1}>
            {o}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

export function LcdToggle({
  label,
  on,
  onPress,
  style,
}: {
  label: string
  on: boolean
  onPress: () => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [styles.lcdToggle, on && styles.lcdToggleOn, pressed && { opacity: 0.85 }, style]}
    >
      <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <Text style={styles.lcdToggleLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

export function Stepper({
  label,
  value,
  onDec,
  onInc,
  style,
}: {
  label?: string
  value: string
  onDec: () => void
  onInc: () => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.stepper, style]}>
      {label ? (
        <Text style={styles.stepLabel} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      <View style={styles.stepRow}>
        <Pressable onPress={onDec} hitSlop={6} style={styles.stepBtn} accessibilityLabel={`${label ?? ""} down`}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue} numberOfLines={1}>
          {value}
        </Text>
        <Pressable onPress={onInc} hitSlop={6} style={styles.stepBtn} accessibilityLabel={`${label ?? ""} up`}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function LcdButton({
  label,
  onPress,
  primary,
  danger,
  style,
  disabled,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  danger?: boolean
  style?: StyleProp<ViewStyle>
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.lcdBtn,
        primary && styles.lcdBtnPrimary,
        danger && styles.lcdBtnDanger,
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[styles.lcdBtnLabel, primary && { color: Lcd.headerText }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

// ───────────────────────── Dialog ─────────────────────────

export type DialogField = {
  key: string
  label: string
  value: string
  multiline?: boolean
  numeric?: boolean
}

export function FormDialog({
  visible,
  title,
  fields,
  confirm = "OK",
  onCancel,
  onSubmit,
}: {
  visible: boolean
  title: string
  fields: DialogField[]
  confirm?: string
  onCancel: () => void
  onSubmit: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [openKey, setOpenKey] = useState("")
  const key = `${title}:${fields.map((f) => `${f.key}=${f.value}`).join("|")}`
  if (visible && key !== openKey) {
    setOpenKey(key)
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.value])))
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      supportedOrientations={["portrait", "landscape"]}
    >
      <View style={styles.dialogScrim}>
        <View style={styles.dialog}>
          <LcdHeader title={title} />
          <View style={styles.dialogBody}>
            {fields.map((f) => (
              <View key={f.key} style={styles.field}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <TextInput
                  value={values[f.key] ?? ""}
                  onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
                  style={[styles.input, f.multiline && styles.inputMulti]}
                  placeholderTextColor={Lcd.dim}
                  multiline={f.multiline}
                  keyboardType={f.numeric ? "numbers-and-punctuation" : "default"}
                  autoCorrect={false}
                  selectionColor={Lcd.tabOn}
                />
              </View>
            ))}
          </View>
          <View style={styles.dialogActions}>
            <LcdButton label="Cancel" onPress={onCancel} style={{ flex: 1 }} />
            <LcdButton label={confirm} primary onPress={() => onSubmit(values)} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  key: {
    flex: 1,
    minWidth: 40,
    minHeight: 44,
    borderRadius: 6,
    backgroundColor: Hw.key,
    borderWidth: 1,
    borderColor: Hw.keyHi,
    borderBottomColor: Hw.keyEdge,
    borderBottomWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingTop: 5,
    paddingBottom: 4,
    gap: 3,
  },
  keyCompact: { minHeight: 36, paddingTop: 3, gap: 2, borderRadius: 5 },
  keyStart: { backgroundColor: "#2D3238", borderColor: "#4A5058" },
  keyAccent: { backgroundColor: "#33302A", borderColor: "#55503F" },
  keyPressed: {
    backgroundColor: Hw.keyDown,
    borderBottomWidth: 1,
    marginTop: 2,
  },
  keyDisabled: { opacity: 0.4 },
  led: { width: 18, height: 4, borderRadius: 2 },
  ledCompact: { width: 14, height: 3 },
  keyLabel: {
    color: Hw.label,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  keyLabelCompact: { fontSize: 10, letterSpacing: 0.2 },
  keySub: {
    color: Hw.sub,
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 0.4,
  },

  group: { gap: 4 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  groupLine: { flex: 1, height: 1, backgroundColor: "#2B2F36" },
  groupTitle: {
    color: Hw.section,
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  groupRow: { flexDirection: "row", gap: 5, flexGrow: 1 },
  groupCol: { gap: 5, flexGrow: 1 },

  knobWrap: { alignItems: "center", gap: 1 },
  knobDot: { position: "absolute", width: 3, height: 3, borderRadius: 1.5 },
  knobBody: {
    position: "absolute",
    backgroundColor: "#2E3238",
    borderWidth: 1,
    borderColor: "#484D55",
    borderBottomColor: "#16181C",
    alignItems: "center",
    paddingTop: 3,
  },
  knobBodyLcd: {
    backgroundColor: Lcd.bgDeep,
    borderColor: Lcd.cell,
    borderBottomColor: Lcd.line,
  },
  knobMark: { width: 3, borderRadius: 1.5 },
  knobValue: {
    color: Hw.ledAmber,
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  knobLabel: {
    color: Hw.sub,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },

  fader: { flex: 1, width: 34, alignItems: "center", minHeight: 60 },
  faderSlot: {
    position: "absolute",
    width: 5,
    borderRadius: 3,
    backgroundColor: "#0A0C0E",
    borderWidth: 1,
    borderColor: Lcd.line,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  faderFill: { width: "100%" },
  faderUnity: {
    position: "absolute",
    left: 4,
    right: 4,
    height: 1,
    backgroundColor: Lcd.dim,
  },
  faderCap: {
    position: "absolute",
    width: 30,
    borderRadius: 4,
    backgroundColor: "#DADDE2",
    borderWidth: 1,
    borderColor: "#F4F6F8",
    borderBottomColor: "#80878F",
    borderBottomWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  faderCapLine: {
    width: 20,
    height: 2,
    backgroundColor: "#2A2F35",
    borderRadius: 1,
  },

  meterV: { width: 5, flex: 1, gap: 1.5, justifyContent: "flex-end" },
  meterH: { height: 5, flexDirection: "row", gap: 1.5 },
  segV: { flex: 1, borderRadius: 1 },
  segH: { flex: 1, borderRadius: 1 },

  header: {
    height: 28,
    backgroundColor: Lcd.header,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#A88A52",
  },
  headerTitle: {
    color: Lcd.headerText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  headerMid: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  headerRight: {
    color: Lcd.headerText,
    fontSize: 11.5,
    fontWeight: "800",
    maxWidth: "45%",
  },

  tabs: {
    height: 30,
    flexDirection: "row",
    backgroundColor: "#3A444E",
    borderTopWidth: 1,
    borderTopColor: Lcd.line,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  tabOn: { backgroundColor: Lcd.bgDeep },
  tabBar: {
    position: "absolute",
    top: 0,
    left: 8,
    right: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: Lcd.tabOn,
  },
  tabLabel: { color: Lcd.dim, fontSize: 10.5, fontWeight: "700" },
  tabLabelOn: { color: Lcd.text, fontWeight: "900" },

  seg: {
    flexDirection: "row",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
    overflow: "hidden",
    minHeight: 32,
  },
  segItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  segItemOn: { backgroundColor: Lcd.catOn },
  segDivider: { borderLeftWidth: 1, borderLeftColor: Lcd.line },
  segLabel: { color: Lcd.muted, fontSize: 11, fontWeight: "700" },
  segLabelOn: { color: "#0C2427", fontWeight: "900" },

  lcdToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  lcdToggleOn: { borderColor: Lcd.catOn },
  check: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: Lcd.dim,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: Lcd.catOn, borderColor: Lcd.catOn },
  checkMark: {
    color: "#0C2427",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 13,
  },
  lcdToggleLabel: {
    color: Lcd.text,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },

  stepper: { gap: 4 },
  stepLabel: {
    color: Lcd.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
    overflow: "hidden",
  },
  stepBtn: {
    width: 34,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Lcd.cell,
  },
  stepBtnText: { color: Lcd.text, fontSize: 18, fontWeight: "800" },
  stepValue: {
    flex: 1,
    minWidth: 40,
    textAlign: "center",
    color: Lcd.text,
    fontSize: 14,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },

  lcdBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: Lcd.cell,
    borderWidth: 1,
    borderColor: Lcd.line,
    borderBottomWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  lcdBtnPrimary: { backgroundColor: Lcd.tabOn, borderColor: "#B8962F" },
  lcdBtnDanger: { backgroundColor: "#7A3434", borderColor: "#5A2424" },
  lcdBtnLabel: {
    color: Lcd.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  dialogScrim: {
    flex: 1,
    backgroundColor: "#000000AA",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  dialog: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: Lcd.bg,
    borderWidth: 1,
    borderColor: "#2A3038",
  },
  dialogBody: { padding: 12, gap: 10 },
  field: { gap: 4 },
  fieldLabel: {
    color: Lcd.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  input: {
    minHeight: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
    color: Lcd.text,
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: "700",
  },
  inputMulti: { minHeight: 80, textAlignVertical: "top", paddingTop: 8 },
  dialogActions: { flexDirection: "row", gap: 8, padding: 12, paddingTop: 0 },
})

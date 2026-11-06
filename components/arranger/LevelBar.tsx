import { useRef } from "react"
import { StyleSheet, Text, View } from "react-native"

import { Pa } from "@/constants/theme"

type Props = {
  label: string
  value: number
  onChange: (value: number) => void
}

export function LevelBar({ label, value, onChange }: Props) {
  const width = useRef(1)
  const amount = Math.max(0, Math.min(1, value))

  const setFromX = (x: number) => {
    onChange(Math.max(0, Math.min(1, x / width.current)))
  }

  return (
    <View style={styles.wrap} accessibilityLabel={`${label} ${Math.round(amount * 100)} percent`}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={styles.track}
        onLayout={(event) => {
          width.current = Math.max(1, event.nativeEvent.layout.width)
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => setFromX(event.nativeEvent.locationX)}
        onResponderMove={(event) => setFromX(event.nativeEvent.locationX)}
      >
        <View style={[styles.fill, { width: `${amount * 100}%` }]} />
      </View>
      <Text style={styles.value}>{Math.round(amount * 100)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: {
    width: 44,
    color: Pa.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  track: {
    flex: 1,
    height: 28,
    borderRadius: 14,
    backgroundColor: Pa.bgRaised,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 14,
    backgroundColor: Pa.text,
  },
  value: {
    width: 36,
    color: Pa.dim,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
})

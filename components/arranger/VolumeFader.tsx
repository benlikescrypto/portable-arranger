import { useRef } from "react"
import { StyleSheet, Text, View } from "react-native"

import { Pa } from "@/constants/theme"

const MAX = 1.5

type Props = {
  label: string
  value: number
  onChange: (value: number) => void
}

export function VolumeFader({ label, value, onChange }: Props) {
  const height = useRef(1)
  const trackTop = useRef(0)
  // The track spans 0..MAX (the fill is drawn on that scale), so the cap stays under the finger.
  const setFromPageY = (pageY: number) => {
    const y = pageY - trackTop.current
    const next = (1 - y / height.current) * MAX
    onChange(Math.round(Math.max(0, Math.min(MAX, next)) * 100) / 100)
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.value}>{Math.round(value * 100)}</Text>
      <View
        style={styles.track}
        onLayout={(event) => {
          height.current = Math.max(1, event.nativeEvent.layout.height)
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // Keep the drag once it starts, so the horizontal pager can't take it mid-move.
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          // Children ignore touches, so locationY here is relative to the track.
          // Anchor to pageY so later moves can't jump if the touch target changes.
          trackTop.current = event.nativeEvent.pageY - event.nativeEvent.locationY
          setFromPageY(event.nativeEvent.pageY)
        }}
        onResponderMove={(event) => setFromPageY(event.nativeEvent.pageY)}
      >
        <View pointerEvents="none" style={[styles.fill, { height: `${Math.min(100, (value / MAX) * 100)}%` }]} />
        <View pointerEvents="none" style={[styles.cap, { bottom: `${Math.min(96, (value / MAX) * 100)}%` }]} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6, flex: 1 },
  value: { color: Pa.gold, fontSize: 12, fontWeight: "800" },
  track: {
    width: 44,
    flex: 1,
    minHeight: 120,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Pa.stroke,
    backgroundColor: "#101215",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  fill: { width: "100%", backgroundColor: Pa.orange },
  cap: {
    position: "absolute",
    left: 2,
    right: 2,
    height: 10,
    borderRadius: 2,
    backgroundColor: Pa.text,
  },
  label: { color: Pa.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textAlign: "center", lineHeight: 13 },
})

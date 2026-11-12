import { useRef, useState } from "react"
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
  const [trackH, setTrackH] = useState(0)
  const trackTop = useRef(0)
  // The cap centre travels from CAP_H/2 to height-CAP_H/2 over 0..MAX, so it stays under the finger.
  const setFromPageY = (pageY: number) => {
    const fromBottom = height.current - (pageY - trackTop.current) - CAP_H / 2
    const next = (fromBottom / Math.max(1, height.current - CAP_H)) * MAX
    onChange(Math.round(Math.max(0, Math.min(MAX, next)) * 100) / 100)
  }

  const pct = Math.max(0, Math.min(1, value / MAX))
  const travel = Math.max(0, trackH - CAP_H)

  return (
    <View style={styles.wrap}>
      <Text style={styles.value}>{Math.round(value * 100)}</Text>
      <View
        style={styles.track}
        onLayout={(event) => {
          height.current = Math.max(1, event.nativeEvent.layout.height)
          setTrackH(event.nativeEvent.layout.height)
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
        <View pointerEvents="none" style={styles.slot}>
          <View style={[styles.fill, { height: `${pct * 100}%` }]} />
        </View>
        {/* Unity (100) mark */}
        <View pointerEvents="none" style={[styles.unity, { bottom: CAP_H / 2 + travel / MAX }]} />
        <View pointerEvents="none" style={[styles.cap, { bottom: pct * travel }]}>
          <View style={styles.capLine} />
        </View>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const CAP_H = 30

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6, flex: 1 },
  value: { color: Pa.gold, fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  track: {
    width: 56,
    flex: 1,
    minHeight: 56,
    alignItems: "center",
  },
  slot: {
    position: "absolute",
    top: CAP_H / 2,
    bottom: CAP_H / 2,
    width: 6,
    borderRadius: 3,
    backgroundColor: "#050607",
    borderWidth: 1,
    borderColor: "#262B32",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  fill: { width: "100%", backgroundColor: Pa.orange },
  unity: { position: "absolute", left: 8, right: 8, height: 1, backgroundColor: "#3A414A" },
  cap: {
    position: "absolute",
    width: 44,
    height: CAP_H,
    borderRadius: 5,
    backgroundColor: "#D9DDE2",
    borderWidth: 1,
    borderColor: "#F4F6F8",
    borderBottomColor: "#8D949C",
    borderBottomWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  capLine: { width: 30, height: 2, borderRadius: 1, backgroundColor: "#2A2F35" },
  label: { color: Pa.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textAlign: "center", lineHeight: 13 },
})

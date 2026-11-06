import { StyleSheet, Text, View } from "react-native"

import { Pa } from "@/constants/theme"

export function Led({ on, color, label }: { on: boolean; color: string; label: string }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.pill, { backgroundColor: on ? color : "#2A2E34", borderColor: on ? color : Pa.stroke }]}>
        <View style={[styles.dot, { backgroundColor: on ? "#FFFFFFD9" : "#111214" }]} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  pill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: Pa.muted, fontSize: 9, fontWeight: "500", letterSpacing: 0.6 },
})

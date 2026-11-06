import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native"

import { Pa } from "@/constants/theme"

type Props = {
  label: string
  onPress: () => void
  active?: boolean
  booked?: boolean
  accent?: string
  style?: StyleProp<ViewStyle>
}

export function PaButton({ label, onPress, active, booked, accent = Pa.orange, style }: Props) {
  const backgroundColor = active ? accent : booked ? `${accent}59` : "#1A1D22"
  return (
    <Pressable
      onPress={onPress}
      style={[styles.btn, { backgroundColor, borderColor: active ? accent : Pa.stroke }, style]}
    >
      <Text style={[styles.label, { color: active ? Pa.bg : Pa.text }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textAlign: "center",
  },
})

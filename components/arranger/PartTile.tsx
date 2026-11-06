import { Pressable, StyleSheet, Text, View } from "react-native"

import { Pa } from "@/constants/theme"

type Props = {
  title: string
  name: string
  on: boolean
  selected: boolean
  accent: string
  onPress: () => void
  onToggle: () => void
}

export function PartTile({ title, name, on, selected, accent, onPress, onToggle }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tile,
        { borderColor: selected ? accent : Pa.stroke, backgroundColor: selected ? `${accent}29` : Pa.panelAlt },
      ]}
    >
      <Text onPress={onToggle} style={[styles.title, { color: on ? accent : Pa.muted }]}>
        {title}
        {on ? "" : "  OFF"}
      </Text>
      <Text style={[styles.name, { color: on ? Pa.text : Pa.muted }]} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  title: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  name: { fontSize: 15, fontWeight: "600", marginTop: 2 },
})

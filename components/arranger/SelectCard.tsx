import { Pressable, StyleSheet, Text, View } from "react-native"

import { Pa } from "@/constants/theme"

type Props = {
  kicker: string
  title: string
  subtitle?: string
  onPress: () => void
}

export function SelectCard({ kicker, title, subtitle, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${kicker}, ${title}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.sub} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : (
        <View style={styles.subSpacer} />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 120,
    backgroundColor: Pa.panel,
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 22,
    justifyContent: "center",
  },
  pressed: { opacity: 0.86 },
  kicker: {
    color: Pa.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  title: {
    color: Pa.text,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.6,
    marginTop: 8,
  },
  sub: { color: Pa.dim, fontSize: 15, marginTop: 6 },
  subSpacer: { height: 21 },
})

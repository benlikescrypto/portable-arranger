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
    minHeight: 84,
    backgroundColor: Pa.panel,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  kicker: {
    color: Pa.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: {
    color: Pa.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: 6,
  },
  sub: { color: Pa.dim, fontSize: 14, marginTop: 4 },
  subSpacer: { height: 18 },
})

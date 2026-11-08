import { StyleSheet, View } from "react-native"

import { Lcd } from "@/constants/theme"

export function KeyboardIcon({ width = 34, height = 16 }: { width?: number; height?: number }) {
  const whites = 7
  const keyW = width / whites
  return (
    <View style={{ width, height }}>
      <View style={styles.keysRow}>
        {Array.from({ length: whites }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.whiteKey,
              {
                width: keyW - 1,
                height,
                borderColor: Lcd.text,
              },
            ]}
          />
        ))}
      </View>
      {[0.55, 1.55, 3.55, 4.55, 5.55].map((slot) => (
        <View
          key={slot}
          style={[
            styles.blackKey,
            {
              left: slot * keyW,
              width: keyW * 0.55,
              height: height * 0.58,
              backgroundColor: Lcd.text,
            },
          ]}
        />
      ))}
    </View>
  )
}

export function PianoIcon() {
  return (
    <View style={styles.glyph}>
      <View style={styles.pianoLid} />
      <KeyboardIcon width={22} height={10} />
    </View>
  )
}

export function PadIcon() {
  return (
    <View style={styles.glyph}>
      <View style={styles.padGrid}>
        {Array.from({ length: 9 }).map((_, i) => (
          <View key={i} style={styles.padDot} />
        ))}
      </View>
    </View>
  )
}

export function StringsIcon() {
  return (
    <View style={styles.glyph}>
      <View style={styles.violinBody} />
      <View style={styles.violinNeck} />
    </View>
  )
}

const styles = StyleSheet.create({
  keysRow: { flexDirection: "row", height: "100%" },
  whiteKey: {
    borderWidth: 1,
    borderRadius: 1,
    marginRight: 1,
    backgroundColor: "transparent",
  },
  blackKey: {
    position: "absolute",
    top: 0,
    borderRadius: 1,
  },
  glyph: { width: 28, height: 22, alignItems: "center", justifyContent: "center" },
  pianoLid: {
    width: 20,
    height: 8,
    borderWidth: 1.5,
    borderColor: Lcd.text,
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 2,
    marginBottom: 1,
  },
  padGrid: {
    width: 20,
    height: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  },
  padDot: {
    width: 5,
    height: 5,
    borderRadius: 1,
    backgroundColor: Lcd.text,
  },
  violinBody: {
    width: 14,
    height: 16,
    borderWidth: 1.5,
    borderColor: Lcd.text,
    borderRadius: 8,
  },
  violinNeck: {
    position: "absolute",
    top: 0,
    width: 3,
    height: 10,
    backgroundColor: Lcd.text,
    borderRadius: 1,
  },
})

import { useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { noteName, Pa } from "@/constants/theme"

const BLACK = new Set([1, 3, 6, 8, 10])

type Props = {
  onNoteOn: (note: number) => void
  onNoteOff: (note: number) => void
  startNote?: number
  octaves?: number
}

export function MiniKeyboard({ onNoteOn, onNoteOff, startNote = 60, octaves = 2 }: Props) {
  const [held, setHeld] = useState<number[]>([])
  const { whites, blacks } = useMemo(() => buildKeys(startNote, octaves), [octaves, startNote])
  const whiteW = 100 / Math.max(1, whites.length)
  const blackW = whiteW * 0.62

  const down = (note: number) => {
    setHeld((cur) => (cur.includes(note) ? cur : [...cur, note]))
    onNoteOn(note)
  }
  const up = (note: number) => {
    setHeld((cur) => cur.filter((n) => n !== note))
    onNoteOff(note)
  }

  return (
    <View
      style={styles.wrap}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
    >
      <View style={styles.row}>
        {whites.map((note) => {
          const on = held.includes(note)
          const label = note % 12 === 0 ? noteName(note) : ""
          return (
            <Pressable
              key={note}
              onPressIn={() => down(note)}
              onPressOut={() => up(note)}
              accessibilityRole="button"
              accessibilityLabel={noteName(note)}
              style={[styles.white, on && styles.whiteOn]}
            >
              {label ? <Text style={styles.whiteLabel}>{label}</Text> : null}
            </Pressable>
          )
        })}
        {blacks.map(({ note, afterWhite }) => {
          const on = held.includes(note)
          return (
            <Pressable
              key={note}
              onPressIn={() => down(note)}
              onPressOut={() => up(note)}
              accessibilityRole="button"
              accessibilityLabel={noteName(note)}
              style={[
                styles.black,
                on && styles.blackOn,
                {
                  width: `${blackW}%`,
                  left: `${(afterWhite + 1) * whiteW - blackW / 2}%`,
                },
              ]}
            />
          )
        })}
      </View>
    </View>
  )
}

function buildKeys(startNote: number, octaves: number) {
  const end = startNote + octaves * 12
  const whites: number[] = []
  const blacks: { note: number; afterWhite: number }[] = []
  for (let note = startNote; note <= end; note++) {
    if (BLACK.has(note % 12)) continue
    whites.push(note)
    const sharp = note + 1
    if (sharp <= end && BLACK.has(sharp % 12)) blacks.push({ note: sharp, afterWhite: whites.length - 1 })
  }
  return { whites, blacks }
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
    marginTop: 28,
    paddingHorizontal: 4,
  },
  row: {
    height: 108,
    flexDirection: "row",
    position: "relative",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#D8DDE3",
  },
  white: {
    flex: 1,
    backgroundColor: "#F4F6F8",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#B7BEC6",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 8,
  },
  whiteOn: { backgroundColor: Pa.gold },
  whiteLabel: {
    color: "#5A6169",
    fontSize: 10,
    fontWeight: "700",
  },
  black: {
    position: "absolute",
    top: 0,
    height: "58%",
    backgroundColor: "#121417",
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    zIndex: 2,
  },
  blackOn: { backgroundColor: Pa.orange },
})

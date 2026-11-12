import { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"

import { NativeKeyboardView } from "arrangerbox-audio"

import { noteName, Pa } from "@/constants/theme"

const BLACK = new Set([1, 3, 6, 8, 10])

type Props = {
  onNoteOn: (note: number) => void
  onNoteOff: (note: number) => void
  startNote?: number
  octaves?: number
  style?: StyleProp<ViewStyle>
}

/**
 * On a native build the keyboard is a native view: touches reach the C++ engine
 * directly (no JS round trip), several fingers play chords and sliding plays each
 * key. The JS keyboard below is the fallback for web and older native builds.
 */
export function MiniKeyboard(props: Props) {
  if (NativeKeyboardView) {
    return (
      <NativeKeyboardView
        style={[styles.wrap, styles.native, props.style]}
        startNote={props.startNote ?? 60}
        octaves={props.octaves ?? 2}
        channel={0}
      />
    )
  }
  return <JsMiniKeyboard {...props} />
}

function JsMiniKeyboard({ onNoteOn, onNoteOff, startNote = 60, octaves = 2, style }: Props) {
  const heldRef = useRef<Set<number>>(new Set())
  const [held, setHeld] = useState<number[]>([])
  const onNoteOnRef = useRef(onNoteOn)
  const onNoteOffRef = useRef(onNoteOff)
  onNoteOnRef.current = onNoteOn
  onNoteOffRef.current = onNoteOff
  const { whites, blacks } = useMemo(() => buildKeys(startNote, octaves), [octaves, startNote])
  const whiteW = 100 / Math.max(1, whites.length)
  const blackW = whiteW * 0.62

  const sync = () => setHeld([...heldRef.current])
  const down = (note: number) => {
    if (heldRef.current.has(note)) return
    heldRef.current.add(note)
    sync()
    onNoteOnRef.current(note)
  }
  const up = (note: number) => {
    if (!heldRef.current.has(note)) return
    heldRef.current.delete(note)
    sync()
    onNoteOffRef.current(note)
  }
  const allUp = () => {
    const notes = [...heldRef.current]
    if (!notes.length) return
    heldRef.current.clear()
    sync()
    for (const note of notes) onNoteOffRef.current(note)
  }

  useEffect(
    () => () => {
      const notes = [...heldRef.current]
      heldRef.current.clear()
      for (const note of notes) onNoteOffRef.current(note)
    },
    []
  )

  return (
    <View style={[styles.wrap, style]} onResponderTerminate={allUp}>
      <View style={styles.row}>
        {whites.map((note) => {
          const on = held.includes(note)
          const label = note % 12 === 0 ? noteName(note) : ""
          return (
            <Pressable
              key={note}
              onPressIn={() => down(note)}
              onPressOut={() => up(note)}
              onTouchEnd={() => up(note)}
              onTouchCancel={() => up(note)}
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
              onTouchEnd={() => up(note)}
              onTouchCancel={() => up(note)}
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
    minHeight: 84,
  },
  native: { flex: 1 },
  row: {
    flex: 1,
    flexDirection: "row",
    position: "relative",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#0E1013",
    borderWidth: 1,
    borderColor: "#2A3038",
  },
  white: {
    flex: 1,
    backgroundColor: "#F2F4F7",
    borderRightWidth: 2,
    borderRightColor: "#0E1013",
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 8,
  },
  whiteOn: { backgroundColor: "#FFD48A" },
  whiteLabel: {
    color: "#8A929C",
    fontSize: 10,
    fontWeight: "700",
  },
  black: {
    position: "absolute",
    top: 0,
    height: "60%",
    backgroundColor: "#16191D",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: "#000",
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    zIndex: 2,
  },
  blackOn: { backgroundColor: Pa.orange },
})

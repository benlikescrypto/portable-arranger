import { useMemo, useRef } from "react"
import { LayoutChangeEvent, PanResponder, StyleSheet, View } from "react-native"

import { Pa } from "@/constants/theme"

const WHITE = [0, 2, 4, 5, 7, 9, 11]
const isBlack = (pc: number) => pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10

type Props = {
  startNote?: number
  endNote?: number
  onNoteOn: (note: number, vel: number) => void
  onNoteOff: (note: number) => void
}

export function OnscreenKeyboard({ startNote = 36, endNote = 96, onNoteOn, onNoteOff }: Props) {
  const size = useRef({ w: 1, h: 1 })
  const held = useRef<number | null>(null)

  const whites = useMemo(() => {
    const notes: number[] = []
    for (let n = startNote; n <= endNote; n++) if (!isBlack(n % 12)) notes.push(n)
    return notes
  }, [endNote, startNote])

  const noteAt = (x: number, y: number) => {
    const { w, h } = size.current
    const whiteW = w / Math.max(whites.length, 1)
    const blackW = whiteW * 0.62
    if (y < h * 0.58) {
      whites.forEach((n, i) => {
        const pc = n % 12
        if (pc !== 4 && pc !== 11 && n + 1 <= endNote) {
          const bx = i * whiteW + whiteW - blackW / 2
          if (x >= bx && x <= bx + blackW) return
        }
      })
      for (let i = 0; i < whites.length; i++) {
        const n = whites[i]
        const pc = n % 12
        if (pc !== 4 && pc !== 11 && n + 1 <= endNote) {
          const bx = i * whiteW + whiteW - blackW / 2
          if (x >= bx && x <= bx + blackW) {
            const vel = Math.max(1, Math.min(127, Math.round((1 - y / h) * 126 + 1)))
            return { note: n + 1, vel }
          }
        }
      }
    }
    const idx = Math.max(0, Math.min(whites.length - 1, Math.floor(x / whiteW)))
    const vel = Math.max(1, Math.min(127, Math.round((1 - Math.max(0, Math.min(1, y / h))) * 126 + 1)))
    return { note: whites[idx], vel }
  }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const hit = noteAt(e.nativeEvent.locationX, e.nativeEvent.locationY)
          held.current = hit.note
          onNoteOn(hit.note, hit.vel)
        },
        onPanResponderMove: (e) => {
          const hit = noteAt(e.nativeEvent.locationX, e.nativeEvent.locationY)
          if (held.current != null && held.current !== hit.note) {
            onNoteOff(held.current)
            onNoteOn(hit.note, hit.vel)
            held.current = hit.note
          }
        },
        onPanResponderRelease: () => {
          if (held.current != null) onNoteOff(held.current)
          held.current = null
        },
        onPanResponderTerminate: () => {
          if (held.current != null) onNoteOff(held.current)
          held.current = null
        },
      }),
    [endNote, onNoteOff, onNoteOn, whites]
  )

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }
  }

  return (
    <View style={styles.wrap} onLayout={onLayout} {...responder.panHandlers}>
      <View style={styles.row}>
        {whites.map((n) => (
          <View key={n} style={styles.white} />
        ))}
      </View>
      {whites.map((n, i) => {
        const pc = n % 12
        if (pc === 4 || pc === 11 || n + 1 > endNote) return null
        const leftPct = ((i + 1) / whites.length) * 100
        return <View key={`b${n}`} pointerEvents="none" style={[styles.black, { left: `${leftPct}%` }]} />
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    height: 118,
    borderRadius: 8,
    backgroundColor: Pa.keyBlack,
    overflow: "hidden",
  },
  row: { flex: 1, flexDirection: "row" },
  white: {
    flex: 1,
    backgroundColor: Pa.keyWhite,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: Pa.stroke,
    marginBottom: 0,
  },
  black: {
    position: "absolute",
    top: 0,
    width: 18,
    height: "58%",
    marginLeft: -9,
    backgroundColor: Pa.keyBlack,
    borderRadius: 2,
  },
})

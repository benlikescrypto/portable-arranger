import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { LcdButton } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import { noteAt, type AiLearn, type LearnDoc } from "@/hooks/useAiLearn"
import { onTelemetry, telemetryNow } from "@/lib/telemetry"

/**
 * AI Notes: the note the chosen stem is playing right now (A#, F, …), large, changing as the
 * song plays. The notes are read on this device with SwiftF0 as soon as a stem is picked.
 */

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
/** Between notes the last one stays up (dimmed) for this long, so the name does not blink. */
const REST_HOLD_S = 1.2

function pitchName(midi: number) {
  return SHARPS[((midi % 12) + 12) % 12]
}

export function LearnPanel({ learn, colors }: { learn: AiLearn; colors: Record<string, string> }) {
  const { doc, song } = learn
  if (!song) return null
  const color = colors[learn.stem ?? ""] ?? Lcd.tabOn
  const stemLabel = learn.stems.find((t) => t.key === learn.stem)?.label ?? "stem"
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Notes</Text>
      {!learn.available ? (
        <Text style={[styles.hint, { color: "#FFE2B0" }]}>This app build cannot read notes yet. Install the new build.</Text>
      ) : (
        <Text style={styles.hint}>Play the song to see the note being played. Pick which part to follow:</Text>
      )}
      <View style={styles.wrapRow}>
        {learn.stems.map((t) => (
          <LcdButton key={t.key} label={t.label} primary={learn.stem === t.key} onPress={() => learn.setStem(t.key)} />
        ))}
      </View>
      {learn.status === "finding" ? (
        <View style={styles.box}>
          <Text style={styles.wait}>{`Reading the ${stemLabel.toLowerCase()} notes…`}</Text>
        </View>
      ) : learn.status === "error" ? (
        <View style={[styles.box, { gap: 8 }]}>
          <Text style={[styles.hint, { color: "#FFD3D3", textAlign: "center" }]}>{learn.error}</Text>
          <LcdButton label="Try again" onPress={learn.retry} />
        </View>
      ) : doc && doc.notes.length === 0 ? (
        <View style={styles.box}>
          <Text style={[styles.hint, { textAlign: "center" }]}>{`No notes found in the ${stemLabel.toLowerCase()}. Try another part.`}</Text>
        </View>
      ) : doc ? (
        <NowNote doc={doc} color={color} />
      ) : null}
    </View>
  )
}

/** What to show at `pos`: "<midi>|on" while a note sounds, "<midi>|rest" just after, or "". */
function shownAt(doc: LearnDoc, pos: number) {
  const i = noteAt(doc.notes, pos)
  if (i < 0) return ""
  const n = doc.notes[i]
  if (pos < n.e) return `${n.midi}|on`
  if (pos < n.e + REST_HOLD_S) return `${n.midi}|rest`
  return ""
}

/**
 * The note under the play position, checked every display frame (~16 ms). The engine's
 * position is read ~30 times a second, so while the song plays it is carried forward by the
 * time since that read; the name then changes within a frame of the note. Re-renders only
 * when the shown note changes.
 */
function NowNote({ doc, color }: { doc: LearnDoc; color: string }) {
  const [shown, setShown] = useState(() => shownAt(doc, telemetryNow().stemPos))
  useEffect(() => {
    const unsubscribe = onTelemetry(() => {}) // keeps the engine read-back running
    let last = ""
    let raf = 0
    const tick = () => {
      const t = telemetryNow()
      const ahead = t.stemPlaying && t.at > 0 ? Math.min(0.1, (performance.now() - t.at) / 1000) : 0
      const next = shownAt(doc, t.stemPos + ahead)
      if (next !== last) {
        last = next
        setShown(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      unsubscribe()
    }
  }, [doc])
  const [midi, state] = shown.split("|")
  return (
    <View style={styles.box}>
      <Text
        style={[styles.note, { color: shown ? color : Lcd.dim, opacity: state === "rest" ? 0.4 : 1 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {shown ? pitchName(Number(midi)) : "–"}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8, padding: 10, borderRadius: 8, backgroundColor: Lcd.bgDeep, borderWidth: 1, borderColor: Lcd.line },
  sectionTitle: { color: Lcd.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  hint: { color: Lcd.muted, fontSize: 11.5, fontWeight: "600", lineHeight: 16 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  box: {
    minHeight: 120,
    borderRadius: 8,
    backgroundColor: "#2E363E",
    borderWidth: 1,
    borderColor: Lcd.line,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  note: { fontSize: 88, fontWeight: "900", letterSpacing: 1 },
  wait: { color: Lcd.muted, fontSize: 14, fontWeight: "700" },
})

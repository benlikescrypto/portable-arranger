import { audio } from "arrangerbox-audio"
import { memo, useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { buildKeys, MiniKeyboard } from "@/components/arranger/MiniKeyboard"
import { LcdButton } from "@/components/pro/ui"
import { Lcd, noteName } from "@/constants/theme"
import { noteAt, type AiLearn, type LearnDoc, type LearnNote } from "@/hooks/useAiLearn"
import type { AiSongs } from "@/hooks/useAiSongs"
import { useTelemetry } from "@/lib/telemetry"

/**
 * AI Learn: the notes of one stem (found on this device with SwiftF0) scroll past a play
 * line in time with the stem player. The strip over the keyboard shows the key to play now
 * and the next one; what you play on the keyboard (here, the play slide or a MIDI keyboard)
 * is checked against the song.
 */

const PAST_S = 1.5
const AHEAD_S = 6
const PAGE_S = 4
const ROLL_H = 170
const BLACK = new Set([1, 3, 6, 8, 10])

export function LearnPanel({ ai, learn, colors }: { ai: AiSongs; learn: AiLearn; colors: Record<string, string> }) {
  const { doc, song } = learn
  if (!song) return null
  const color = colors[learn.stem ?? ""] ?? Lcd.tabOn
  const muted = learn.stemIndex > 0 && ai.player.mode === "stems" && ai.player.solo == null && !!ai.player.muted[learn.stemIndex]
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Learn the notes</Text>
      {!learn.available ? (
        <Text style={[styles.hint, { color: "#FFE2B0" }]}>This app build has no note finder yet. Install the new build to learn songs.</Text>
      ) : (
        <Text style={styles.hint}>
          SwiftF0 finds the notes of a stem on this device. Play the song and follow along on the keyboard: the strip shows the key to play now
          and the next one. It follows one voice at a time, so vocals, bass and lead lines work best.
        </Text>
      )}
      <View style={styles.wrapRow}>
        {learn.stems.map((t) => (
          <LcdButton
            key={t.key}
            label={t.label}
            primary={learn.stem === t.key}
            disabled={learn.status === "finding"}
            onPress={() => learn.setStem(t.key)}
          />
        ))}
      </View>
      {learn.status === "error" ? <Text style={[styles.value, { color: "#FFD3D3" }]}>{learn.error}</Text> : null}
      {!doc ? (
        <View style={styles.row}>
          <LcdButton
            label={learn.status === "finding" ? "Finding notes…" : "Find notes"}
            primary
            disabled={!learn.available || !learn.stem || learn.status === "finding"}
            onPress={() => void learn.find()}
            style={styles.flex}
          />
          <Text style={[styles.small, styles.flex]}>
            {learn.status === "finding" ? "Reading the stem on this device. A few seconds for a song." : "Runs on this device; nothing is uploaded."}
          </Text>
        </View>
      ) : !doc.notes.some((n) => n.target) ? (
        <View style={styles.row}>
          <Text style={[styles.hint, styles.flex]}>No notes in this stem: it is silent or has no clear pitch. Try another stem.</Text>
          <LcdButton label="Find again" disabled={learn.status === "finding"} onPress={() => void learn.find()} />
        </View>
      ) : (
        <>
          <Roll doc={doc} hits={learn.hits} color={color} waiting={learn.waiting} />
          <Guide doc={doc} learn={learn} color={color} />
          <Score doc={doc} learn={learn} />
          <View style={styles.wrapRow}>
            <LcdButton label={learn.wait ? "● Wait for me" : "Wait for me"} primary={learn.wait} onPress={learn.toggleWait} />
            <LcdButton label={learn.anyOctave ? "● Any octave" : "Any octave"} primary={learn.anyOctave} onPress={learn.toggleAnyOctave} />
            {learn.stemIndex > 0 ? (
              <LcdButton label={muted ? "● Stem muted" : "Mute this stem"} danger={muted} onPress={() => ai.toggleMute(learn.stemIndex)} />
            ) : null}
            <LcdButton label="Reset score" onPress={learn.resetScore} />
            <LcdButton label="Find again" disabled={learn.status === "finding"} onPress={() => void learn.find()} />
          </View>
          <Text style={styles.small}>
            {`SwiftF0 · ${doc.notes.filter((n) => n.target).length} notes in ${song.manifest.stems?.find((t) => t.key === doc.stem)?.label ?? doc.stem} · ${noteName(
              doc.lo
            )}–${noteName(doc.hi)}. Wait for me stops the song at each note until you play it; Play skips it. Any octave accepts the right note in any octave.`}
          </Text>
        </>
      )}
    </View>
  )
}

/** The scrolling notes. The notes are laid out once per 4 s page; only the layer moves. */
function Roll({ doc, hits, color, waiting }: { doc: LearnDoc; hits: ReadonlySet<number>; color: string; waiting: number | null }) {
  const [w, setW] = useState(0)
  const pos = useTelemetry((t) => t.stemPos)
  const span = PAST_S + AHEAD_S
  const pps = w > 0 ? w / span : 0
  const page = Math.floor(pos / PAGE_S)
  const base = page * PAGE_S - PAST_S - 1
  const playX = PAST_S * pps
  const rows = doc.hi - doc.lo + 3
  const rowH = ROLL_H / rows
  return (
    <View style={styles.roll} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Rows lo={doc.lo - 1} rows={rows} rowH={rowH} />
      {pps > 0 ? (
        <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: playX + (base - pos) * pps }] }]} pointerEvents="none">
          <Layer doc={doc} base={base} pps={pps} lo={doc.lo - 1} rowH={rowH} hits={hits} color={color} waiting={waiting} />
        </View>
      ) : null}
      <View style={[styles.playLine, { left: playX }]} pointerEvents="none" />
      <Labels lo={doc.lo - 1} rows={rows} rowH={rowH} />
    </View>
  )
}

const Rows = memo(function Rows({ lo, rows, rowH }: { lo: number; rows: number; rowH: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => {
        const note = lo + i
        return (
          <View
            key={note}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: i * rowH,
              height: rowH,
              backgroundColor: BLACK.has(((note % 12) + 12) % 12) ? "rgba(0,0,0,0.16)" : "transparent",
              borderBottomWidth: note % 12 === 0 ? StyleSheet.hairlineWidth : 0,
              borderColor: "rgba(255,255,255,0.25)",
            }}
          />
        )
      })}
    </>
  )
})

const Labels = memo(function Labels({ lo, rows, rowH }: { lo: number; rows: number; rowH: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => lo + i)
        .filter((n) => n % 12 === 0)
        .map((n) => (
          <Text key={n} style={[styles.rowLabel, { bottom: (n - lo) * rowH - 1 }]} pointerEvents="none">
            {noteName(n)}
          </Text>
        ))}
    </>
  )
})

const Layer = memo(function Layer({
  doc,
  base,
  pps,
  lo,
  rowH,
  hits,
  color,
  waiting,
}: {
  doc: LearnDoc
  base: number
  pps: number
  lo: number
  rowH: number
  hits: ReadonlySet<number>
  color: string
  waiting: number | null
}) {
  const end = base + PAGE_S + PAST_S + AHEAD_S + 2
  const first = Math.max(0, noteAt(doc.notes, base - 4))
  const out: React.ReactNode[] = []
  for (let i = first; i < doc.notes.length; i++) {
    const n = doc.notes[i]
    if (n.s > end) break
    if (n.e < base) continue
    const hit = hits.has(i)
    out.push(
      <View
        key={i}
        style={{
          position: "absolute",
          left: (n.s - base) * pps,
          width: Math.max(2, (n.e - n.s) * pps - 1),
          bottom: (n.midi - lo) * rowH + 1,
          height: Math.max(3, rowH - 2),
          borderRadius: 3,
          backgroundColor: hit ? Lcd.green : color,
          opacity: n.target ? 1 : 0.45,
          borderWidth: waiting === i ? 2 : 0,
          borderColor: Lcd.text,
        }}
      />
    )
  }
  // SwiftF0's pitch line: bends, slides and vibrato the notes round off.
  const hop = doc.hop || 0.016
  const step = 3
  const from = Math.max(0, Math.floor(base / hop))
  const to = Math.min(doc.line.length, Math.ceil(end / hop))
  for (let f = from - (from % step); f < to; f += step) {
    const c = doc.line[f]
    if (!c) continue
    out.push(
      <View
        key={`p${f}`}
        style={{
          position: "absolute",
          left: (f * hop - base) * pps - 1,
          bottom: (c / 100 - lo) * rowH + rowH / 2 - 1,
          width: 2,
          height: 2,
          borderRadius: 1,
          backgroundColor: "rgba(255,255,255,0.85)",
        }}
      />
    )
  }
  return <>{out}</>
})

/** Keyboard range: whole octaves from the C at or below the lowest note, 2 to 4 of them. */
function keyRange(doc: LearnDoc) {
  const start = Math.floor(doc.lo / 12) * 12
  const octaves = Math.max(2, Math.min(4, Math.ceil((doc.hi + 1 - start) / 12)))
  return { start, octaves }
}

/** Where a note sits on the keyboard (folded by octaves into its range), as a fraction of the width. */
function keyX(note: number, start: number, octaves: number) {
  const end = start + octaves * 12
  let n = note
  while (n < start) n += 12
  while (n > end) n -= 12
  const { whites, blacks } = buildKeys(start, octaves)
  const ww = 1 / whites.length
  const wi = whites.indexOf(n)
  if (wi >= 0) return { x: (wi + 0.5) * ww, black: false, folded: n !== note }
  const b = blacks.find((k) => k.note === n)
  return { x: b ? (b.afterWhite + 1) * ww : 0.5, black: true, folded: n !== note }
}

function Guide({ doc, learn, color }: { doc: LearnDoc; learn: AiLearn; color: string }) {
  const { start, octaves } = keyRange(doc)
  // The note to play now (sounding, or starting within 0.25 s) and the next one.
  const at = useTelemetry((t) => {
    if (learn.waiting != null) return `${learn.waiting}`
    let i = noteAt(doc.notes, t.stemPos + 0.25)
    while (i >= 0 && !doc.notes[i].target) i--
    if (i >= 0 && doc.notes[i].e < t.stemPos) i = -1
    return `${i}`
  })
  const nowI = Number(at)
  // The next note to play after the current one (or after the play line when nothing sounds).
  const nextI = useTelemetry((t) => {
    const from = nowI >= 0 ? nowI + 1 : Math.max(0, noteAt(doc.notes, t.stemPos) + 1)
    for (let i = from; i < doc.notes.length; i++) if (doc.notes[i].target) return i
    return -1
  })
  const now = nowI >= 0 ? doc.notes[nowI] : null
  const next = nextI >= 0 ? doc.notes[nextI] : null
  const [flash, setFlash] = useState(learn.lastPress)
  useEffect(() => {
    setFlash(learn.lastPress)
    if (!learn.lastPress) return
    const id = setTimeout(() => setFlash(null), 450)
    return () => clearTimeout(id)
  }, [learn.lastPress])

  return (
    <View style={{ gap: 4 }}>
      <View style={styles.row}>
        <Text style={[styles.value, styles.flex]} numberOfLines={1}>
          {now ? `Play ${label(now)}` : next ? `Next: ${label(next)}` : "—"}
          {now && next ? <Text style={styles.small}>{`   then ${label(next)}`}</Text> : null}
        </Text>
        {learn.waiting != null ? <Text style={[styles.small, { color: Lcd.tabOn }]}>Waiting for you</Text> : null}
      </View>
      <View style={styles.lane}>
        {next ? <Marker note={next} start={start} octaves={octaves} color={color} hollow /> : null}
        {now ? <Marker note={now} start={start} octaves={octaves} color={color} /> : null}
        {flash ? <PressDot note={flash.note} ok={flash.ok} start={start} octaves={octaves} /> : null}
      </View>
      <MiniKeyboard
        onNoteOn={(n) => audio.noteOn(0, n, 100)}
        onNoteOff={(n) => audio.noteOff(0, n)}
        startNote={start}
        octaves={octaves}
        style={styles.keys}
      />
    </View>
  )
}

function label(n: LearnNote) {
  const off = Math.abs(n.cents) >= 25 ? (n.cents > 0 ? " (sung sharp)" : " (sung flat)") : ""
  return `${noteName(n.midi)}${off}`
}

function Marker({ note, start, octaves, color, hollow }: { note: LearnNote; start: number; octaves: number; color: string; hollow?: boolean }) {
  const k = keyX(note.midi, start, octaves)
  return (
    <View
      style={[
        styles.marker,
        { left: `${k.x * 100}%`, borderColor: color },
        hollow ? { backgroundColor: "transparent" } : { backgroundColor: color },
        k.black && { top: 0 },
      ]}
    >
      <Text style={[styles.markerText, hollow && { color }]} numberOfLines={1}>
        {noteName(note.midi)}
      </Text>
    </View>
  )
}

function PressDot({ note, ok, start, octaves }: { note: number; ok: boolean; start: number; octaves: number }) {
  const k = keyX(note, start, octaves)
  return <View style={[styles.press, { left: `${k.x * 100}%`, backgroundColor: ok ? Lcd.green : Lcd.red }]} />
}

function Score({ doc, learn }: { doc: LearnDoc; learn: AiLearn }) {
  // Notes already past the play line, counted four times a second.
  const quarter = useTelemetry((t) => Math.floor(t.stemPos * 4))
  const passed = useMemo(() => {
    const pos = quarter / 4
    let n = 0
    let missed = 0
    for (let i = 0; i < doc.notes.length; i++) {
      const x = doc.notes[i]
      if (x.s > pos) break
      if (!x.target) continue
      n++
      if (x.e + 0.12 < pos && !learn.hits.has(i)) missed++
    }
    return { n, missed }
  }, [doc, learn.hits, quarter])
  const hit = learn.hits.size
  const pct = passed.n > 0 ? Math.round((100 * hit) / Math.max(hit, passed.n)) : 0
  return (
    <Text style={styles.small}>
      {`Hit ${hit} · Missed ${passed.missed} · Wrong keys ${learn.wrong}${passed.n ? ` · ${pct}% so far` : ""}`}
    </Text>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8, padding: 10, borderRadius: 8, backgroundColor: Lcd.bgDeep, borderWidth: 1, borderColor: Lcd.line },
  sectionTitle: { color: Lcd.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  hint: { color: Lcd.muted, fontSize: 11.5, fontWeight: "600", lineHeight: 16 },
  small: { color: Lcd.dim, fontSize: 10.5, fontWeight: "700" },
  value: { color: Lcd.text, fontSize: 12.5, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  flex: { flex: 1 },
  roll: { height: ROLL_H, borderRadius: 6, backgroundColor: "#3A434C", overflow: "hidden", borderWidth: 1, borderColor: Lcd.line },
  playLine: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: Lcd.tabOn },
  rowLabel: { position: "absolute", left: 3, color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: "800" },
  lane: { height: 22, position: "relative" },
  marker: {
    position: "absolute",
    top: 1,
    height: 20,
    minWidth: 30,
    marginLeft: -15,
    paddingHorizontal: 3,
    borderRadius: 5,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  markerText: { color: Lcd.headerText, fontSize: 10, fontWeight: "900" },
  press: { position: "absolute", top: 7, width: 8, height: 8, marginLeft: -4, borderRadius: 4 },
  keys: { height: 96 },
})

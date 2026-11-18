import { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { LcdButton } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import { MAX_STRETCH, MIN_STRETCH, type AiNotes } from "@/hooks/useAiNotes"
import type { AiSongs } from "@/hooks/useAiSongs"
import type { AiNote, AiNotesDoc } from "@/lib/ai/client"
import { useTelemetry } from "@/lib/telemetry"

/**
 * AI step 2a: pick a stretch of one stem, find its notes, and check every start.
 * Green = exact (proven to the sample), amber = close (an estimate), blue = a swell.
 */

const EXACT = "#6FD9A8"
const CLOSE = "#F2B35B"
const SWELL = "#7FB4FF"

const noteColor = (n: AiNote) => (n.exact ? EXACT : n.sharp ? CLOSE : SWELL)

function fmtClock(s: number, decimals = 2) {
  const t = Math.max(0, s)
  const m = Math.floor(t / 60)
  const sec = t - m * 60
  return `${m}:${sec.toFixed(decimals).padStart(decimals + 3, "0")}`
}

function fmtMs(s: number) {
  const ms = s * 1000
  const whole = Math.floor(Math.abs(ms))
  const frac = (Math.abs(ms) - whole).toFixed(3).slice(1)
  return `${ms < 0 ? "−" : ""}${whole.toLocaleString("en-US").replace(/,/g, " ")}${frac} ms`
}

/** Why a note's start is not marked exact, in a few words. */
function whyNotExact(n: AiNote, mp3: boolean) {
  if (mp3) return "read from an MP3 (its attacks are smeared)"
  if (n.crowded) return "another note starts within 25 ms"
  if (!n.sharp) return "a swell: it fades in, so its first sample is buried"
  if (n.clear_db > -30) return `other sound under it (${n.clear_db.toFixed(0)} dB)`
  return "part of its attack may hide below the quiet"
}

export function FindNotes({ ai, notes }: { ai: AiSongs; notes: AiNotes }) {
  const song = notes.song
  const s = notes.stretch
  if (!song || !s) return null
  const stems = song.manifest.stems ?? []
  const busy = !!notes.search && notes.search.phase !== "done" && notes.search.phase !== "error"
  const len = s.end - s.start
  const lossless = song.manifest.source_lossless === true
  const keptDays = song.manifest.lossless_days ?? 0
  const expired = keptDays > 0 && Date.now() - (ai.songs.find((x) => x.id === song.id)?.created ?? 0) > keptDays * 86400_000
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Step 2 · Find the notes</Text>
      <Text style={styles.hint}>
        Pick one stem and a stretch where the instrument plays clearly. The server finds every note (Basic Pitch), then moves each start to the exact
        sample.
      </Text>
      <View style={styles.chips}>
        {stems.map((t, i) =>
          i === 0 ? null : (
            <Pressable
              key={t.key}
              onPress={() => notes.setStem(i)}
              style={[styles.chip, s.stem === i && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: s.stem === i }}
            >
              <Text style={[styles.chipText, s.stem === i && styles.chipTextOn]}>{t.label}</Text>
            </Pressable>
          )
        )}
      </View>
      <StretchBar duration={song.manifest.duration} start={s.start} end={s.end} />
      <Edge label="Start" value={s.start} onSet={notes.setStart} onMark={notes.markStart} />
      <Edge label="End" value={s.end} onSet={notes.setEnd} onMark={notes.markEnd} />
      <Text style={[styles.small, (len < MIN_STRETCH || len > MAX_STRETCH) && { color: Lcd.red }]}>
        {`${len.toFixed(1)} s selected (${MIN_STRETCH}–${MAX_STRETCH} s). Play the song and tap “Here” to mark the playhead.`}
      </Text>
      <View style={styles.row}>
        <Text style={[styles.small, { width: 44 }]}>Plays as</Text>
        <LcdButton label="Let it suggest" primary={s.mode === ""} onPress={() => notes.setMode("")} style={styles.flex} />
        <LcdButton label="Held" primary={s.mode === "held"} onPress={() => notes.setMode("held")} style={styles.flex} />
        <LcdButton label="One-shot" primary={s.mode === "oneshot"} onPress={() => notes.setMode("oneshot")} style={styles.flex} />
      </View>
      <Text style={styles.small}>Held: sounds while the key is down (strings, organ, pads). One-shot: plays out its own decay (xylophone, plucks, piano).</Text>
      <View style={styles.row}>
        <LcdButton label="▶ Hear stretch" disabled={busy} onPress={() => void notes.previewStretch()} style={styles.flex} />
        <LcdButton label="Find notes" primary disabled={busy || len < MIN_STRETCH || len > MAX_STRETCH} onPress={() => void notes.find()} style={styles.flex} />
      </View>
      {!lossless ? (
        <Text style={[styles.hint, { color: "#FFE2B0" }]}>
          This song was not uploaded as WAV, FLAC or AIFF, so its attacks are already smeared by a few ms. Notes and starts will be close, but none can
          be proven exact. For sample-exact cuts, split a lossless copy of the song.
        </Text>
      ) : expired ? (
        <Text style={[styles.hint, { color: "#FFE2B0" }]}>
          The server keeps lossless stems for {keptDays} days, and this song is older. The app will send its MP3 stem instead: starts close, never exact.
          Split the song again for exact timing.
        </Text>
      ) : null}
      {notes.search ? <SearchCard notes={notes} /> : null}
    </View>
  )
}

function StretchBar({ duration, start, end }: { duration: number; start: number; end: number }) {
  const pos = useTelemetry((t) => (duration > 0 ? Math.round((t.stemPos / duration) * 500) / 500 : 0))
  const a = duration > 0 ? start / duration : 0
  const b = duration > 0 ? end / duration : 0
  return (
    <View style={styles.bar} accessibilityLabel={`Stretch ${fmtClock(start)} to ${fmtClock(end)}`}>
      <View style={[styles.barSel, { left: `${a * 100}%`, width: `${Math.max(0.5, (b - a) * 100)}%` }]} />
      <View style={[styles.barHead, { left: `${Math.min(1, pos) * 100}%` }]} />
    </View>
  )
}

function Edge({ label, value, onSet, onMark }: { label: string; value: number; onSet: (t: number) => void; onMark: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.small, { width: 34 }]}>{label}</Text>
      <Text style={[styles.value, { width: 74 }]}>{fmtClock(value)}</Text>
      <LcdButton label="−1s" onPress={() => onSet(value - 1)} />
      <LcdButton label="−0.1" onPress={() => onSet(value - 0.1)} />
      <LcdButton label="+0.1" onPress={() => onSet(value + 0.1)} />
      <LcdButton label="+1s" onPress={() => onSet(value + 1)} />
      <LcdButton label="Here" primary onPress={onMark} style={styles.flex} />
    </View>
  )
}

function SearchCard({ notes }: { notes: AiNotes }) {
  const s = notes.search!
  const busy = s.phase !== "done" && s.phase !== "error"
  const secs = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000))
  return (
    <View style={[styles.card, s.phase === "error" && { borderColor: Lcd.red }]}>
      <View style={styles.row}>
        <Text style={[styles.value, styles.flex]}>{busy ? `Finding notes… ${Math.round(s.progress * 100)}% · ${secs}s` : s.phase === "done" ? "Done" : "Failed"}</Text>
        {busy ? <LcdButton label="Cancel" danger onPress={notes.cancel} /> : <LcdButton label="Close" onPress={notes.dismiss} />}
      </View>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${Math.round(s.progress * 100)}%` }, s.phase === "error" && { backgroundColor: Lcd.red }, s.phase === "done" && { backgroundColor: Lcd.green }]} />
      </View>
      <Text style={[styles.small, s.phase === "error" && { color: "#FFD3D3" }]}>{s.message}</Text>
    </View>
  )
}

export function NotesResults({ notes }: { notes: AiNotes }) {
  if (!notes.song || !notes.results.length) return null
  const stems = notes.song.manifest.stems ?? []
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Notes found in {notes.song.name}</Text>
      {notes.results.map((r) => {
        const m = r.manifest
        const label = stems.find((t) => t.key === m.stem)?.label ?? m.stem
        const on = notes.openId === r.id
        return (
          <View key={r.id} style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.value} numberOfLines={1}>{`${label} · ${fmtClock(m.start ?? 0, 1)}–${fmtClock(m.end ?? 0, 1)}`}</Text>
              <Text style={styles.small} numberOfLines={1}>
                {`${m.count ?? 0} notes · ${m.keys?.length ?? 0} keys · ${m.exact ?? 0} exact · ${m.audio === "lossless" ? "lossless" : "from MP3"}`}
              </Text>
            </View>
            <LcdButton label={on ? "● Open" : "Open"} primary={on} disabled={on} onPress={() => notes.openResult(r.id)} />
            <LcdButton label="Delete" danger onPress={() => notes.removeResult(r.id)} />
          </View>
        )
      })}
    </View>
  )
}

export function NotesView({ notes }: { notes: AiNotes }) {
  const doc = notes.doc
  const result = notes.results.find((r) => r.id === notes.openId)
  if (!doc || !result || !notes.song) return null
  const m = result.manifest
  const mp3 = m.audio !== "lossless"
  const label = notes.song.manifest.stems?.find((t) => t.key === doc.stem)?.label ?? doc.stem
  const chosen = notes.modes[result.id] ?? (doc.mode === "held" || doc.mode === "oneshot" ? doc.mode : doc.suggest.mode)
  const sel = notes.selected != null ? doc.notes[notes.selected] : null
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={[styles.sectionTitle, styles.flex]} numberOfLines={1}>
          {`${label} · ${fmtClock(doc.start, 1)}–${fmtClock(doc.end, 1)}`}
        </Text>
        <LcdButton label="Close" onPress={notes.closeResult} />
      </View>
      <Text style={styles.value}>
        {`${doc.notes.length} notes · ${m.keys?.length ?? 0} keys · `}
        <Text style={{ color: EXACT }}>{`${m.exact ?? 0} exact`}</Text>
        {mp3 ? <Text style={{ color: "#FFE2B0" }}> · from MP3: starts close, not exact</Text> : null}
      </Text>
      <View style={styles.legend}>
        <Legend color={EXACT} label="Exact: proven to the sample" />
        <Legend color={CLOSE} label="Close: an estimate" />
        <Legend color={SWELL} label="Swell: fades in" />
      </View>
      <View style={styles.row}>
        <Text style={[styles.small, styles.flex]}>{`Suggested: ${doc.suggest.mode === "held" ? "Held" : "One-shot"} — ${doc.suggest.why}`}</Text>
      </View>
      <View style={styles.row}>
        <LcdButton label="Held" primary={chosen === "held"} onPress={() => notes.chooseMode(result.id, "held")} style={styles.flex} />
        <LcdButton label="One-shot" primary={chosen === "oneshot"} onPress={() => notes.chooseMode(result.id, "oneshot")} style={styles.flex} />
      </View>
      <PianoRoll doc={doc} selected={notes.selected} onTap={(i) => void notes.playNote(i)} />
      <KeyMap doc={doc} onKey={(i) => void notes.playNote(i)} />
      <View style={styles.row}>
        <LcdButton label="▶ Whole stretch" onPress={() => void notes.playStretch()} style={styles.flex} />
        <LcdButton label="■ Stop" onPress={notes.stop} style={styles.flex} />
        {notes.auditioning ? <LcdButton label="Back to song" onPress={() => void notes.backToSong()} style={styles.flex} /> : null}
      </View>
      {sel ? <NoteDetail n={sel} doc={doc} mp3={mp3} notes={notes} /> : <Text style={styles.small}>Tap a note (or a key below the roll) to hear it from its cut.</Text>}
    </View>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.row, { gap: 4 }]}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.small}>{label}</Text>
    </View>
  )
}

function PianoRoll({ doc, selected, onTap }: { doc: AiNotesDoc; selected: number | null; onTap: (i: number) => void }) {
  const [pps, setPps] = useState(90)
  const { lo, hi } = useMemo(() => {
    const ks = doc.notes.map((n) => n.midi)
    return { lo: Math.min(...ks) - 1, hi: Math.max(...ks) + 1 }
  }, [doc])
  if (!doc.notes.length) return <Text style={styles.small}>No notes found in this stretch.</Text>
  const rows = hi - lo + 1
  const rowH = Math.max(6, Math.min(14, Math.floor(260 / rows)))
  const dur = doc.end - doc.start
  const width = Math.max(200, dur * pps)
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.row}>
        <Text style={[styles.small, styles.flex]}>{`${(dur).toFixed(1)} s · ${hi - 1 >= lo + 1 ? `${doc.notes.find((n) => n.midi === lo + 1)?.name ?? ""} – ${doc.notes.find((n) => n.midi === hi - 1)?.name ?? ""}` : ""}`}</Text>
        <LcdButton label="−" onPress={() => setPps((p) => Math.max(30, p / 1.5))} />
        <LcdButton label="+" onPress={() => setPps((p) => Math.min(600, p * 1.5))} />
      </View>
      <View style={styles.rollFrame}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ width, height: rows * rowH }}>
            {Array.from({ length: rows }, (_, r) => {
              const midi = hi - r
              const black = [1, 3, 6, 8, 10].includes(midi % 12)
              return <View key={midi} style={[styles.rollRow, { top: r * rowH, height: rowH }, black && { backgroundColor: "#141A20" }, midi % 12 === 0 && styles.rollC]} />
            })}
            {Array.from({ length: Math.floor(dur) + 1 }, (_, s) => (
              <View key={`s${s}`} style={[styles.rollSec, { left: s * pps }]} />
            ))}
            {doc.notes.map((n, i) => (
              <Pressable
                key={i}
                onPress={() => onTap(i)}
                hitSlop={4}
                accessibilityLabel={`${n.name} at ${n.t.toFixed(3)} seconds${n.exact ? ", exact" : ""}`}
                style={[
                  styles.rollNote,
                  {
                    left: n.t * pps,
                    width: Math.max(3, (n.end - n.t) * pps),
                    top: (hi - n.midi) * rowH + 1,
                    height: rowH - 2,
                    backgroundColor: noteColor(n),
                  },
                  selected === i && styles.rollSel,
                ]}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  )
}

/** Every key in the range: which have an exact take, which only close ones. */
function KeyMap({ doc, onKey }: { doc: AiNotesDoc; onKey: (i: number) => void }) {
  const keys = useMemo(() => {
    const by = new Map<number, number[]>()
    doc.notes.forEach((n, i) => by.set(n.midi, [...(by.get(n.midi) ?? []), i]))
    return [...by.entries()].sort((a, b) => a[0] - b[0])
  }, [doc])
  if (!keys.length) return null
  const exactKeys = keys.filter(([, ids]) => ids.some((i) => doc.notes[i].exact)).length
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.small}>{`Keys played: ${keys.length} · with an exact take: ${exactKeys}. Tap a key to hear its best take.`}</Text>
      <View style={styles.keys}>
        {keys.map(([midi, ids]) => {
          // Best take: exact first, then the loudest.
          const best = [...ids].sort((a, b) => Number(doc.notes[b].exact) - Number(doc.notes[a].exact) || doc.notes[b].vel - doc.notes[a].vel)[0]
          const n = doc.notes[best]
          return (
            <Pressable key={midi} onPress={() => onKey(best)} style={[styles.key, { borderColor: noteColor(n) }]} accessibilityLabel={`${n.name}, ${ids.length} takes`}>
              <Text style={[styles.keyName, { color: noteColor(n) }]}>{n.name}</Text>
              <Text style={styles.keyCount}>{ids.length}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function NoteDetail({ n, doc, mp3, notes }: { n: AiNote; doc: AiNotesDoc; mp3: boolean; notes: AiNotes }) {
  const i = notes.selected ?? 0
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.big, { color: noteColor(n) }]}>{n.name}</Text>
        <Text style={[styles.value, styles.flex]}>{n.exact ? "Exact start" : `Close — ${whyNotExact(n, mp3)}`}</Text>
      </View>
      <Wave n={n} />
      <Line k="Start" v={`${fmtMs(n.t)} into the stretch · ${fmtClock(doc.start + n.t, 4)} in the song`} />
      <Line k="Cut" v={`${((n.t - n.cut) * 1000).toFixed(2)} ms before the start, on a zero crossing`} />
      <Line k="Basic Pitch" v={`was ${Math.abs(n.shift_ms).toFixed(2)} ms ${n.shift_ms < 0 ? "late" : "early"} (it works in 11.6 ms frames)`} />
      <Line k="Attack" v={`${n.sharp ? "sharp" : "swell"} · within 20 dB of its peak in ${n.rise_ms.toFixed(1)} ms`} />
      <Line k="Before it" v={n.clear_db <= -30 ? `quiet (${n.clear_db.toFixed(0)} dB): isolated` : `other sound at ${n.clear_db.toFixed(0)} dB`} />
      <Line k="Length" v={`${((n.end - n.t) * 1000).toFixed(0)} ms · loudness ${(n.vel * 100).toFixed(0)}%`} />
      <View style={styles.row}>
        <LcdButton label="◀ Prev" disabled={i <= 0} onPress={() => void notes.playNote(i - 1)} style={styles.flex} />
        <LcdButton label="▶ Play note" primary onPress={() => void notes.playNote(i)} style={styles.flex} />
        <LcdButton label="Next ▶" disabled={i >= doc.notes.length - 1} onPress={() => void notes.playNote(i + 1)} style={styles.flex} />
      </View>
    </View>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <View style={[styles.row, { alignItems: "flex-start" }]}>
      <Text style={[styles.small, { width: 70 }]}>{k}</Text>
      <Text style={[styles.value, styles.flex, { fontSize: 11.5 }]}>{v}</Text>
    </View>
  )
}

/** 20 ms around the start: 6 ms before, 14 after. Green line = start, orange = cut. */
function Wave({ n }: { n: AiNote }) {
  const H = 64
  const startX = 6 / 20
  const cutX = Math.max(0, Math.min(1, (0.006 - (n.t - n.cut)) / 0.02))
  return (
    <View>
      <View style={[styles.wave, { height: H }]}>
        <View style={[styles.waveMid, { top: H / 2 }]} />
        {n.wave.map(([lo, hi], c) => (
          <View
            key={c}
            style={{
              position: "absolute",
              left: `${(c / n.wave.length) * 100}%`,
              width: `${100 / n.wave.length}%`,
              top: H / 2 - (hi / 100) * (H / 2 - 2),
              height: Math.max(1, ((hi - lo) / 100) * (H / 2 - 2)),
              backgroundColor: c / n.wave.length < cutX ? "#4A5560" : noteColor(n),
            }}
          />
        ))}
        <View style={[styles.marker, { left: `${cutX * 100}%`, backgroundColor: Lcd.orange }]} />
        <View style={[styles.marker, { left: `${startX * 100}%`, backgroundColor: EXACT }]} />
      </View>
      <View style={styles.row}>
        <Text style={[styles.small, styles.flex]}>−6 ms</Text>
        <Text style={[styles.small, { color: Lcd.orange }]}>cut</Text>
        <Text style={[styles.small, { color: EXACT }]}>start</Text>
        <Text style={[styles.small, styles.flex, { textAlign: "right" }]}>+14 ms</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8, padding: 10, borderRadius: 8, backgroundColor: Lcd.bgDeep, borderWidth: 1, borderColor: Lcd.line },
  sectionTitle: { color: Lcd.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  card: { gap: 6, padding: 8, borderRadius: 6, backgroundColor: Lcd.bg, borderWidth: 1, borderColor: Lcd.line },
  hint: { color: Lcd.muted, fontSize: 11.5, fontWeight: "600", lineHeight: 16 },
  small: { color: Lcd.dim, fontSize: 10.5, fontWeight: "700" },
  value: { color: Lcd.text, fontSize: 12.5, fontWeight: "700" },
  big: { fontSize: 22, fontWeight: "900", minWidth: 48 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: Lcd.line, backgroundColor: Lcd.bg },
  chipOn: { borderColor: Lcd.tabOn, backgroundColor: "#1E2A36" },
  chipText: { color: Lcd.muted, fontSize: 11.5, fontWeight: "800" },
  chipTextOn: { color: Lcd.text },
  bar: { height: 16, borderRadius: 4, backgroundColor: Lcd.line, overflow: "hidden" },
  barSel: { position: "absolute", top: 0, bottom: 0, backgroundColor: "#3B6EA8" },
  barHead: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: Lcd.text },
  progress: { height: 6, borderRadius: 3, backgroundColor: Lcd.line, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Lcd.orange },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  rollFrame: { borderRadius: 4, borderWidth: 1, borderColor: Lcd.line, backgroundColor: "#0E1318", overflow: "hidden" },
  rollRow: { position: "absolute", left: 0, right: 0 },
  rollC: { borderBottomWidth: 1, borderBottomColor: "#2A3440" },
  rollSec: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "#1F2933" },
  rollNote: { position: "absolute", borderRadius: 2 },
  rollSel: { borderWidth: 2, borderColor: "#FFFFFF" },
  keys: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  key: { width: 40, paddingVertical: 4, alignItems: "center", borderRadius: 4, borderWidth: 1, backgroundColor: Lcd.bg },
  keyName: { fontSize: 11, fontWeight: "900" },
  keyCount: { color: Lcd.dim, fontSize: 9, fontWeight: "800" },
  wave: { borderRadius: 4, backgroundColor: "#0E1318", borderWidth: 1, borderColor: Lcd.line, overflow: "hidden" },
  waveMid: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "#1F2933" },
  marker: { position: "absolute", top: 0, bottom: 0, width: 2 },
})

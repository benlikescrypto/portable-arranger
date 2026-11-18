import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import { LcdButton, LcdHeader } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import { useAuth, type Auth } from "@/hooks/useAuth"
import type { AiSong, AiSongs, SongJob } from "@/hooks/useAiSongs"
import { useTelemetry } from "@/lib/telemetry"

/**
 * The AI tab. Built and checked one step at a time; step 1 is the stem split:
 * upload a song, Demucs separates it on the GPU server, and the stems play here in sync.
 */

const STEM_COLORS: Record<string, string> = {
  original: "#E8C45A",
  vocals: "#F28B82",
  drums: "#7FB4FF",
  bass: "#6FD9A8",
  piano: "#C79BFF",
  guitar: "#F2B35B",
  other: "#9AA6B0",
}

const STEPS: { label: string; done: (j: SongJob) => boolean; now: (j: SongJob) => boolean }[] = [
  { label: "Upload", done: (j) => j.phase !== "uploading", now: (j) => j.phase === "uploading" },
  {
    label: "Separate",
    done: (j) => j.phase === "downloading" || j.phase === "done" || (j.phase === "processing" && j.stage === "encode"),
    now: (j) => j.phase === "queued" || (j.phase === "processing" && j.stage !== "encode"),
  },
  { label: "Save", done: (j) => j.phase === "downloading" || j.phase === "done", now: (j) => j.phase === "processing" && j.stage === "encode" },
  { label: "Download", done: (j) => j.phase === "done", now: (j) => j.phase === "downloading" },
]

export function AiPage({ ai }: { ai: AiSongs }) {
  const auth = useAuth()
  const status = !ai.configured ? "Not set up" : ai.online == null ? "Connecting…" : ai.online ? "Server online" : "Server offline"
  const busy = !!ai.job && ai.job.phase !== "done" && ai.job.phase !== "error"
  const loaded = ai.songs.find((s) => s.id === ai.player.songId) ?? null

  return (
    <View style={styles.lcd}>
      <LcdHeader title="AI" right={status}>
        <View style={[styles.dot, { backgroundColor: ai.online ? Lcd.green : ai.online === false ? Lcd.red : Lcd.dim }]} />
      </LcdHeader>
      <ScrollView contentContainerStyle={styles.body}>
        {!ai.configured ? (
          <Section title="AI server not set up">
            <Text style={styles.hint}>
              This build has no ArrangerBox AI server address. Deploy server/modal_app.py and run server/scripts/write-app-config.mjs, then
              reload the app.
            </Text>
          </Section>
        ) : null}
        {auth.ready && !auth.user ? (
          <SignIn auth={auth} />
        ) : (
          <Section title="Song → Stems">
            <Text style={styles.hint}>
              Step 1: pick a song. The GPU server splits it with Demucs into vocals, drums, bass, piano, guitar and other. Play them here, alone or
              together, and compare with the original.
            </Text>
            <View style={styles.row}>
              <LcdButton label="Choose song…" primary disabled={!ai.configured || busy} onPress={() => void ai.pickAndRun()} style={styles.flex} />
              <LcdButton label="Try demo song" disabled={!ai.configured || busy} onPress={() => void ai.runDemo()} style={styles.flex} />
            </View>
            <Text style={styles.small}>Songs up to 10 minutes. The song is deleted from the server when the job ends; the stems stay on this device.</Text>
            {!ai.canPlay ? (
              <Text style={[styles.hint, { color: "#FFE2B0" }]}>This app build has no stem player yet. Install the new build to listen.</Text>
            ) : null}
            <View style={styles.row}>
              <Text style={[styles.small, styles.flex]} numberOfLines={1}>
                Signed in as {auth.user?.email}
              </Text>
              <LcdButton label="Sign out" disabled={auth.busy} onPress={() => void auth.signOut()} />
            </View>
          </Section>
        )}
        {ai.job ? <JobCard job={ai.job} onCancel={ai.cancel} onDismiss={ai.dismiss} /> : null}
        {ai.player.loading ? (
          <Section title="Loading stems…">
            <Text style={styles.hint}>Decoding the stems into memory.</Text>
          </Section>
        ) : null}
        {ai.player.error ? (
          <Section title="Can't play these stems">
            <Text style={[styles.hint, { color: "#FFD3D3" }]}>{ai.player.error}</Text>
          </Section>
        ) : null}
        {loaded ? <StemPlayer song={loaded} ai={ai} /> : null}
        <SongList ai={ai} />
      </ScrollView>
    </View>
  )
}

function JobCard({ job, onCancel, onDismiss }: { job: SongJob; onCancel: () => void; onDismiss: () => void }) {
  const busy = job.phase !== "done" && job.phase !== "error"
  const secs = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000))
  return (
    <View style={[styles.section, job.phase === "error" && { borderColor: Lcd.red }]}>
      <View style={styles.row}>
        <Text style={[styles.sectionTitle, styles.flex]} numberOfLines={1}>
          {job.name}
        </Text>
        <Text style={styles.small}>{busy ? `${Math.round(job.progress * 100)}% · ${secs}s` : job.phase === "done" ? "Done" : "Failed"}</Text>
      </View>
      <View style={styles.steps}>
        {STEPS.map((s) => {
          const state = s.done(job) ? "done" : s.now(job) ? (job.phase === "error" ? "error" : "now") : "todo"
          return (
            <View key={s.label} style={styles.step} accessibilityLabel={`${s.label} ${state}`}>
              <View
                style={[
                  styles.stepLed,
                  state === "done" && { backgroundColor: Lcd.green },
                  state === "now" && { backgroundColor: Lcd.orange },
                  state === "error" && { backgroundColor: Lcd.red },
                ]}
              />
              <Text style={[styles.stepLabel, state === "todo" && { color: Lcd.dim }]} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          )
        })}
      </View>
      <View style={styles.progress}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(job.progress * 100)}%` },
            job.phase === "error" && { backgroundColor: Lcd.red },
            job.phase === "done" && { backgroundColor: Lcd.green },
          ]}
        />
      </View>
      <Text style={[styles.value, job.phase === "error" && { color: "#FFD3D3" }]}>{job.message}</Text>
      {job.phase === "queued" ? <Text style={styles.small}>The first job after a quiet period starts a GPU, which can take up to a minute.</Text> : null}
      <View style={styles.row}>{busy ? <LcdButton label="Cancel" danger onPress={onCancel} /> : <LcdButton label="Close" onPress={onDismiss} />}</View>
    </View>
  )
}

function fmtTime(s: number) {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}

function StemPlayer({ song, ai }: { song: AiSong; ai: AiSongs }) {
  const m = song.manifest
  const stems = m.stems ?? []
  const playing = useTelemetry((t) => t.stemPlaying)
  const p = ai.player
  return (
    <Section title={song.name}>
      <View style={styles.row}>
        <LcdButton label={playing ? "❚❚ Pause" : "▶ Play"} primary onPress={() => ai.play(!playing)} style={{ minWidth: 96 }} />
        <LcdButton label="⏮" onPress={() => ai.seek(0)} />
        <Clock duration={m.duration} />
      </View>
      <Scrubber duration={m.duration} onSeek={ai.seek} />
      <View style={styles.row}>
        <LcdButton label="Original" primary={p.mode === "original"} onPress={() => ai.setMode("original")} style={styles.flex} />
        <LcdButton label="Stems" primary={p.mode === "stems"} onPress={() => ai.setMode("stems")} style={styles.flex} />
      </View>
      <Text style={styles.small}>
        {p.mode === "original"
          ? "Playing the original song. Tap Stems to hear the separation."
          : p.solo != null
            ? `Solo: ${stems[p.solo]?.label}. Tap S again to hear every stem.`
            : "Playing the stems added together. Mute (M) or solo (S) a stem to hear it alone."}
      </Text>
      <View style={{ gap: 6 }}>
        {stems.map((t, i) =>
          i === 0 ? null : (
            <View key={t.key} style={styles.stemRow}>
              <View style={[styles.swatch, { backgroundColor: STEM_COLORS[t.key] ?? Lcd.dim }]} />
              <View style={{ width: 70 }}>
                <Text style={styles.stemName}>{t.label}</Text>
                <Text style={styles.small}>{t.share_db <= -40 ? "silent" : `${t.share_db > 0 ? "+" : ""}${t.share_db} dB`}</Text>
              </View>
              <Meter index={i} color={STEM_COLORS[t.key] ?? Lcd.dim} active={p.mode === "stems" && (p.solo != null ? p.solo === i : !p.muted[i])} />
              <LcdButton label="M" danger={p.mode === "stems" && p.solo == null && !!p.muted[i]} onPress={() => ai.toggleMute(i)} />
              <LcdButton label="S" primary={p.mode === "stems" && p.solo === i} onPress={() => ai.toggleSolo(i)} />
            </View>
          )
        )}
      </View>
      <Text style={styles.small}>
        {`${m.model ?? "Demucs"} · ${fmtTime(m.duration)}${m.cut ? " (cut to the first 10 min)" : ""}${
          m.residual_db != null ? ` · stems add up to the song within ${m.residual_db} dB` : ""
        } · dB = loudness against the whole song`}
      </Text>
    </Section>
  )
}

function Clock({ duration }: { duration: number }) {
  const pos = useTelemetry((t) => Math.floor(t.stemPos))
  return <Text style={[styles.value, styles.flex, { textAlign: "right" }]}>{`${fmtTime(pos)} / ${fmtTime(duration)}`}</Text>
}

function Scrubber({ duration, onSeek }: { duration: number; onSeek: (s: number) => void }) {
  const [w, setW] = useState(0)
  const frac = useTelemetry((t) => (duration > 0 ? Math.min(1, Math.round((t.stemPos / duration) * 400) / 400) : 0))
  return (
    <Pressable
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onPress={(e) => w > 0 && onSeek((e.nativeEvent.locationX / w) * duration)}
      style={styles.scrub}
      accessibilityRole="adjustable"
      accessibilityLabel="Song position"
    >
      <View style={[styles.scrubFill, { width: `${frac * 100}%` }]} />
    </Pressable>
  )
}

function Meter({ index, color, active }: { index: number; color: string; active: boolean }) {
  const level = useTelemetry((t) => Math.round(Math.min(1, Math.sqrt(t.stemLevels[index] ?? 0)) * 40) / 40)
  return (
    <View style={[styles.meter, styles.flex]}>
      <View style={[styles.meterFill, { width: `${level * 100}%`, backgroundColor: active ? color : Lcd.dim }]} />
    </View>
  )
}

function SongList({ ai }: { ai: AiSongs }) {
  if (!ai.songs.length) return null
  return (
    <Section title="Your songs">
      {ai.songs.map((s) => {
        const on = ai.player.songId === s.id
        return (
          <View key={s.id} style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.value} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {`${fmtTime(s.manifest.duration)} · ${(s.manifest.stems?.length ?? 1) - 1} stems · ${new Date(s.created).toLocaleDateString()}`}
              </Text>
            </View>
            <LcdButton label={on ? "● Open" : "Open"} primary={on} disabled={on || ai.player.loading || !ai.canPlay} onPress={() => void ai.open(s.id)} />
            <LcdButton label="Delete" danger onPress={() => ai.remove(s.id)} />
          </View>
        )
      })}
      <Text style={styles.small}>One song is held in memory at a time; opening another replaces it.</Text>
    </Section>
  )
}

function SignIn({ auth }: { auth: Auth }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const ok = /.+@.+\..+/.test(email.trim()) && password.length >= 8
  return (
    <Section title="Sign in to use AI">
      <Text style={styles.hint}>AI runs on the ArrangerBox GPU server, so it needs an account. Everything else in the app works without one.</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={Lcd.dim}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        selectionColor={Lcd.tabOn}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password (8+ characters)"
        placeholderTextColor={Lcd.dim}
        style={styles.input}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        selectionColor={Lcd.tabOn}
        onSubmitEditing={() => ok && void auth.signIn(email, password)}
      />
      {auth.error ? <Text style={[styles.value, { color: "#FFD3D3" }]}>{auth.error}</Text> : null}
      {auth.notice ? <Text style={styles.value}>{auth.notice}</Text> : null}
      <View style={styles.row}>
        <LcdButton label="Sign in" primary disabled={!ok || auth.busy} onPress={() => void auth.signIn(email, password)} style={styles.flex} />
        <LcdButton label="Create account" disabled={!ok || auth.busy} onPress={() => void auth.signUp(email, password)} style={styles.flex} />
      </View>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  lcd: { flex: 1, backgroundColor: Lcd.bg, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#2A3038" },
  body: { padding: 10, gap: 10 },
  section: { gap: 8, padding: 10, borderRadius: 8, backgroundColor: Lcd.bgDeep, borderWidth: 1, borderColor: Lcd.line },
  sectionTitle: { color: Lcd.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  hint: { color: Lcd.muted, fontSize: 11.5, fontWeight: "600", lineHeight: 16 },
  small: { color: Lcd.dim, fontSize: 10.5, fontWeight: "700" },
  value: { color: Lcd.text, fontSize: 12.5, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  input: {
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.bg,
    color: Lcd.text,
    paddingHorizontal: 10,
    fontSize: 13,
    fontWeight: "700",
  },
  dot: { width: 8, height: 8, borderRadius: 4, alignSelf: "center" },
  steps: { flexDirection: "row", gap: 4 },
  step: { flex: 1, alignItems: "center", gap: 3 },
  stepLed: { width: 18, height: 5, borderRadius: 2, backgroundColor: Lcd.line },
  stepLabel: { color: Lcd.text, fontSize: 9.5, fontWeight: "800" },
  progress: { height: 6, borderRadius: 3, backgroundColor: Lcd.line, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Lcd.orange },
  scrub: { height: 22, borderRadius: 4, backgroundColor: Lcd.line, overflow: "hidden", justifyContent: "center" },
  scrubFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: Lcd.tabOn },
  stemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stemName: { color: Lcd.text, fontSize: 12.5, fontWeight: "900" },
  swatch: { width: 6, height: 28, borderRadius: 2 },
  meter: { height: 10, borderRadius: 3, backgroundColor: Lcd.line, overflow: "hidden" },
  meterFill: { height: "100%" },
})

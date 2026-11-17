import { useMemo, useState } from "react"
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import { LcdButton, LcdHeader, LcdTabs } from "@/components/pro/ui"
import { Lcd, noteName } from "@/constants/theme"
import { useAuth, type Auth } from "@/hooks/useAuth"
import { AI_STAGES, stepOf, type AiActive, type AiLab, type AiLoaded } from "@/hooks/useAiLab"
import type { useArranger } from "@/hooks/useArranger"
import type { AiKind, AiManifest } from "@/lib/ai/client"
import type { AiEntry } from "@/lib/ai/library"

type Vm = ReturnType<typeof useArranger>
type Tab = "drums" | "sounds" | "library"

const ROLE_COLORS: Record<string, string> = {
  Intro: "#7EE0B8",
  "Var 1": "#7FB4FF",
  "Var 2": "#5E93E8",
  "Var 3": "#C79BFF",
  "Var 4": "#F2B35B",
  Ending: "#E26A6A",
  Other: "#9AA6B0",
  "No drums": "#46505A",
}

const ELEMENTS: { id: string; label: string }[] = [
  { id: "intro1", label: "Intro 1" },
  { id: "intro2", label: "Intro 2" },
  { id: "var1", label: "Var 1" },
  { id: "var2", label: "Var 2" },
  { id: "var3", label: "Var 3" },
  { id: "var4", label: "Var 4" },
  { id: "fill1", label: "Fill 1" },
  { id: "fill2", label: "Fill 2" },
  { id: "fill3", label: "Fill 3" },
  { id: "fill4", label: "Fill 4" },
  { id: "break", label: "Break" },
  { id: "end1", label: "Ending 1" },
  { id: "end2", label: "Ending 2" },
  { id: "end3", label: "Ending 3" },
]

const SOUND_COLORS = ["#F2B35B", "#7FB4FF", "#C79BFF", "#6FD9A8", "#E39B45", "#E26A6A"]

export function AiPage({ vm, ai, wide }: { vm: Vm; ai: AiLab; wide: boolean }) {
  const auth = useAuth()
  const [tab, setTab] = useState<Tab>("drums")
  const [openId, setOpenId] = useState<Record<AiKind, string | null>>({ drums: null, sounds: null })
  const status = !ai.configured ? "Not set up" : ai.online == null ? "Connecting…" : ai.online ? "Server online" : "Server offline"
  const kind: AiKind = tab === "sounds" ? "sounds" : "drums"
  const shown = useMemo(() => {
    const id = openId[kind] ?? ai.active[kind]?.entryId
    return ai.entries.find((e) => e.id === id) ?? ai.entries.find((e) => e.kind === kind) ?? null
  }, [ai.entries, ai.active, openId, kind])

  return (
    <View style={styles.lcd}>
      <LcdHeader title="AI Lab" right={status}>
        <View style={[styles.dot, { backgroundColor: ai.online ? Lcd.green : ai.online === false ? Lcd.red : Lcd.dim }]} />
      </LcdHeader>
      <ScrollView contentContainerStyle={styles.body}>
        {!ai.configured ? (
          <Section title="AI server not set up">
            <Text style={styles.hint}>
              This build has no ArrangerBox AI server address. Deploy server/modal_app.py and run
              server/scripts/write-app-config.mjs, then reload the app.
            </Text>
          </Section>
        ) : null}
        {auth.ready && !auth.user && tab !== "library" ? (
          <SignIn auth={auth} />
        ) : tab === "library" ? (
          <LibraryList
            ai={ai}
            onOpen={(e) => {
              setOpenId((o) => ({ ...o, [e.kind]: e.id }))
              setTab(e.kind)
            }}
          />
        ) : (
          <>
            <Section title={kind === "drums" ? "Song → Drum Style" : "Song → Sounds"}>
              <Text style={styles.hint}>
                {kind === "drums"
                  ? "Pick a song. ArrangerBox separates the drums, finds the tempo and bars, and builds a style: intro, four variations, fills, break and endings cut from the song's own drums. It plays at any tempo."
                  : "Pick a song. ArrangerBox separates the instruments, finds where piano, strings, organ and others play, samples their clean notes and maps them across the keyboard."}
              </Text>
              <View style={styles.row}>
                <LcdButton
                  label="Choose song…"
                  primary
                  disabled={!ai.configured || isBusy(ai.active[kind])}
                  onPress={() => void ai.pickAndRun(kind)}
                  style={styles.flex}
                />
                <LcdButton
                  label="Try demo song"
                  disabled={!ai.configured || isBusy(ai.active[kind])}
                  onPress={() => void ai.runDemo(kind)}
                  style={styles.flex}
                />
              </View>
              <Text style={styles.small}>
                The song is processed on the ArrangerBox GPU server and deleted when the job ends; results stay on this device.
              </Text>
              <View style={styles.row}>
                <Text style={[styles.small, styles.flex]} numberOfLines={1}>
                  Signed in as {auth.user?.email}
                </Text>
                <LcdButton label="Sign out" disabled={auth.busy} onPress={() => void auth.signOut()} />
              </View>
            </Section>
            {ai.active[kind] ? (
              <JobCard
                a={ai.active[kind]!}
                onCancel={() => ai.cancel(kind)}
                onDismiss={() => ai.dismiss(kind)}
              />
            ) : null}
            {shown ? (
              kind === "drums" ? (
                <DrumResult entry={shown} ids={ai.loaded[shown.id]} vm={vm} wide={wide} onLoad={() => void ai.ensureLoaded(shown)} />
              ) : (
                <SoundResult entry={shown} ids={ai.loaded[shown.id]} vm={vm} onLoad={() => void ai.ensureLoaded(shown)} />
              )
            ) : null}
          </>
        )}
      </ScrollView>
      <LcdTabs
        tabs={[
          { id: "drums", label: "Drum Style" },
          { id: "sounds", label: "Sounds" },
          { id: "library", label: `Library${ai.entries.length ? ` (${ai.entries.length})` : ""}` },
        ]}
        value={tab}
        onChange={setTab}
      />
    </View>
  )
}

function isBusy(a: AiActive | null) {
  return !!a && a.phase !== "done" && a.phase !== "error"
}

function JobCard({ a, onCancel, onDismiss }: { a: AiActive; onCancel: () => void; onDismiss: () => void }) {
  const step = stepOf(a)
  const busy = isBusy(a)
  const secs = Math.max(0, Math.round((Date.now() - a.startedAt) / 1000))
  return (
    <View style={[styles.section, a.phase === "error" && { borderColor: Lcd.red }]}>
      <View style={styles.row}>
        <Text style={[styles.sectionTitle, styles.flex]} numberOfLines={1}>
          {a.name}
        </Text>
        <Text style={styles.small}>{busy ? `${Math.round(a.progress * 100)}% · ${secs}s` : a.phase === "done" ? "Done" : "Failed"}</Text>
      </View>
      <View style={styles.steps}>
        {AI_STAGES.map((s, i) => {
          const state = a.phase === "error" ? (i < step ? "done" : i === step ? "error" : "todo") : i < step ? "done" : i === step ? "now" : "todo"
          return (
            <View key={s.id} style={styles.step} accessibilityLabel={`${s.label} ${state}`}>
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
            { width: `${Math.round(a.progress * 100)}%` },
            a.phase === "error" && { backgroundColor: Lcd.red },
            a.phase === "done" && { backgroundColor: Lcd.green },
          ]}
        />
      </View>
      <Text style={[styles.value, a.phase === "error" && { color: "#FFD3D3" }]}>{a.message}</Text>
      {a.phase === "queued" ? (
        <Text style={styles.small}>The first job after a quiet period starts a GPU, which can take up to a minute.</Text>
      ) : null}
      <View style={styles.row}>
        {busy ? <LcdButton label="Cancel" danger onPress={onCancel} /> : <LcdButton label="Close" onPress={onDismiss} />}
      </View>
    </View>
  )
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`
}

function DrumResult({ entry, ids, vm, wide, onLoad }: { entry: AiEntry; ids?: AiLoaded; vm: Vm; wide: boolean; onLoad: () => void }) {
  const m = entry.manifest
  const audioId = ids?.styleIds[0] ?? -1
  const gmId = ids?.styleIds[1] ?? -1
  const s = vm.state
  const playingThis = s.playing && (s.styleId === audioId || s.styleId === gmId)
  const play = (id: number) => {
    if (id < 0) return
    if (s.styleId !== id) vm.selectStyle(id, false)
    if (!s.playing) setTimeout(() => vm.toggleStart(), 60)
  }
  return (
    <>
      <Section title={m.name}>
        <View style={styles.stats}>
          <Stat label="TEMPO" value={`${m.bpm}`} unit="BPM" />
          <Stat label="METER" value={`${m.meter}/4`} />
          <Stat label="BARS" value={`${m.bars}`} />
          <Stat label="LENGTH" value={fmtTime(m.duration)} />
        </View>
        <Timeline m={m} />
        <View style={styles.legend}>
          {Object.entries(ROLE_COLORS)
            .filter(([role]) => m.sections?.some((x) => x.role === role))
            .map(([role, color]) => (
              <View key={role} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: color }]} />
                <Text style={styles.small}>{role}</Text>
              </View>
            ))}
          {m.fills?.length ? (
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: Lcd.orange, width: 3 }]} />
              <Text style={styles.small}>Fill</Text>
            </View>
          ) : null}
        </View>
        {ids == null ? (
          <LcdButton label="Load into arranger" primary onPress={onLoad} />
        ) : (
          <View style={styles.row}>
            <LcdButton
              label={playingThis && s.styleId === audioId ? "■ Stop" : "▶ Play song drums"}
              primary
              disabled={audioId < 0}
              onPress={() => (playingThis && s.styleId === audioId ? vm.toggleStart() : play(audioId))}
              style={styles.flex}
            />
            <LcdButton
              label={playingThis && s.styleId === gmId ? "■ Stop" : "▶ GM kit version"}
              disabled={gmId < 0}
              onPress={() => (playingThis && s.styleId === gmId ? vm.toggleStart() : play(gmId))}
              style={styles.flex}
            />
          </View>
        )}
        {ids?.warning ? <Text style={[styles.hint, { color: "#FFE2B0" }]}>{ids.warning}</Text> : null}
        <Text style={styles.small}>
          The style is in Style Select (World / Imported) as “{m.styles[0]?.name}”. Use the control panel for Intro, Variation, Fill,
          Break, Ending and tempo.
        </Text>
      </Section>
      <Section title="Style elements from the song">
        <View style={[styles.grid, wide && styles.gridWide]}>
          {ELEMENTS.map((el) => {
            const src = m.elements?.[el.id]
            if (!src) return null
            const t0 = m.barTimes?.[src.bar0]
            return (
              <View key={el.id} style={[styles.chip, wide && styles.chipWide]}>
                <Text style={styles.chipTitle}>{el.label}</Text>
                <Text style={styles.chipSub} numberOfLines={1}>
                  {`${src.bar1 - src.bar0 === 1 ? `bar ${src.bar1}` : `bars ${src.bar0 + 1}–${src.bar1}`}${t0 != null ? ` · ${fmtTime(t0)}` : ""}`}
                </Text>
              </View>
            )
          })}
        </View>
      </Section>
    </>
  )
}

function Timeline({ m }: { m: AiManifest }) {
  const total = Math.max(1, m.bars ?? 1)
  return (
    <View style={styles.timeline} accessibilityLabel="Song sections">
      {(m.sections ?? []).map((sec, i) => (
        <View
          key={i}
          style={[styles.block, { flexGrow: sec.bar1 - sec.bar0, backgroundColor: ROLE_COLORS[sec.role] ?? "#9AA6B0" }]}
        >
          {sec.bar1 - sec.bar0 >= total / 14 ? (
            <Text style={styles.blockLabel} numberOfLines={1}>
              {sec.role === "No drums" ? "" : sec.role}
            </Text>
          ) : null}
        </View>
      ))}
      {(m.fills ?? []).map((f, i) => (
        <View key={`f${i}`} style={[styles.fillMark, { left: `${((f.bar + 0.5) / total) * 100}%` }]} />
      ))}
    </View>
  )
}

function SoundResult({ entry, ids, vm, onLoad }: { entry: AiEntry; ids?: AiLoaded; vm: Vm; onLoad: () => void }) {
  const m = entry.manifest
  const s = vm.state
  return (
    <>
      <Section title={m.name}>
        <SoundTimeline m={m} />
        {ids == null ? <LcdButton label="Load sounds" primary onPress={onLoad} /> : null}
        {ids?.warning ? <Text style={[styles.hint, { color: "#FFE2B0" }]}>{ids.warning}</Text> : null}
      </Section>
      {m.sounds.map((snd, i) => {
        const id = ids?.soundIds[i] ?? -1
        const on = (part: number) => id >= 0 && (part === 0 ? s.upper1 : part === 1 ? s.upper2 : part === 2 ? s.upper3 : s.lower) === id
        return (
          <View key={snd.file} style={styles.section}>
            <View style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: SOUND_COLORS[i % SOUND_COLORS.length], height: 28, width: 6 }]} />
              <View style={styles.flex}>
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {snd.name}
                </Text>
                <Text style={styles.small} numberOfLines={1}>
                  {snd.source === "library"
                    ? `${snd.category} · ${snd.library} matched to the song · full keyboard`
                    : snd.source === "resynth"
                      ? `${snd.category} · rebuilt from the song's tone · full keyboard`
                      : `${snd.category} · ${snd.zones.length} sample${snd.zones.length === 1 ? "" : "s"} cut from the song · ${noteName(snd.range[0])}–${noteName(snd.range[1])}${snd.sustained ? " · looped" : ""}`}
                </Text>
                {snd.credit ? (
                  <Text style={styles.small} numberOfLines={1}>
                    {`Samples: ${snd.credit}`}
                  </Text>
                ) : null}
              </View>
            </View>
            <KeyMap zones={snd.zones.map((z) => [z.lo, z.hi, z.root])} color={SOUND_COLORS[i % SOUND_COLORS.length]} />
            <View style={styles.row}>
              {(["Upper 1", "Upper 2", "Upper 3", "Lower"] as const).map((label, part) => (
                <LcdButton
                  key={label}
                  label={on(part) ? `● ${label}` : label}
                  primary={on(part)}
                  disabled={id < 0}
                  onPress={() => vm.selectSound(id, part)}
                  style={styles.flex}
                />
              ))}
            </View>
          </View>
        )
      })}
    </>
  )
}

function SoundTimeline({ m }: { m: AiManifest }) {
  const stems = Array.from(new Set((m.timeline ?? []).map((t) => t.stem)))
  const cats = Array.from(new Set(m.sounds.map((x) => x.category)))
  if (!stems.length) return null
  return (
    <View style={{ gap: 4 }}>
      {stems.map((stem) => (
        <View key={stem} style={styles.row}>
          <Text style={[styles.small, { width: 46 }]}>{stem}</Text>
          <View style={[styles.timeline, styles.flex, { height: 16 }]}>
            {(m.timeline ?? [])
              .filter((t) => t.stem === stem)
              .map((t, i) => {
                const ci = cats.indexOf(t.category)
                return (
                  <View
                    key={i}
                    style={[
                      styles.abs,
                      {
                        left: `${(t.start / m.duration) * 100}%`,
                        width: `${Math.max(0.5, ((t.end - t.start) / m.duration) * 100)}%`,
                        backgroundColor: ci >= 0 ? SOUND_COLORS[ci % SOUND_COLORS.length] : "#7A858F",
                      },
                    ]}
                  />
                )
              })}
          </View>
        </View>
      ))}
      <Text style={styles.small}>Where each sound plays in the song (sound changes over time).</Text>
    </View>
  )
}

function KeyMap({ zones, color }: { zones: [number, number, number][]; color: string }) {
  const lo = 21
  const hi = 108
  const span = hi - lo + 1
  return (
    <View style={[styles.timeline, { height: 14 }]} accessibilityLabel="Sample zones across the keyboard">
      {zones.map(([a, b, root], i) => (
        <View
          key={i}
          style={[
            styles.abs,
            {
              left: `${((a - lo) / span) * 100}%`,
              width: `${((b - a + 1) / span) * 100}%`,
              backgroundColor: i % 2 ? color : `${color}AA`,
            },
          ]}
        >
          <View style={[styles.rootMark, { left: `${((root - a + 0.5) / (b - a + 1)) * 100}%` }]} />
        </View>
      ))}
    </View>
  )
}

function LibraryList({ ai, onOpen }: { ai: AiLab; onOpen: (e: AiEntry) => void }) {
  if (!ai.entries.length) {
    return (
      <Section title="Library">
        <Text style={styles.hint}>Styles and sounds you make from songs are kept here.</Text>
      </Section>
    )
  }
  return (
    <>
      {ai.entries.map((e) => (
        <View key={e.id} style={styles.section}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle} numberOfLines={1}>
                {e.name}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {e.kind === "drums"
                  ? `Drum style · ${e.manifest.bpm} BPM · ${e.manifest.meter}/4`
                  : `${e.manifest.sounds.length} sound${e.manifest.sounds.length === 1 ? "" : "s"} · ${e.manifest.sounds.map((x) => x.category).join(", ")}`}
                {` · ${new Date(e.created).toLocaleDateString()}`}
              </Text>
            </View>
            <LcdButton label="Open" primary onPress={() => onOpen(e)} />
            <LcdButton label="Delete" danger onPress={() => ai.remove(e.id)} />
          </View>
        </View>
      ))}
      <Text style={styles.small}>Deleting removes the files; a style or sound already loaded stays playable until the app restarts.</Text>
    </>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.statUnit}>{` ${unit}`}</Text> : null}
      </Text>
    </View>
  )
}

function SignIn({ auth }: { auth: Auth }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const ok = /.+@.+\..+/.test(email.trim()) && password.length >= 8
  return (
    <Section title="Sign in to use AI Lab">
      <Text style={styles.hint}>
        AI Lab runs on the ArrangerBox GPU server, so it needs an account. Everything else in the app works without one.
      </Text>
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
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, padding: 6, borderRadius: 6, backgroundColor: Lcd.cell, alignItems: "center" },
  statLabel: { color: Lcd.dim, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  statValue: { color: Lcd.text, fontSize: 18, fontWeight: "900" },
  statUnit: { color: Lcd.dim, fontSize: 10, fontWeight: "800" },
  timeline: { flexDirection: "row", height: 26, borderRadius: 4, overflow: "hidden", backgroundColor: Lcd.line, gap: 1 },
  block: { flexBasis: 0, justifyContent: "center", paddingHorizontal: 3 },
  blockLabel: { color: "#1B2026", fontSize: 9.5, fontWeight: "900" },
  fillMark: { position: "absolute", top: 0, bottom: 0, width: 3, marginLeft: -1, backgroundColor: Lcd.orange },
  abs: { position: "absolute", top: 0, bottom: 0 },
  rootMark: { position: "absolute", top: 2, bottom: 2, width: 2, marginLeft: -1, backgroundColor: "#1B2026" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gridWide: { gap: 8 },
  chip: { flexBasis: "30%", flexGrow: 1, padding: 6, borderRadius: 6, backgroundColor: Lcd.cell },
  chipWide: { flexBasis: "13%" },
  chipTitle: { color: Lcd.text, fontSize: 11.5, fontWeight: "900" },
  chipSub: { color: Lcd.dim, fontSize: 10, fontWeight: "700" },
})

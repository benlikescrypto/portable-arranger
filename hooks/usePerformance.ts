import { audio, EngineCmd } from "arrangerbox-audio"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { useArranger } from "@/hooks/useArranger"
import { readJson, writeJson } from "@/lib/storage"
import { telemetryNow } from "@/lib/telemetry"
import type { SoundItem, StyleItem } from "@/lib/types"

type Vm = ReturnType<typeof useArranger>

// ───────────────────────── Mixer ─────────────────────────

export type StripId = "up1" | "up2" | "up3" | "low" | "drum" | "bass" | "acc1" | "acc2" | "acc3" | "pad" | "metro"

export const STRIPS: { id: StripId; label: string; channels: number[]; group: "kbd" | "style" | "other" }[] = [
  { id: "up1", label: "UP1", channels: [0], group: "kbd" },
  { id: "up2", label: "UP2", channels: [1], group: "kbd" },
  { id: "up3", label: "UP3", channels: [2], group: "kbd" },
  { id: "low", label: "LOW", channels: [3], group: "kbd" },
  { id: "drum", label: "DRUM", channels: [9], group: "style" },
  { id: "bass", label: "BASS", channels: [8], group: "style" },
  { id: "acc1", label: "ACC1", channels: [4], group: "style" },
  { id: "acc2", label: "ACC2", channels: [5], group: "style" },
  { id: "acc3", label: "ACC3", channels: [6], group: "style" },
  { id: "pad", label: "PADS", channels: [10, 11, 12, 13], group: "other" },
  { id: "metro", label: "CLICK", channels: [15], group: "other" },
]

export type Strip = { gain: number; pan: number; mute: boolean; solo: boolean }

function defaultStrips(): Record<StripId, Strip> {
  const out = {} as Record<StripId, Strip>
  for (const s of STRIPS) out[s.id] = { gain: s.id === "metro" ? 0.7 : 1, pan: 0, mute: false, solo: false }
  return out
}

// ───────────────────────── Keyboard Sets ─────────────────────────

export type KbdPart = { sound: string | null; on: boolean; octave: number; volume: number }
export type KbdSet = { name: string; parts: KbdPart[]; ensemble: number; split?: number }

const DEFAULT_STS: { name: string; sounds: string[][] }[] = [
  { name: "Piano & Strings", sounds: [["Concert Grand"], ["Concert Strings", "Chamber Strings"], [], ["Concert Strings"]] },
  { name: "Jazz Organ", sounds: [["Jazz Organ", "Rock Organ"], [], [], ["Jazz Organ"]] },
  { name: "Lead Guitar", sounds: [["Distorted Guitar", "Overdrive Guitar"], [], [], ["Clean Electric"]] },
  { name: "Accordion", sounds: [["Accordion", "Musette Accordion"], ["Kanun", "Qanun"], [], ["Accordion"]] },
]

// ───────────────────────── SongBook ─────────────────────────

export type SongEntry = {
  id: string
  title: string
  artist: string
  genre: string
  key: string
  styleName: string
  tempo: number
  transpose: number
  variation: number
  kbd: KbdSet
  notes: string
  favorite?: boolean
}

// ───────────────────────── Pads ─────────────────────────

export type PadMode = "hit" | "chord" | "note"
export type PadSlot = { name: string; sound: string; mode: PadMode; note: number }

const DEFAULT_PADS: PadSlot[] = [
  { name: "Crash", sound: "Standard Kit", mode: "hit", note: 49 },
  { name: "Hand Clap", sound: "Standard Kit", mode: "hit", note: 39 },
  { name: "Brass Hit", sound: "Brass Section", mode: "chord", note: 60 },
  { name: "Orch Hit", sound: "Symphonic Strings", mode: "chord", note: 60 },
]

// ───────────────────────── Sub Scale ─────────────────────────

/** Cents per pitch class, written for the key of C; the Key parameter rotates them. */
export const SCALES: { id: string; name: string; cents: number[] }[] = [
  { id: "equal", name: "Equal", cents: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "just", name: "Pure Major", cents: [0, 12, 4, 16, -14, -2, -10, 2, 14, -16, -4, -12] },
  { id: "pureMinor", name: "Pure Minor", cents: [0, 12, 4, 16, -14, -2, -10, 2, 14, -16, 18, -12] },
  { id: "pyth", name: "Pythagorean", cents: [0, 14, 4, -6, 8, -2, 12, 2, 16, 6, -4, 10] },
  { id: "werck", name: "Werckmeister", cents: [0, -10, -8, -6, -10, -2, -12, -4, -8, -12, -4, -8] },
  { id: "kirn", name: "Kirnberger", cents: [0, -10, -7, -6, -14, -2, -10, -3, -8, -10, -4, -12] },
  { id: "rast", name: "Arabic Rast", cents: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, -50] },
  { id: "bayati", name: "Arabic Bayati", cents: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, 0] },
  { id: "user", name: "User / Quarter Tone", cents: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
]

export const ENSEMBLE_MODES = ["Off", "Duet", "Close", "Block", "Octave"] as const
export const VELOCITY_CURVES = ["Soft", "Normal", "Hard", "Fixed"] as const
export const CHORD_SCANS = ["Lower", "Full", "Off"] as const
export const CHORD_MODES = ["Fingered", "One Finger"] as const

// ───────────────────────── State ─────────────────────────

export type Prefs = {
  strips: Record<StripId, Strip>
  octaves: number[]
  memory: boolean
  bassInversion: boolean
  manualBass: boolean
  synchroStop: boolean
  splitOn: boolean
  chordScan: number
  chordMode: number
  ensemble: number
  velocityCurve: number
  metronome: boolean
  metroVolume: number
  tempoLock: boolean
  fadeSeconds: number
  eq: number[]
  scaleId: string
  scaleKey: number
  userCents: number[]
  scaleToStyle: boolean
  pads: PadSlot[]
  masterVolume: number
}

const defaultPrefs: Prefs = {
  strips: defaultStrips(),
  octaves: [0, 0, 0, 0],
  memory: true,
  bassInversion: false,
  manualBass: false,
  synchroStop: false,
  splitOn: true,
  chordScan: 0,
  chordMode: 0,
  ensemble: 0,
  velocityCurve: 1,
  metronome: false,
  metroVolume: 0.7,
  tempoLock: false,
  fadeSeconds: 6,
  eq: [0, 0, 0],
  scaleId: "equal",
  scaleKey: 0,
  userCents: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  scaleToStyle: false,
  pads: DEFAULT_PADS,
  masterVolume: 0.95,
}

type Library = {
  sts: Record<string, (KbdSet | null)[]>
  kbdSets: KbdSet[]
}

type Book = {
  songs: SongEntry[]
  setList: string[]
}

const CHORD_TONES: number[][] = [
  [0, 4, 7], [0, 3, 7], [0, 4, 7, 10], [0, 3, 7, 10], [0, 4, 7, 11], [0, 5, 7],
  [0, 3, 6, 9], [0, 4, 7, 9], [0, 3, 7, 9], [0, 4, 7, 10, 14], [0, 2, 7], [0, 4, 8],
]

function findSound(sounds: SoundItem[], name: string | null | undefined) {
  if (!name) return undefined
  return sounds.find((s) => s.name === name)
}

function findByNames(sounds: SoundItem[], names: string[]) {
  for (const n of names) {
    const hit = findSound(sounds, n)
    if (hit) return hit
  }
  return undefined
}

function engineId(item?: SoundItem) {
  if (!item) return -1
  if (item.engineId != null && item.engineId >= 0) return item.engineId
  return item.loaded === false ? -1 : item.id
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function scaleCents(prefs: Pick<Prefs, "scaleId" | "scaleKey" | "userCents">) {
  const base = prefs.scaleId === "user" ? prefs.userCents : (SCALES.find((s) => s.id === prefs.scaleId)?.cents ?? SCALES[0].cents)
  const out = new Array(12).fill(0)
  for (let pc = 0; pc < 12; pc++) out[(pc + prefs.scaleKey) % 12] = base[pc] ?? 0
  return out
}

export function usePerformance(vm: Vm) {
  const s = vm.state
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs)
  const [library, setLibrary] = useState<Library>({ sts: {}, kbdSets: [] })
  const [book, setBook] = useState<Book>({ songs: [], setList: [] })
  const [loaded, setLoaded] = useState(false)
  const [activeSts, setActiveSts] = useState<number | null>(null)
  const [setListIndex, setSetListIndex] = useState(-1)
  const [currentSong, setCurrentSong] = useState<string | null>(null)
  const taps = useRef<number[]>([])
  const vmRef = useRef(vm)
  vmRef.current = vm
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  // ── load ──
  useEffect(() => {
    let alive = true
    void (async () => {
      const [p, l, b] = await Promise.all([
        readJson<Prefs>("performance.json", defaultPrefs),
        readJson<Library>("kbdsets.json", { sts: {}, kbdSets: [] }),
        readJson<Book>("songbook.json", { songs: [], setList: [] }),
      ])
      if (!alive) return
      setPrefs({ ...defaultPrefs, ...p, strips: { ...defaultStrips(), ...(p.strips ?? {}) } })
      setLibrary(l)
      setBook(b)
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (loaded) writeJson("performance.json", prefs)
  }, [prefs, loaded])
  useEffect(() => {
    if (loaded) writeJson("kbdsets.json", library)
  }, [library, loaded])
  useEffect(() => {
    if (loaded) writeJson("songbook.json", book)
  }, [book, loaded])

  // ── push everything to the engine once it is up ──
  const applyMixer = useCallback((strips: Record<StripId, Strip>) => {
    const anySolo = STRIPS.some((x) => strips[x.id].solo && x.id !== "metro")
    for (const def of STRIPS) {
      const st = strips[def.id]
      const muted = st.mute || (anySolo && !st.solo && def.id !== "metro")
      for (const ch of def.channels) {
        audio.control(EngineCmd.ChannelGain, ch, 0, st.gain)
        audio.control(EngineCmd.ChannelPan, ch, 0, st.pan)
        audio.control(EngineCmd.ChannelMute, ch, muted ? 1 : 0)
      }
    }
  }, [])

  const applyScale = useCallback((p: Prefs) => {
    const cents = scaleCents(p)
    for (let pc = 0; pc < 12; pc++) audio.control(EngineCmd.ScaleCents, pc, 0, cents[pc])
    audio.control(EngineCmd.ScaleToStyle, 0, p.scaleToStyle ? 1 : 0)
  }, [])

  const applyAll = useCallback(
    (p: Prefs) => {
      applyMixer(p.strips)
      p.octaves.forEach((o, part) => audio.control(EngineCmd.PartOctave, part, o))
      audio.control(EngineCmd.Memory, 0, p.memory ? 1 : 0)
      audio.control(EngineCmd.BassInversion, 0, p.bassInversion ? 1 : 0)
      audio.control(EngineCmd.ManualBass, 0, p.manualBass ? 1 : 0)
      audio.control(EngineCmd.SynchroStop, 0, p.synchroStop ? 1 : 0)
      audio.control(EngineCmd.SplitOn, 0, p.splitOn ? 1 : 0)
      audio.control(EngineCmd.ChordScan, 0, p.chordScan)
      audio.control(EngineCmd.ChordMode, 0, p.chordMode)
      audio.control(EngineCmd.Ensemble, 0, p.ensemble)
      audio.control(EngineCmd.VelocityCurve, 0, p.velocityCurve)
      audio.control(EngineCmd.Metronome, 0, p.metronome ? 1 : 0, p.metroVolume)
      p.eq.forEach((db, band) => audio.control(EngineCmd.Eq, band, 0, db))
      applyScale(p)
      audio.setMixer(5, p.masterVolume)
    },
    [applyMixer, applyScale]
  )

  const appliedOnce = useRef(false)
  useEffect(() => {
    if (!loaded || !s.arrangerReady || appliedOnce.current) return
    appliedOnce.current = true
    applyAll(prefsRef.current)
  }, [loaded, s.arrangerReady, applyAll])

  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), [])

  // ── mixer ──
  const setStrip = useCallback(
    (id: StripId, patch: Partial<Strip>) => {
      setPrefs((p) => {
        const strips = { ...p.strips, [id]: { ...p.strips[id], ...patch } }
        applyMixer(strips)
        return { ...p, strips }
      })
    },
    [applyMixer]
  )
  const clearSolo = useCallback(() => {
    setPrefs((p) => {
      const strips = { ...p.strips }
      for (const k of Object.keys(strips) as StripId[]) strips[k] = { ...strips[k], solo: false }
      applyMixer(strips)
      return { ...p, strips }
    })
  }, [applyMixer])
  const resetMixer = useCallback(() => {
    const strips = defaultStrips()
    applyMixer(strips)
    setPrefs((p) => ({ ...p, strips }))
  }, [applyMixer])

  // ── switches ──
  const toggle = useCallback(
    (key: "memory" | "bassInversion" | "manualBass" | "synchroStop" | "splitOn" | "metronome" | "tempoLock" | "scaleToStyle") => {
      setPrefs((p) => {
        const on = !p[key]
        if (key === "memory") audio.control(EngineCmd.Memory, 0, on ? 1 : 0)
        if (key === "bassInversion") audio.control(EngineCmd.BassInversion, 0, on ? 1 : 0)
        if (key === "manualBass") audio.control(EngineCmd.ManualBass, 0, on ? 1 : 0)
        if (key === "synchroStop") audio.control(EngineCmd.SynchroStop, 0, on ? 1 : 0)
        if (key === "splitOn") audio.control(EngineCmd.SplitOn, 0, on ? 1 : 0)
        if (key === "metronome") {
          audio.control(EngineCmd.Metronome, 0, on ? 1 : 0, p.metroVolume)
          audio.control(EngineCmd.MetronomeRun, 0, on ? 1 : 0)
        }
        if (key === "scaleToStyle") audio.control(EngineCmd.ScaleToStyle, 0, on ? 1 : 0)
        return { ...p, [key]: on }
      })
    },
    []
  )

  const setChoice = useCallback((key: "chordScan" | "chordMode" | "ensemble" | "velocityCurve", value: number) => {
    const cmd =
      key === "chordScan"
        ? EngineCmd.ChordScan
        : key === "chordMode"
          ? EngineCmd.ChordMode
          : key === "ensemble"
            ? EngineCmd.Ensemble
            : EngineCmd.VelocityCurve
    audio.control(cmd, 0, value)
    setPrefs((p) => ({ ...p, [key]: value }))
  }, [])

  const setOctave = useCallback((part: number, octave: number) => {
    const o = Math.max(-3, Math.min(3, octave))
    audio.control(EngineCmd.PartOctave, part, o)
    setPrefs((p) => {
      const octaves = [...p.octaves]
      octaves[part] = o
      return { ...p, octaves }
    })
  }, [])

  const setEq = useCallback((band: number, db: number) => {
    const v = Math.max(-12, Math.min(12, Math.round(db * 2) / 2))
    audio.control(EngineCmd.Eq, band, 0, v)
    setPrefs((p) => {
      const eq = [...p.eq]
      eq[band] = v
      return { ...p, eq }
    })
  }, [])

  const setMetroVolume = useCallback((v: number) => {
    setPrefs((p) => {
      audio.control(EngineCmd.Metronome, 0, p.metronome ? 1 : 0, v)
      const strips = { ...p.strips, metro: { ...p.strips.metro, gain: v } }
      return { ...p, metroVolume: v, strips }
    })
  }, [])

  const setMasterVolume = useCallback((v: number) => {
    audio.setMixer(5, v)
    setPrefs((p) => ({ ...p, masterVolume: v }))
  }, [])

  // ── scale ──
  const setScale = useCallback(
    (patch: Partial<Pick<Prefs, "scaleId" | "scaleKey" | "userCents" | "scaleToStyle">>) => {
      setPrefs((p) => {
        const next = { ...p, ...patch }
        applyScale(next)
        return next
      })
    },
    [applyScale]
  )
  const toggleQuarterTone = useCallback(
    (pc: number) => {
      setPrefs((p) => {
        // Editing a key switches to the User scale, starting from what is playing now.
        const start = p.scaleId === "user" ? p.userCents : scaleCents({ ...p, scaleKey: 0 })
        const userCents = [...start]
        const at = (pc - (p.scaleId === "user" ? p.scaleKey : 0) + 12) % 12
        userCents[at] = userCents[at] === -50 ? 0 : -50
        const next = { ...p, scaleId: "user", userCents, scaleKey: p.scaleId === "user" ? p.scaleKey : 0 }
        applyScale(next)
        return next
      })
    },
    [applyScale]
  )

  // ── tempo ──
  const tapTempo = useCallback(() => {
    const now = Date.now()
    const list = taps.current.filter((t) => now - t < 2500)
    list.push(now)
    taps.current = list.slice(-5)
    if (taps.current.length < 2) return
    const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i])
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const bpm = Math.round(60000 / avg)
    if (bpm >= 40 && bpm <= 240) vmRef.current.nudgeTempo(bpm - vmRef.current.state.tempo)
  }, [])

  const selectStyle = useCallback((id: number) => {
    vmRef.current.selectStyle(id, prefsRef.current.tempoLock)
  }, [])

  // ── fades ──
  const fadeIn = useCallback(() => audio.control(EngineCmd.Fade, 0, 1, prefsRef.current.fadeSeconds), [])
  const fadeOut = useCallback(() => audio.control(EngineCmd.Fade, 0, 2, prefsRef.current.fadeSeconds), [])

  // ── keyboard sets ──
  const currentStyle: StyleItem | undefined = s.styles.find((x) => x.id === s.styleId)
  const styleKey = currentStyle?.name ?? "—"

  const captureKbdSet = useCallback(
    (name: string): KbdSet => {
      const st = vmRef.current.state
      const p = prefsRef.current
      const nameOf = (id: number | null) => (id == null ? null : (st.sounds.find((x) => x.id === id)?.name ?? null))
      return {
        name,
        parts: [
          { sound: nameOf(st.upper1), on: true, octave: p.octaves[0], volume: p.strips.up1.gain },
          { sound: nameOf(st.upper2), on: st.upper2On, octave: p.octaves[1], volume: p.strips.up2.gain },
          { sound: nameOf(st.upper3), on: st.upper3On, octave: p.octaves[2], volume: p.strips.up3.gain },
          { sound: nameOf(st.lower), on: st.lowerOn, octave: p.octaves[3], volume: p.strips.low.gain },
        ],
        ensemble: p.ensemble,
        split: st.split,
      }
    },
    []
  )

  const recallKbdSet = useCallback(
    (set: KbdSet) => {
      const v = vmRef.current
      set.parts.forEach((part, i) => {
        const item = findSound(v.state.sounds, part.sound)
        if (i > 0) v.setPartOn(i, part.on && !!item)
        if (item) v.selectSound(item.id, i, false)
        setOctave(i, part.octave ?? 0)
      })
      setPrefs((p) => {
        const strips = { ...p.strips }
        const ids: StripId[] = ["up1", "up2", "up3", "low"]
        set.parts.forEach((part, i) => {
          strips[ids[i]] = { ...strips[ids[i]], gain: part.volume ?? 1 }
        })
        applyMixer(strips)
        audio.control(EngineCmd.Ensemble, 0, set.ensemble ?? 0)
        return { ...p, strips, ensemble: set.ensemble ?? 0 }
      })
      if (set.split) v.setSplit(set.split)
    },
    [applyMixer, setOctave]
  )

  const stsSlots = useMemo(() => {
    const stored = library.sts[styleKey] ?? []
    return [0, 1, 2, 3].map((i) => {
      const own = stored[i]
      if (own) return { set: own, stored: true }
      const def = DEFAULT_STS[i]
      const parts: KbdPart[] = def.sounds.map((names, pi) => {
        const hit = findByNames(s.sounds, names)
        return { sound: hit?.name ?? null, on: pi === 0 || (pi === 3 ? true : !!hit), octave: 0, volume: 1 }
      })
      return { set: { name: def.name, parts, ensemble: 0 } as KbdSet, stored: false }
    })
  }, [library.sts, styleKey, s.sounds])

  const pressSts = useCallback(
    (n: number) => {
      const slot = stsSlots[n]
      if (!slot) return
      recallKbdSet(slot.set)
      setActiveSts(n)
    },
    [recallKbdSet, stsSlots]
  )

  const writeSts = useCallback(
    (n: number, name?: string) => {
      const set = captureKbdSet(name || stsSlots[n]?.set.name || `STS ${n + 1}`)
      setLibrary((l) => {
        const row = [...(l.sts[styleKey] ?? [null, null, null, null])]
        row[n] = set
        return { ...l, sts: { ...l.sts, [styleKey]: row } }
      })
      setActiveSts(n)
    },
    [captureKbdSet, stsSlots, styleKey]
  )

  const saveKbdSet = useCallback(
    (name: string) => {
      const set = captureKbdSet(name)
      setLibrary((l) => ({ ...l, kbdSets: [...l.kbdSets.filter((k) => k.name !== name), set] }))
    },
    [captureKbdSet]
  )
  const deleteKbdSet = useCallback((name: string) => {
    setLibrary((l) => ({ ...l, kbdSets: l.kbdSets.filter((k) => k.name !== name) }))
  }, [])

  // ── pads ──
  const padHeld = useRef<Record<number, { id: number; notes: number[] }>>({})
  const padDown = useCallback((slot: number) => {
    const p = prefsRef.current.pads[slot]
    const sound = findSound(vmRef.current.state.sounds, p?.sound)
    const id = engineId(sound)
    if (!p || id < 0) return
    let notes = [p.note]
    if (p.mode === "chord") {
      const t = telemetryNow()
      const root = 60 + (((t.chordRoot % 12) + 12) % 12)
      notes = (CHORD_TONES[t.chordType] ?? CHORD_TONES[0]).map((iv) => root + iv)
    }
    notes.forEach((n) => audio.control(EngineCmd.PadOn, id, n, 112, slot))
    padHeld.current[slot] = { id, notes }
  }, [])
  const padUp = useCallback((slot: number) => {
    const held = padHeld.current[slot]
    const p = prefsRef.current.pads[slot]
    if (!held) return
    // Hits ring out; held chords / notes stop with the finger.
    if (p?.mode !== "hit") held.notes.forEach((n) => audio.control(EngineCmd.PadOff, held.id, n, 0, slot))
    delete padHeld.current[slot]
  }, [])
  const padsStop = useCallback(() => {
    audio.control(EngineCmd.PadsOff)
    padHeld.current = {}
  }, [])
  const setPad = useCallback((slot: number, patch: Partial<PadSlot>) => {
    setPrefs((p) => {
      const pads = [...p.pads]
      pads[slot] = { ...pads[slot], ...patch }
      return { ...p, pads }
    })
  }, [])

  // ── SongBook ──
  const songFromCurrent = useCallback(
    (fields: Partial<SongEntry>): SongEntry => {
      const st = vmRef.current.state
      const style = st.styles.find((x) => x.id === st.styleId)
      return {
        id: uid(),
        title: "New Song",
        artist: "",
        genre: style?.category ?? "",
        key: "",
        styleName: style?.name ?? "",
        tempo: Math.round(st.tempo),
        transpose: st.transpose,
        variation: telemetryNow().variation || st.variation || 1,
        kbd: captureKbdSet(fields.title || "Song Set"),
        notes: "",
        ...fields,
      }
    },
    [captureKbdSet]
  )

  const addSong = useCallback(
    (fields: Partial<SongEntry>) => {
      const entry = songFromCurrent(fields)
      setBook((b) => ({ ...b, songs: [...b.songs, entry] }))
      setCurrentSong(entry.id)
      return entry
    },
    [songFromCurrent]
  )

  const updateSong = useCallback((id: string, patch: Partial<SongEntry>) => {
    setBook((b) => ({ ...b, songs: b.songs.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  }, [])

  const overwriteSong = useCallback(
    (id: string) => {
      setBook((b) => ({
        ...b,
        songs: b.songs.map((x) => {
          if (x.id !== id) return x
          const fresh = songFromCurrent({ title: x.title })
          return { ...fresh, id: x.id, title: x.title, artist: x.artist, genre: x.genre, key: x.key, notes: x.notes, favorite: x.favorite }
        }),
      }))
    },
    [songFromCurrent]
  )

  const deleteSong = useCallback((id: string) => {
    setBook((b) => ({ songs: b.songs.filter((x) => x.id !== id), setList: b.setList.filter((x) => x !== id) }))
  }, [])

  const recallSong = useCallback(
    (entry: SongEntry) => {
      const v = vmRef.current
      const style = v.state.styles.find((x) => x.name === entry.styleName)
      if (entry.tempo) v.nudgeTempo(entry.tempo - v.state.tempo)
      if (style) v.selectStyle(style.id, true)
      if (entry.transpose !== v.state.transpose) v.transpose(entry.transpose - v.state.transpose)
      if (entry.variation) v.book(3 + Math.max(1, Math.min(4, entry.variation)))
      if (entry.kbd) recallKbdSet(entry.kbd)
      setCurrentSong(entry.id)
      setActiveSts(null)
    },
    [recallKbdSet]
  )

  const toggleSetList = useCallback((id: string) => {
    setBook((b) => ({ ...b, setList: b.setList.includes(id) ? b.setList.filter((x) => x !== id) : [...b.setList, id] }))
  }, [])
  const moveInSetList = useCallback((id: string, delta: number) => {
    setBook((b) => {
      const list = [...b.setList]
      const i = list.indexOf(id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= list.length) return b
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...b, setList: list }
    })
  }, [])
  const stepSetList = useCallback(
    (delta: number) => {
      const list = book.setList.map((id) => book.songs.find((x) => x.id === id)).filter(Boolean) as SongEntry[]
      if (!list.length) return
      const next = Math.max(0, Math.min(list.length - 1, setListIndex + delta))
      setSetListIndex(next)
      recallSong(list[next])
    },
    [book, recallSong, setListIndex]
  )

  return {
    prefs,
    library,
    book,
    activeSts,
    currentSong,
    setListIndex,
    stsSlots,
    update,
    setStrip,
    clearSolo,
    resetMixer,
    toggle,
    setChoice,
    setOctave,
    setEq,
    setMetroVolume,
    setMasterVolume,
    setScale,
    toggleQuarterTone,
    tapTempo,
    selectStyle,
    fadeIn,
    fadeOut,
    pressSts,
    writeSts,
    saveKbdSet,
    deleteKbdSet,
    recallKbdSet,
    padDown,
    padUp,
    padsStop,
    setPad,
    addSong,
    updateSong,
    overwriteSong,
    deleteSong,
    recallSong,
    toggleSetList,
    moveInSetList,
    stepSetList,
    setSetListIndex,
  }
}

export type Perf = ReturnType<typeof usePerformance>

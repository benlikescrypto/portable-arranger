import { audio, isAudioNativeAvailable } from "arrangerbox-audio"
import { midi } from "arrangerbox-midi"
import * as SplashScreen from "expo-splash-screen"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert } from "react-native"

import {
  cachedFileName,
  loadDiskCatalog,
  loadDiskItem,
  mergePads,
  mergeSounds,
  mergeStyles,
  setPathForName,
} from "@/lib/library/diskCatalog"
import {
  importPa4xSet,
  readSavedSelection,
  writeSavedSelection,
  type ImportMode,
} from "@/lib/library/setImporter"
import type { ArrangerUiState, LibraryKind, Mode, PadItem, SoundItem, StyleItem } from "@/lib/types"

function catalogSounds(): SoundItem[] {
  return audio.listSounds().map((item) => ({
    ...item,
    bank: item.source === "FACTORY" || !item.source ? "FACTORY" : item.source,
    source: item.source ?? "FACTORY",
    loaded: true,
    engineId: item.id,
  }))
}

let factoryStyleCount = 0

function findSoundId(sounds: SoundItem[], names: string[], fallback = 0) {
  for (const name of names) {
    const hit = sounds.find((item) => item.name === name)
    if (hit) return hit.id
  }
  return fallback
}

function findStyleId(styles: StyleItem[], names: string[], fallback = 0) {
  for (const name of names) {
    const hit = styles.find((item) => item.name === name)
    if (hit) return hit.id
  }
  return fallback
}

function isImportedSound(item: SoundItem) {
  return (item.source ?? "FACTORY").toUpperCase() !== "FACTORY"
}

function catalogStyles(): StyleItem[] {
  return audio.listStyles().map((item) => {
    const imported = factoryStyleCount > 0 && item.id >= factoryStyleCount
    return {
      ...item,
      bank: imported ? "IMPORTED" : "FACTORY",
      source: imported ? "IMPORTED" : "FACTORY",
      category: imported && item.category === "Style" ? "Imported" : item.category,
      loaded: true,
      engineId: item.id,
    }
  })
}

function engineProgram(item?: { loaded?: boolean; engineId?: number; id: number } | null) {
  if (!item) return -1
  if (item.engineId != null && item.engineId >= 0) return item.engineId
  if (item.loaded !== false) return item.id
  return -1
}

function hideSplash() {
  void SplashScreen.hideAsync().catch(() => {})
}

const initial: ArrangerUiState = {
  mode: "STYLE",
  setName: "",
  adapterName: "ArrangerBox",
  sounds: [],
  styles: [],
  pads: [],
  query: "",
  category: "All",
  upper1: 0,
  upper2: 7,
  upper3: 11,
  lower: 21,
  upper2On: false,
  upper3On: false,
  lowerOn: false,
  split: 54,
  styleId: 0,
  padId: 0,
  tempo: 112,
  transpose: 0,
  variation: 1,
  section: 4,
  playing: false,
  synchro: false,
  autoFill: true,
  chordRoot: 0,
  chordType: 0,
  mixer: { keyboard: 1, drums: 1, bass: 1, acc: 1, pad: 1, master: 0.95 },
  midiConnected: false,
  midiName: "MIDI",
  latencyMs: 8,
  nativeReady: false,
  arrangerReady: false,
  importMessage: "Loading arranger…",
  importing: true,
  importProgress: 0,
  setFiles: [],
  sts: 1,
  favorites: [],
  octave: 0,
  reverb: 0.18,
  chorus: 0.08,
  delay: 0,
  recentSounds: [],
  recentStyles: [],
  libraryFilter: "all",
  importReport: "",
}

export function useArranger() {
  const [state, setState] = useState<ArrangerUiState>(initial)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!isAudioNativeAvailable) {
        setState((s) => ({
          ...s,
          arrangerReady: true,
          importing: false,
          importMessage: "Native audio requires an Expo development build.",
        }))
        hideSplash()
        return
      }
      let started = false
      try {
        started = await audio.start()
      } catch (error) {
        console.log("[boot] audio.start failed", error)
      }
      if (!alive) {
        hideSplash()
        return
      }
      factoryStyleCount = catalogStyles().length
      const saved = await readSavedSelection()
      const factorySounds = catalogSounds()
      const factoryStyles = catalogStyles()
      const upper1 = findSoundId(factorySounds, [saved.upper1Name, "Concert Grand"].filter(Boolean) as string[])
      const upper2 = findSoundId(
        factorySounds,
        [saved.upper2Name, "Warm Pad", "Atmosphere"].filter(Boolean) as string[],
        11
      )
      const upper3 = findSoundId(
        factorySounds,
        [saved.upper3Name, "Concert Strings", "Chamber Strings"].filter(Boolean) as string[],
        10
      )
      const lower = findSoundId(
        factorySounds,
        [saved.lowerName, "Cinematic Strings", "Symphonic Strings", "Concert Strings"].filter(Boolean) as string[],
        10
      )
      const styleId = findStyleId(
        factoryStyles,
        [saved.styleName, factoryStyles[0]?.name].filter(Boolean) as string[],
        factoryStyles[0]?.id ?? 0
      )
      const style = factoryStyles.find((item) => item.id === styleId)
      const factoryProg = (id: number, fallback: number) => {
        const prog = engineProgram(factorySounds.find((item) => item.id === id))
        return prog >= 0 ? prog : fallback
      }
      audio.setPartProgram(0, factoryProg(upper1, 0))
      audio.setPartProgram(1, factoryProg(upper2, 7))
      audio.setPartProgram(2, factoryProg(upper3, 11))
      audio.setPartProgram(3, factoryProg(lower, 21))
      audio.setPartEnable(1, false)
      audio.setPartEnable(2, false)
      audio.setPartEnable(3, true)
      audio.setSplit(54)
      audio.setSynchro(false)
      audio.setFx(0, 0.18)
      audio.setFx(1, 0.08)
      if (styleId >= 0) {
        audio.setStyle(styleId)
        audio.setTempo(style?.tempo || 112)
      }

      const factoryName = (name?: string) =>
        !!name &&
        (factorySounds.some((item) => item.name === name) || factoryStyles.some((item) => item.name === name))
      const setPath = setPathForName(saved.setName)
      const catalogP = loadDiskCatalog()
      const session = [
        { kind: "sound" as const, name: saved.upper1Name, part: 0 as const },
        { kind: "sound" as const, name: saved.upper2Name, part: 1 as const },
        { kind: "sound" as const, name: saved.upper3Name, part: 2 as const },
        { kind: "sound" as const, name: saved.lowerName, part: 3 as const },
        { kind: "style" as const, name: saved.styleName, part: null },
      ]
      try {
        for (const job of session) {
          if (!alive) return
          if (!job.name || factoryName(job.name) || !setPath) continue
          const fileName = await cachedFileName(setPath, job.kind, job.name)
          if (job.kind === "style" && (!fileName || !/\.(MID|SMF)$/i.test(fileName))) continue
          await loadDiskItem({ kind: job.kind, name: job.name, setPath, fileName })
          const soundsNow = catalogSounds()
          const stylesNow = catalogStyles()
          if (job.kind === "sound" && job.part != null) {
            const hit = soundsNow.find((item) => item.name === job.name)
            const prog = engineProgram(hit)
            if (prog >= 0) audio.setPartProgram(job.part, prog)
          }
          if (job.kind === "style") {
            const hit = stylesNow.find((item) => item.name === job.name)
            const prog = engineProgram(hit)
            if (prog >= 0) {
              audio.setStyle(prog)
              if (hit?.tempo) audio.setTempo(hit.tempo)
            }
          }
        }
      } catch (error) {
        console.log("[boot] session load failed", error)
      }
      if (!alive) return

      let disk: Awaited<ReturnType<typeof loadDiskCatalog>> = { setName: "", sounds: [], styles: [], pads: [] }
      try {
        disk = await catalogP
      } catch (error) {
        console.log("[boot] library catalog failed", error)
      }
      if (!alive) return

      const sounds = mergeSounds(catalogSounds(), disk.sounds)
      const styles = mergeStyles(catalogStyles(), disk.styles)
      const pads = mergePads(catalogStyles(), disk.pads)
      const nextUpper1 = findSoundId(sounds, [saved.upper1Name, "Concert Grand"].filter(Boolean) as string[])
      const nextUpper2 = findSoundId(sounds, [saved.upper2Name, "Warm Pad", "Atmosphere"].filter(Boolean) as string[], 11)
      const nextUpper3 = findSoundId(
        sounds,
        [saved.upper3Name, "Concert Strings", "Chamber Strings"].filter(Boolean) as string[],
        10
      )
      const nextLower = findSoundId(
        sounds,
        [saved.lowerName, "Cinematic Strings", "Symphonic Strings", "Concert Strings"].filter(Boolean) as string[],
        10
      )
      const nextStyleId = findStyleId(
        styles,
        [saved.styleName, styles[0]?.name].filter(Boolean) as string[],
        styles[0]?.id ?? 0
      )
      const nextStyle = styles.find((item) => item.id === nextStyleId)
      const userOnDisk = disk.sounds.length + disk.styles.length + disk.pads.length
      setState((s) => ({
        ...s,
        sounds,
        styles,
        pads,
        nativeReady: started,
        arrangerReady: true,
        setName: saved.setName || disk.setName || "",
        upper1: nextUpper1,
        upper2: nextUpper2,
        upper3: nextUpper3,
        lower: nextLower,
        upper2On: false,
        upper3On: false,
        lowerOn: true,
        styleId: nextStyleId,
        tempo: nextStyle?.tempo || style?.tempo || 112,
        importing: false,
        importProgress: 1,
        importMessage: userOnDisk
          ? `${disk.sounds.length} User sounds · ${disk.styles.length} styles · ${disk.pads.length} pads — tap to load`
          : "",
      }))
      hideSplash()
      void midi.start()
    })()
    const sub = midi.addDeviceListener((event) => {
      setState((s) => ({ ...s, midiConnected: event.connected, midiName: event.name }))
    })
    const timer = setInterval(() => {
      const snap = audio.snapshot()
      if (!snap) return
      setState((s) => ({
        ...s,
        playing: snap.playing,
        section: snap.section,
        chordRoot: snap.chordRoot,
        chordType: snap.chordType,
        tempo: snap.tempo,
        latencyMs: snap.latencyMs,
      }))
    }, 50)
    return () => {
      alive = false
      sub.remove()
      clearInterval(timer)
      midi.stop()
    }
  }, [])

  const setMode = useCallback((mode: Mode) => setState((s) => ({ ...s, mode })), [])
  const setQuery = useCallback((query: string) => setState((s) => ({ ...s, query })), [])
  const setCategory = useCallback((category: string) => setState((s) => ({ ...s, category })), [])
  const setLibraryFilter = useCallback((libraryFilter: ArrangerUiState["libraryFilter"]) => {
    setState((s) => ({ ...s, libraryFilter }))
  }, [])

  const inFlight = useRef(new Set<string>())
  const nativeLoad = useRef(Promise.resolve())

  const patchProgress = useCallback((kind: LibraryKind, id: number, progress: number, extra: Record<string, unknown> = {}) => {
    setState((s) => {
      const patch = <T extends { id: number; loadingProgress?: number }>(rows: T[]) =>
        rows.map((row) => (row.id === id ? { ...row, loadingProgress: progress, ...extra } : row))
      if (kind === "sound") return { ...s, sounds: patch(s.sounds) }
      if (kind === "pad") return { ...s, pads: patch(s.pads) }
      return { ...s, styles: patch(s.styles) }
    })
  }, [])

  const assignSound = useCallback((s: ArrangerUiState, id: number, part: number, sounds: SoundItem[]) => {
    const item = sounds.find((row) => row.id === id)
    const prog = engineProgram(item)
    if (prog >= 0) {
      audio.setPartProgram(part, prog)
      if (part > 0) audio.setPartEnable(part, true)
    }
    if (item?.name) {
      void writeSavedSelection(
        part === 1
          ? { upper2Name: item.name }
          : part === 2
            ? { upper3Name: item.name }
            : part === 3
              ? { lowerName: item.name }
              : { upper1Name: item.name }
      )
    }
    const recentSounds = [id, ...s.recentSounds.filter((x) => x !== id)].slice(0, 12)
    if (part === 1) return { ...s, sounds, upper2: id, upper2On: true, recentSounds }
    if (part === 2) return { ...s, sounds, upper3: id, upper3On: true, recentSounds }
    if (part === 3) return { ...s, sounds, lower: id, recentSounds }
    return { ...s, sounds, upper1: id, recentSounds }
  }, [])

  const ensureLoaded = useCallback(
    async (kind: LibraryKind, id: number, item: SoundItem | StyleItem | PadItem | undefined) => {
      if (!item) return { ok: false, reason: "Missing." }
      if (item.loaded !== false && engineProgram(item) >= 0) return { ok: true, reason: "" }
      const key = `${kind}:${id}`
      if (inFlight.current.has(key)) return { ok: false, reason: "" }
      inFlight.current.add(key)
      const tick = setInterval(() => {
        setState((s) => {
          const bump = <T extends { id: number; loadingProgress?: number }>(rows: T[]) =>
            rows.map((row) =>
              row.id === id ? { ...row, loadingProgress: Math.min(0.9, (row.loadingProgress ?? 0.08) + 0.05) } : row
            )
          if (kind === "sound") return { ...s, sounds: bump(s.sounds) }
          if (kind === "pad") return { ...s, pads: bump(s.pads) }
          return { ...s, styles: bump(s.styles) }
        })
      }, 160)
      patchProgress(kind, id, 0.08, { loadError: undefined })
      try {
        const run = () =>
          loadDiskItem({
            kind,
            name: item.name,
            setPath: item.setPath,
            fileName: item.fileName,
          })
        const pending = nativeLoad.current.then(run, run)
        nativeLoad.current = pending.then(
          () => undefined,
          () => undefined
        )
        const result = await pending
        const ok = result.ok
        setState((s) => {
          const mark = <T extends { id: number; name: string; loaded?: boolean; engineId?: number }>(rows: T[]) =>
            rows.map((row) =>
              row.id === id
                ? {
                    ...row,
                    loaded: ok || row.loaded,
                    engineId: ok ? result.engineId : row.engineId,
                    loadingProgress: 0,
                    loadError: ok ? undefined : result.reason,
                  }
                : row
            )
          return {
            ...s,
            sounds: kind === "sound" ? mark(s.sounds) : s.sounds,
            styles: kind === "style" ? mark(s.styles) : s.styles,
            pads: kind === "pad" ? mark(s.pads) : s.pads,
            importMessage: ok ? s.importMessage : result.reason,
          }
        })
        return { ok, reason: result.reason }
      } finally {
        clearInterval(tick)
        inFlight.current.delete(key)
      }
    },
    [patchProgress]
  )

  const selectSound = useCallback(
    (id: number, part = 0) => {
      void (async () => {
        const current = await new Promise<ArrangerUiState>((resolve) => {
          setState((s) => {
            resolve(s)
            return s
          })
        })
        const item = current.sounds.find((row) => row.id === id)
        if (item?.loaded !== false && engineProgram(item) >= 0) {
          setState((s) => assignSound(s, id, part, s.sounds))
          return
        }
        const loaded = await ensureLoaded("sound", id, item)
        if (!loaded.ok && loaded.reason) {
          setState((s) => ({
            ...s,
            sounds: s.sounds.map((row) => (row.id === id ? { ...row, loadError: loaded.reason } : row)),
          }))
        }
      })()
    },
    [assignSound, ensureLoaded]
  )

  const togglePart = useCallback((part: number) => {
    setState((s) => {
      const on = part === 1 ? !s.upper2On : part === 2 ? !s.upper3On : part === 3 ? !s.lowerOn : true
      audio.setPartEnable(part, on)
      if (part === 1) return { ...s, upper2On: on }
      if (part === 2) return { ...s, upper3On: on }
      if (part === 3) return { ...s, lowerOn: on }
      return s
    })
  }, [])

  const selectStyle = useCallback(
    (id: number) => {
      void (async () => {
        const current = await new Promise<ArrangerUiState>((resolve) => {
          setState((s) => {
            resolve(s)
            return s
          })
        })
        const apply = (s: ArrangerUiState, styles: StyleItem[]) => {
          const style = styles.find((item) => item.id === id)
          const prog = engineProgram(style)
          const tempo = style?.tempo || s.tempo || 100
          if (prog >= 0) {
            audio.setStyle(prog)
            if (style?.tempo) audio.setTempo(tempo)
          }
          if (style?.name) void writeSavedSelection({ styleName: style.name })
          return {
            ...s,
            styles,
            styleId: id,
            tempo,
            recentStyles: [id, ...s.recentStyles.filter((x) => x !== id)].slice(0, 12),
          }
        }
        const item = current.styles.find((row) => row.id === id)
        if (item?.loaded !== false && engineProgram(item) >= 0) {
          setState((s) => apply(s, s.styles))
          return
        }
        const loaded = await ensureLoaded("style", id, item)
        if (!loaded.ok && loaded.reason) {
          setState((s) => ({
            ...s,
            styles: s.styles.map((row) => (row.id === id ? { ...row, loadError: loaded.reason } : row)),
          }))
        }
      })()
    },
    [ensureLoaded]
  )

  const selectPad = useCallback(
    (id: number) => {
      void (async () => {
        const current = await new Promise<ArrangerUiState>((resolve) => {
          setState((s) => {
            resolve(s)
            return s
          })
        })
        const item = current.pads.find((row) => row.id === id)
        if (item?.loaded !== false && engineProgram(item) >= 0) {
          setState((s) => ({ ...s, padId: id }))
          return
        }
        const loaded = await ensureLoaded("pad", id, item)
        if (!loaded.ok && loaded.reason) {
          setState((s) => ({
            ...s,
            pads: s.pads.map((row) => (row.id === id ? { ...row, loadError: loaded.reason } : row)),
          }))
        }
      })()
    },
    [ensureLoaded]
  )

  const book = useCallback((section: number) => {
    audio.bookSection(section)
    if (section >= 4 && section <= 7) setState((s) => ({ ...s, variation: section - 3, sts: section - 3 }))
  }, [])

  const setMixer = useCallback((bus: number, gain: number) => {
    audio.setMixer(bus, gain)
    setState((s) => {
      const mixer = { ...s.mixer }
      if (bus === 0) mixer.keyboard = gain
      else if (bus === 1) mixer.drums = gain
      else if (bus === 2) mixer.bass = gain
      else if (bus === 3) mixer.acc = gain
      else if (bus === 4) mixer.pad = gain
      else mixer.master = gain
      return { ...s, mixer }
    })
  }, [])

  const setAccVolume = useCallback((gain: number) => {
    audio.setMixer(1, gain)
    audio.setMixer(2, gain)
    audio.setMixer(3, gain)
    audio.setMixer(4, gain)
    setState((s) => ({
      ...s,
      mixer: { ...s.mixer, drums: gain, bass: gain, acc: gain, pad: gain },
    }))
  }, [])

  const runImport = useCallback(async (mode: ImportMode) => {
    setState((s) => ({
      ...s,
      importing: true,
      importProgress: 0,
      importMessage: mode === "folder" ? "Pick the PA4X .SET folder, then tap Open…" : "Pick PA4X STY / Style Record SMF / WAV…",
    }))
    try {
      const lib = await importPa4xSet(mode, (progress) => {
        setState((s) => ({ ...s, importMessage: progress.message, importProgress: progress.fraction }))
      })
      if (!lib) {
        setState((s) => ({ ...s, importing: false, importMessage: "Load cancelled." }))
        return
      }
      const disk = await loadDiskCatalog()
      const sounds = mergeSounds(catalogSounds(), disk.sounds)
      const styles = mergeStyles(catalogStyles(), disk.styles)
      const pads = mergePads(catalogStyles(), disk.pads)
      const importedStyles = styles.filter((item) => item.source === "IMPORTED")
      const importedSounds = sounds.filter(isImportedSound)
      void writeSavedSelection({ setName: lib.setName || disk.setName })
      const report = [
        `${importedSounds.length} User sound${importedSounds.length === 1 ? "" : "s"}`,
        `${importedStyles.length} style${importedStyles.length === 1 ? "" : "s"}`,
        `${pads.length} pad${pads.length === 1 ? "" : "s"}`,
        "tap a User square to load it into RAM",
        lib.reason?.trim(),
      ]
        .filter(Boolean)
        .join(" · ")
      console.log("[import] done", report, {
        set: lib.setName,
        files: lib.files.slice(0, 12).map((f) => f.relativePath),
      })
      setState((s) => ({
        ...s,
        importing: false,
        importProgress: 1,
        setName: lib.setName || disk.setName,
        adapterName: lib.adapterName,
        sounds,
        styles,
        pads,
        setFiles: lib.files.map((f) => f.relativePath),
        importReport: report,
        importMessage: report || "Import finished.",
        libraryFilter: "imported",
        mode: "STYLE",
      }))
      Alert.alert("Import", report || "Import finished.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "SET import failed"
      setState((s) => ({
        ...s,
        importing: false,
        importMessage: message,
      }))
      console.log("[import] failed", error)
      Alert.alert("Import failed", message)
    }
  }, [])

  const importSet = useCallback(() => {
    Alert.alert(
      "PA4X import",
      "ArrangerBox reads a Pa4X SET (STYLE / SOUND / PCM).\n\nNative USER01.STY banks are OC31-compressed (Korg never published that). The documented path is Style Record > Export SMF (hold Shift + Execute): format 0, markers v1cv1, channels 9–16.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "SET folder / zip", onPress: () => setTimeout(() => void runImport("folder"), 400) },
        { text: "SMF / STY / SET file", onPress: () => setTimeout(() => void runImport("files"), 400) },
      ]
    )
  }, [runImport])

  const actions = useMemo(
    () => ({
      setMode,
      setQuery,
      setCategory,
      setLibraryFilter,
      selectSound,
      togglePart,
      selectStyle,
      selectPad,
      book,
      setMixer,
      setAccVolume,
      importSet,
      toggleStart: () => {
        if (isAudioNativeAvailable) audio.arrangerToggle()
      },
      playNote: (note: number, vel = 100) => {
        audio.noteOn(0, note, vel)
      },
      releaseNote: (note: number) => {
        audio.noteOff(0, note)
      },
      nudgeTempo: (delta: number) => {
        setState((s) => {
          const tempo = Math.min(240, Math.max(40, s.tempo + delta))
          audio.setTempo(tempo)
          return { ...s, tempo }
        })
      },
      toggleSynchro: () =>
        setState((s) => {
          audio.setSynchro(!s.synchro)
          return { ...s, synchro: !s.synchro }
        }),
      toggleAutoFill: () =>
        setState((s) => {
          audio.setAutoFill(!s.autoFill)
          return { ...s, autoFill: !s.autoFill }
        }),
      transpose: (delta: number) =>
        setState((s) => {
          const transpose = Math.min(12, Math.max(-12, s.transpose + delta))
          audio.setTranspose(transpose)
          return { ...s, transpose }
        }),
      setOctave: (delta: number) =>
        setState((s) => {
          const octave = Math.min(3, Math.max(-3, s.octave + delta))
          audio.setOctave(octave)
          return { ...s, octave }
        }),
      setFx: (which: number, mix: number) => {
        audio.setFx(which, mix)
        setState((s) => {
          if (which === 0) return { ...s, reverb: mix }
          if (which === 1) return { ...s, chorus: mix }
          return { ...s, delay: mix }
        })
      },
      setSts: (n: number) => {
        const section = 3 + n
        audio.bookSection(section)
        setState((s) => {
          const names =
            n === 1
              ? ["Distorted Guitar", "Overdrive Guitar"]
              : n === 2
                ? ["Jazz Organ", "Rock Organ"]
                : n === 3
                  ? ["Concert Grand", "Pop Piano"]
                  : ["Accordion", "Kanun"]
          const id = findSoundId(s.sounds, names, s.upper1)
          const prog = engineProgram(s.sounds.find((item) => item.id === id))
          if (prog >= 0) audio.setPartProgram(0, prog)
          return { ...s, sts: n, variation: n, upper1: id }
        })
      },
      setSplit: (note: number) => {
        const split = Math.min(84, Math.max(24, note))
        audio.setSplit(split)
        setState((s) => ({ ...s, split }))
      },
      toggleFavorite: (id: number) =>
        setState((s) => ({
          ...s,
          favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id],
        })),
    }),
    [
      book,
      importSet,
      selectPad,
      selectSound,
      selectStyle,
      setAccVolume,
      setCategory,
      setLibraryFilter,
      setMixer,
      setMode,
      setQuery,
      togglePart,
    ]
  )

  return { state, ...actions }
}

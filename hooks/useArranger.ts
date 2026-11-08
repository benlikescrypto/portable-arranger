import { audio, isAudioNativeAvailable } from "arrangerbox-audio"
import { midi } from "arrangerbox-midi"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert } from "react-native"

import { importPa4xSet, type ImportMode } from "@/lib/library/setImporter"
import type { ArrangerUiState, Mode, SoundItem, StyleItem } from "@/lib/types"

function catalogSounds(): SoundItem[] {
  return audio.listSounds().map((item) => ({
    ...item,
    bank: item.source === "FACTORY" || !item.source ? "FACTORY" : item.source,
    source: item.source ?? "FACTORY",
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

function catalogStyles(): StyleItem[] {
  return audio.listStyles().map((item) => {
    const imported = factoryStyleCount > 0 && item.id >= factoryStyleCount
    return {
      ...item,
      bank: imported ? "IMPORTED" : "FACTORY",
      source: imported ? "IMPORTED" : "FACTORY",
      category: imported && item.category === "Style" ? "Imported" : item.category,
    }
  })
}

const initial: ArrangerUiState = {
  mode: "STYLE",
  setName: "",
  adapterName: "ArrangerBox",
  sounds: [],
  styles: [],
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
  importMessage: "",
  importing: false,
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
        setState((s) => ({ ...s, importMessage: "Native audio requires an Expo development build." }))
        return
      }
      const started = await audio.start()
      if (!alive) return
      const sounds = catalogSounds()
      const styles = catalogStyles()
      factoryStyleCount = styles.length
      const upper1 = findSoundId(sounds, ["Concert Grand"])
      const upper2 = findSoundId(sounds, ["Warm Pad", "Atmosphere"], 11)
      const upper3 = findSoundId(sounds, ["Concert Strings", "Chamber Strings"], 10)
      const lower = findSoundId(sounds, ["Cinematic Strings", "Symphonic Strings", "Concert Strings"], 10)
      audio.setPartProgram(0, upper1)
      audio.setPartProgram(1, upper2)
      audio.setPartProgram(2, upper3)
      audio.setPartProgram(3, lower)
      audio.setPartEnable(1, false)
      audio.setPartEnable(2, false)
      audio.setPartEnable(3, true)
      audio.setSplit(54)
      audio.setSynchro(false)
      audio.setFx(0, 0.18)
      audio.setFx(1, 0.08)
      if (styles.length > 0) {
        audio.setStyle(0)
        audio.setTempo(styles[0].tempo || 112)
      }
      setState((s) => ({
        ...s,
        sounds,
        styles,
        nativeReady: started,
        upper1,
        upper2,
        upper3,
        lower,
        upper2On: false,
        upper3On: false,
        lowerOn: true,
        styleId: styles[0]?.id ?? 0,
        tempo: styles[0]?.tempo || 112,
        importMessage: "",
      }))
      await midi.start()
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

  const selectSound = useCallback((id: number, part = 0) => {
    setState((s) => {
      audio.setPartProgram(part, id)
      if (part > 0) audio.setPartEnable(part, true)
      const recentSounds = [id, ...s.recentSounds.filter((x) => x !== id)].slice(0, 12)
      if (part === 1) return { ...s, upper2: id, upper2On: true, recentSounds }
      if (part === 2) return { ...s, upper3: id, upper3On: true, recentSounds }
      if (part === 3) return { ...s, lower: id, recentSounds }
      return { ...s, upper1: id, recentSounds }
    })
  }, [])

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

  const selectStyle = useCallback((id: number) => {
    setState((s) => {
      const style = s.styles.find((item) => item.id === id)
      audio.setStyle(id)
      const tempo = style?.tempo || 100
      audio.setTempo(tempo)
      return {
        ...s,
        styleId: id,
        tempo,
        recentStyles: [id, ...s.recentStyles.filter((x) => x !== id)].slice(0, 12),
      }
    })
  }, [])

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
      const sounds = catalogSounds()
      const styles = catalogStyles()
      const importedStyles = styles.filter((item) => item.source === "IMPORTED")
      const next = importedStyles[importedStyles.length - 1]
      const loaded = next ? 1 : lib.stylesLoaded
      const report = [
        loaded ? `${importedStyles.length || lib.stylesLoaded} imported style${importedStyles.length === 1 ? "" : "s"}` : "0 styles imported",
        lib.patchesLoaded ? `${lib.patchesLoaded} instruments` : "",
        lib.samplesLoaded ? `${lib.samplesLoaded} samples` : "",
        lib.reason?.trim(),
      ]
        .filter(Boolean)
        .join(" · ")
      console.log("[import] done", report, {
        set: lib.setName,
        styles: lib.stylesLoaded,
        files: lib.files.slice(0, 12).map((f) => f.relativePath),
      })
      if (next) {
        audio.setStyle(next.id)
        if (next.tempo) audio.setTempo(next.tempo)
      }
      setState((s) => ({
        ...s,
        importing: false,
        importProgress: 1,
        setName: lib.setName,
        adapterName: lib.adapterName,
        sounds,
        styles,
        styleId: next ? next.id : s.styleId,
        tempo: next?.tempo || s.tempo,
        setFiles: lib.files.map((f) => f.relativePath),
        importReport: report,
        importMessage: report || "Import finished.",
        libraryFilter: next ? "imported" : s.libraryFilter,
        category: next ? "World" : s.category,
        mode: next ? "PAD" : "STYLE",
      }))
    } catch (error) {
      setState((s) => ({
        ...s,
        importing: false,
        importMessage: error instanceof Error ? error.message : "SET import failed",
      }))
      console.log("[import] failed", error)
    }
  }, [])

  const importSet = useCallback(() => {
    Alert.alert(
      "PA4X import",
      "ArrangerBox reads a Pa4X SET (STYLE / SOUND / PCM).\n\nNative USER01.STY banks are OC31-compressed (Korg never published that). The documented path is Style Record > Export SMF (hold Shift + Execute): format 0, markers v1cv1, channels 9–16.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "SET folder", onPress: () => setTimeout(() => void runImport("folder"), 400) },
        { text: "SMF / STY", onPress: () => setTimeout(() => void runImport("files"), 400) },
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
      book,
      setMixer,
      setAccVolume,
      importSet,
      toggleStart: () => {
        if (isAudioNativeAvailable) audio.arrangerToggle()
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
          audio.setPartProgram(0, id)
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
    [book, importSet, selectSound, selectStyle, setAccVolume, setCategory, setLibraryFilter, setMixer, setMode, setQuery, togglePart]
  )

  return { state, ...actions }
}

import { audio, isAudioNativeAvailable } from "arrangerbox-audio"
import { midi } from "arrangerbox-midi"
import { useCallback, useEffect, useMemo, useState } from "react"

import { importPa4xSet } from "@/lib/library/setImporter"
import type { ArrangerUiState, Mode } from "@/lib/types"

const initial: ArrangerUiState = {
  mode: "STYLE",
  setName: "Factory Engine",
  adapterName: "ArrangerBox",
  sounds: [],
  styles: [],
  query: "",
  category: "All",
  upper1: 0,
  upper2: 7,
  upper3: null,
  lower: 21,
  upper2On: false,
  upper3On: false,
  lowerOn: true,
  split: 60,
  styleId: 10,
  tempo: 98,
  transpose: 0,
  variation: 1,
  section: 4,
  playing: false,
  synchro: true,
  autoFill: true,
  chordRoot: 0,
  chordType: 0,
  mixer: { keyboard: 0.95, drums: 0.92, bass: 0.88, acc: 0.82, pad: 0.75, master: 0.9 },
  midiConnected: false,
  midiName: "MIDI",
  latencyMs: 8,
  nativeReady: false,
  importMessage: "",
  importing: false,
  importProgress: 0,
  setFiles: [],
  sts: 1,
  showKeyboard: true,
  favorites: [],
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
      const sounds = audio.listSounds().map((item) => ({ ...item, bank: "FACTORY" }))
      const styles = audio.listStyles()
      audio.setPartProgram(0, 0)
      audio.setPartProgram(1, 7)
      audio.setPartProgram(3, 21)
      audio.setPartEnable(1, false)
      audio.setStyle(10)
      audio.setTempo(98)
      setState((s) => ({ ...s, sounds, styles, nativeReady: started }))
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

  const selectSound = useCallback((id: number, part = 0) => {
    setState((s) => {
      const picked = s.sounds.find((item) => item.id === id)
      const engineId =
        id < 10_000
          ? id
          : (s.sounds.find((item) => item.source !== "PA4X SET" && item.name === picked?.name)?.id ?? id)
      if (engineId < 10_000) {
        audio.setPartProgram(part, engineId)
        if (part > 0) audio.setPartEnable(part, true)
      }
      if (part === 1) return { ...s, upper2: engineId, upper2On: true }
      if (part === 2) return { ...s, upper3: engineId, upper3On: true }
      if (part === 3) return { ...s, lower: engineId }
      return { ...s, upper1: engineId }
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
      if (id < 10_000) {
        audio.setStyle(id)
        const tempo = style?.tempo ?? audio.listStyles().find((item) => item.id === id)?.tempo ?? 100
        audio.setTempo(tempo)
        return { ...s, styleId: id, tempo }
      }
      return { ...s, styleId: id, tempo: style?.tempo ?? s.tempo }
    })
  }, [])

  const book = useCallback((section: number) => {
    audio.bookSection(section)
    if (section >= 4 && section <= 7) setState((s) => ({ ...s, variation: section - 3 }))
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

  const importSet = useCallback(async () => {
    setState((s) => ({
      ...s,
      importing: true,
      importProgress: 0,
      importMessage: "Choose a PA4X .SET folder…",
      mode: "SET",
    }))
    try {
      const lib = await importPa4xSet((progress) => {
        setState((s) => ({ ...s, importMessage: progress.message, importProgress: progress.fraction }))
      })
      if (!lib) {
        setState((s) => ({ ...s, importing: false, importMessage: "SET import cancelled." }))
        return
      }
      const engineSounds = audio.listSounds().map((item) => ({
        ...item,
        bank: item.id < 40 ? "FACTORY" : lib.setName,
        source: item.id < 40 ? "Engine" : "PA4X SET",
      }))
      const namedSounds = lib.sounds.filter((sound) => !engineSounds.some((item) => item.name === sound.name))
      const engineStyles = audio.listStyles().map((item) => ({
        ...item,
        source: item.id < 16 ? "Engine" : "PA4X SET",
      }))
      const namedStyles = lib.styles.filter((style) => !engineStyles.some((item) => item.name === style.name))
      const bits = [
        `${lib.patchesLoaded} SET sounds`,
        `${lib.stylesLoaded} SET styles`,
        `${lib.samplesLoaded} samples`,
      ]
      if (lib.compressedDecoded) bits.push(`${lib.compressedDecoded} compressed samples decoded`)
      if (lib.skippedSamples) bits.push(`${lib.skippedSamples} files skipped`)
      setState((s) => ({
        ...s,
        importing: false,
        importProgress: 1,
        setName: lib.setName,
        adapterName: lib.adapterName,
        sounds: lib.patchesLoaded > 0 ? engineSounds : [...engineSounds, ...namedSounds],
        styles: lib.stylesLoaded > 0 ? engineStyles : [...engineStyles, ...namedStyles],
        setFiles: lib.files.slice(0, 40).map((file) => `${file.kind}  ${file.relativePath}`),
        importMessage: `Loaded ${bits.join(", ")} from ${lib.setName}`,
        mode: "SOUND",
      }))
    } catch (error) {
      setState((s) => ({
        ...s,
        importing: false,
        importMessage: error instanceof Error ? error.message : "SET import failed",
      }))
    }
  }, [])

  const actions = useMemo(
    () => ({
      setMode,
      setQuery,
      setCategory,
      selectSound,
      togglePart,
      selectStyle,
      book,
      setMixer,
      importSet,
      toggleStart: () => {
        if (isAudioNativeAvailable) audio.arrangerToggle()
      },
      noteOn: (note: number, vel: number) => {
        if (isAudioNativeAvailable) audio.noteOn(0, note, vel)
      },
      noteOff: (note: number) => {
        if (isAudioNativeAvailable) audio.noteOff(0, note)
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
        setState((s) => ({ ...s, transpose: Math.min(12, Math.max(-12, s.transpose + delta)) })),
      setSts: (n: number) => setState((s) => ({ ...s, sts: n })),
      toggleKeyboard: () => setState((s) => ({ ...s, showKeyboard: !s.showKeyboard })),
      toggleFavorite: (id: number) =>
        setState((s) => ({
          ...s,
          favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id],
        })),
    }),
    [book, importSet, selectSound, selectStyle, setCategory, setMixer, setMode, setQuery, togglePart]
  )

  return { state, ...actions }
}

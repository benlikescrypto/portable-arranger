import { audio, isAudioNativeAvailable } from "arrangerbox-audio"
import { midi } from "arrangerbox-midi"
import * as DocumentPicker from "expo-document-picker"
import { useCallback, useEffect, useMemo, useState } from "react"

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
    audio.setPartProgram(part, id)
    if (part > 0) audio.setPartEnable(part, true)
    setState((s) => {
      if (part === 1) return { ...s, upper2: id, upper2On: true }
      if (part === 2) return { ...s, upper3: id, upper3On: true }
      if (part === 3) return { ...s, lower: id }
      return { ...s, upper1: id }
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
    audio.setStyle(id)
    const style = audio.listStyles().find((item) => item.id === id)
    const tempo = style?.tempo ?? 100
    audio.setTempo(tempo)
    setState((s) => ({ ...s, styleId: id, tempo }))
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

  const importSamples = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: "*/*",
    })
    if (picked.canceled) return
    let loaded = 0
    for (const file of picked.assets) {
      const path = file.uri.replace("file://", "")
      const name = file.name.replace(/\.[^.]+$/, "")
      const upper = file.name.toUpperCase()
      if (upper.endsWith(".WAV")) {
        if ((await audio.loadWav(path, name, "Imported")) >= 0) loaded++
      } else if (upper.endsWith(".KSF")) {
        if ((await audio.loadKsf(path, name, "Imported")) >= 0) loaded++
      } else if (upper.endsWith(".PCM")) {
        loaded += await audio.scanPcmBank(path)
      }
    }
    setState((s) => ({
      ...s,
      sounds: audio.listSounds().map((item) => ({ ...item, bank: "FACTORY" })),
      importMessage: `Loaded ${loaded} sample file(s). Full PA4X SET folders still use the legacy Android importer.`,
      mode: "SOUND",
    }))
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
      importSamples,
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
    [book, importSamples, selectSound, selectStyle, setCategory, setMixer, setMode, setQuery, togglePart]
  )

  return { state, ...actions }
}

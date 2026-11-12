import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core"
import type { ComponentType } from "react"
import type { ViewProps } from "react-native"

export type SoundInfo = {
  id: number
  name: string
  category: string
  source?: string
}

export type StyleInfo = {
  id: number
  name: string
  category: string
  tempo: number
}

export type EngineSnapshot = {
  soundCount: number
  styleCount: number
  latencyMs: number
  chordRoot: number
  chordType: number
  section: number
  playing: boolean
  tempo: number
}

type AudioNative = {
  isAvailable: () => boolean
  start: () => Promise<boolean>
  stop: () => void
  noteOn: (ch: number, note: number, vel: number) => void
  noteOff: (ch: number, note: number) => void
  cc: (ch: number, ctl: number, value: number) => void
  pitchBend: (ch: number, lsb: number, msb: number) => void
  programChange: (ch: number, program: number) => void
  setPartProgram: (part: number, inst: number) => void
  setPartEnable: (part: number, on: boolean) => void
  setSplit: (note: number) => void
  setTempo: (bpm: number) => void
  setMixer: (bus: number, gain: number) => void
  arrangerToggle: () => void
  bookSection: (section: number) => void
  setStyle: (id: number) => void
  setSynchro: (on: boolean) => void
  setAutoFill: (on: boolean) => void
  setTranspose?: (semis: number) => void
  setOctave?: (oct: number) => void
  setFx?: (which: number, mix: number) => void
  snapshot: () => EngineSnapshot
  listSounds: () => SoundInfo[]
  listStyles: () => StyleInfo[]
  loadWav: (path: string, name: string, category: string) => Promise<number>
  loadKsf: (path: string, name: string, category: string) => Promise<number>
  scanPcmBank: (path: string) => Promise<number>
  loadPa4xSet?: (path: string) => Promise<string>
  loadPa4xNamed?: (path: string, kind: string, name: string) => Promise<string>
  listPa4xCatalog?: (path: string) => Promise<string>
  loadSfz?: (path: string) => Promise<string>
  loadAbStyle?: (path: string) => Promise<string>
}

const native = requireOptionalNativeModule<AudioNative>("ArrangerBoxAudio")

export const isAudioNativeAvailable = native != null

export type NativeKeyboardProps = ViewProps & {
  startNote?: number
  octaves?: number
  channel?: number
}

/**
 * Native on-screen keyboard (touch -> C++ engine, no JS round trip, multi-touch).
 * Null when this build has no such view (web, Expo Go, or an older native build
 * running newer JS): callers fall back to the JS keyboard instead of a dead view.
 */
export const NativeKeyboardView: ComponentType<NativeKeyboardProps> | null = (() => {
  if (!native) return null
  const expoGlobal = (globalThis as { expo?: { getViewConfig?: (module: string, view?: string) => unknown } }).expo
  if (!expoGlobal?.getViewConfig?.("ArrangerBoxAudio")) return null
  try {
    return requireNativeViewManager<NativeKeyboardProps>("ArrangerBoxAudio")
  } catch {
    return null
  }
})()

export const audio = {
  isAvailable(): boolean {
    return native?.isAvailable() === true
  },
  start() {
    return native ? native.start() : Promise.resolve(false)
  },
  stop() {
    native?.stop()
  },
  noteOn(ch: number, note: number, vel: number) {
    native?.noteOn(ch, note, vel)
  },
  noteOff(ch: number, note: number) {
    native?.noteOff(ch, note)
  },
  cc(ch: number, ctl: number, value: number) {
    native?.cc(ch, ctl, value)
  },
  pitchBend(ch: number, lsb: number, msb: number) {
    native?.pitchBend(ch, lsb, msb)
  },
  programChange(ch: number, program: number) {
    native?.programChange(ch, program)
  },
  setPartProgram(part: number, inst: number) {
    native?.setPartProgram(part, inst)
  },
  setPartEnable(part: number, on: boolean) {
    native?.setPartEnable(part, on)
  },
  setSplit(note: number) {
    native?.setSplit(note)
  },
  setTempo(bpm: number) {
    native?.setTempo(bpm)
  },
  setMixer(bus: number, gain: number) {
    native?.setMixer(bus, gain)
  },
  arrangerToggle() {
    native?.arrangerToggle()
  },
  bookSection(section: number) {
    native?.bookSection(section)
  },
  setStyle(id: number) {
    native?.setStyle(id)
  },
  setSynchro(on: boolean) {
    native?.setSynchro(on)
  },
  setAutoFill(on: boolean) {
    native?.setAutoFill(on)
  },
  setTranspose(semis: number) {
    native?.setTranspose?.(semis)
  },
  setOctave(oct: number) {
    native?.setOctave?.(oct)
  },
  setFx(which: number, mix: number) {
    native?.setFx?.(which, mix)
  },
  snapshot(): EngineSnapshot | null {
    return native ? native.snapshot() : null
  },
  listSounds(): SoundInfo[] {
    return native ? native.listSounds() : []
  },
  listStyles(): StyleInfo[] {
    return native ? native.listStyles() : []
  },
  loadWav(path: string, name: string, category: string) {
    return native ? native.loadWav(path, name, category) : Promise.resolve(-1)
  },
  loadKsf(path: string, name: string, category: string) {
    return native ? native.loadKsf(path, name, category) : Promise.resolve(-1)
  },
  scanPcmBank(path: string) {
    return native ? native.scanPcmBank(path) : Promise.resolve(0)
  },
  loadPa4xSet(path: string) {
    const load = native?.loadPa4xSet
    return load ? load(path) : Promise.resolve('{"ok":0}')
  },
  loadPa4xNamed(path: string, kind: string, name: string) {
    const load = native?.loadPa4xNamed
    return load ? load(path, kind, name) : Promise.resolve('{"ok":0,"reason":"This app build cannot load one item at a time."}')
  },
  listPa4xCatalog(path: string) {
    const list = native?.listPa4xCatalog
    return list ? list(path) : Promise.resolve('{"ok":0}')
  },
  loadSfz(path: string) {
    const load = native?.loadSfz
    return load ? load(path) : Promise.resolve('{"ok":0}')
  },
  loadAbStyle(path: string) {
    const load = native?.loadAbStyle
    return load ? load(path) : Promise.resolve('{"ok":0}')
  },
}

export default audio

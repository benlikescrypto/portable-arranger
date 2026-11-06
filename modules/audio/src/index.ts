import { requireOptionalNativeModule } from "expo-modules-core"

export type SoundInfo = {
  id: number
  name: string
  category: string
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
  snapshot: () => EngineSnapshot
  listSounds: () => SoundInfo[]
  listStyles: () => StyleInfo[]
  loadWav: (path: string, name: string, category: string) => Promise<number>
  loadKsf: (path: string, name: string, category: string) => Promise<number>
  scanPcmBank: (path: string) => Promise<number>
}

const native = requireOptionalNativeModule<AudioNative>("ArrangerBoxAudio")

export const isAudioNativeAvailable = native != null

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
}

export default audio

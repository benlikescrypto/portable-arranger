export type Mode = "STYLE" | "SOUND" | "PAD" | "MIXER" | "PERF" | "SET"

export type SoundItem = {
  id: number
  name: string
  category: string
  bank?: string
}

export type StyleItem = {
  id: number
  name: string
  category: string
  tempo: number
}

export type MixerState = {
  keyboard: number
  drums: number
  bass: number
  acc: number
  pad: number
  master: number
}

export type ArrangerUiState = {
  mode: Mode
  setName: string
  adapterName: string
  sounds: SoundItem[]
  styles: StyleItem[]
  query: string
  category: string
  upper1: number
  upper2: number | null
  upper3: number | null
  lower: number
  upper2On: boolean
  upper3On: boolean
  lowerOn: boolean
  split: number
  styleId: number
  tempo: number
  transpose: number
  variation: number
  section: number
  playing: boolean
  synchro: boolean
  autoFill: boolean
  chordRoot: number
  chordType: number
  mixer: MixerState
  midiConnected: boolean
  midiName: string
  latencyMs: number
  nativeReady: boolean
  importMessage: string
  sts: number
  showKeyboard: boolean
  favorites: number[]
}

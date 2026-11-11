export type Mode = "STYLE" | "SOUND" | "PAD" | "MIXER" | "PERF" | "SET"

export type LibraryKind = "sound" | "style" | "pad"

export type SoundItem = {
  id: number
  name: string
  category: string
  bank?: string
  source?: string
  loaded?: boolean
  engineId?: number
  setPath?: string
  fileName?: string
  cacheName?: string
  loadError?: string
  loadingProgress?: number
}

export type StyleItem = {
  id: number
  name: string
  category: string
  tempo: number
  bank?: string
  source?: string
  loaded?: boolean
  engineId?: number
  setPath?: string
  fileName?: string
  cacheName?: string
  loadError?: string
  loadingProgress?: number
}

export type PadItem = {
  id: number
  name: string
  category: string
  bank?: string
  source?: string
  loaded?: boolean
  engineId?: number
  setPath?: string
  fileName?: string
  cacheName?: string
  loadError?: string
  loadingProgress?: number
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
  pads: PadItem[]
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
  padId: number
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
  arrangerReady: boolean
  importMessage: string
  importing: boolean
  importProgress: number
  setFiles: string[]
  sts: number
  favorites: number[]
  octave: number
  reverb: number
  chorus: number
  delay: number
  recentSounds: number[]
  recentStyles: number[]
  libraryFilter: "all" | "factory" | "imported"
  importReport: string
}

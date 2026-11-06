import { requireOptionalNativeModule } from "expo-modules-core"

export type MidiDeviceInfo = {
  id: string
  name: string
  manufacturer: string
  inputPorts: number
  outputPorts: number
  usb: boolean
}

export type MidiDevicesEvent = {
  connected: boolean
  name: string
  devices: MidiDeviceInfo[]
}

type MidiNative = {
  isAvailable: () => boolean
  start: () => Promise<boolean>
  stop: () => void
  send: (bytes: number[]) => void
  addListener: (event: string, listener: (event: MidiDevicesEvent) => void) => { remove: () => void }
}

const native = requireOptionalNativeModule<MidiNative>("ArrangerBoxMidi")

export const isMidiNativeAvailable = native != null

export const midi = {
  isAvailable() {
    return native?.isAvailable() === true
  },
  start() {
    return native ? native.start() : Promise.resolve(false)
  },
  stop() {
    native?.stop()
  },
  send(bytes: number[]) {
    native?.send(bytes)
  },
  addDeviceListener(listener: (event: MidiDevicesEvent) => void) {
    if (!native) return { remove() {} }
    return native.addListener("onDevicesChanged", listener)
  },
}

export default midi

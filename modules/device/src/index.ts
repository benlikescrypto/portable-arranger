import { requireOptionalNativeModule } from "expo-modules-core"

export type UsbDeviceInfo = {
  name: string
  vendorId?: number
  productId?: number
  class?: number
}

export type DeviceCapabilities = {
  platform: string
  model: string
  manufacturer: string
  usbHost: boolean
  midiService: boolean
  usbDevices: UsbDeviceInfo[]
}

type DeviceNative = {
  isAvailable: () => boolean
  capabilities: () => DeviceCapabilities
}

const native = requireOptionalNativeModule<DeviceNative>("ArrangerBoxDevice")

export const isDeviceNativeAvailable = native != null

export const device = {
  isAvailable() {
    return native?.isAvailable() === true
  },
  capabilities(): DeviceCapabilities | null {
    return native ? native.capabilities() : null
  },
}

export default device

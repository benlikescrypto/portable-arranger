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

export type PickedImportFolder = {
  canceled?: boolean
  path?: string
  uri?: string
  name?: string
  files?: number
  source?: string
  error?: string
}

type DeviceNative = {
  isAvailable: () => boolean
  capabilities: () => DeviceCapabilities
  pickAndCopyImportFolder?: () => Promise<PickedImportFolder>
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
  pickAndCopyImportFolder(): Promise<PickedImportFolder> | null {
    const pick = native?.pickAndCopyImportFolder
    return pick ? pick() : null
  },
}

export default device

package expo.modules.arrangerboxdevice

import android.content.Context
import android.hardware.usb.UsbManager
import android.media.midi.MidiManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ArrangerBoxDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArrangerBoxDevice")

    Function("isAvailable") { true }

    Function("capabilities") {
      val context = appContext.reactContext
      val usb = context?.getSystemService(Context.USB_SERVICE) as? UsbManager
      val midi = context?.getSystemService(Context.MIDI_SERVICE) as? MidiManager
      val devices = usb?.deviceList?.values?.map { device ->
        mapOf(
          "name" to (device.productName ?: device.deviceName),
          "vendorId" to device.vendorId,
          "productId" to device.productId,
          "class" to device.deviceClass
        )
      } ?: emptyList()
      mapOf(
        "platform" to "android",
        "model" to Build.MODEL,
        "manufacturer" to Build.MANUFACTURER,
        "usbHost" to (usb != null),
        "midiService" to (midi != null),
        "usbDevices" to devices
      )
    }
  }
}

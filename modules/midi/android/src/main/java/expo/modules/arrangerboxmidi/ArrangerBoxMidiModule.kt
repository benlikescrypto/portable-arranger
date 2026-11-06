package expo.modules.arrangerboxmidi

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ArrangerBoxMidiModule : Module() {
  private var host: UsbMidiHost? = null

  override fun definition() = ModuleDefinition {
    Name("ArrangerBoxMidi")

    Events("onDevicesChanged")

    Function("isAvailable") {
      appContext.reactContext?.getSystemService(android.content.Context.MIDI_SERVICE) != null
    }

    AsyncFunction("start") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (host == null) {
        host = UsbMidiHost(context) { connected, name, devices ->
          sendEvent(
            "onDevicesChanged",
            mapOf(
              "connected" to connected,
              "name" to name,
              "devices" to devices
            )
          )
        }.also { it.start() }
      }
      true
    }

    Function("stop") {
      host?.stop()
      host = null
    }

    Function("send") { bytes: List<Int> ->
      host?.send(bytes.map { it.toByte() }.toByteArray())
    }
  }
}

package expo.modules.arrangerboxmidi

import android.content.Context
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiInputPort
import android.media.midi.MidiManager
import android.media.midi.MidiReceiver
import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArrayList

internal class UsbMidiHost(
  context: Context,
  private val onDevices: (connected: Boolean, name: String, devices: List<Map<String, Any>>) -> Unit
) {
  private val midi = context.getSystemService(Context.MIDI_SERVICE) as? MidiManager
  private val handler = Handler(Looper.getMainLooper())
  private val openDevices = CopyOnWriteArrayList<MidiDevice>()
  private val outputPorts = CopyOnWriteArrayList<MidiInputPort>()
  private var deviceCallback: MidiManager.DeviceCallback? = null

  fun start() {
    val mgr = midi ?: run {
      onDevices(false, "No MIDI", emptyList())
      return
    }
    mgr.devices.forEach { open(it) }
    val cb = object : MidiManager.DeviceCallback() {
      override fun onDeviceAdded(device: MidiDeviceInfo) = open(device)
      override fun onDeviceRemoved(device: MidiDeviceInfo) = emit()
    }
    deviceCallback = cb
    mgr.registerDeviceCallback(cb, handler)
    emit()
  }

  fun stop() {
    deviceCallback?.let { midi?.unregisterDeviceCallback(it) }
    outputPorts.forEach { runCatching { it.close() } }
    outputPorts.clear()
    openDevices.forEach { runCatching { it.close() } }
    openDevices.clear()
  }

  fun send(bytes: ByteArray) {
    outputPorts.forEach { port ->
      runCatching { port.send(bytes, 0, bytes.size) }
    }
  }

  private fun open(info: MidiDeviceInfo) {
    @Suppress("DEPRECATION")
    midi?.openDevice(info, { device ->
      if (device == null) return@openDevice
      openDevices += device
      if (info.outputPortCount > 0) {
        device.openOutputPort(0)?.connect(object : MidiReceiver() {
          override fun onSend(msg: ByteArray, offset: Int, count: Int, timestamp: Long) {
            parse(msg, offset, count)
          }
        })
      }
      if (info.inputPortCount > 0) {
        device.openInputPort(0)?.let { outputPorts += it }
      }
      emit()
    }, handler)
  }

  private fun emit() {
    val devices = (midi?.devices ?: emptyArray()).map { info ->
      mapOf(
        "id" to info.id.toString(),
        "name" to (info.properties.getString(MidiDeviceInfo.PROPERTY_NAME) ?: "USB MIDI"),
        "manufacturer" to (info.properties.getString(MidiDeviceInfo.PROPERTY_MANUFACTURER) ?: ""),
        "inputPorts" to info.outputPortCount,
        "outputPorts" to info.inputPortCount,
        "usb" to (info.type == MidiDeviceInfo.TYPE_USB)
      )
    }
    val first = devices.firstOrNull()?.get("name") as? String ?: "MIDI"
    handler.post { onDevices(devices.isNotEmpty(), first, devices) }
  }

  private fun parse(msg: ByteArray, offset: Int, count: Int) {
    var i = offset
    val end = offset + count
    while (i < end) {
      val status = msg[i].toInt() and 0xFF
      if (status < 0x80) {
        i++
        continue
      }
      when (status) {
        0xF8 -> {
          MidiNative.nativeClock()
          i++
        }
        0xFA -> {
          MidiNative.nativeStart()
          i++
        }
        0xFB -> {
          MidiNative.nativeContinue()
          i++
        }
        0xFC -> {
          MidiNative.nativeStop()
          i++
        }
        0xF0 -> break
        else -> {
          val hi = status and 0xF0
          val ch = status and 0x0F
          when (hi) {
            0x90 -> {
              if (i + 2 >= end) break
              val note = msg[i + 1].toInt() and 0x7F
              val vel = msg[i + 2].toInt() and 0x7F
              if (vel == 0) MidiNative.nativeNoteOff(ch, note)
              else MidiNative.nativeNoteOn(ch, note, vel)
              i += 3
            }
            0x80 -> {
              if (i + 2 >= end) break
              MidiNative.nativeNoteOff(ch, msg[i + 1].toInt() and 0x7F)
              i += 3
            }
            0xB0 -> {
              if (i + 2 >= end) break
              MidiNative.nativeCc(ch, msg[i + 1].toInt() and 0x7F, msg[i + 2].toInt() and 0x7F)
              i += 3
            }
            0xE0 -> {
              if (i + 2 >= end) break
              MidiNative.nativePitchBend(ch, msg[i + 1].toInt() and 0x7F, msg[i + 2].toInt() and 0x7F)
              i += 3
            }
            0xC0 -> {
              if (i + 1 >= end) break
              MidiNative.nativeProgramChange(ch, msg[i + 1].toInt() and 0x7F)
              i += 2
            }
            0xD0 -> i += 2
            else -> i++
          }
        }
      }
    }
  }
}

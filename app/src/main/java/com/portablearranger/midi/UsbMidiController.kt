package com.portablearranger.midi

import android.content.Context
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiManager
import android.media.midi.MidiReceiver
import android.os.Handler
import android.os.Looper
import com.portablearranger.engine.NativeEngine
import java.util.concurrent.CopyOnWriteArrayList

class UsbMidiController(
    context: Context,
    private val handle: Long,
    private val onStatus: (connected: Boolean, name: String) -> Unit
) {
    private val midi = context.getSystemService(Context.MIDI_SERVICE) as? MidiManager
    private val handler = Handler(Looper.getMainLooper())
    private val openDevices = CopyOnWriteArrayList<MidiDevice>()
    private var deviceCallback: MidiManager.DeviceCallback? = null

    fun start() {
        val mgr = midi ?: run {
            onStatus(false, "No MIDI")
            return
        }
        mgr.devices.forEach { open(it) }
        val cb = object : MidiManager.DeviceCallback() {
            override fun onDeviceAdded(device: MidiDeviceInfo) = open(device)
            override fun onDeviceRemoved(device: MidiDeviceInfo) {
                if (openDevices.isEmpty()) onStatus(false, "MIDI")
            }
        }
        deviceCallback = cb
        mgr.registerDeviceCallback(cb, handler)
        if (openDevices.isEmpty()) onStatus(false, "MIDI")
    }

    fun stop() {
        deviceCallback?.let { midi?.unregisterDeviceCallback(it) }
        openDevices.forEach { runCatching { it.close() } }
        openDevices.clear()
    }

    private fun open(info: MidiDeviceInfo) {
        if (info.outputPortCount <= 0) return
        @Suppress("DEPRECATION")
        midi?.openDevice(info, { device ->
            if (device != null) {
                openDevices += device
                val port = device.openOutputPort(0)
                port?.connect(object : MidiReceiver() {
                    override fun onSend(msg: ByteArray, offset: Int, count: Int, timestamp: Long) {
                        parse(msg, offset, count)
                    }
                })
                val name = info.properties.getString(MidiDeviceInfo.PROPERTY_NAME) ?: "USB MIDI"
                handler.post { onStatus(true, name) }
            }
        }, handler)
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
            val hi = status and 0xF0
            val ch = status and 0x0F
            when (hi) {
                0x90 -> {
                    if (i + 2 >= end) break
                    val note = msg[i + 1].toInt() and 0x7F
                    val vel = msg[i + 2].toInt() and 0x7F
                    if (vel == 0) NativeEngine.noteOff(handle, ch, note)
                    else NativeEngine.noteOn(handle, ch, note, vel)
                    i += 3
                }
                0x80 -> {
                    if (i + 2 >= end) break
                    NativeEngine.noteOff(handle, ch, msg[i + 1].toInt() and 0x7F)
                    i += 3
                }
                0xB0 -> {
                    if (i + 2 >= end) break
                    NativeEngine.cc(handle, ch, msg[i + 1].toInt() and 0x7F, msg[i + 2].toInt() and 0x7F)
                    i += 3
                }
                0xE0 -> i += 3
                0xC0, 0xD0 -> i += 2
                0xF0 -> break
                else -> i++
            }
        }
    }
}

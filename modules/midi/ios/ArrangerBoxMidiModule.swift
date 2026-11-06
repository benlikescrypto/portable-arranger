import CoreMIDI
import ExpoModulesCore

@_silgen_name("arrangerbox_note_on")
func midi_note_on(_ ch: Int32, _ note: Int32, _ vel: Int32)

@_silgen_name("arrangerbox_note_off")
func midi_note_off(_ ch: Int32, _ note: Int32)

@_silgen_name("arrangerbox_cc")
func midi_cc(_ ch: Int32, _ ctl: Int32, _ val: Int32)

@_silgen_name("arrangerbox_pitch_bend")
func midi_pitch_bend(_ ch: Int32, _ lsb: Int32, _ msb: Int32)

@_silgen_name("arrangerbox_program_change")
func midi_program_change(_ ch: Int32, _ program: Int32)

@_silgen_name("arrangerbox_midi_clock")
func midi_clock()

@_silgen_name("arrangerbox_midi_start")
func midi_start()

@_silgen_name("arrangerbox_midi_stop")
func midi_stop()

@_silgen_name("arrangerbox_midi_continue")
func midi_continue()

private func parse(_ packet: MIDIPacket) {
  var i = 0
  let length = Int(packet.length)
  withUnsafeBytes(of: packet.data) { raw in
    let bytes = raw.bindMemory(to: UInt8.self)
    while i < length {
      let status = Int(bytes[i])
      if status < 0x80 {
        i += 1
        continue
      }
      switch status {
      case 0xF8:
        midi_clock()
        i += 1
      case 0xFA:
        midi_start()
        i += 1
      case 0xFB:
        midi_continue()
        i += 1
      case 0xFC:
        midi_stop()
        i += 1
      default:
        let hi = status & 0xF0
        let ch = Int32(status & 0x0F)
        switch hi {
        case 0x90:
          guard i + 2 < length else { return }
          let note = Int32(bytes[i + 1] & 0x7F)
          let vel = Int32(bytes[i + 2] & 0x7F)
          if vel == 0 { midi_note_off(ch, note) } else { midi_note_on(ch, note, vel) }
          i += 3
        case 0x80:
          guard i + 1 < length else { return }
          midi_note_off(ch, Int32(bytes[i + 1] & 0x7F))
          i += 3
        case 0xB0:
          guard i + 2 < length else { return }
          midi_cc(ch, Int32(bytes[i + 1] & 0x7F), Int32(bytes[i + 2] & 0x7F))
          i += 3
        case 0xE0:
          guard i + 2 < length else { return }
          midi_pitch_bend(ch, Int32(bytes[i + 1] & 0x7F), Int32(bytes[i + 2] & 0x7F))
          i += 3
        case 0xC0:
          guard i + 1 < length else { return }
          midi_program_change(ch, Int32(bytes[i + 1] & 0x7F))
          i += 2
        case 0xD0:
          i += 2
        default:
          i += 1
        }
      }
    }
  }
}

public class ArrangerBoxMidiModule: Module {
  private var client = MIDIClientRef()
  private var inputPort = MIDIPortRef()
  private var outputPort = MIDIPortRef()
  private var destinations: [MIDIEndpointRef] = []

  public func definition() -> ModuleDefinition {
    Name("ArrangerBoxMidi")
    Events("onDevicesChanged")

    Function("isAvailable") { true }

    AsyncFunction("start") { () -> Bool in
      self.setup()
      return true
    }

    Function("stop") {
      if self.inputPort != 0 { MIDIPortDispose(self.inputPort) }
      if self.outputPort != 0 { MIDIPortDispose(self.outputPort) }
      if self.client != 0 { MIDIClientDispose(self.client) }
      self.inputPort = 0
      self.outputPort = 0
      self.client = 0
    }

    Function("send") { (bytes: [Int]) in
      var packet = MIDIPacket()
      packet.timeStamp = 0
      packet.length = UInt16(min(bytes.count, 256))
      withUnsafeMutableBytes(of: &packet.data) { raw in
        let buf = raw.bindMemory(to: UInt8.self)
        for i in 0..<Int(packet.length) {
          buf[i] = UInt8(truncatingIfNeeded: bytes[i])
        }
      }
      var list = MIDIPacketList(numPackets: 1, packet: packet)
      for dest in self.destinations {
        MIDISend(self.outputPort, dest, &list)
      }
    }
  }

  private func setup() {
    let name = "ArrangerBox" as CFString
    MIDIClientCreateWithBlock(name, &client) { [weak self] _ in
      self?.refresh()
    }
    MIDIInputPortCreateWithBlock(client, "ArrangerBoxIn" as CFString, &inputPort) { packetList, _ in
      var packet = packetList.pointee.packet
      parse(packet)
      var remaining = packetList.pointee.numPackets
      while remaining > 1 {
        remaining -= 1
        packet = MIDIPacketNext(&packet).pointee
        parse(packet)
      }
    }
    MIDIOutputPortCreate(client, "ArrangerBoxOut" as CFString, &outputPort)
    refresh()
  }

  private func refresh() {
    destinations.removeAll()
    var devices: [[String: Any]] = []
    let sourceCount = MIDIGetNumberOfSources()
    for i in 0..<sourceCount {
      let src = MIDIGetSource(i)
      MIDIPortConnectSource(inputPort, src, nil)
      devices.append(endpointInfo(src, output: false))
    }
    let destCount = MIDIGetNumberOfDestinations()
    for i in 0..<destCount {
      let dest = MIDIGetDestination(i)
      destinations.append(dest)
      devices.append(endpointInfo(dest, output: true))
    }
    sendEvent("onDevicesChanged", [
      "connected": !devices.isEmpty,
      "name": (devices.first?["name"] as? String) ?? "MIDI",
      "devices": devices
    ])
  }

  private func endpointInfo(_ endpoint: MIDIEndpointRef, output: Bool) -> [String: Any] {
    var cfName: Unmanaged<CFString>?
    MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &cfName)
    let name = cfName?.takeUnretainedValue() as String? ?? "USB MIDI"
    return [
      "id": "\(endpoint)",
      "name": name,
      "manufacturer": "",
      "inputPorts": output ? 0 : 1,
      "outputPorts": output ? 1 : 0,
      "usb": true
    ]
  }
}


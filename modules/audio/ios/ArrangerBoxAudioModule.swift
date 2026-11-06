import ExpoModulesCore

@_silgen_name("arrangerbox_engine_create")
func arrangerbox_engine_create() -> UnsafeMutableRawPointer?

@_silgen_name("arrangerbox_engine_destroy")
func arrangerbox_engine_destroy(_ handle: UnsafeMutableRawPointer?)

@_silgen_name("arrangerbox_audio_start")
func arrangerbox_audio_start() -> Int32

@_silgen_name("arrangerbox_audio_stop")
func arrangerbox_audio_stop()

@_silgen_name("arrangerbox_note_on")
func arrangerbox_note_on(_ ch: Int32, _ note: Int32, _ vel: Int32)

@_silgen_name("arrangerbox_note_off")
func arrangerbox_note_off(_ ch: Int32, _ note: Int32)

@_silgen_name("arrangerbox_cc")
func arrangerbox_cc(_ ch: Int32, _ ctl: Int32, _ val: Int32)

@_silgen_name("arrangerbox_pitch_bend")
func arrangerbox_pitch_bend(_ ch: Int32, _ lsb: Int32, _ msb: Int32)

@_silgen_name("arrangerbox_program_change")
func arrangerbox_program_change(_ ch: Int32, _ program: Int32)

@_silgen_name("arrangerbox_set_part_program")
func arrangerbox_set_part_program(_ part: Int32, _ inst: Int32)

@_silgen_name("arrangerbox_set_part_enable")
func arrangerbox_set_part_enable(_ part: Int32, _ on: Int32)

@_silgen_name("arrangerbox_set_split")
func arrangerbox_set_split(_ note: Int32)

@_silgen_name("arrangerbox_set_tempo")
func arrangerbox_set_tempo(_ bpm: Float)

@_silgen_name("arrangerbox_set_mixer")
func arrangerbox_set_mixer(_ bus: Int32, _ gain: Float)

@_silgen_name("arrangerbox_arranger_toggle")
func arrangerbox_arranger_toggle()

@_silgen_name("arrangerbox_book_section")
func arrangerbox_book_section(_ section: Int32)

@_silgen_name("arrangerbox_set_style")
func arrangerbox_set_style(_ id: Int32)

@_silgen_name("arrangerbox_set_synchro")
func arrangerbox_set_synchro(_ on: Int32)

@_silgen_name("arrangerbox_set_auto_fill")
func arrangerbox_set_auto_fill(_ on: Int32)

@_silgen_name("arrangerbox_sound_count")
func arrangerbox_sound_count() -> Int32

@_silgen_name("arrangerbox_sound_name")
func arrangerbox_sound_name(_ id: Int32, _ out: UnsafeMutablePointer<CChar>, _ maxLen: Int32)

@_silgen_name("arrangerbox_sound_category")
func arrangerbox_sound_category(_ id: Int32, _ out: UnsafeMutablePointer<CChar>, _ maxLen: Int32)

@_silgen_name("arrangerbox_style_count")
func arrangerbox_style_count() -> Int32

@_silgen_name("arrangerbox_style_name")
func arrangerbox_style_name(_ id: Int32, _ out: UnsafeMutablePointer<CChar>, _ maxLen: Int32)

@_silgen_name("arrangerbox_style_category")
func arrangerbox_style_category(_ id: Int32, _ out: UnsafeMutablePointer<CChar>, _ maxLen: Int32)

@_silgen_name("arrangerbox_style_tempo")
func arrangerbox_style_tempo(_ id: Int32) -> Float

@_silgen_name("arrangerbox_latency_ms")
func arrangerbox_latency_ms() -> Float

@_silgen_name("arrangerbox_chord_root")
func arrangerbox_chord_root() -> Int32

@_silgen_name("arrangerbox_chord_type")
func arrangerbox_chord_type() -> Int32

@_silgen_name("arrangerbox_section")
func arrangerbox_section() -> Int32

@_silgen_name("arrangerbox_is_playing")
func arrangerbox_is_playing() -> Int32

@_silgen_name("arrangerbox_tempo")
func arrangerbox_tempo() -> Float

@_silgen_name("arrangerbox_load_wav")
func arrangerbox_load_wav(_ path: UnsafePointer<CChar>, _ name: UnsafePointer<CChar>, _ category: UnsafePointer<CChar>) -> Int32

@_silgen_name("arrangerbox_load_ksf")
func arrangerbox_load_ksf(_ path: UnsafePointer<CChar>, _ name: UnsafePointer<CChar>, _ category: UnsafePointer<CChar>) -> Int32

@_silgen_name("arrangerbox_scan_pcm_bank")
func arrangerbox_scan_pcm_bank(_ path: UnsafePointer<CChar>) -> Int32

private func cString(_ id: Int32, _ fill: (Int32, UnsafeMutablePointer<CChar>, Int32) -> Void) -> String {
  var buf = [CChar](repeating: 0, count: 64)
  buf.withUnsafeMutableBufferPointer { ptr in
    fill(id, ptr.baseAddress!, 64)
  }
  return String(cString: buf)
}

public class ArrangerBoxAudioModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArrangerBoxAudio")

    OnCreate {
      _ = arrangerbox_audio_start()
    }

    OnDestroy {
      arrangerbox_audio_stop()
    }

    Function("isAvailable") { true }

    AsyncFunction("start") {
      arrangerbox_audio_start() != 0
    }

    Function("stop") {
      arrangerbox_audio_stop()
    }

    Function("noteOn") { (ch: Int, note: Int, vel: Int) in
      arrangerbox_note_on(Int32(ch), Int32(note), Int32(vel))
    }
    Function("noteOff") { (ch: Int, note: Int) in
      arrangerbox_note_off(Int32(ch), Int32(note))
    }
    Function("cc") { (ch: Int, ctl: Int, value: Int) in
      arrangerbox_cc(Int32(ch), Int32(ctl), Int32(value))
    }
    Function("pitchBend") { (ch: Int, lsb: Int, msb: Int) in
      arrangerbox_pitch_bend(Int32(ch), Int32(lsb), Int32(msb))
    }
    Function("programChange") { (ch: Int, program: Int) in
      arrangerbox_program_change(Int32(ch), Int32(program))
    }
    Function("setPartProgram") { (part: Int, inst: Int) in
      arrangerbox_set_part_program(Int32(part), Int32(inst))
    }
    Function("setPartEnable") { (part: Int, on: Bool) in
      arrangerbox_set_part_enable(Int32(part), on ? 1 : 0)
    }
    Function("setSplit") { (note: Int) in arrangerbox_set_split(Int32(note)) }
    Function("setTempo") { (bpm: Double) in arrangerbox_set_tempo(Float(bpm)) }
    Function("setMixer") { (bus: Int, gain: Double) in arrangerbox_set_mixer(Int32(bus), Float(gain)) }
    Function("arrangerToggle") { arrangerbox_arranger_toggle() }
    Function("bookSection") { (section: Int) in arrangerbox_book_section(Int32(section)) }
    Function("setStyle") { (id: Int) in arrangerbox_set_style(Int32(id)) }
    Function("setSynchro") { (on: Bool) in arrangerbox_set_synchro(on ? 1 : 0) }
    Function("setAutoFill") { (on: Bool) in arrangerbox_set_auto_fill(on ? 1 : 0) }

    Function("snapshot") {
      [
        "soundCount": arrangerbox_sound_count(),
        "styleCount": arrangerbox_style_count(),
        "latencyMs": arrangerbox_latency_ms(),
        "chordRoot": arrangerbox_chord_root(),
        "chordType": arrangerbox_chord_type(),
        "section": arrangerbox_section(),
        "playing": arrangerbox_is_playing() != 0,
        "tempo": arrangerbox_tempo()
      ]
    }

    Function("listSounds") {
      (0..<Int(arrangerbox_sound_count())).map { id in
        [
          "id": id,
          "name": cString(Int32(id), arrangerbox_sound_name),
          "category": cString(Int32(id), arrangerbox_sound_category)
        ]
      }
    }

    Function("listStyles") {
      (0..<Int(arrangerbox_style_count())).map { id in
        [
          "id": id,
          "name": cString(Int32(id), arrangerbox_style_name),
          "category": cString(Int32(id), arrangerbox_style_category),
          "tempo": arrangerbox_style_tempo(Int32(id))
        ]
      }
    }

    AsyncFunction("loadWav") { (path: String, name: String, category: String) in
      path.withCString { p in
        name.withCString { n in
          category.withCString { c in arrangerbox_load_wav(p, n, c) }
        }
      }
    }

    AsyncFunction("loadKsf") { (path: String, name: String, category: String) in
      path.withCString { p in
        name.withCString { n in
          category.withCString { c in arrangerbox_load_ksf(p, n, c) }
        }
      }
    }

    AsyncFunction("scanPcmBank") { (path: String) in
      path.withCString { arrangerbox_scan_pcm_bank($0) }
    }
  }
}

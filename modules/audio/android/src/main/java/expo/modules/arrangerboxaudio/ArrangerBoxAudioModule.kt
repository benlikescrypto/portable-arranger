package expo.modules.arrangerboxaudio

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ArrangerBoxAudioModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ArrangerBoxAudio")

    OnCreate {
      EngineNative.nativeStart()
    }

    OnDestroy {
      EngineNative.nativeDestroy()
    }

    Function("isAvailable") { true }

    AsyncFunction("start") {
      EngineNative.nativeStart()
    }

    Function("stop") {
      EngineNative.nativeStop()
    }

    Function("noteOn") { ch: Int, note: Int, vel: Int ->
      EngineNative.nativeNoteOn(ch, note, vel)
    }

    Function("noteOff") { ch: Int, note: Int ->
      EngineNative.nativeNoteOff(ch, note)
    }

    Function("cc") { ch: Int, ctl: Int, value: Int ->
      EngineNative.nativeCc(ch, ctl, value)
    }

    Function("pitchBend") { ch: Int, lsb: Int, msb: Int ->
      EngineNative.nativePitchBend(ch, lsb, msb)
    }

    Function("programChange") { ch: Int, program: Int ->
      EngineNative.nativeProgramChange(ch, program)
    }

    Function("setPartProgram") { part: Int, inst: Int ->
      EngineNative.nativeSetPartProgram(part, inst)
    }

    Function("setPartEnable") { part: Int, on: Boolean ->
      EngineNative.nativeSetPartEnable(part, on)
    }

    Function("setSplit") { note: Int -> EngineNative.nativeSetSplit(note) }
    Function("setTempo") { bpm: Double -> EngineNative.nativeSetTempo(bpm.toFloat()) }
    Function("setMixer") { bus: Int, gain: Double -> EngineNative.nativeSetMixer(bus, gain.toFloat()) }
    Function("arrangerToggle") { EngineNative.nativeArrangerToggle() }
    Function("bookSection") { section: Int -> EngineNative.nativeBookSection(section) }
    Function("setStyle") { id: Int -> EngineNative.nativeSetStyle(id) }
    Function("setSynchro") { on: Boolean -> EngineNative.nativeSetSynchro(on) }
    Function("setAutoFill") { on: Boolean -> EngineNative.nativeSetAutoFill(on) }

    Function("snapshot") {
      mapOf(
        "soundCount" to EngineNative.nativeSoundCount(),
        "styleCount" to EngineNative.nativeStyleCount(),
        "latencyMs" to EngineNative.nativeLatencyMs(),
        "chordRoot" to EngineNative.nativeChordRoot(),
        "chordType" to EngineNative.nativeChordType(),
        "section" to EngineNative.nativeSection(),
        "playing" to EngineNative.nativeIsPlaying(),
        "tempo" to EngineNative.nativeTempo()
      )
    }

    Function("listSounds") {
      (0 until EngineNative.nativeSoundCount()).map { id ->
        mapOf(
          "id" to id,
          "name" to EngineNative.nativeSoundName(id),
          "category" to EngineNative.nativeSoundCategory(id)
        )
      }
    }

    Function("listStyles") {
      (0 until EngineNative.nativeStyleCount()).map { id ->
        mapOf(
          "id" to id,
          "name" to EngineNative.nativeStyleName(id),
          "category" to EngineNative.nativeStyleCategory(id),
          "tempo" to EngineNative.nativeStyleTempo(id)
        )
      }
    }

    AsyncFunction("loadWav") { path: String, name: String, category: String ->
      EngineNative.nativeLoadWav(path, name, category)
    }

    AsyncFunction("loadKsf") { path: String, name: String, category: String ->
      EngineNative.nativeLoadKsf(path, name, category)
    }

    AsyncFunction("scanPcmBank") { path: String ->
      EngineNative.nativeScanPcm(path)
    }
  }
}

package expo.modules.arrangerboxaudio

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class ArrangerBoxAudioModule : Module() {
  private fun loadFactorySoundfont() {
    val ctx = appContext.reactContext?.applicationContext ?: return
    val dest = File(ctx.filesDir, "GeneralUser-GS.sf2")
    if (dest.length() < 1_000_000L) {
      ctx.assets.open("GeneralUser-GS.sf2").use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      }
    }
    if (dest.length() > 1_000_000L) {
      EngineNative.nativeLoadSoundfont(dest.absolutePath)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ArrangerBoxAudio")

    OnCreate {
      try {
        loadFactorySoundfont()
      } catch (_: Throwable) {
      }
      EngineNative.nativeStart()
    }

    OnDestroy {
      EngineNative.nativeDestroy()
    }

    Function("isAvailable") { true }

    AsyncFunction("start") {
      try {
        loadFactorySoundfont()
      } catch (_: Throwable) {
      }
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
    Function("setTranspose") { semis: Int -> EngineNative.nativeSetTranspose(semis) }
    Function("setOctave") { oct: Int -> EngineNative.nativeSetOctave(oct) }
    Function("setFx") { which: Int, mix: Double -> EngineNative.nativeSetFx(which, mix.toFloat()) }

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
          "category" to EngineNative.nativeSoundCategory(id),
          "source" to EngineNative.nativeSoundSource(id)
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

    AsyncFunction("loadPa4xSet") { path: String ->
      EngineNative.nativeLoadPa4xSet(path)
    }

    AsyncFunction("loadPa4xNamed") { path: String, kind: String, name: String ->
      EngineNative.nativeLoadPa4xNamed(path, kind, name)
    }

    AsyncFunction("listPa4xCatalog") { path: String ->
      EngineNative.nativeListPa4xCatalog(path)
    }

    AsyncFunction("loadSfz") { path: String ->
      EngineNative.nativeLoadSfz(path)
    }

    AsyncFunction("loadAbStyle") { path: String ->
      EngineNative.nativeLoadAbStyle(path)
    }
  }
}

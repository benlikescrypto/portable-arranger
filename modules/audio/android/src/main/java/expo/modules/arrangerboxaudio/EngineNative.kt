package expo.modules.arrangerboxaudio

internal object EngineNative {
  init {
    System.loadLibrary("arranger_engine")
  }

  @JvmStatic external fun nativeStart(): Boolean
  @JvmStatic external fun nativeLoadSoundfont(path: String): Boolean
  @JvmStatic external fun nativeStop()
  @JvmStatic external fun nativeDestroy()
  @JvmStatic external fun nativeNoteOn(ch: Int, note: Int, vel: Int)
  @JvmStatic external fun nativeNoteOff(ch: Int, note: Int)
  @JvmStatic external fun nativeCc(ch: Int, ctl: Int, value: Int)
  @JvmStatic external fun nativePitchBend(ch: Int, lsb: Int, msb: Int)
  @JvmStatic external fun nativeProgramChange(ch: Int, program: Int)
  @JvmStatic external fun nativeSetPartProgram(part: Int, inst: Int)
  @JvmStatic external fun nativeSetPartEnable(part: Int, on: Boolean)
  @JvmStatic external fun nativeSetSplit(note: Int)
  @JvmStatic external fun nativeSetTempo(bpm: Float)
  @JvmStatic external fun nativeSetMixer(bus: Int, gain: Float)
  @JvmStatic external fun nativeArrangerToggle()
  @JvmStatic external fun nativeBookSection(section: Int)
  @JvmStatic external fun nativeSetStyle(id: Int)
  @JvmStatic external fun nativeSetSynchro(on: Boolean)
  @JvmStatic external fun nativeSetAutoFill(on: Boolean)
  @JvmStatic external fun nativeSetTranspose(semis: Int)
  @JvmStatic external fun nativeSetOctave(oct: Int)
  @JvmStatic external fun nativeSetFx(which: Int, mix: Float)
  @JvmStatic external fun nativeSoundCount(): Int
  @JvmStatic external fun nativeSoundName(id: Int): String
  @JvmStatic external fun nativeSoundCategory(id: Int): String
  @JvmStatic external fun nativeSoundSource(id: Int): String
  @JvmStatic external fun nativeStyleCount(): Int
  @JvmStatic external fun nativeStyleName(id: Int): String
  @JvmStatic external fun nativeStyleCategory(id: Int): String
  @JvmStatic external fun nativeStyleTempo(id: Int): Float
  @JvmStatic external fun nativeLatencyMs(): Float
  @JvmStatic external fun nativeChordRoot(): Int
  @JvmStatic external fun nativeChordType(): Int
  @JvmStatic external fun nativeSection(): Int
  @JvmStatic external fun nativeIsPlaying(): Boolean
  @JvmStatic external fun nativeTempo(): Float
  @JvmStatic external fun nativeLoadWav(path: String, name: String, category: String): Int
  @JvmStatic external fun nativeLoadKsf(path: String, name: String, category: String): Int
  @JvmStatic external fun nativeScanPcm(path: String): Int
  @JvmStatic external fun nativeLoadPa4xSet(path: String): String
  @JvmStatic external fun nativeLoadSfz(path: String): String
  @JvmStatic external fun nativeLoadAbStyle(path: String): String
}

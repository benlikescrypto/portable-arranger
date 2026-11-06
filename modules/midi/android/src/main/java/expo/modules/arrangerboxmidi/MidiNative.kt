package expo.modules.arrangerboxmidi

internal object MidiNative {
  init {
    System.loadLibrary("arranger_engine")
  }

  @JvmStatic external fun nativeNoteOn(ch: Int, note: Int, vel: Int)
  @JvmStatic external fun nativeNoteOff(ch: Int, note: Int)
  @JvmStatic external fun nativeCc(ch: Int, ctl: Int, value: Int)
  @JvmStatic external fun nativePitchBend(ch: Int, lsb: Int, msb: Int)
  @JvmStatic external fun nativeProgramChange(ch: Int, program: Int)
  @JvmStatic external fun nativeClock()
  @JvmStatic external fun nativeStart()
  @JvmStatic external fun nativeStop()
  @JvmStatic external fun nativeContinue()
}

package com.portablearranger.engine

object NativeEngine {
    init {
        System.loadLibrary("arranger_engine")
    }

    @JvmStatic external fun create(): Long
    @JvmStatic external fun destroy(handle: Long)
    @JvmStatic external fun start(handle: Long): Boolean
    @JvmStatic external fun stop(handle: Long)
    @JvmStatic external fun noteOn(handle: Long, ch: Int, note: Int, vel: Int)
    @JvmStatic external fun noteOff(handle: Long, ch: Int, note: Int)
    @JvmStatic external fun cc(handle: Long, ch: Int, ctl: Int, value: Int)
    @JvmStatic external fun setPartProgram(handle: Long, part: Int, inst: Int)
    @JvmStatic external fun setPartEnable(handle: Long, part: Int, on: Boolean)
    @JvmStatic external fun setSplit(handle: Long, note: Int)
    @JvmStatic external fun setTempo(handle: Long, bpm: Float)
    @JvmStatic external fun setMixer(handle: Long, bus: Int, gain: Float)
    @JvmStatic external fun arrangerToggle(handle: Long)
    @JvmStatic external fun arrangerStart(handle: Long)
    @JvmStatic external fun arrangerStop(handle: Long)
    @JvmStatic external fun bookSection(handle: Long, section: Int)
    @JvmStatic external fun setStyle(handle: Long, id: Int)
    @JvmStatic external fun setSynchro(handle: Long, on: Boolean)
    @JvmStatic external fun setAutoFill(handle: Long, on: Boolean)
    @JvmStatic external fun soundCount(handle: Long): Int
    @JvmStatic external fun soundName(handle: Long, id: Int): String
    @JvmStatic external fun soundCategory(handle: Long, id: Int): String
    @JvmStatic external fun styleCount(handle: Long): Int
    @JvmStatic external fun styleName(handle: Long, id: Int): String
    @JvmStatic external fun styleCategory(handle: Long, id: Int): String
    @JvmStatic external fun styleTempo(handle: Long, id: Int): Float
    @JvmStatic external fun latencyMs(handle: Long): Float
    @JvmStatic external fun chordRoot(handle: Long): Int
    @JvmStatic external fun chordType(handle: Long): Int
    @JvmStatic external fun section(handle: Long): Int
    @JvmStatic external fun isPlaying(handle: Long): Boolean
    @JvmStatic external fun tempo(handle: Long): Float
    @JvmStatic external fun loadWavInstrument(handle: Long, path: String, name: String, category: String): Int
    @JvmStatic external fun loadKsfInstrument(handle: Long, path: String, name: String, category: String): Int
    @JvmStatic external fun scanPcmBank(handle: Long, path: String): Int
}

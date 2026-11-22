package expo.modules.arrangerboxaudio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.nio.FloatBuffer
import org.json.JSONObject

/**
 * SwiftF0 (https://github.com/lars76/swift-f0, MIT) on the device: finds the notes in one
 * AI stem. The C++ side (PitchTrack.cpp) decodes the stem, resamples it to 16 kHz and cuts
 * it into the windows SwiftF0's detect() uses; this class only runs the ONNX model on each
 * window, then C++ segments the notes and returns JSON.
 */
internal object SwiftF0Runner {
  private const val MODEL_ASSET = "swift_f0.onnx"
  private var session: OrtSession? = null
  private val lock = Any()

  private fun session(ctx: Context): OrtSession {
    session?.let { return it }
    val env = OrtEnvironment.getEnvironment()
    val bytes = ctx.assets.open(MODEL_ASSET).use { it.readBytes() }
    val opts = OrtSession.SessionOptions().apply {
      // A 14k-parameter model: two threads are plenty and leave cores for the audio thread.
      setIntraOpNumThreads(2)
      addConfigEntry("session.intra_op.allow_spinning", "0")
    }
    return env.createSession(bytes, opts).also { session = it }
  }

  fun findNotes(ctx: Context, path: String, fmin: Float, fmax: Float, holdMs: Float): String = synchronized(lock) {
    val report = arrayOfNulls<String>(1)
    val id = EngineNative.nativeF0Open(path, report)
    if (id == 0) return report[0] ?: """{"ok":0,"reason":"could not read the stem"}"""
    try {
      val s = session(ctx)
      val env = OrtEnvironment.getEnvironment()
      val windows = EngineNative.nativeF0Windows(id)
      for (w in 0 until windows) {
        val audio = EngineNative.nativeF0Window(id, w)
        if (audio.isEmpty()) continue
        OnnxTensor.createTensor(env, FloatBuffer.wrap(audio), longArrayOf(1, audio.size.toLong())).use { a ->
          OnnxTensor.createTensor(env, FloatBuffer.wrap(floatArrayOf(fmin)), longArrayOf()).use { lo ->
            OnnxTensor.createTensor(env, FloatBuffer.wrap(floatArrayOf(fmax)), longArrayOf()).use { hi ->
              s.run(mapOf("audio" to a, "fmin" to lo, "fmax" to hi), setOf("pitch", "confidence")).use { out ->
                val pitch = (out.get("pitch").get() as OnnxTensor).floatBuffer.let { b -> FloatArray(b.remaining()).also { b.get(it) } }
                val conf = (out.get("confidence").get() as OnnxTensor).floatBuffer.let { b -> FloatArray(b.remaining()).also { b.get(it) } }
                EngineNative.nativeF0Put(id, w, pitch, conf)
              }
            }
          }
        }
      }
      return EngineNative.nativeF0Finish(id, holdMs)
    } catch (t: Throwable) {
      EngineNative.nativeF0Close(id)
      return JSONObject().put("ok", 0).put("reason", "SwiftF0 failed: ${t.message ?: t.javaClass.simpleName}").toString()
    }
  }
}

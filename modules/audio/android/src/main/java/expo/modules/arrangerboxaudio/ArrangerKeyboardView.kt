package expo.modules.arrangerboxaudio

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * On-screen keyboard drawn and played natively. Touches go straight from Android to
 * the C++ engine (no JS round trip), so key-down latency is the audio buffer only.
 * Every finger is tracked on its own (chords) and sliding onto another key plays it
 * (glissando). Velocity comes from where the key is struck: softer near the top.
 */
class ArrangerKeyboardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var startNote = 60
    set(value) {
      field = value
      rebuildKeys()
    }
  var octaves = 2
    set(value) {
      field = value
      rebuildKeys()
    }
  var channel = 0

  private val blackPitchClasses = setOf(1, 3, 6, 8, 10)
  private val whites = ArrayList<Int>()
  private val blacks = ArrayList<Pair<Int, Int>>() // note, afterWhite

  /** Which note each pointer (finger) is holding. */
  private val fingers = HashMap<Int, Int>()

  /** How many fingers hold each note (two fingers on one key = one note). */
  private val heldCount = HashMap<Int, Int>()

  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(138, 146, 156)
    textAlign = Paint.Align.CENTER
    isFakeBoldText = true
  }
  private val rect = RectF()
  private val path = Path()

  init {
    setWillNotDraw(false)
    rebuildKeys()
  }

  private fun rebuildKeys() {
    whites.clear()
    blacks.clear()
    val end = startNote + maxOf(1, octaves) * 12
    for (note in startNote..end) {
      if (note % 12 in blackPitchClasses) continue
      whites.add(note)
      val sharp = note + 1
      if (sharp <= end && sharp % 12 in blackPitchClasses) blacks.add(Pair(sharp, whites.size - 1))
    }
    invalidate()
  }

  // Geometry

  private val whiteWidth get() = width.toFloat() / maxOf(1, whites.size)
  private val blackHeight get() = height * 0.6f

  private fun blackRect(afterWhite: Int, out: RectF) {
    val w = whiteWidth * 0.62f
    val x = (afterWhite + 1) * whiteWidth - w / 2
    out.set(x, 0f, x + w, blackHeight)
  }

  private fun noteAt(x: Float, y: Float): Int? {
    if (whites.isEmpty() || x < 0 || y < 0 || x > width || y > height) return null
    if (y < blackHeight) {
      for ((note, after) in blacks) {
        blackRect(after, rect)
        if (rect.contains(x, y)) return note
      }
    }
    val i = (x / whiteWidth).toInt().coerceIn(0, whites.size - 1)
    return whites[i]
  }

  private fun velocityAt(y: Float, note: Int): Int {
    val keyHeight = if (note % 12 in blackPitchClasses) blackHeight else height.toFloat()
    val t = (y / maxOf(1f, keyHeight)).coerceIn(0f, 1f)
    return (70 + t * 57).toInt() // 70 at the top edge ... 127 at the front
  }

  // Notes

  private fun press(note: Int, velocity: Int) {
    val count = heldCount[note] ?: 0
    heldCount[note] = count + 1
    if (count == 0) {
      EngineNative.nativeNoteOn(channel, note, velocity)
      invalidate()
    }
  }

  private fun release(note: Int) {
    val count = heldCount[note] ?: return
    if (count <= 1) {
      heldCount.remove(note)
      EngineNative.nativeNoteOff(channel, note)
      invalidate()
    } else {
      heldCount[note] = count - 1
    }
  }

  private fun allNotesOff() {
    for (note in heldCount.keys) EngineNative.nativeNoteOff(channel, note)
    heldCount.clear()
    fingers.clear()
    invalidate()
  }

  // Touches

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
        // Keep the page pager from stealing the gesture (sideways slides = glissando).
        parent?.requestDisallowInterceptTouchEvent(true)
        val i = event.actionIndex
        val x = event.getX(i)
        val y = event.getY(i)
        noteAt(x, y)?.let { note ->
          fingers[event.getPointerId(i)] = note
          press(note, velocityAt(y, note))
        }
      }
      MotionEvent.ACTION_MOVE -> {
        for (i in 0 until event.pointerCount) {
          val id = event.getPointerId(i)
          val x = event.getX(i)
          val y = event.getY(i)
          val now = noteAt(x, y)
          val was = fingers[id]
          if (now == was) continue
          if (was != null) release(was)
          if (now != null) {
            fingers[id] = now
            press(now, velocityAt(y, now))
          } else {
            fingers.remove(id)
          }
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
        val id = event.getPointerId(event.actionIndex)
        fingers.remove(id)?.let { release(it) }
        if (event.actionMasked == MotionEvent.ACTION_UP) {
          for (note in fingers.values) release(note)
          fingers.clear()
          parent?.requestDisallowInterceptTouchEvent(false)
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        allNotesOff()
        parent?.requestDisallowInterceptTouchEvent(false)
      }
    }
    return true
  }

  override fun onDetachedFromWindow() {
    allNotesOff()
    super.onDetachedFromWindow()
  }

  // Drawing (matches the JS keyboard's look)

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (whites.isEmpty() || width == 0 || height == 0) return
    val density = resources.displayMetrics.density
    path.reset()
    rect.set(0f, 0f, width.toFloat(), height.toFloat())
    path.addRoundRect(rect, 10 * density, 10 * density, Path.Direction.CW)
    canvas.save()
    canvas.clipPath(path)
    canvas.drawColor(Color.rgb(14, 16, 19))

    val w = whiteWidth
    val gap = 2 * density
    val whiteR = 6 * density
    labelPaint.textSize = 10 * density
    for ((i, note) in whites.withIndex()) {
      rect.set(i * w, -whiteR, (i + 1) * w - gap, height.toFloat())
      paint.color = if (heldCount.containsKey(note)) Color.rgb(255, 212, 138) else Color.rgb(242, 244, 247)
      canvas.drawRoundRect(rect, whiteR, whiteR, paint)
      if (note % 12 == 0) {
        canvas.drawText("C${note / 12 - 1}", rect.centerX(), height - 8 * density, labelPaint)
      }
    }
    val blackR = 5 * density
    for ((note, after) in blacks) {
      blackRect(after, rect)
      rect.top = -blackR
      paint.style = Paint.Style.FILL
      paint.color = if (heldCount.containsKey(note)) Color.rgb(255, 138, 61) else Color.rgb(22, 25, 29)
      canvas.drawRoundRect(rect, blackR, blackR, paint)
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = density
      paint.color = Color.BLACK
      canvas.drawRoundRect(rect, blackR, blackR, paint)
      paint.style = Paint.Style.FILL
    }
    canvas.restore()
  }
}

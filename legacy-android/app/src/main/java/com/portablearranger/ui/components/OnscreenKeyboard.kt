package com.portablearranger.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.portablearranger.ui.theme.PaKeyBlack
import com.portablearranger.ui.theme.PaKeyWhite
import com.portablearranger.ui.theme.PaOrange
import com.portablearranger.ui.theme.PaStroke
import kotlin.math.roundToInt

private val WHITE = intArrayOf(0, 2, 4, 5, 7, 9, 11)
private fun isBlack(pc: Int) = pc == 1 || pc == 3 || pc == 6 || pc == 8 || pc == 10

@Composable
fun OnscreenKeyboard(
    startNote: Int = 36,
    endNote: Int = 96,
    modifier: Modifier = Modifier,
    onNoteOn: (note: Int, vel: Int) -> Unit,
    onNoteOff: (note: Int) -> Unit
) {
    val held = remember { mutableStateMapOf<Int, Int>() }
    BoxWithConstraints(modifier.clip(RoundedCornerShape(8.dp)).background(PaKeyBlack)) {
        val whites = (startNote..endNote).count { !isBlack(it % 12) }
        val whiteW = maxWidth / whites.coerceAtLeast(1)
        val blackW = whiteW * 0.62f
        val density = LocalDensity.current
        val wPx = with(density) { whiteW.toPx() }
        val totalPx = with(density) { maxWidth.toPx() }
        val heightPx = with(density) { maxHeight.toPx() }

        fun noteAt(x: Float, y: Float): Pair<Int, Int>? {
            val blackH = heightPx * 0.58f
            if (y < blackH) {
                var whiteIndex = 0
                for (n in startNote..endNote) {
                    if (!isBlack(n % 12)) {
                        val left = whiteIndex * wPx
                        val pc = n % 12
                        if (pc != 4 && pc != 11 && n + 1 <= endNote) {
                            val bx = left + wPx - with(density) { blackW.toPx() } / 2f
                            if (x in bx..(bx + with(density) { blackW.toPx() })) {
                                val vel = ((1f - (y / heightPx)) * 126f + 1f).roundToInt().coerceIn(1, 127)
                                return (n + 1) to vel
                            }
                        }
                        whiteIndex++
                    }
                }
            }
            val idx = (x / wPx).toInt().coerceIn(0, whites - 1)
            var whiteIndex = 0
            for (n in startNote..endNote) {
                if (!isBlack(n % 12)) {
                    if (whiteIndex == idx) {
                        val vel = ((1f - (y / heightPx).coerceIn(0f, 1f)) * 126f + 1f).roundToInt().coerceIn(1, 127)
                        return n to vel
                    }
                    whiteIndex++
                }
            }
            return null
        }

        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(startNote, endNote, totalPx) {
                    awaitPointerEventScope {
                        val pointerNotes = mutableMapOf<Long, Int>()
                        while (true) {
                            val event = awaitPointerEvent()
                            event.changes.forEach { ch ->
                                val id = ch.id.value
                                if (ch.pressed) {
                                    val hit = noteAt(ch.position.x, ch.position.y)
                                    val prev = pointerNotes[id]
                                    if (hit != null) {
                                        if (prev != hit.first) {
                                            if (prev != null) {
                                                held.remove(prev)
                                                onNoteOff(prev)
                                            }
                                            pointerNotes[id] = hit.first
                                            held[hit.first] = hit.second
                                            onNoteOn(hit.first, hit.second)
                                        }
                                    }
                                    ch.consume()
                                } else {
                                    pointerNotes.remove(id)?.let { n ->
                                        held.remove(n)
                                        onNoteOff(n)
                                    }
                                }
                            }
                        }
                    }
                }
        ) {
            var wi = 0
            for (n in startNote..endNote) {
                if (!isBlack(n % 12)) {
                    Box(
                        Modifier
                            .offset { IntOffset((wi * wPx).roundToInt(), 0) }
                            .width(whiteW)
                            .fillMaxHeight()
                            .background(if (n in held) PaOrange.copy(alpha = 0.55f) else PaKeyWhite)
                            .border(0.6.dp, PaStroke)
                    )
                    wi++
                }
            }
            wi = 0
            for (n in startNote..endNote) {
                if (!isBlack(n % 12)) {
                    val pc = n % 12
                    if (pc != 4 && pc != 11 && n + 1 <= endNote && isBlack((n + 1) % 12)) {
                        val bn = n + 1
                        Box(
                            Modifier
                                .offset {
                                    IntOffset(
                                        (wi * wPx + wPx - with(density) { blackW.toPx() } / 2f).roundToInt(),
                                        0
                                    )
                                }
                                .width(blackW)
                                .fillMaxHeight(0.58f)
                                .clip(RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp))
                                .background(if (bn in held) PaOrange else PaKeyBlack)
                        )
                    }
                    wi++
                }
            }
        }
    }
}

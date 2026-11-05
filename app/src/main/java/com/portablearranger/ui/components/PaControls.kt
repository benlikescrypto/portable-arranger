package com.portablearranger.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.portablearranger.ui.theme.PaBg
import com.portablearranger.ui.theme.PaMuted
import com.portablearranger.ui.theme.PaOrange
import com.portablearranger.ui.theme.PaPanelAlt
import com.portablearranger.ui.theme.PaStroke
import com.portablearranger.ui.theme.PaText

@Composable
fun PaButton(
    label: String,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    booked: Boolean = false,
    accent: Color = PaOrange,
    dim: Boolean = false,
    minHeight: Dp = 48.dp,
    onClick: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(8.dp)
    val bg = when {
        active -> Brush.verticalGradient(listOf(accent, accent.copy(alpha = 0.75f)))
        booked -> Brush.verticalGradient(listOf(accent.copy(alpha = 0.35f), PaPanelAlt))
        else -> Brush.verticalGradient(listOf(Color(0xFF2A2F36), Color(0xFF1A1D22)))
    }
    Box(
        modifier
            .defaultMinSize(minHeight = minHeight)
            .shadow(if (active) 10.dp else 2.dp, shape, ambientColor = accent.copy(alpha = if (active) 0.45f else 0.0f))
            .clip(shape)
            .background(bg)
            .border(1.dp, if (active) accent else PaStroke, shape)
            .clickable(indication = null, interactionSource = remember { MutableInteractionSource() }) {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            }
            .padding(horizontal = 6.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            color = if (dim && !active) PaMuted else if (active) PaBg else PaText,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.6.sp,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Clip
        )
    }
}

@Composable
fun PartTile(
    title: String,
    name: String,
    on: Boolean,
    selected: Boolean,
    accent: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onToggle: () -> Unit
) {
    val shape = RoundedCornerShape(10.dp)
    Column(
        modifier
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.16f) else PaPanelAlt)
            .border(1.dp, if (selected) accent else PaStroke, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp)
    ) {
        Text(
            text = title + if (on) "" else "  OFF",
            color = if (on) accent else PaMuted,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
            modifier = Modifier.clickable(onClick = onToggle)
        )
        Text(
            text = name,
            color = if (on) PaText else PaMuted,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun Led(on: Boolean, color: Color, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .padding(bottom = 3.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (on) color else Color(0xFF2A2E34))
                .border(1.dp, if (on) color else PaStroke, RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp, vertical = 3.dp)
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (on) Color.White.copy(alpha = 0.85f) else Color(0xFF111214))
                    .padding(5.dp)
            )
        }
        Text(label, color = PaMuted, fontSize = 9.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.6.sp)
    }
}

package com.portablearranger.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val Scheme = darkColorScheme(
    primary = PaOrange,
    onPrimary = PaBg,
    secondary = PaBlue,
    background = PaBg,
    surface = PaPanel,
    onBackground = PaText,
    onSurface = PaText,
    outline = PaStroke
)

@Composable
fun ArrangerBoxTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, typography = PaTypography, content = content)
}

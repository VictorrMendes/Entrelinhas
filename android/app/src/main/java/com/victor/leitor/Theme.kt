package com.victor.leitor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val Blue = Color(0xFF60A5FA)
private val Navy = Color(0xFF101622)
private val Slate = Color(0xFF1E293B)
private val Cream = Color(0xFFFDF7EE)
private val Grey = Color(0xFF8D8D8D)
private val Paper = Color(0xFFF6F6F8)
private val Ink = Color(0xFF1A1A1A)
private val Red = Color(0xFFF85D5D)

val Success = Color(0xFF22C55E)
val Flame = Color(0xFFF97316)

private val Dark = darkColorScheme(
    primary = Blue, onPrimary = Navy,
    primaryContainer = Color(0xFF273854), onPrimaryContainer = Cream,
    secondaryContainer = Color(0xFF273854), onSecondaryContainer = Cream,
    background = Navy, onBackground = Cream,
    surface = Navy, onSurface = Cream,
    surfaceVariant = Slate, onSurfaceVariant = Grey,
    surfaceContainerLowest = Slate, surfaceContainerLow = Slate, surfaceContainer = Slate,
    surfaceContainerHigh = Slate, surfaceContainerHighest = Slate,
    outline = Grey, outlineVariant = Color(0xFF414D5B),
    error = Red,
)

private val Light = lightColorScheme(
    primary = Blue, onPrimary = Color.White,
    primaryContainer = Color(0xFFDCEBFE), onPrimaryContainer = Ink,
    secondaryContainer = Color(0xFFDCEBFE), onSecondaryContainer = Ink,
    background = Paper, onBackground = Ink,
    surface = Paper, onSurface = Ink,
    surfaceVariant = Color.White, onSurfaceVariant = Grey,
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color.White, surfaceContainer = Color.White,
    surfaceContainerHigh = Color.White, surfaceContainerHighest = Color.White,
    outline = Grey, outlineVariant = Color(0xFFD8D8D8),
    error = Red,
)

/** Montserrat ships under the SIL Open Font License, so it can be bundled. */
private val Montserrat = FontFamily(
    Font(R.font.montserrat_light, FontWeight.Light),
    Font(R.font.montserrat_regular, FontWeight.Normal),
    Font(R.font.montserrat_medium, FontWeight.Medium),
    Font(R.font.montserrat_semibold, FontWeight.SemiBold),
)

private fun TextStyle.m() = copy(fontFamily = Montserrat)

private val AppTypography = Typography().run {
    copy(
        displayLarge = displayLarge.m(), displayMedium = displayMedium.m(), displaySmall = displaySmall.m(),
        headlineLarge = headlineLarge.m(), headlineMedium = headlineMedium.m(), headlineSmall = headlineSmall.m(),
        titleLarge = titleLarge.m(), titleMedium = titleMedium.m(), titleSmall = titleSmall.m(),
        bodyLarge = bodyLarge.m(), bodyMedium = bodyMedium.m(), bodySmall = bodySmall.m(),
        labelLarge = labelLarge.m(), labelMedium = labelMedium.m(), labelSmall = labelSmall.m(),
    )
}

@Composable
fun AppTheme(mode: Int, content: @Composable () -> Unit) {
    val dark = when (mode) {
        1 -> false
        2 -> true
        else -> isSystemInDarkTheme()
    }
    MaterialTheme(colorScheme = if (dark) Dark else Light, typography = AppTypography, content = content)
}

val cardBorder: BorderStroke
    @Composable @ReadOnlyComposable
    get() = BorderStroke(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))

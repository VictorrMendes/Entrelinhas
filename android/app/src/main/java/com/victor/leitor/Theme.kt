package com.victor.leitor

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

// Built from the app icon: its indigo on light backgrounds, a lavender of it on dark ones, amber for streaks and goals.
private val Indigo = Color(0xFF3B3A98)
private val Lavender = Color(0xFFA9A6FF)
private val Ink = Color(0xFF12111F)
private val InkCard = Color(0xFF1D1B33)
private val Sheet = Color(0xFF211F3A)
private val Mist = Color(0xFFEDEBF7)
private val MistMuted = Color(0xFF9A97B5)
private val Paper = Color(0xFFFAF7F2)
private val PaperText = Color(0xFF1F1D2E)
private val PaperMuted = Color(0xFF6B6880)
private val PaperSheet = Color(0xFFFDFCFF)

val Success = Color(0xFF34D399)
val Flame = Color(0xFFF59E0B)

private val Dark = darkColorScheme(
    primary = Lavender, onPrimary = Color(0xFF1B1A4A),
    primaryContainer = Color(0xFF2E2C66), onPrimaryContainer = Color(0xFFE6E4FF),
    secondaryContainer = Color(0xFF2A2750), onSecondaryContainer = Color(0xFFECEAFF),
    tertiary = Flame, onTertiary = Ink,
    background = Ink, onBackground = Mist,
    surface = Ink, onSurface = Mist,
    surfaceVariant = InkCard, onSurfaceVariant = MistMuted,
    // sheets and dialogs one shade off the cards: Material picks content colors by matching the background, and a sheet
    // colored exactly like surfaceVariant would get its muted text color
    surfaceContainerLowest = Sheet, surfaceContainerLow = Sheet, surfaceContainer = Sheet,
    surfaceContainerHigh = Sheet, surfaceContainerHighest = Sheet,
    outline = MistMuted, outlineVariant = Color(0xFF34315A),
    error = Color(0xFFFF6B81), errorContainer = Color(0xFF5A1D2A), onErrorContainer = Color(0xFFFFD9DF),
    inverseSurface = Mist, inverseOnSurface = Ink, inversePrimary = Indigo,
)

private val Light = lightColorScheme(
    primary = Indigo, onPrimary = Color.White,
    primaryContainer = Color(0xFFE4E3FA), onPrimaryContainer = Color(0xFF1E1D5C),
    secondaryContainer = Color(0xFFEEEBFB), onSecondaryContainer = Color(0xFF1E1D5C),
    tertiary = Flame, onTertiary = Color.White,
    background = Paper, onBackground = PaperText,
    surface = Paper, onSurface = PaperText,
    surfaceVariant = Color.White, onSurfaceVariant = PaperMuted,
    surfaceContainerLowest = PaperSheet, surfaceContainerLow = PaperSheet, surfaceContainer = PaperSheet,
    surfaceContainerHigh = PaperSheet, surfaceContainerHighest = PaperSheet,
    outline = PaperMuted, outlineVariant = Color(0xFFE5E1EC),
    error = Color(0xFFD9364F), errorContainer = Color(0xFFFFE1E6), onErrorContainer = Color(0xFF5A1020),
    inverseSurface = Color(0xFF2A2840), inverseOnSurface = Color(0xFFF4F2FA), inversePrimary = Lavender,
)

// Nunito (interface) and Literata (book text) ship under the SIL Open Font License, so they can be bundled.
val Nunito = FontFamily(
    Font(R.font.nunito_regular, FontWeight.Normal),
    Font(R.font.nunito_medium, FontWeight.Medium),
    Font(R.font.nunito_semibold, FontWeight.SemiBold),
    Font(R.font.nunito_bold, FontWeight.Bold),
    Font(R.font.nunito_extrabold, FontWeight.ExtraBold),
)

val Literata = FontFamily(
    Font(R.font.literata_regular, FontWeight.Normal),
    Font(R.font.literata_italic, FontWeight.Normal, FontStyle.Italic),
    Font(R.font.literata_medium, FontWeight.Medium),
    Font(R.font.literata_semibold, FontWeight.SemiBold),
    Font(R.font.literata_bold, FontWeight.Bold),
)

private fun TextStyle.nunito() = copy(fontFamily = Nunito)

private val AppTypography = Typography().run {
    copy(
        displayLarge = displayLarge.nunito(), displayMedium = displayMedium.nunito(), displaySmall = displaySmall.nunito(),
        headlineLarge = headlineLarge.nunito(), headlineMedium = headlineMedium.nunito(), headlineSmall = headlineSmall.nunito(),
        titleLarge = titleLarge.nunito().copy(fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.nunito().copy(fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.nunito().copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = bodyLarge.nunito(), bodyMedium = bodyMedium.nunito(), bodySmall = bodySmall.nunito(),
        labelLarge = labelLarge.nunito().copy(fontWeight = FontWeight.Bold),
        labelMedium = labelMedium.nunito().copy(fontWeight = FontWeight.SemiBold),
        labelSmall = labelSmall.nunito(),
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

/** The reader's page colors, independent of the app theme; [APP] follows it. */
enum class ReadingTheme(@StringRes val label: Int, val page: Color?, val text: Color?) {
    APP(R.string.reading_theme_app, null, null),
    LIGHT(R.string.reading_theme_light, Paper, PaperText),
    SEPIA(R.string.reading_theme_sepia, Color(0xFFF4ECD8), Color(0xFF5B4636)),
    DARK(R.string.reading_theme_dark, Ink, Mist),
    NIGHT(R.string.reading_theme_night, Color.Black, Color(0xFFB8B5C8)),
}

/** The app scheme with the page and text colors of [theme]; cards and sheets are tinted from the page color. */
fun ColorScheme.forReading(theme: ReadingTheme): ColorScheme {
    val page = theme.page ?: return this
    val text = theme.text ?: return this
    val card = lerp(page, text, 0.07f)
    val sheet = lerp(page, text, 0.05f)
    // the lavender accent of the dark scheme fades on paper-like pages; the icon's indigo reads well there
    val accent = if (page.luminance() > 0.5f) Indigo else Lavender
    return copy(
        primary = accent, onPrimary = page,
        background = page, surface = page, onBackground = text, onSurface = text,
        surfaceVariant = card, surfaceContainerLow = sheet, surfaceContainer = sheet, surfaceContainerHigh = sheet,
        surfaceContainerHighest = sheet, surfaceContainerLowest = sheet,
        onSurfaceVariant = text.copy(alpha = 0.7f),
        secondaryContainer = lerp(page, accent, 0.16f), onSecondaryContainer = text,
    )
}

val cardBorder: BorderStroke
    @Composable @ReadOnlyComposable
    get() = BorderStroke(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))

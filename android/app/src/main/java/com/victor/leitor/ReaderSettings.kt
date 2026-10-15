@file:OptIn(ExperimentalMaterial3Api::class)

package com.victor.leitor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

val LINE_SPACINGS = listOf(1.35f, 1.55f, 1.8f)
val MARGINS: List<Dp> = listOf(12.dp, 20.dp, 32.dp)
private const val MIN_FONT = 14
private const val MAX_FONT = 28

/** How the book text looks, from the reader's preferences. */
data class ReaderStyle(val fontSize: Int, val lineSpacing: Float, val margin: Dp, val font: FontFamily, val interlinear: Boolean)

fun readerStyle(p: Prefs) = ReaderStyle(
    fontSize = p.readerFontSize.coerceIn(MIN_FONT, MAX_FONT),
    lineSpacing = LINE_SPACINGS[p.lineSpacing.coerceIn(0, LINE_SPACINGS.lastIndex)],
    margin = MARGINS[p.margins.coerceIn(0, MARGINS.lastIndex)],
    font = if (p.readerSerif) Literata else Nunito,
    interlinear = p.interlinear,
)

@Composable
fun ReaderSettingsSheet(prefs: Prefs, onVoice: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(stringResource(R.string.reading_settings), style = MaterialTheme.typography.titleLarge)
            Label(R.string.reading_theme)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ReadingTheme.entries.forEach { theme ->
                    val selected = prefs.readingTheme == theme.ordinal
                    val page = theme.page ?: MaterialTheme.colorScheme.background
                    val text = theme.text ?: MaterialTheme.colorScheme.onBackground
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable { prefs.readingTheme = theme.ordinal }) {
                        Box(
                            Modifier.size(48.dp).clip(CircleShape).background(page)
                                .border(
                                    if (selected) BorderStroke(3.dp, MaterialTheme.colorScheme.primary) else BorderStroke(1.dp, text.copy(alpha = 0.3f)),
                                    CircleShape,
                                ),
                            contentAlignment = Alignment.Center,
                        ) { Text("Aa", color = text, style = MaterialTheme.typography.labelLarge) }
                        Text(stringResource(theme.label), Modifier.padding(top = 4.dp), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Label(R.string.text_size)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                FilledTonalIconButton(onClick = { prefs.readerFontSize = (prefs.readerFontSize - 2).coerceAtLeast(MIN_FONT) }) {
                    Icon(Icons.Filled.Remove, stringResource(R.string.smaller_text))
                }
                Text("${prefs.readerFontSize}", style = MaterialTheme.typography.titleMedium)
                FilledTonalIconButton(onClick = { prefs.readerFontSize = (prefs.readerFontSize + 2).coerceAtMost(MAX_FONT) }) {
                    Icon(Icons.Filled.Add, stringResource(R.string.larger_text))
                }
            }
            Label(R.string.line_spacing)
            Pills(
                listOf(stringResource(R.string.spacing_compact), stringResource(R.string.spacing_normal), stringResource(R.string.spacing_wide)),
                prefs.lineSpacing,
            ) { prefs.lineSpacing = it }
            Label(R.string.margins)
            Pills(
                listOf(stringResource(R.string.margins_narrow), stringResource(R.string.margins_normal), stringResource(R.string.margins_wide)),
                prefs.margins,
            ) { prefs.margins = it }
            Label(R.string.reader_font)
            Pills(listOf("Literata", "Nunito"), if (prefs.readerSerif) 0 else 1) { prefs.readerSerif = it == 0 }
            Label(R.string.reading_voice)
            OutlinedButton(onClick = onVoice) { Text(stringResource(R.string.choose_voice)) }
            Label(R.string.paragraph_translation)
            Pills(
                listOf(stringResource(R.string.translation_interlinear), stringResource(R.string.translation_below)),
                if (prefs.interlinear) 0 else 1,
            ) { prefs.interlinear = it == 0 }
        }
    }
}

@Composable
private fun Label(res: Int) =
    Text(stringResource(res), Modifier.padding(top = 8.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

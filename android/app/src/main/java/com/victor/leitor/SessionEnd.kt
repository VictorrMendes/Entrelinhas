package com.victor.leitor

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** One number on the end screen: 12 "palavras", 95 "% de acerto", 3 "min". */
data class SessionStat(val value: Int, val label: String)

/** A finished round's words, accuracy and minutes (rounded up, at least 1). */
@Composable
fun sessionStats(words: Int, right: Int, seconds: Long) = listOf(
    SessionStat(words, pluralStringResource(R.plurals.session_stat_words, words)),
    SessionStat(right * 100 / words.coerceAtLeast(1), stringResource(R.string.session_stat_accuracy)),
    SessionStat(((seconds + 59) / 60).toInt().coerceAtLeast(1), stringResource(R.string.session_stat_minutes)),
)

/**
 * The end of a study round: numbers counting up, what the round earned and an invite to one more. It tops the round's
 * summary, inside the caller's scrolling column.
 */
@Composable
fun SessionEnd(
    title: String, stats: List<SessionStat>, accolades: List<Accolade>, bestCombo: Int,
    onMore: (() -> Unit)?, onDone: () -> Unit, modifier: Modifier = Modifier,
) {
    // the accolades pop in one by one once the numbers are mostly up, each with a light tick
    var shown by remember { mutableIntStateOf(0) }
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(accolades) {
        accolades.indices.forEach {
            delay(if (it == 0) 900L else 350L)
            shown = it + 1
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Image(painterResource(R.drawable.celebrate), null, Modifier.size(96.dp))
        Text(title, Modifier.padding(top = 16.dp), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        // same height for every card even when a label wraps
        Row(Modifier.fillMaxWidth().padding(top = 24.dp).height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            stats.forEachIndexed { i, s -> StatCard(s, i * 120, Modifier.weight(1f).fillMaxHeight()) }
        }
        accolades.forEachIndexed { i, a ->
            AnimatedVisibility(i < shown, enter = fadeIn(tween(250)) + scaleIn(tween(250), initialScale = 0.8f)) {
                AccoladeCard(a, bestCombo, Modifier.padding(top = 12.dp))
            }
        }
        if (onMore != null) {
            Button(onClick = onMore, Modifier.fillMaxWidth().padding(top = 24.dp)) { Text(stringResource(R.string.session_end_more)) }
            OutlinedButton(onClick = onDone, Modifier.fillMaxWidth().padding(top = 8.dp)) { Text(stringResource(R.string.session_end_done)) }
        } else {
            Button(onClick = onDone, Modifier.fillMaxWidth().padding(top = 24.dp)) { Text(stringResource(R.string.session_end_done)) }
        }
    }
}

@Composable
private fun StatCard(stat: SessionStat, delayMs: Int, modifier: Modifier) {
    val count = remember { Animatable(0f) }
    LaunchedEffect(stat.value) { count.animateTo(stat.value.toFloat(), tween(800, delayMs)) }
    Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = modifier) {
        Column(Modifier.padding(vertical = 16.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(count.value.roundToInt().toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Text(stat.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun AccoladeCard(accolade: Accolade, bestCombo: Int, modifier: Modifier) {
    val (emoji, tint, variants) = when (accolade) {
        Accolade.PERFECT -> Triple(R.string.session_end_emoji_perfect, Success, listOf(R.string.session_end_perfect_1, R.string.session_end_perfect_2, R.string.session_end_perfect_3))
        Accolade.FAST -> Triple(R.string.session_end_emoji_fast, MaterialTheme.colorScheme.primary, listOf(R.string.session_end_fast_1, R.string.session_end_fast_2, R.string.session_end_fast_3))
        Accolade.COMBO_RECORD -> Triple(R.string.session_end_emoji_combo, Flame, listOf(R.string.session_end_combo_1, R.string.session_end_combo_2, R.string.session_end_combo_3))
    }
    val text = remember(accolade) { variants.random() }
    Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = tint.copy(alpha = 0.16f), modifier = Modifier.size(44.dp)) {
                Box(contentAlignment = Alignment.Center) { Text(stringResource(emoji), style = MaterialTheme.typography.titleLarge) }
            }
            // only the combo texts have a %1$d; the others ignore the extra argument
            Text(stringResource(text, bestCombo), Modifier.padding(start = 14.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}

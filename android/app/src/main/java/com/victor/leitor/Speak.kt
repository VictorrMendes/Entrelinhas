package com.victor.leitor

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private const val ROUND_WORDS = 10
private const val TRIES = 3
private const val SLOW_RATE = 0.6f

/**
 * "Falar": say saved words aloud and see whether the phone's recognizer heard them right, almost or wrong ([speakGrade]).
 * Pronunciation isn't knowing a word: the round leaves the review boxes alone and only counts for the day's streak. The web
 * app's Speak.tsx is the same.
 */
@Composable
fun SpeakMode(app: App, onClose: () -> Unit) {
    fun newRound() = practiceWords(app.db.words(), app.db.dueWords(), ROUND_WORDS)
    var words by remember { mutableStateOf(newRound()) }
    var index by remember(words) { mutableIntStateOf(0) }
    // each finished word's best grade
    val grades = remember(words) { mutableStateListOf<SpeakGrade>() }
    var said by remember(words) { mutableIntStateOf(0) }
    val combo = remember(words) { ComboCounter() }
    var accolades by remember(words) { mutableStateOf<List<Accolade>?>(null) }

    Column(Modifier.fillMaxSize()) {
        StudyTopBar(stringResource(R.string.mode_speak), onClose)
        if (words.isEmpty()) {
            Empty(stringResource(R.string.vocabulary_empty_title), stringResource(R.string.speak_empty_text), R.drawable.empty_vocabulary)
            return@Column
        }
        val ended = accolades
        if (ended == null) {
            StudyProgress(index, words.size)
            ComboBadge(combo)
        }
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (ended != null) {
                val right = grades.count { it == SpeakGrade.RIGHT }
                val wrong = grades.count { it == SpeakGrade.WRONG }
                SessionEnd(
                    stringResource(R.string.practice_done_title),
                    listOf(
                        SessionStat(right, pluralStringResource(R.plurals.speak_stat_right, right)),
                        SessionStat(grades.count { it == SpeakGrade.ALMOST }, stringResource(R.string.speak_stat_almost)),
                        SessionStat(wrong, pluralStringResource(R.plurals.speak_stat_wrong, wrong)),
                    ),
                    ended, combo.best, onMore = { words = newRound() }, onDone = onClose,
                )
            } else {
                key(index) {
                    SpeakWord(app, words[index], last = index == words.lastIndex) { grade, tried ->
                        combo.answer(grade == SpeakGrade.RIGHT)
                        grades += grade
                        if (tried) said++
                        if (index < words.lastIndex) {
                            index++
                        } else {
                            accolades = combo.finish(app.prefs)
                            // like the dictation, a round that was spoken counts for the day; skipping every word doesn't
                            if (said > 0) app.db.completeExercise()
                        }
                    }
                }
            }
        }
    }
}

/** One word: hear it, say it up to three times, then move on with the best grade. Recognizer errors are hints, not tries. */
@Composable
private fun SpeakWord(app: App, word: Word, last: Boolean, onDone: (grade: SpeakGrade, tried: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    var tries by remember { mutableIntStateOf(0) }
    var best by remember { mutableStateOf(SpeakGrade.WRONG) }
    var result by remember { mutableStateOf<Spoken?>(null) }
    var hint by remember { mutableStateOf<String?>(null) }
    val finished = result?.grade == SpeakGrade.RIGHT || tries >= TRIES

    fun play(rate: Float = app.prefs.speechRate) = scope.launch {
        if (!app.speech.speak(word.original, word.source, rate = rate)) {
            app.notices.show(Notice(res.getString(R.string.install_voice, langName(word.source)), NoticeKind.ERROR))
        }
    }

    DisposableEffect(Unit) {
        play()
        onDispose { app.speech.stop() }
    }

    val recognize = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val heard = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS).orEmpty()
        when {
            r.resultCode == Activity.RESULT_OK && heard.isNotEmpty() -> {
                val spoken = speakGrade(word.original, heard)
                result = spoken
                tries++
                if (spoken.grade.ordinal < best.ordinal) best = spoken.grade
            }
            r.resultCode == RecognizerIntent.RESULT_NETWORK_ERROR || r.resultCode == RecognizerIntent.RESULT_SERVER_ERROR ->
                hint = res.getString(R.string.speak_hint_network)
            r.resultCode == RecognizerIntent.RESULT_AUDIO_ERROR -> hint = res.getString(R.string.speak_hint_mic)
            r.resultCode == RecognizerIntent.RESULT_CLIENT_ERROR -> hint = res.getString(R.string.speech_recognition_missing)
            // cancelled, nothing heard or nothing matched
            else -> hint = res.getString(R.string.speak_hint_not_heard)
        }
    }

    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(word.original, fontSize = 36.sp, lineHeight = 44.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(word.translated, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { play() }) {
                Icon(Icons.AutoMirrored.Outlined.VolumeUp, null)
                Text(stringResource(R.string.listen), Modifier.padding(start = 8.dp))
            }
            OutlinedButton(onClick = { play(SLOW_RATE) }) { Text(stringResource(R.string.speak_listen_slowly)) }
        }
        result?.let { SpokenVerdict(it) }
        if (result != null && !finished) Hint(stringResource(R.string.speak_try_again, tries, TRIES))
        hint?.let { Hint(it) }
        if (!finished) {
            Button(
                onClick = {
                    hint = null
                    app.speech.stop()
                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, word.source)
                        .putExtra(RecognizerIntent.EXTRA_PROMPT, word.original)
                        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                    try {
                        recognize.launch(intent)
                    } catch (e: ActivityNotFoundException) {
                        hint = res.getString(R.string.speech_recognition_missing)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.Mic, null)
                Text(stringResource(R.string.speak_say), Modifier.padding(start = 8.dp))
            }
            TextButton(onClick = { onDone(best, tries > 0) }) { Text(stringResource(R.string.skip)) }
        } else {
            Button(onClick = { onDone(best, tries > 0) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (last) R.string.speak_see_result else R.string.speak_next))
            }
        }
    }
}

/** The grade in the colors of the dictation's marks ([MarkedWords]): green, amber underlined, red struck through. */
@Composable
private fun SpokenVerdict(spoken: Spoken) {
    val right = stringResource(R.string.speak_right)
    val almost = stringResource(R.string.speak_almost)
    val heard = stringResource(R.string.speak_heard, spoken.heard)
    val error = MaterialTheme.colorScheme.error
    val text = buildAnnotatedString {
        when (spoken.grade) {
            SpeakGrade.RIGHT -> withStyle(SpanStyle(color = Success, fontWeight = FontWeight.SemiBold)) { append(right) }
            SpeakGrade.ALMOST -> withStyle(SpanStyle(color = Flame, textDecoration = TextDecoration.Underline)) { append(almost) }
            // "Ouvi: " plain, what was heard struck through
            SpeakGrade.WRONG -> {
                val at = heard.lastIndexOf(spoken.heard).coerceAtLeast(0)
                append(heard.substring(0, at))
                withStyle(SpanStyle(color = error, textDecoration = TextDecoration.LineThrough)) { append(heard.substring(at)) }
            }
        }
    }
    Text(text, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

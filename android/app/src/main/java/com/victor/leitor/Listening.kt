@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.victor.leitor

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val LOOP_ID = "loop"
private const val LOOP_PAUSE_MS = 700L
private val SLOW_RATES = listOf(0.5f, 0.75f, 1f)

/**
 * A long-pressed sentence: listen (once, in a loop, slower), translate it, take it as a dictation, say it out loud and get a
 * score (shadowing), or highlight it.
 */
@Composable
fun SentenceSheet(
    app: App,
    sentence: String,
    lang: String,
    target: String,
    bookId: Long,
    highlighted: Boolean,
    onHighlight: () -> Unit,
    onDictation: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    var rate by remember { mutableFloatStateOf(1f) }
    var looping by remember { mutableStateOf(false) }
    var translation by remember { mutableStateOf<String?>(null) }
    var translating by remember { mutableStateOf(false) }
    var spoken by remember { mutableStateOf<Dictation?>(null) }

    fun play() = scope.launch {
        if (!app.speech.speak(sentence, lang, id = LOOP_ID, rate = rate)) {
            app.notices.show(Notice(res.getString(R.string.install_voice, langName(lang)), NoticeKind.ERROR))
        }
    }

    DisposableEffect(Unit) {
        val previous = app.speech.onDone
        app.speech.onDone = { id ->
            if (id == LOOP_ID && looping) scope.launch { delay(LOOP_PAUSE_MS); if (looping) play() } else previous?.invoke(id)
        }
        onDispose {
            app.speech.onDone = previous
            app.speech.stop()
        }
    }

    val recognize = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS).orEmpty()
        if (result.resultCode == Activity.RESULT_OK && heard.isNotEmpty()) spoken = heard.map { checkDictation(sentence, it) }.maxBy { it.score }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("“$sentence”", style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Literata))
            translation?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.primary) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { play() }) {
                    Icon(Icons.AutoMirrored.Outlined.VolumeUp, null)
                    Text(stringResource(R.string.listen), Modifier.padding(start = 8.dp))
                }
                FilterChip(
                    selected = looping,
                    onClick = { looping = !looping; if (looping) play() else app.speech.stop() },
                    label = { Text(stringResource(R.string.repeat_loop)) },
                    leadingIcon = { Icon(Icons.Outlined.Repeat, null) },
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SLOW_RATES.forEach { r ->
                    FilterChip(selected = rate == r, onClick = { rate = r; play() }, label = { Text(rateLabel(r)) })
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                AssistChip(
                    onClick = {
                        translating = true
                        scope.launch {
                            translation = runCatching { app.translator.translate(sentence, lang, target, bookId).text }
                                .getOrElse { it.message ?: res.getString(R.string.translation_failed) }
                            translating = false
                        }
                    },
                    enabled = translation == null && !translating,
                    label = { Text(stringResource(R.string.translate_sentence)) },
                    leadingIcon = { if (translating) CircularProgressIndicator(Modifier.padding(2.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Translate, null) },
                )
                AssistChip(onClick = onDictation, label = { Text(stringResource(R.string.dictation)) }, leadingIcon = { Icon(Icons.Outlined.Edit, null) })
                AssistChip(
                    onClick = {
                        app.speech.stop()
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                            .putExtra(RecognizerIntent.EXTRA_PROMPT, sentence)
                            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                        try {
                            recognize.launch(intent)
                        } catch (e: ActivityNotFoundException) {
                            app.notices.show(Notice(res.getString(R.string.speech_recognition_missing), NoticeKind.ERROR))
                        }
                    },
                    label = { Text(stringResource(R.string.say_it)) },
                    leadingIcon = { Icon(Icons.Outlined.Mic, null) },
                )
                AssistChip(
                    onClick = onHighlight,
                    label = { Text(stringResource(if (highlighted) R.string.edit_highlight else R.string.highlight)) },
                    leadingIcon = { Icon(Icons.Outlined.BorderColor, null) },
                )
            }
            Explanation(app, sentence, sentence, lang, target)
            spoken?.let {
                Text(stringResource(R.string.pronunciation_score, it.score), style = MaterialTheme.typography.titleMedium)
                MarkedWords(it)
            }
        }
    }
}

/**
 * Dictation over a list of sentences (a book's, or the examples of saved words): hear it, type it, see what was missed.
 */
@Composable
fun DictationSheet(app: App, sentences: List<Pair<String, String>>, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    var index by remember { mutableIntStateOf(0) }
    var typed by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<Dictation?>(null) }
    val (sentence, lang) = sentences[index]

    fun play(rate: Float = app.prefs.speechRate) = scope.launch {
        if (!app.speech.speak(sentence, lang, rate = rate)) {
            app.notices.show(Notice(res.getString(R.string.install_voice, langName(lang)), NoticeKind.ERROR))
        }
    }

    DisposableEffect(index) {
        play()
        onDispose { app.speech.stop() }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.dictation), style = MaterialTheme.typography.titleLarge)
            Text(
                stringResource(R.string.dictation_hint, index + 1, sentences.size),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { play() }) {
                    Icon(Icons.AutoMirrored.Outlined.VolumeUp, null)
                    Text(stringResource(R.string.listen), Modifier.padding(start = 8.dp))
                }
                OutlinedButton(onClick = { play(0.6f) }) { Text(stringResource(R.string.listen_slowly)) }
            }
            OutlinedTextField(
                typed, { typed = it }, Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.dictation_type)) }, minLines = 2, enabled = result == null,
            )
            val r = result
            if (r == null) {
                Button(
                    onClick = {
                        result = checkDictation(sentence, typed)
                        app.db.record(Stat.DICTATION)
                        if (index == sentences.lastIndex) app.db.completeExercise() // the last sentence ends the round
                    },
                    enabled = typed.isNotBlank(), modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.check))
                }
            } else {
                Text(stringResource(R.string.dictation_score, r.score), style = MaterialTheme.typography.titleMedium)
                MarkedWords(r)
                Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(12.dp)) {
                    Text(sentence, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { typed = ""; result = null; play() }) { Text(stringResource(R.string.try_again)) }
                    if (index < sentences.lastIndex) {
                        Button(onClick = { index++; typed = ""; result = null }) { Text(stringResource(R.string.next_sentence)) }
                    }
                }
            }
        }
    }
}

/** Heard words in green, typed-but-wrong struck through in red, missed ones underlined in amber. */
@Composable
fun MarkedWords(d: Dictation) {
    val ok = Success
    val wrong = MaterialTheme.colorScheme.error
    Text(
        buildAnnotatedString {
            d.words.forEachIndexed { i, w ->
                if (i > 0) append(' ')
                val style = when (w.mark) {
                    Mark.OK -> SpanStyle(color = ok, fontWeight = FontWeight.SemiBold)
                    Mark.WRONG -> SpanStyle(color = wrong, textDecoration = TextDecoration.LineThrough)
                    Mark.MISSING -> SpanStyle(color = Flame, textDecoration = TextDecoration.Underline)
                }
                withStyle(style) { append(w.text) }
            }
        },
        style = MaterialTheme.typography.bodyLarge,
    )
}

/** The device's voices for [lang] (free; network ones need internet), with a preview of each. */
@Composable
fun VoicePicker(app: App, lang: String, sample: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val voices by produceState<List<VoiceOption>?>(null, lang) { value = app.speech.voices(lang) }
    var chosen by remember { mutableStateOf(app.prefs.voice(lang)) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.voice_for, langName(lang))) },
        text = {
            val list = voices
            when {
                list == null -> CircularProgressIndicator()
                list.isEmpty() -> Text(stringResource(R.string.install_voice, langName(lang)))
                else -> LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    item {
                        VoiceRow(stringResource(R.string.voice_auto), null, chosen == null, { chosen = null }) {
                            scope.launch { app.speech.speak(sample, lang, voice = null) }
                        }
                    }
                    items(list) { v ->
                        val label = stringResource(R.string.voice_n, list.indexOf(v) + 1)
                        val detail = listOfNotNull(
                            stringResource(if (v.quality >= android.speech.tts.Voice.QUALITY_HIGH) R.string.voice_high else R.string.voice_normal),
                            if (v.network) stringResource(R.string.voice_online) else stringResource(R.string.voice_offline),
                        ).joinToString(" · ")
                        VoiceRow(label, detail, chosen == v.name, { chosen = v.name }) { scope.launch { app.speech.speak(sample, lang, voice = v.name) } }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { app.prefs.setVoice(lang, chosen); onDismiss() }) { Text(stringResource(R.string.ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun VoiceRow(label: String, detail: String?, selected: Boolean, onSelect: () -> Unit, onPreview: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onSelect), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = onSelect)
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        IconButton(onClick = onPreview) { Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen)) }
    }
}

/** "Explicar": what [text] means in [sentence], with grammar notes and an example, written by AI in [target]. */
@Composable
fun Explanation(app: App, text: String, sentence: String, lang: String, target: String) {
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    var answer by remember(text, sentence) { mutableStateOf<String?>(null) }
    var error by remember(text, sentence) { mutableStateOf<String?>(null) }
    var busy by remember(text, sentence) { mutableStateOf(false) }
    val shown = answer
    if (shown != null) {
        Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp)) {
                Icon(Icons.Outlined.AutoAwesome, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Text(shown, Modifier.padding(start = 10.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        return
    }
    AssistChip(
        onClick = {
            busy = true
            error = null
            scope.launch {
                runCatching { app.translator.explain(text, sentence, lang, target) }
                    .onSuccess { answer = it }
                    .onFailure { error = it.message ?: res.getString(R.string.translation_failed) }
                busy = false
            }
        },
        enabled = !busy,
        label = { Text(stringResource(R.string.explain)) },
        leadingIcon = { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.AutoAwesome, null) },
    )
    error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
}

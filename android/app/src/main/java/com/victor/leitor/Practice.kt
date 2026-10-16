package com.victor.leitor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val NEXT_AFTER_RIGHT_MS = 700L

/** The answer to the question on screen: [right] or not, [exact] unless a typo was forgiven, [note] from the AI when it graded it. */
private data class Verdict(val right: Boolean, val exact: Boolean = true, val typed: String? = null, val note: String? = null)

/**
 * "Aprender": a round over saved words. Each word is first recognized (its meaning among four) and later recalled (typed
 * from its meaning). A miss stops on the right answer until "Continuar". At the end, words without a miss move up a
 * Leitner box and the others go back to today's review.
 */
@Composable
fun LearnMode(app: App, onClose: () -> Unit) {
    fun newRound(): PracticeRound {
        val all = app.db.words()
        return PracticeRound(practiceWords(all, app.db.dueWords()), all)
    }
    var round by remember { mutableStateOf(newRound()) }
    // the round is a plain object; this counter makes the screen read it again after every answer
    var step by remember { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize()) {
        StudyTopBar(stringResource(R.string.mode_learn), onClose)
        val question = round.current
        if (question != null) StudyProgress(round.done, round.total)
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (question == null) {
                PracticeSummary(app, round, onAgain = { round = newRound(); step++ }, onDone = onClose)
            } else {
                Question(app, question, key = step) { right ->
                    round.answer(right)
                    step++
                }
            }
        }
    }
}

@Composable
private fun Question(app: App, q: PracticeQuestion, key: Int, onAnswered: (right: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    val keyboard = LocalSoftwareKeyboardController.current
    var verdict by remember(key) { mutableStateOf<Verdict?>(null) }
    var picked by remember(key) { mutableStateOf<String?>(null) }
    var typed by remember(key) { mutableStateOf("") }
    var grading by remember(key) { mutableStateOf(false) }
    val word = q.word
    val answer = if (q.stage == PracticeStage.CHOICE) word.translated.trim() else word.original

    // a right answer moves on by itself; a wrong one waits for "Continuar" so the right answer gets read
    LaunchedEffect(verdict) {
        if (verdict?.right == true && verdict?.exact == true) {
            delay(NEXT_AFTER_RIGHT_MS)
            onAnswered(true)
        }
    }

    fun speak() = scope.launch {
        if (!app.speech.speak(word.original, word.source)) {
            app.notices.show(Notice(res.getString(R.string.install_voice, langName(word.source)), NoticeKind.ERROR))
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (q.stage == PracticeStage.CHOICE) word.original else word.translated,
            Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold,
        )
        if (q.stage == PracticeStage.CHOICE || verdict != null) {
            IconButton(onClick = { speak() }) { Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation)) }
        }
    }
    val v = verdict
    Text(
        when {
            v == null && q.stage == PracticeStage.CHOICE -> stringResource(R.string.practice_choose)
            v == null -> stringResource(R.string.practice_write, langName(word.source))
            v.right && v.exact -> stringResource(R.string.practice_right)
            v.right && v.note != null -> stringResource(R.string.practice_ai_accepted, answer)
            v.right -> stringResource(R.string.practice_almost, answer)
            picked == null && v.typed == null -> stringResource(R.string.practice_shown_answer) // "Não sei"
            else -> stringResource(R.string.practice_wrong)
        },
        style = MaterialTheme.typography.titleSmall,
        color = when {
            v == null -> MaterialTheme.colorScheme.onSurfaceVariant
            v.right -> Success
            else -> MaterialTheme.colorScheme.error
        },
    )

    if (q.stage == PracticeStage.CHOICE) {
        q.options.forEach { option ->
            val isAnswer = option == answer
            val state = when {
                v == null -> null
                isAnswer -> true
                option == picked -> false
                else -> null
            }
            AnswerOption(option, state, enabled = v == null) {
                picked = option
                verdict = Verdict(right = isAnswer)
            }
        }
    } else {
        // the example sentence with the word blanked out is a hint that doesn't give the answer away
        word.example?.let { blankOut(it, word.original) }?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        fun check() {
            keyboard?.hide()
            if (closeEnough(word.original, typed)) {
                verdict = Verdict(true, exact = typed.trim().equals(word.original.trim(), ignoreCase = true), typed = typed)
                return
            }
            // refused by the strict check: the AI may still accept a synonym or another form of the word
            grading = true
            scope.launch {
                val g = app.translator.grade(word.original, word.translated, typed, word.source, word.target)
                grading = false
                verdict = Verdict(g?.correct == true, exact = false, typed = typed, note = g?.note?.takeIf { it.isNotBlank() })
            }
        }
        OutlinedTextField(
            typed, { typed = it }, Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.practice_your_answer)) }, singleLine = true, enabled = v == null,
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (typed.isNotBlank() && !grading) check() }),
        )
        v?.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (v != null && !v.right) {
            AnswerOption(answer, state = true, enabled = false) {}
            if (!v.typed.isNullOrBlank()) AnswerOption(v.typed, state = false, enabled = false) {}
        }
        if (v == null) {
            Button(onClick = { check() }, enabled = typed.isNotBlank() && !grading, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (grading) R.string.practice_grading else R.string.check))
            }
        }
    }

    when {
        v == null -> TextButton(onClick = { verdict = Verdict(right = false) }, Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.practice_dont_know))
        }
        !v.exact || !v.right -> Button(onClick = { onAnswered(v.right) }, Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.practice_continue))
        }
    }
}

/** A choice, or an answer shown after the fact: [state] true marks it right, false wrong, null neutral. */
@Composable
fun AnswerOption(text: String, state: Boolean?, enabled: Boolean, onClick: () -> Unit) {
    val color = when (state) {
        true -> Success
        false -> MaterialTheme.colorScheme.error
        null -> MaterialTheme.colorScheme.outline
    }
    Surface(
        onClick = onClick, enabled = enabled, shape = RoundedCornerShape(14.dp),
        color = if (state == null) Color.Transparent else color.copy(alpha = 0.12f),
        border = BorderStroke(if (state == null) 1.dp else 2.dp, color),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            state?.let { Icon(if (it) Icons.Filled.Check else Icons.Filled.Close, null, Modifier.size(20.dp).padding(end = 4.dp), tint = color) }
            Text(text, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun PracticeSummary(app: App, round: PracticeRound, onAgain: () -> Unit, onDone: () -> Unit) {
    // the round counts as a review: no miss moves a word up a box, a miss sends it back to today's queue
    LaunchedEffect(round) { round.words.forEach { app.db.answer(it, known = it.id !in round.missed) } }
    val clean = round.words.count { it.id !in round.missed }
    Text(stringResource(R.string.practice_done_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    Text(
        stringResource(R.string.practice_done_text, clean, round.words.size),
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    round.words.forEach { w ->
        val missed = w.id in round.missed
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = (if (missed) Flame else Success).copy(alpha = 0.16f), modifier = Modifier.size(32.dp)) {
                Icon(
                    if (missed) Icons.Filled.Refresh else Icons.Filled.Check, null, Modifier.padding(6.dp),
                    tint = if (missed) Flame else Success,
                )
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                Text(w.original, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Text(w.translated, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onAgain, Modifier.weight(1f)) { Text(stringResource(R.string.practice_again)) }
        Button(onClick = onDone, Modifier.weight(1f)) { Text(stringResource(R.string.practice_finish)) }
    }
}

/** [sentence] with [word] replaced by a blank, or null when the word isn't in it. */
private fun blankOut(sentence: String, word: String): String? {
    val blanked = Regex(Regex.escape(word.trim()), RegexOption.IGNORE_CASE).replace(sentence, "_____")
    return blanked.takeIf { it != sentence }
}

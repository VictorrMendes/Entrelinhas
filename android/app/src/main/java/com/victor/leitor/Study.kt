package com.victor.leitor

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
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
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.util.Locale
import kotlin.math.abs
import kotlin.math.sign
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The rows of the vocabulary screen that open on their own: the study modes and the word list. */
enum class StudyMode(@StringRes val title: Int) {
    CARDS(R.string.mode_cards),
    LEARN(R.string.mode_learn),
    TEST(R.string.mode_test),
    MATCH(R.string.mode_match),
    LISTEN(R.string.mode_listen),
    WORDS(R.string.mode_words),
    KITS(R.string.kits_title),
}

@Composable
fun StudyScreen(app: App, mode: StudyMode, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
            when (mode) {
                StudyMode.CARDS -> CardsMode(app, onClose)
                StudyMode.LEARN -> LearnMode(app, onClose)
                StudyMode.TEST -> TestMode(app, onClose)
                StudyMode.MATCH -> MatchMode(app, onClose)
                StudyMode.LISTEN -> ListenMode(app, onClose)
                StudyMode.WORDS -> WordsScreen(app, onClose)
                StudyMode.KITS -> KitsMode(app, onClose)
            }
        }
    }
}

/** Close on the left, title in the middle, [trailing] (or an equal gap, to keep the title centered) on the right. */
@Composable
fun StudyTopBar(title: String, onClose: () -> Unit, trailing: @Composable () -> Unit = { Spacer(Modifier.size(48.dp)) }) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.close)) }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        trailing()
    }
}

@Composable
fun StudyProgress(done: Int, total: Int) {
    LinearProgressIndicator(
        progress = { done / total.coerceAtLeast(1).toFloat() },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).height(6.dp),
        color = Success, trackColor = MaterialTheme.colorScheme.surfaceVariant, drawStopIndicator = {},
    )
}

/** Right answers in a row during a round, the round's best, and a combo that just broke (to say so). */
class ComboCounter {
    var current by mutableIntStateOf(0)
        private set
    var best by mutableIntStateOf(0)
        private set
    var lost by mutableIntStateOf(0)
        private set
    private var answers = 0
    private var misses = 0
    private val startedAt = SystemClock.elapsedRealtime()

    fun answer(right: Boolean) {
        answers++
        if (right) {
            current++
            best = maxOf(best, current)
            lost = 0
        } else {
            misses++
            lost = if (current >= COMBO_MIN) current else 0
            current = 0
        }
    }

    /** The round's accolades; a new best combo becomes the record. Call once, when the round ends. */
    fun finish(prefs: Prefs): List<Accolade> =
        sessionAccolades(answers, misses, (SystemClock.elapsedRealtime() - startedAt) / 1000, best, prefs.bestCombo)
            .also { if (best > prefs.bestCombo) prefs.bestCombo = best }
}

@Composable
fun ComboBadge(combo: ComboCounter) {
    val text = when {
        combo.current >= COMBO_MIN -> stringResource(R.string.combo_streak, combo.current)
        combo.lost > 0 -> stringResource(R.string.combo_lost, combo.lost)
        else -> return
    }
    Text(
        text, Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold,
        color = if (combo.current > 0) Flame else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

// ---------------------------------------------------------------- Cartões

/**
 * Flashcards: tap to flip, swipe right when you knew it and left when you're still learning it. Due words are a real
 * review (Leitner); with nothing due, every word goes round as free practice that leaves the schedule alone.
 */
@Composable
private fun CardsMode(app: App, onClose: () -> Unit) {
    val prefs = app.prefs
    val due = remember { app.db.dueWords() }
    val scheduled = due.isNotEmpty()
    val queue = remember { mutableStateListOf<Word>().apply { addAll(if (scheduled) due else app.db.words().shuffled()) } }
    val total = remember { queue.size }
    val learning = remember { mutableStateListOf<Long>() }
    var known by remember { mutableIntStateOf(0) }
    var turn by remember { mutableIntStateOf(0) }

    fun answer(knew: Boolean) {
        val w = queue.removeAt(0)
        if (scheduled) app.db.answer(w, knew)
        if (knew) known++ else {
            if (w.id !in learning) learning += w.id
            queue += w // a card still being learned comes back at the end
        }
        turn++
    }

    Column(Modifier.fillMaxSize()) {
        StudyTopBar(stringResource(R.string.mode_cards), onClose) {
            IconToggleButton(checked = prefs.listenFirst, onCheckedChange = { prefs.listenFirst = it }) {
                Icon(
                    Icons.Outlined.Headphones, stringResource(R.string.listen_first),
                    tint = if (prefs.listenFirst) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        StudyProgress(known, total)
        val word = queue.firstOrNull()
        if (word == null) {
            if (total > 0) LaunchedEffect(Unit) { app.db.completeExercise() }
            StudyDone(
                title = stringResource(R.string.cards_done_title),
                text = stringResource(R.string.cards_done_text, known, learning.size),
                onClose = onClose,
            )
            return@Column
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp)) {
            CountPill(learning.size, stringResource(R.string.cards_learning), Flame)
            Spacer(Modifier.weight(1f))
            CountPill(known, stringResource(R.string.cards_known), Success)
        }
        if (!scheduled) {
            Text(
                stringResource(R.string.cards_free_note), Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 2.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
        }
        key(turn) {
            SwipeCard(app, word, prefs.listenFirst, Modifier.weight(1f).padding(horizontal = 20.dp, vertical = 12.dp), ::answer)
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            RoundButton(Icons.Filled.Refresh, stringResource(R.string.cards_learning), Flame) { answer(false) }
            RoundButton(Icons.Filled.Check, stringResource(R.string.cards_known), Success) { answer(true) }
        }
        Text(
            stringResource(R.string.cards_hint), Modifier.fillMaxWidth().padding(bottom = 12.dp),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun SwipeCard(app: App, word: Word, listenFirst: Boolean, modifier: Modifier, onDone: (knew: Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var flipped by remember { mutableStateOf(false) }
    // listening first: the front only plays the word until the reader asks to see it
    var heard by remember { mutableStateOf(!listenFirst) }
    val rotation by animateFloatAsState(if (flipped) 180f else 0f, tween(280), label = "flip")
    LaunchedEffect(Unit) { if (listenFirst) pronounce(app, scope, word) }
    val leaning = when {
        offset.value > 40f -> Success
        offset.value < -40f -> Flame
        else -> null
    }

    Box(
        modifier.fillMaxWidth()
            .graphicsLayer { translationX = offset.value; rotationZ = offset.value / 60f }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        scope.launch {
                            val width = size.width.toFloat()
                            if (abs(offset.value) > width * 0.28f) {
                                val knew = offset.value > 0
                                offset.animateTo(sign(offset.value) * width * 1.4f, tween(160))
                                onDone(knew)
                            } else offset.animateTo(0f, spring(dampingRatio = 0.6f))
                        }
                    },
                    onDragCancel = { scope.launch { offset.animateTo(0f) } },
                ) { change, amount ->
                    change.consume()
                    scope.launch { offset.snapTo(offset.value + amount) }
                }
            },
    ) {
        Surface(
            onClick = { flipped = !flipped },
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface,
            border = BorderStroke(if (leaning != null) 3.dp else 1.dp, leaning ?: MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxSize().graphicsLayer { rotationY = rotation; cameraDistance = 14f * density },
        ) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                if (rotation <= 90f) {
                    if (!heard) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            FilledIconButton(onClick = { pronounce(app, scope, word) }, Modifier.size(80.dp)) {
                                Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation), Modifier.size(40.dp))
                            }
                            Text(stringResource(R.string.listen_and_guess), Modifier.padding(top = 16.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(onClick = { heard = true }) { Text(stringResource(R.string.show_answer)) }
                        }
                    } else {
                        Text(word.original, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                    }
                } else {
                    // drawn mirrored, so it reads right once the card has turned
                    Column(Modifier.graphicsLayer { rotationY = 180f }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(word.translated, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        word.example?.let { Example(it, word.original, Modifier.padding(top = 20.dp)) }
                        word.bookTitle?.let { BookLine(it, Modifier.padding(top = 16.dp)) }
                    }
                }
                if (rotation <= 90f && heard) {
                    IconButton(onClick = { pronounce(app, scope, word) }, Modifier.align(Alignment.TopStart)) {
                        Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation))
                    }
                }
            }
        }
    }
}

@Composable
private fun CountPill(n: Int, label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = CircleShape, color = color.copy(alpha = 0.14f), border = BorderStroke(1.5.dp, color)) {
            Text("$n", Modifier.padding(horizontal = 14.dp, vertical = 4.dp), color = color, fontWeight = FontWeight.Bold)
        }
        Text(label, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelLarge, color = color)
    }
}

@Composable
private fun RoundButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(onClick = onClick, Modifier.size(64.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = color)) {
            Icon(icon, label, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.background)
        }
        Text(label, Modifier.padding(top = 6.dp), style = MaterialTheme.typography.labelLarge)
    }
}

/** The end of a session: the celebration picture, a line of results and a way out. */
@Composable
private fun StudyDone(title: String, text: String, onClose: () -> Unit, extra: @Composable () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Image(painterResource(R.drawable.celebrate), null, Modifier.size(120.dp))
        Text(title, Modifier.padding(top = 16.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(text, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        extra()
        Button(onClick = onClose, Modifier.fillMaxWidth().padding(top = 24.dp)) { Text(stringResource(R.string.practice_finish)) }
    }
}

// ---------------------------------------------------------------- Avaliar

private enum class TestStep { SETUP, TAKING, RESULTS }

/** A test you set up (how many questions, which kinds) and get a grade for. It doesn't change the review schedule. */
@Composable
private fun TestMode(app: App, onClose: () -> Unit) {
    val all = remember { app.db.words() }
    var step by remember { mutableStateOf(TestStep.SETUP) }
    var count by remember { mutableIntStateOf(minOf(10, all.size)) }
    var kinds by remember { mutableStateOf(TestKind.entries.toSet()) }
    var questions by remember { mutableStateOf<List<TestQuestion>>(emptyList()) }
    val answers = remember { mutableStateListOf<String>() }
    // written answers the strict check refused, as graded by the AI, by question index
    val graded = remember { mutableStateMapOf<Int, AiGrade>() }
    val combo = remember(questions) { ComboCounter() }

    Column(Modifier.fillMaxSize()) {
        val title = stringResource(R.string.mode_test)
        StudyTopBar(if (step == TestStep.TAKING) "$title · ${answers.size + 1}/${questions.size}" else title, onClose)
        when (step) {
            TestStep.SETUP -> TestSetup(all.size, count, { count = it }, kinds, { kinds = it }) {
                questions = buildTest(all, all, count, kinds)
                answers.clear()
                graded.clear()
                step = TestStep.TAKING
            }
            TestStep.TAKING -> {
                StudyProgress(answers.size, questions.size)
                ComboBadge(combo)
                key(answers.size) {
                    TestQuestionView(app, questions[answers.size]) { answer, ai ->
                        combo.answer(questions[answers.size].isRight(answer) || ai?.correct == true)
                        ai?.let { graded[answers.size] = it }
                        answers += answer
                        if (answers.size == questions.size) step = TestStep.RESULTS
                    }
                }
            }
            TestStep.RESULTS -> {
                LaunchedEffect(Unit) {
                    app.db.completeExercise()
                    combo.finish(app.prefs)
                }
                TestResults(questions, answers, graded, onNew = { step = TestStep.SETUP }, onClose = onClose)
            }
        }
    }
}

@Composable
private fun TestSetup(available: Int, count: Int, onCount: (Int) -> Unit, kinds: Set<TestKind>, onKinds: (Set<TestKind>) -> Unit, onStart: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(R.string.test_setup_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.test_count), style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (listOf(5, 10, 20).filter { it < available } + available).distinct().forEach { n ->
                FilterChip(
                    selected = count == n, onClick = { onCount(n) },
                    label = { Text(if (n == available) stringResource(R.string.test_all, n) else "$n") },
                )
            }
        }
        Text(stringResource(R.string.test_kinds), style = MaterialTheme.typography.titleSmall)
        listOf(TestKind.CHOICE to R.string.test_kind_choice, TestKind.WRITTEN to R.string.test_kind_written, TestKind.TRUE_FALSE to R.string.test_kind_tf).forEach { (kind, label) ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(label), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                Switch(
                    checked = kind in kinds,
                    // at least one kind stays on
                    onCheckedChange = { on -> (if (on) kinds + kind else kinds - kind).takeIf { it.isNotEmpty() }?.let(onKinds) },
                )
            }
        }
        Button(onClick = onStart, Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp), enabled = count > 0) { Text(stringResource(R.string.test_start)) }
    }
}

@Composable
private fun TestQuestionView(app: App, q: TestQuestion, onAnswer: (answer: String, ai: AiGrade?) -> Unit) {
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    var typed by remember { mutableStateOf("") }
    var grading by remember { mutableStateOf(false) }
    val word = q.word
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (q.kind == TestKind.WRITTEN) word.translated else word.original,
                Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold,
            )
            if (q.kind != TestKind.WRITTEN) {
                IconButton(onClick = { pronounce(app, scope, word) }) { Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation)) }
            }
        }
        when (q.kind) {
            TestKind.CHOICE -> {
                Text(stringResource(R.string.practice_choose), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                q.options.forEach { option -> AnswerOption(option, state = null, enabled = true) { onAnswer(option, null) } }
            }
            TestKind.WRITTEN -> {
                Text(stringResource(R.string.practice_write, langName(word.source)), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                fun send() {
                    keyboard?.hide()
                    if (q.isRight(typed)) return onAnswer(typed, null)
                    // refused by the strict check: the AI may still accept a synonym or another form of the word
                    grading = true
                    scope.launch { onAnswer(typed, app.translator.grade(word.original, word.translated, typed, word.source, word.target)) }
                }
                OutlinedTextField(
                    typed, { typed = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.practice_your_answer)) },
                    singleLine = true, shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (typed.isNotBlank() && !grading) send() }),
                )
                Button(onClick = { send() }, Modifier.fillMaxWidth(), enabled = typed.isNotBlank() && !grading) {
                    Text(stringResource(if (grading) R.string.practice_grading else R.string.test_answer))
                }
            }
            TestKind.TRUE_FALSE -> {
                Text(stringResource(R.string.test_tf_means), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(q.shown, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = { onAnswer("true", null) }, Modifier.weight(1f).height(56.dp)) { Text(stringResource(R.string.test_true)) }
                    OutlinedButton(onClick = { onAnswer("false", null) }, Modifier.weight(1f).height(56.dp)) { Text(stringResource(R.string.test_false)) }
                }
            }
        }
        TextButton(onClick = { onAnswer("", null) }, Modifier.fillMaxWidth(), enabled = !grading) { Text(stringResource(R.string.practice_dont_know)) }
    }
}

@Composable
private fun TestResults(questions: List<TestQuestion>, answers: List<String>, graded: Map<Int, AiGrade>, onNew: () -> Unit, onClose: () -> Unit) {
    val right = questions.indices.count { questions[it].isRight(answers[it]) || graded[it]?.correct == true }
    val score = right / questions.size.coerceAtLeast(1).toFloat()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { score }, Modifier.size(104.dp), color = Success, strokeWidth = 10.dp,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant, gapSize = 0.dp,
                )
                Text("${(score * 100).toInt()}%", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.padding(start = 20.dp)) {
                Text(
                    stringResource(
                        when {
                            score >= 0.9f -> R.string.test_result_excellent
                            score >= 0.7f -> R.string.test_result_good
                            score >= 0.5f -> R.string.test_result_ok
                            else -> R.string.test_result_low
                        },
                    ),
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                )
                Text(stringResource(R.string.test_score, right, questions.size), Modifier.padding(top = 4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onNew, Modifier.weight(1f)) { Text(stringResource(R.string.test_new)) }
            Button(onClick = onClose, Modifier.weight(1f)) { Text(stringResource(R.string.practice_finish)) }
        }
        Text(stringResource(R.string.test_your_answers), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        questions.forEachIndexed { i, q -> TestReview(q, answers[i], graded[i]) }
    }
}

@Composable
private fun TestReview(q: TestQuestion, answer: String, ai: AiGrade?) {
    val right = q.isRight(answer) || ai?.correct == true
    val color = if (right) Success else MaterialTheme.colorScheme.error
    fun tf(s: String) = if (s == "true") R.string.test_true else R.string.test_false
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant, border = BorderStroke(1.dp, color.copy(alpha = 0.6f))) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                when (q.kind) {
                    TestKind.WRITTEN -> q.word.translated
                    TestKind.TRUE_FALSE -> "${q.word.original} = ${q.shown}?"
                    TestKind.CHOICE -> q.word.original
                },
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
            )
            val given = when {
                answer.isBlank() -> stringResource(R.string.test_no_answer)
                q.kind == TestKind.TRUE_FALSE -> stringResource(tf(answer))
                else -> answer
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (right) Icons.Filled.Check else Icons.Filled.Close, null, Modifier.size(18.dp), tint = color)
                Text(given, Modifier.padding(start = 6.dp), color = color)
            }
            ai?.note?.takeIf { it.isNotBlank() }?.let {
                Text(
                    stringResource(if (ai.correct) R.string.test_ai_accepted else R.string.test_ai_refused, it),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (ai?.correct == true && q.kind == TestKind.WRITTEN) {
                Text(stringResource(R.string.test_studied_word, q.word.original), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (!right) {
                val correct = when (q.kind) {
                    TestKind.CHOICE -> q.word.translated
                    TestKind.WRITTEN -> q.word.original
                    TestKind.TRUE_FALSE -> "${stringResource(tf((q.shown == q.word.translated.trim()).toString()))} · ${q.word.original} = ${q.word.translated}"
                }
                Text(stringResource(R.string.test_correct_answer, correct), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ---------------------------------------------------------------- Combinar

/** Six words and their meanings shuffled on a grid; match every pair as fast as you can. The best time is kept. */
@Composable
private fun MatchMode(app: App, onClose: () -> Unit) {
    val prefs = app.prefs
    val words = remember { app.db.words() }
    var round by remember { mutableIntStateOf(0) }
    var started by remember { mutableStateOf(false) }
    val tiles = remember(round) { matchTiles(words) }
    val matched = remember(round) { mutableStateListOf<Long>() }
    var selected by remember(round) { mutableStateOf<Int?>(null) }
    var wrong by remember(round) { mutableStateOf(emptySet<Int>()) }
    var startAt by remember(round) { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    var elapsed by remember(round) { mutableLongStateOf(0L) }
    var record by remember(round) { mutableStateOf(false) }
    val finished = tiles.isNotEmpty() && matched.size * 2 == tiles.size
    val scope = rememberCoroutineScope()

    LaunchedEffect(round, started, finished) {
        while (started && !finished) {
            elapsed = SystemClock.elapsedRealtime() - startAt
            delay(100)
        }
        if (finished) {
            elapsed = SystemClock.elapsedRealtime() - startAt
            record = prefs.matchBest == 0L || elapsed < prefs.matchBest
            if (record) prefs.matchBest = elapsed
        }
    }

    Column(Modifier.fillMaxSize()) {
        StudyTopBar(if (started && !finished) stringResource(R.string.match_time, seconds(elapsed)) else stringResource(R.string.mode_match), onClose)
        when {
            !started -> StudyIntro(
                text = stringResource(R.string.match_intro),
                best = prefs.matchBest.takeIf { it > 0 }?.let { stringResource(R.string.match_best, seconds(it)) },
                action = stringResource(R.string.match_start),
            ) { started = true; startAt = SystemClock.elapsedRealtime() }
            finished -> StudyDone(
                title = stringResource(if (record) R.string.match_record else R.string.match_done),
                text = stringResource(R.string.match_time, seconds(elapsed)) +
                    if (!record) "\n" + stringResource(R.string.match_best, seconds(prefs.matchBest)) else "",
                onClose = onClose,
            ) {
                OutlinedButton(onClick = { round++ }, Modifier.fillMaxWidth().padding(top = 24.dp)) {
                    Text(stringResource(R.string.match_again))
                }
            }
            else -> Column(Modifier.fillMaxSize().padding(12.dp)) {
                tiles.chunked(3).forEachIndexed { row, line ->
                    Row(Modifier.fillMaxWidth().weight(1f)) {
                        line.forEachIndexed { col, tile ->
                            val i = row * 3 + col
                            val gone = tile.pair in matched
                            val border = when {
                                i in wrong -> MaterialTheme.colorScheme.error
                                i == selected -> MaterialTheme.colorScheme.primary
                                else -> MaterialTheme.colorScheme.outlineVariant
                            }
                            Surface(
                                onClick = {
                                    val other = selected
                                    when {
                                        other == null -> selected = i
                                        other == i -> selected = null
                                        tiles[other].pair == tile.pair -> { matched += tile.pair; selected = null }
                                        else -> {
                                            selected = null
                                            wrong = setOf(i, other)
                                            scope.launch { delay(450); wrong = emptySet() }
                                        }
                                    }
                                },
                                enabled = !gone,
                                shape = RoundedCornerShape(16.dp),
                                color = if (i == selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else MaterialTheme.colorScheme.surfaceVariant,
                                border = BorderStroke(if (i == selected || i in wrong) 2.dp else 1.dp, border),
                                modifier = Modifier.weight(1f).fillMaxHeight().padding(5.dp).alpha(if (gone) 0f else 1f),
                            ) {
                                Box(Modifier.fillMaxSize().padding(8.dp), contentAlignment = Alignment.Center) {
                                    Text(tile.text, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                                }
                            }
                        }
                        repeat(3 - line.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun StudyIntro(text: String, best: String?, action: String, onStart: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(text, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        best?.let { Text(it, Modifier.padding(top = 10.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Button(onClick = onStart, Modifier.fillMaxWidth().padding(top = 28.dp).height(52.dp)) { Text(action) }
    }
}

/** 12.3 in the device's number format. */
fun seconds(ms: Long): String = String.format(Locale.getDefault(), "%.1f", ms / 1000.0)

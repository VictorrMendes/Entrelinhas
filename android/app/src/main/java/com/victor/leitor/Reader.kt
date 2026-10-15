@file:OptIn(ExperimentalMaterial3Api::class)

package com.victor.leitor

import androidx.compose.ui.res.stringResource
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.alpha
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.FilledIconButton
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Pause
import androidx.core.view.WindowCompat
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.graphics.luminance
import androidx.compose.material.icons.outlined.FormatSize
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.google.mlkit.nl.translate.TranslateLanguage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.Normalizer
import kotlin.coroutines.cancellation.CancellationException

/** Reading time is credited in ticks, only while the app is on screen and the reader recently scrolled, tapped or listened. */
private const val TICK_SECONDS = 10
private const val IDLE_AFTER_MS = 120_000L

private val WORD = Regex("\\p{L}[\\p{L}'’-]*")

private val HIGHLIGHT_COLORS = listOf(Color(0xFFFACC15), Color(0xFF4ADE80), Color(0xFF60A5FA), Color(0xFFF472B6))

/** A tapped word or a grown expression: [start, end) in the text of [block]. */
private data class Lookup(
    val block: Int,
    val start: Int,
    val end: Int,
    val word: String,
    val sentence: String,
    val result: String? = null,
    val offline: Boolean = false,
    val error: String? = null,
)

private data class HighlightEdit(val block: Int, val start: Int, val end: Int, val existing: Highlight?)

/** A long-pressed sentence: [existing] when it falls inside a highlight. */
private data class SentenceTarget(val block: Int, val start: Int, val end: Int, val existing: Highlight?)

private enum class Panel { TOC, SEARCH, NOTES }

@Composable
fun Reader(app: App, bookId: Long, onBack: () -> Unit) {
    val book = remember(bookId) { app.db.book(bookId) }
    val loaded by produceState<Pair<List<Block>, List<TocEntry>>?>(null, bookId) {
        value = withContext(Dispatchers.IO) {
            val blocks = runCatching { app.loadBlocks(bookId) }.getOrDefault(emptyList())
            // books without their own table of contents fall back to their headings
            val toc = runCatching { BookParser.tocFromJson(app.tocFile(bookId).readText()) }.getOrNull()?.takeIf { it.isNotEmpty() }
                ?: blocks.mapIndexedNotNull { i, b -> if (b.type == BlockType.HEADING && b.text.length <= 120) TocEntry(b.text, i) else null }
            blocks to toc
        }
    }
    val theme = ReadingTheme.entries[app.prefs.readingTheme.coerceIn(0, ReadingTheme.entries.lastIndex)]
    val view = LocalView.current
    val lightPage = (theme.page ?: MaterialTheme.colorScheme.background).luminance() > 0.5f
    DisposableEffect(lightPage) {
        val window = (view.context as? android.app.Activity)?.window
        val bars = window?.let { WindowCompat.getInsetsController(it, view) }
        val before = bars?.isAppearanceLightStatusBars
        bars?.isAppearanceLightStatusBars = lightPage
        onDispose { before?.let { bars.isAppearanceLightStatusBars = it } }
    }
    MaterialTheme(colorScheme = MaterialTheme.colorScheme.forReading(theme)) {
    Surface(Modifier.fillMaxSize()) {
        val l = loaded
        when {
            book == null || l?.first?.isEmpty() == true -> Column(
                Modifier.fillMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.book_open_failed))
                Button(onClick = onBack) { Text(stringResource(R.string.back_to_library)) }
            }
            l == null -> Box(contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else -> ReaderContent(app, book, l.first, l.second, onBack)
        }
    }
    }
}

@Composable
private fun ReaderContent(app: App, book: Book, blocks: List<Block>, toc: List<TocEntry>, onBack: () -> Unit) {
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    val prefs = app.prefs
    var src by rememberSaveable { mutableStateOf(book.language ?: TranslateLanguage.ENGLISH) }
    var tgt by rememberSaveable { mutableStateOf(book.targetLanguage ?: prefs.defaultTarget) }
    val translations = remember(src, tgt) { mutableStateMapOf<Int, String>().apply { putAll(app.db.paragraphTranslations(book.id, src, tgt)) } }
    val loading = remember(src, tgt) { mutableStateMapOf<Int, Boolean>() }
    var offline by remember { mutableStateOf<Boolean?>(null) }
    var lookup by remember { mutableStateOf<Lookup?>(null) }
    var showLanguages by rememberSaveable { mutableStateOf(book.language == null) }
    var panel by remember { mutableStateOf<Panel?>(null) }
    var editing by remember { mutableStateOf<HighlightEdit?>(null) }
    var speaking by remember { mutableStateOf<Int?>(null) }
    var paused by remember { mutableStateOf(false) }
    var spoken by remember { mutableStateOf<IntRange?>(null) }
    var listenOnly by remember { mutableStateOf(false) }
    val revealed = remember { mutableStateMapOf<Int, Boolean>() }
    var sentence by remember { mutableStateOf<SentenceTarget?>(null) }
    var dictation by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var voicePicker by remember { mutableStateOf(false) }
    var searchMark by remember { mutableStateOf<Pair<Int, String>?>(null) }
    var celebrate by remember { mutableStateOf<Streak.State?>(null) }
    var lastInteraction by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val version by app.db.changes.collectAsState()
    val highlights = remember(version) { app.db.highlights(book.id) }
    val highlightsByBlock = remember(highlights) { highlights.groupBy { it.block } }
    // words and expressions already saved in this book's language get underlined wherever they come back
    val savedWords = remember(version, src) { app.db.words().filter { it.source == src }.mapTo(HashSet()) { it.original.lowercase() } }
    val listState = rememberLazyListState(book.lastBlock.coerceIn(0, blocks.lastIndex))
    val percent by remember { derivedStateOf { (listState.firstVisibleItemIndex + 1) * 100 / blocks.size } }
    val style = readerStyle(prefs)
    var showSettings by remember { mutableStateOf(false) }

    fun notify(message: String, kind: NoticeKind = NoticeKind.ERROR) = app.notices.show(Notice(message, kind))

    fun fail(e: Throwable) {
        if (e !is CancellationException) notify(e.message ?: res.getString(R.string.translation_failed))
    }

    fun translateBlock(i: Int) {
        if (loading[i] == true) return
        loading[i] = true
        scope.launch {
            val text = blocks[i].text
            runCatching {
                if (prefs.interlinear) app.translator.translateSentences(sentenceRanges(text).map { text.substring(it) }, src, tgt, book.id)
                else app.translator.translate(text, src, tgt, book.id)
            }
                .onSuccess {
                    translations[i] = it.text
                    offline = it.offline
                    app.db.record(Stat.PARAGRAPH)
                    app.db.saveParagraphTranslation(book.id, i, src, tgt, it.text)
                }
                .onFailure(::fail)
            loading.remove(i)
        }
    }

    fun lookUp(block: Int, start: Int, end: Int) {
        lastInteraction = System.currentTimeMillis()
        val text = blocks[block].text
        val asked = Lookup(block, start, end, text.substring(start, end), sentenceAt(text, start))
        lookup = asked
        scope.launch {
            val r = runCatching { app.translator.translate(asked.word, src, tgt, book.id, context = asked.sentence) }
            r.onSuccess { app.db.record(Stat.WORD) }
            if (lookup == asked) {
                lookup = r.fold({ asked.copy(result = it.text, offline = it.offline) }, { asked.copy(error = it.message ?: res.getString(R.string.translation_failed)) })
            }
        }
    }

    fun openSentence(block: Int, offset: Int) {
        lastInteraction = System.currentTimeMillis()
        val existing = highlightsByBlock[block]?.firstOrNull { offset in it.start until it.end }
        val range = sentenceRange(blocks[block].text, offset)
        sentence = if (existing != null) SentenceTarget(block, existing.start, existing.end, existing) else SentenceTarget(block, range.first, range.last + 1, null)
    }

    /** The long-pressed sentence and the ones after it, for a dictation that follows the book. */
    fun dictationFrom(block: Int, start: Int): List<Pair<String, String>> =
        (block until blocks.size).asSequence()
            .filter { blocks[it].type != BlockType.IMAGE }
            .flatMap { i -> sentenceRanges(blocks[i].text).filter { i != block || it.first >= start }.map { blocks[i].text.substring(it) } }
            .filter { it.split(' ').size >= 3 }
            .take(10).map { it to src }.toList()

    fun speakFrom(from: Int, step: Int = 1) {
        val range = if (step > 0) (from until blocks.size) else (from downTo 0)
        val next = range.firstOrNull { blocks[it].type != BlockType.IMAGE && blocks[it].text.isNotBlank() }
        speaking = next
        spoken = null
        paused = false
        if (next == null) return
        scope.launch {
            if (listState.layoutInfo.visibleItemsInfo.none { it.index == next }) listState.animateScrollToItem(next)
            app.speech.rate = prefs.speechRate
            if (!app.speech.speak(blocks[next].text, src, id = "b$next")) {
                speaking = null
                notify(res.getString(R.string.install_voice, langName(src)))
            }
        }
    }

    DisposableEffect(Unit) {
        app.speech.onDone = { id -> scope.launch { speaking?.let { if (id == "b$it" && !paused) speakFrom(it + 1) } } }
        // karaoke: the word being spoken lights up
        app.speech.onRange = { id, start, end -> scope.launch { if (id == "b$speaking") spoken = start until end } }
        onDispose {
            app.speech.onDone = null
            app.speech.onRange = null
            app.speech.stop()
        }
    }

    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }.collect { lastInteraction = System.currentTimeMillis() }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(TICK_SECONDS * 1000L)
            val active = speaking != null || System.currentTimeMillis() - lastInteraction < IDLE_AFTER_MS
            if (app.foreground && active && app.db.addReadingSeconds(TICK_SECONDS, prefs.dailyGoalMinutes * 60)) celebrate = app.db.streak()
        }
    }

    LaunchedEffect(book.id) { app.db.record(Stat.SESSION) }

    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex to (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index == blocks.lastIndex) }
            .collectLatest { (first, atEnd) ->
                delay(500)
                app.db.saveProgress(book.id, first, atEnd)
            }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(book.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    TextButton(onClick = { showLanguages = true }) { Text("${src.uppercase()} → ${tgt.uppercase()}") }
                    IconButton(onClick = { showSettings = true }) { Icon(Icons.Outlined.FormatSize, stringResource(R.string.reading_settings)) }
                },
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp) {
                val current = speaking
                if (current == null) Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("$percent%", style = MaterialTheme.typography.labelMedium)
                    offline?.let {
                        Text(
                            if (it) "  OFFLINE" else "  ONLINE",
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { panel = Panel.TOC }) { Icon(Icons.AutoMirrored.Outlined.List, stringResource(R.string.contents)) }
                    IconButton(onClick = { panel = Panel.SEARCH }) { Icon(Icons.Outlined.Search, stringResource(R.string.search_book)) }
                    IconButton(onClick = { speakFrom(listState.firstVisibleItemIndex) }) {
                        Icon(Icons.Filled.PlayArrow, stringResource(R.string.read_aloud))
                    }
                    IconButton(onClick = { panel = Panel.NOTES }) { Icon(Icons.Outlined.BorderColor, stringResource(R.string.highlights_notes)) }
                } else {
                    PlayerBar(
                        paused = paused,
                        rate = prefs.speechRate,
                        listenOnly = listenOnly,
                        onPrevious = { speakFrom(current - 1, step = -1) },
                        onPlayPause = {
                            if (paused) speakFrom(current) else {
                                paused = true
                                app.speech.stop()
                            }
                        },
                        onNext = { speakFrom(current + 1) },
                        onRate = {
                            prefs.speechRate = SPEECH_RATES[(SPEECH_RATES.indexOf(prefs.speechRate) + 1) % SPEECH_RATES.size]
                            if (!paused) speakFrom(current)
                        },
                        onListenOnly = { listenOnly = !listenOnly; revealed.clear() },
                        onStop = {
                            app.speech.stop()
                            speaking = null
                            spoken = null
                            listenOnly = false
                        },
                    )
                }
            }
        },
    ) { pad ->
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(start = style.margin, end = style.margin, top = pad.calculateTopPadding() + 8.dp, bottom = pad.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            itemsIndexed(blocks) { i, block ->
                if (block.type == BlockType.IMAGE) {
                    BookImage(File(app.bookDir(book.id), block.image.orEmpty()), block.text)
                } else {
                    val translation = translations[i]
                    BlockItem(
                        block = block,
                        highlights = highlightsByBlock[i].orEmpty(),
                        mark = searchMark?.takeIf { it.first == i }?.second,
                        speaking = speaking == i,
                        spoken = spoken.takeIf { speaking == i },
                        hidden = listenOnly && speaking != null && revealed[i] != true,
                        onReveal = { revealed[i] = true },
                        translation = translation,
                        loading = loading[i] == true,
                        style = style,
                        saved = savedWords,
                        onWord = { start, end -> lookUp(i, start, end) },
                        onLongPress = { offset -> openSentence(i, offset) },
                        onTranslate = { translateBlock(i) },
                        onLink = { target -> scope.launch { listState.scrollToItem(target) } },
                    )
                }
            }
        }
    }

    lookup?.let { l ->
        ModalBottomSheet(onDismissRequest = { lookup = null }) {
            Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val text = blocks[l.block].text
                val sentence = sentenceRange(text, l.start)
                val before = previousWord(text, l.start)?.takeIf { it.first >= sentence.first }
                val after = nextWord(text, l.end)?.takeIf { it.last <= sentence.last }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { before?.let { lookUp(l.block, it.first, l.end) } }, enabled = before != null) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.add_previous_word))
                    }
                    Text(l.word, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.headlineSmall)
                    IconButton(onClick = { after?.let { lookUp(l.block, l.start, it.last + 1) } }, enabled = after != null) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.add_next_word))
                    }
                    IconButton(onClick = { scope.launch { if (!app.speech.speak(l.word, src)) notify(res.getString(R.string.install_voice, langName(src))) } }) {
                        Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation))
                    }
                }
                Text(
                    "${langName(src)} → ${langName(tgt)}" + if (l.offline) stringResource(R.string.offline_suffix) else "",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                when {
                    l.error != null -> Text(l.error, color = MaterialTheme.colorScheme.error)
                    l.result == null -> CircularProgressIndicator()
                    else -> Text(l.result, style = MaterialTheme.typography.titleLarge)
                }
                if (l.result != null) Explanation(app, l.word, l.sentence, src, tgt)
                Button(enabled = l.result != null, onClick = {
                    app.db.saveWord(l.word, l.result.orEmpty(), src, tgt, book.id, book.title, example = l.sentence)
                    app.notices.show(
                        Notice(res.getString(R.string.saved_to_vocabulary), NoticeKind.SUCCESS, res.getString(R.string.see), NoticeAction.OpenVocabulary),
                    )
                    lookup = null
                }) { Text(stringResource(R.string.save)) }
            }
        }
    }

    editing?.let { e ->
        HighlightSheet(blocks[e.block].text.substring(e.start, e.end), e.existing, onDismiss = { editing = null }) { color, note, remove ->
            when {
                remove -> e.existing?.let { app.db.deleteHighlight(book.id, it) }
                e.existing != null -> app.db.updateHighlight(e.existing.id, color, note)
                else -> app.db.addHighlight(book.id, e.block, e.start, e.end, color, note)
            }
            editing = null
        }
    }

    when (panel) {
        Panel.TOC -> TocSheet(toc, listState.firstVisibleItemIndex, onDismiss = { panel = null }) { block ->
            panel = null
            scope.launch { listState.scrollToItem(block) }
        }
        Panel.SEARCH -> SearchSheet(blocks, onDismiss = { panel = null }) { block, query ->
            panel = null
            searchMark = block to query
            scope.launch { listState.scrollToItem(block) }
        }
        Panel.NOTES -> NotesSheet(highlights, blocks, onDismiss = { panel = null }) { block ->
            panel = null
            scope.launch { listState.scrollToItem(block) }
        }
        null -> Unit
    }

    if (showLanguages) {
        LanguageDialog(app, src, tgt, onDismiss = { showLanguages = false }) { s, t, asDefault ->
            src = s
            tgt = t
            app.db.setLanguages(book.id, s, t)
            if (asDefault) prefs.defaultTarget = t
            showLanguages = false
        }
    }

    if (showSettings) ReaderSettingsSheet(prefs, onVoice = { showSettings = false; voicePicker = true }) { showSettings = false }
    if (voicePicker) {
        val sample = blocks.getOrNull(listState.firstVisibleItemIndex)?.text?.let { t -> sentenceRanges(t).firstOrNull()?.let { t.substring(it) } } ?: book.title
        VoicePicker(app, src, sample) { voicePicker = false }
    }

    sentence?.let { t ->
        SentenceSheet(
            app, blocks[t.block].text.substring(t.start, t.end), src, tgt, book.id, highlighted = t.existing != null,
            onHighlight = { sentence = null; editing = HighlightEdit(t.block, t.start, t.end, t.existing) },
            onDictation = { sentence = null; dictation = dictationFrom(t.block, t.start).ifEmpty { null } },
            onDismiss = { sentence = null },
        )
    }
    dictation?.let { DictationSheet(app, it) { dictation = null } }

    celebrate?.let { GoalReached(it, prefs.dailyGoalMinutes) { celebrate = null } }
}

@Composable
private fun BlockItem(
    block: Block,
    highlights: List<Highlight>,
    mark: String?,
    speaking: Boolean,
    spoken: IntRange?,
    hidden: Boolean,
    onReveal: () -> Unit,
    translation: String?,
    loading: Boolean,
    style: ReaderStyle,
    saved: Set<String>,
    onWord: (start: Int, end: Int) -> Unit,
    onLongPress: (offset: Int) -> Unit,
    onTranslate: () -> Unit,
    onLink: (target: Int) -> Unit,
) {
    val size = style.fontSize.sp
    val base = MaterialTheme.typography.bodyLarge.copy(fontFamily = style.font, fontSize = size, lineHeight = size * style.lineSpacing)
    val textStyle = when (block.type) {
        BlockType.HEADING -> base.copy(fontSize = size * 1.3f, lineHeight = size * 1.3f * style.lineSpacing, fontWeight = FontWeight.Bold)
        BlockType.QUOTE, BlockType.POEM -> base.copy(fontStyle = FontStyle.Italic)
        else -> base
    }
    val indent = if (block.type == BlockType.QUOTE || block.type == BlockType.POEM) 16.dp else 0.dp
    val markColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
    val linkColor = MaterialTheme.colorScheme.primary
    val spokenColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.28f)
    val text = remember(block, highlights, mark, markColor, spoken, saved) { styled(block, highlights, mark, markColor, linkColor, spoken, spokenColor, saved) }
    val prefix = if (block.type == BlockType.LIST_ITEM) 2 else 0
    // an entry of the book's own contents page: a link, nothing to translate
    val navigation = block.links.any { it.start == 0 && it.end >= block.text.length }
    val sentences = remember(block) { sentenceRanges(block.text) }
    val lines = translation?.split('\n')?.takeIf { style.interlinear && it.size == sentences.size && sentences.isNotEmpty() }

    fun tap(offset: Int) {
        val link = block.links.firstOrNull { offset - prefix in it.start..it.end }
        if (link != null) onLink(link.target) else wordRange(block.text, offset - prefix)?.let { onWord(it.first, it.last + 1) }
    }

    fun longPress(offset: Int) {
        if (offset >= prefix) onLongPress(offset - prefix)
    }

    if (hidden) {
        // "ears only": the text stays veiled while it is read; a tap shows it to check what was understood
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onReveal)) {
            Text(text, Modifier.veiled(), style = textStyle)
            Text(
                stringResource(R.string.tap_to_reveal), Modifier.align(Alignment.Center),
                style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
            )
        }
        return
    }
    Column(
        Modifier.fillMaxWidth()
            .then(if (speaking) Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)) else Modifier)
            .padding(start = indent),
    ) {
        if (lines != null) {
            val under = textStyle.copy(
                fontSize = textStyle.fontSize * 0.8f, lineHeight = textStyle.lineHeight * 0.8f, fontStyle = FontStyle.Italic,
                fontWeight = FontWeight.Normal, color = MaterialTheme.colorScheme.primary,
            )
            sentences.forEachIndexed { k, r ->
                val from = if (k == 0) 0 else prefix + r.first
                val to = if (k == sentences.lastIndex) text.length else prefix + sentences[k + 1].first
                TappableText(text.subSequence(from, to), textStyle, onTap = { tap(from + it) }, onLongPress = { longPress(from + it) })
                Text(lines[k], Modifier.padding(bottom = 8.dp), style = under)
            }
            return@Column
        }
        TappableText(text, textStyle, onTap = ::tap, onLongPress = ::longPress)
        when {
            navigation -> Unit
            loading -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
            translation != null -> Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            ) { Text(translation.replace('\n', ' '), Modifier.padding(12.dp), style = textStyle) }
            else -> Text(
                stringResource(R.string.translate_paragraph),
                Modifier.align(Alignment.End).clip(RoundedCornerShape(4.dp)).clickable(onClick = onTranslate).padding(horizontal = 6.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

private fun styled(
    block: Block,
    highlights: List<Highlight>,
    mark: String?,
    markColor: Color,
    linkColor: Color,
    spoken: IntRange? = null,
    spokenColor: Color = Color.Transparent,
    saved: Set<String> = emptySet(),
): AnnotatedString {
    val prefix = if (block.type == BlockType.LIST_ITEM) "• " else ""
    val p = prefix.length
    return buildAnnotatedString {
        append(prefix + block.text)
        block.spans.forEach {
            addStyle(SpanStyle(fontWeight = if (it.bold) FontWeight.Bold else null, fontStyle = if (it.italic) FontStyle.Italic else null), p + it.start, p + it.end)
        }
        block.links.forEach { addStyle(SpanStyle(color = linkColor), p + it.start, p + it.end) }
        if (saved.isNotEmpty()) {
            val lower = block.text.lowercase()
            val underline = SpanStyle(textDecoration = TextDecoration.Underline)
            WORD.findAll(lower).filter { it.value in saved }.forEach { addStyle(underline, p + it.range.first, p + it.range.last + 1) }
            saved.filter { ' ' in it }.forEach { phrase ->
                Regex("(?<!\\p{L})${Regex.escape(phrase)}(?!\\p{L})").findAll(lower).forEach { addStyle(underline, p + it.range.first, p + it.range.last + 1) }
            }
        }
        highlights.forEach { h ->
            val color = HIGHLIGHT_COLORS.getOrElse(h.color) { HIGHLIGHT_COLORS[0] }
            addStyle(SpanStyle(background = color.copy(alpha = 0.35f)), p + h.start.coerceIn(0, block.text.length), p + h.end.coerceIn(0, block.text.length))
        }
        spoken?.let { r ->
            val from = r.first.coerceIn(0, block.text.length)
            val to = (r.last + 1).coerceIn(from, block.text.length)
            addStyle(SpanStyle(background = spokenColor), p + from, p + to)
        }
        if (mark != null) {
            val haystack = normalize(block.text)
            val needle = normalize(mark)
            var from = haystack.indexOf(needle)
            while (needle.isNotEmpty() && from >= 0 && from + needle.length <= block.text.length) {
                addStyle(SpanStyle(background = markColor), p + from, p + from + needle.length)
                from = haystack.indexOf(needle, from + needle.length)
            }
        }
    }
}

/** Case- and accent-insensitive; keeps the length of precomposed text, so match offsets still apply to the original. */
private fun normalize(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}"), "")

@Composable
private fun TappableText(
    text: AnnotatedString,
    style: TextStyle,
    onTap: (offset: Int) -> Unit,
    onLongPress: (Int) -> Unit,
) {
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text,
        style = style,
        onTextLayout = { layout = it },
        modifier = Modifier.pointerInput(text) {
            detectTapGestures(
                onTap = { pos ->
                    layout?.let {
                        onTap(it.getOffsetForPosition(pos))
                    }
                },
                onLongPress = { pos -> layout?.let { onLongPress(it.getOffsetForPosition(pos)) } },
            )
        },
    )
}

@Composable
private fun HighlightSheet(quote: String, existing: Highlight?, onDismiss: () -> Unit, onSave: (color: Int, note: String?, remove: Boolean) -> Unit) {
    var color by remember { mutableIntStateOf(existing?.color ?: 0) }
    var note by remember { mutableStateOf(existing?.note.orEmpty()) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(if (existing == null) R.string.highlight_sentence else R.string.edit_highlight), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "“$quote”",
                Modifier.clip(RoundedCornerShape(8.dp)).background(HIGHLIGHT_COLORS[color].copy(alpha = 0.25f)).padding(12.dp),
                style = MaterialTheme.typography.bodyLarge, maxLines = 6, overflow = TextOverflow.Ellipsis,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                HIGHLIGHT_COLORS.forEachIndexed { i, c ->
                    Box(
                        Modifier.size(36.dp).clip(CircleShape).background(c)
                            .then(if (i == color) Modifier.border(BorderStroke(3.dp, MaterialTheme.colorScheme.onSurface), CircleShape) else Modifier)
                            .clickable { color = i },
                    )
                }
            }
            OutlinedTextField(note, { note = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.note_optional)) }, minLines = 2, maxLines = 5)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (existing != null) OutlinedButton(onClick = { onSave(color, null, true) }) { Text(stringResource(R.string.remove)) }
                Spacer(Modifier.weight(1f))
                Button(onClick = { onSave(color, note.trim().ifEmpty { null }, false) }) { Text(stringResource(if (existing == null) R.string.highlight else R.string.save)) }
            }
        }
    }
}

@Composable
private fun TocSheet(toc: List<TocEntry>, current: Int, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val active = toc.indexOfLast { it.block <= current }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text(stringResource(R.string.contents), Modifier.padding(start = 24.dp, bottom = 8.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        if (toc.isEmpty()) {
            Text(
                stringResource(R.string.no_contents),
                Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else LazyColumn(Modifier.heightIn(max = 520.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            itemsIndexed(toc) { i, entry ->
                Text(
                    entry.title,
                    Modifier.fillMaxWidth().clickable { onPick(entry.block) }.padding(horizontal = 24.dp, vertical = 14.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (i == active) FontWeight.SemiBold else null,
                    color = if (i == active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun SearchSheet(blocks: List<Block>, onDismiss: () -> Unit, onPick: (block: Int, query: String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val normalized by produceState<List<String>?>(null, blocks) { value = withContext(Dispatchers.Default) { blocks.map { normalize(it.text) } } }
    val results by produceState(emptyList<Int>(), query, normalized) {
        delay(250) // debounce typing
        val all = normalized ?: return@produceState
        val q = normalize(query.trim())
        value = if (q.length < 2) emptyList() else withContext(Dispatchers.Default) { all.indices.filter { all[it].contains(q) }.take(200) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().focusRequester(focus), label = { Text(stringResource(R.string.search_book)) }, singleLine = true)
            Text(
                if (query.trim().length < 2) stringResource(R.string.search_min_letters)
                else stringResource(R.string.search_results, "${results.size}${if (results.size == 200) "+" else ""}"),
                Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(Modifier.heightIn(max = 460.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            itemsIndexed(results) { _, i ->
                Text(
                    snippet(blocks[i].text, normalize(query.trim())),
                    Modifier.fillMaxWidth().clickable { onPick(i, query.trim()) }.padding(horizontal = 24.dp, vertical = 12.dp),
                    style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private fun snippet(text: String, needle: String): AnnotatedString {
    val at = normalize(text).indexOf(needle).coerceAtLeast(0)
    val start = (at - 40).coerceAtLeast(0)
    val end = (at + needle.length + 40).coerceAtMost(text.length)
    return buildAnnotatedString {
        if (start > 0) append("…")
        val offset = length - start
        append(text.substring(start, end))
        if (end < text.length) append("…")
        if (at + needle.length <= text.length) addStyle(SpanStyle(fontWeight = FontWeight.Bold), offset + at, offset + at + needle.length)
    }
}

@Composable
private fun NotesSheet(highlights: List<Highlight>, blocks: List<Block>, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text(stringResource(R.string.highlights_notes), Modifier.padding(start = 24.dp, bottom = 8.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        if (highlights.isEmpty()) {
            Text(
                stringResource(R.string.no_highlights),
                Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else LazyColumn(Modifier.heightIn(max = 520.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            itemsIndexed(highlights) { _, h ->
                val text = blocks.getOrNull(h.block)?.text.orEmpty()
                Row(Modifier.fillMaxWidth().clickable { onPick(h.block) }.padding(horizontal = 24.dp, vertical = 12.dp)) {
                    Box(Modifier.width(4.dp).height(48.dp).clip(RoundedCornerShape(2.dp)).background(HIGHLIGHT_COLORS.getOrElse(h.color) { HIGHLIGHT_COLORS[0] }))
                    Column(Modifier.padding(start = 12.dp)) {
                        Text(
                            text.substring(h.start.coerceIn(0, text.length), h.end.coerceIn(0, text.length)),
                            style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis,
                        )
                        h.note?.let { Text(it, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                    }
                }
            }
        }
    }
}

@Composable
private fun GoalReached(streak: Streak.State, goalMinutes: Int, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface) {
            Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Image(painterResource(R.drawable.celebrate), null, Modifier.size(140.dp))
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.goal_reached), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.goal_reached_text, goalMinutes, days(streak.current)),
                    textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(20.dp))
                Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.keep_reading)) }
            }
        }
    }
}

@Composable
private fun BookImage(file: File, alt: String) {
    val bitmap by produceState<ImageBitmap?>(null, file) {
        value = withContext(Dispatchers.IO) { decodeSampled(file, maxWidth = 1440)?.asImageBitmap() }
    }
    val b = bitmap
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        if (b == null) {
            Spacer(Modifier.fillMaxWidth().aspectRatio(1.5f))
        } else {
            val fill = b.width >= 300
            Image(
                bitmap = b,
                contentDescription = alt.ifBlank { null },
                contentScale = ContentScale.Fit,
                modifier = if (fill) Modifier.fillMaxWidth().aspectRatio(b.width / b.height.toFloat()) else Modifier,
            )
        }
    }
}

fun decodeSampled(file: File, maxWidth: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= maxWidth) sample *= 2
    return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
}

@Composable
private fun LanguageDialog(app: App, src0: String, tgt0: String, onDismiss: () -> Unit, onSave: (String, String, Boolean) -> Unit) {
    var src by remember { mutableStateOf(src0) }
    var tgt by remember { mutableStateOf(tgt0) }
    var asDefault by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val installed = stringResource(R.string.offline_pack_installed)
    LaunchedEffect(src, tgt) {
        status = if (runCatching { app.translator.isDownloaded(src, tgt) }.getOrDefault(false)) installed else null
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.book_languages)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.book), Modifier.width(110.dp))
                    LanguagePicker(src) { src = it }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.translate_to), Modifier.width(110.dp))
                    LanguagePicker(tgt) { tgt = it }
                }
                if (src == tgt) Text(stringResource(R.string.same_language), style = MaterialTheme.typography.bodySmall)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { asDefault = !asDefault }) {
                    Checkbox(checked = asDefault, onCheckedChange = { asDefault = it })
                    Text(stringResource(R.string.use_as_default))
                }
                val downloadError = stringResource(R.string.download_error)
                OutlinedButton(enabled = !downloading && src != tgt, onClick = {
                    downloading = true
                    scope.launch {
                        status = runCatching { app.translator.download(src, tgt) }
                            .fold({ installed }, { downloadError.format(it.message) })
                        downloading = false
                    }
                }) { Text(stringResource(if (downloading) R.string.downloading_pack else R.string.download_offline)) }
                status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(src, tgt, asDefault) }) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** Blur where the platform has it (Android 12+); older devices just fade the text out. */
private fun Modifier.veiled(): Modifier =
    if (android.os.Build.VERSION.SDK_INT >= 31) blur(10.dp) else alpha(0.06f)

@Composable
private fun PlayerBar(
    paused: Boolean,
    rate: Float,
    listenOnly: Boolean,
    onPrevious: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    onRate: () -> Unit,
    onListenOnly: () -> Unit,
    onStop: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        IconButton(onClick = onPrevious) { Icon(Icons.Filled.SkipPrevious, stringResource(R.string.previous_paragraph)) }
        FilledIconButton(onClick = onPlayPause) {
            Icon(if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, stringResource(if (paused) R.string.resume else R.string.pause))
        }
        IconButton(onClick = onNext) { Icon(Icons.Filled.SkipNext, stringResource(R.string.next_paragraph)) }
        TextButton(onClick = onRate) { Text(rateLabel(rate)) }
        IconToggleButton(checked = listenOnly, onCheckedChange = { onListenOnly() }) {
            Icon(
                if (listenOnly) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, stringResource(R.string.listen_only),
                tint = if (listenOnly) MaterialTheme.colorScheme.primary else LocalContentColor.current,
            )
        }
        IconButton(onClick = onStop) { Icon(Icons.Filled.Stop, stringResource(R.string.stop_reading_aloud)) }
    }
}

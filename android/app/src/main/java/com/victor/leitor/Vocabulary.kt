package com.victor.leitor

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.Hearing
import androidx.compose.material.icons.outlined.Quiz
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val SORTS = listOf(R.string.sort_recent, R.string.sort_alphabetical, R.string.sort_book)

/** Like a study set page: a few cards to flip, your progress, then the study modes and the word list as rows. */
@Composable
fun Vocabulary(app: App, modifier: Modifier, onStudy: (StudyMode) -> Unit) {
    val version by app.db.changes.collectAsState()
    val all = remember(version) { app.db.words() }
    val due = remember(version) { app.db.dueWords() }
    var dictation by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    // dictation over the example sentences of saved words, in the language each word was read in
    val examples = remember(all) { all.mapNotNull { w -> w.example?.takeIf { it.split(' ').size >= 3 }?.let { it to w.source } }.shuffled().take(10) }
    val ctx = LocalContext.current
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) scope.launch {
            val ok = runCatching {
                withContext(Dispatchers.IO) { ctx.contentResolver.openOutputStream(uri)!!.use { it.write(vocabularyCsv(all, res.getString(R.string.csv_columns)).toByteArray()) } }
            }.isSuccess
            app.notices.show(
                if (ok) Notice(res.getString(R.string.vocabulary_exported, all.size), NoticeKind.SUCCESS)
                else Notice(res.getString(R.string.vocabulary_export_failed), NoticeKind.ERROR),
            )
        }
    }

    Column(modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth()) {
            ScreenTitle(stringResource(R.string.tab_vocabulary))
            if (all.isNotEmpty()) {
                IconButton(onClick = { export.launch(res.getString(R.string.vocabulary_file_name)) }, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp)) {
                    Icon(Icons.Outlined.FileDownload, stringResource(R.string.vocabulary_export))
                }
            }
        }
        if (all.isEmpty()) {
            Empty(stringResource(R.string.vocabulary_empty_title), stringResource(R.string.vocabulary_empty_text), R.drawable.empty_vocabulary)
            return@Column
        }
        LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { WordsPreview(app, (due + all).distinctBy { it.id }.take(10)) }
            item { MasteryCard(all, due.size) }
            item { Section(stringResource(R.string.study_section)) }
            item {
                ModeRow(
                    Icons.Outlined.Style, MaterialTheme.colorScheme.primary, stringResource(R.string.mode_cards),
                    if (due.isNotEmpty()) stringResource(R.string.mode_cards_due, due.size) else stringResource(R.string.mode_cards_free),
                ) { onStudy(StudyMode.CARDS) }
            }
            item { ModeRow(Icons.Outlined.School, Success, stringResource(R.string.mode_learn), stringResource(R.string.mode_learn_hint)) { onStudy(StudyMode.LEARN) } }
            item { ModeRow(Icons.Outlined.Quiz, Flame, stringResource(R.string.mode_test), stringResource(R.string.mode_test_hint)) { onStudy(StudyMode.TEST) } }
            item {
                val best = app.prefs.matchBest
                ModeRow(
                    Icons.Outlined.Extension, MaterialTheme.colorScheme.primary, stringResource(R.string.mode_match),
                    if (best > 0) stringResource(R.string.mode_match_best, seconds(best)) else stringResource(R.string.mode_match_hint),
                    enabled = all.size >= 2,
                ) { onStudy(StudyMode.MATCH) }
            }
            item { ModeRow(Icons.Outlined.Headphones, Flame, stringResource(R.string.mode_listen), stringResource(R.string.mode_listen_hint)) { onStudy(StudyMode.LISTEN) } }
            if (examples.isNotEmpty()) {
                item { ModeRow(Icons.Outlined.Hearing, Success, stringResource(R.string.mode_dictation), stringResource(R.string.mode_dictation_hint)) { dictation = examples } }
            }
            item {
                ModeRow(
                    Icons.Outlined.Bookmarks, MaterialTheme.colorScheme.primary, stringResource(R.string.mode_words),
                    pluralStringResource(R.plurals.words_saved_hint, all.size, all.size),
                ) { onStudy(StudyMode.WORDS) }
            }
        }
    }
    dictation?.let { DictationSheet(app, it) { dictation = null } }
}

/** "Suas palavras": every saved word, searchable and sortable, each with its review date and menu. */
@Composable
internal fun WordsScreen(app: App, onClose: () -> Unit) {
    val version by app.db.changes.collectAsState()
    val all = remember(version) { app.db.words() }
    var sort by rememberSaveable { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val words = remember(all, sort, query) {
        val q = query.trim()
        val found = all.filter { q.isEmpty() || it.original.contains(q, ignoreCase = true) || it.translated.contains(q, ignoreCase = true) }
        when (sort) {
            1 -> found.sortedBy { it.original.lowercase() }
            2 -> found.sortedBy { it.bookTitle.orEmpty() }
            else -> found
        }
    }
    Column(Modifier.fillMaxSize()) {
        StudyTopBar(stringResource(R.string.mode_words), onClose)
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                query, { query = it }, Modifier.weight(1f),
                placeholder = { Text(stringResource(R.string.words_search)) }, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                singleLine = true, shape = CircleShape,
            )
            Spacer(Modifier.width(8.dp))
            SortPill(sort) { sort = it }
        }
        if (words.isEmpty()) {
            Text(
                stringResource(R.string.words_none_found), Modifier.fillMaxWidth().padding(32.dp),
                textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(words, key = { it.id }) { w -> WordCard(app, w, scope) }
        }
    }
}

internal fun pronounce(app: App, scope: CoroutineScope, w: Word) {
    scope.launch {
        if (!app.speech.speak(w.original, w.source)) {
            app.notices.show(Notice(app.getString(R.string.install_voice, langName(w.source)), NoticeKind.ERROR))
        }
    }
}

/** A few words to flip through at the top (due ones first), like the card strip of a study set. */
@Composable
private fun WordsPreview(app: App, words: List<Word>) {
    val pager = rememberPagerState { words.size }
    val scope = rememberCoroutineScope()
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        HorizontalPager(pager, contentPadding = PaddingValues(horizontal = 8.dp), pageSpacing = 12.dp) { page ->
            val w = words[page]
            var flipped by remember(w.id) { mutableStateOf(false) }
            Surface(
                onClick = { flipped = !flipped }, shape = CardShape,
                color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder,
                modifier = Modifier.fillMaxWidth().height(168.dp),
            ) {
                Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
                    Text(
                        if (flipped) w.translated else w.original, style = MaterialTheme.typography.headlineSmall,
                        fontWeight = if (flipped) FontWeight.Normal else FontWeight.SemiBold, textAlign = TextAlign.Center,
                        color = if (flipped) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                    if (!flipped) {
                        IconButton(onClick = { pronounce(app, scope, w) }, Modifier.align(Alignment.TopStart)) {
                            Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation))
                        }
                    }
                }
            }
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repeat(words.size) { i ->
                val active = i == pager.currentPage
                Box(
                    Modifier.size(if (active) 8.dp else 6.dp).clip(CircleShape)
                        .background(if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outlineVariant),
                )
            }
        }
    }
}

/** New (never got right), still learning (climbing the Leitner boxes) and mastered words, as one bar. */
@Composable
private fun MasteryCard(words: List<Word>, due: Int) {
    val mastered = words.count { it.learned }
    val new = words.count { it.box == 0 }
    val learning = words.size - new - mastered
    val parts = listOf(
        Triple(new, MaterialTheme.colorScheme.outline, R.string.mastery_new),
        Triple(learning, Flame, R.string.mastery_learning),
        Triple(mastered, Success, R.string.mastery_mastered),
    )
    Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(pluralStringResource(R.plurals.words_count, words.size, words.size), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (due > 0) {
                    Text(
                        stringResource(R.string.due_today, due),
                        Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Row(Modifier.padding(top = 14.dp).fillMaxWidth().height(10.dp).clip(CircleShape), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                parts.filter { it.first > 0 }.forEach { (n, color, _) -> Box(Modifier.weight(n.toFloat()).height(10.dp).background(color)) }
            }
            Row(Modifier.padding(top = 12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                parts.forEach { (n, color, label) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
                        Text("${stringResource(label)} $n", Modifier.padding(start = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun ModeRow(icon: ImageVector, tint: Color, title: String, subtitle: String, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(
        onClick = onClick, enabled = enabled, shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(tint.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(24.dp), tint = tint)
            }
            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun Example(sentence: String, word: String, modifier: Modifier) {
    val text = buildAnnotatedString {
        append("“$sentence”")
        val i = sentence.indexOf(word, ignoreCase = true)
        if (i >= 0) addStyle(SpanStyle(fontWeight = FontWeight.SemiBold, fontStyle = FontStyle.Normal, color = MaterialTheme.colorScheme.onSurface), i + 1, i + 1 + word.length)
    }
    Text(text, modifier, style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

@Composable
private fun SortPill(selected: Int, onSelect: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Surface(onClick = { open = true }, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder) {
            Row(Modifier.padding(start = 18.dp, end = 12.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.sort_by), style = MaterialTheme.typography.bodyMedium)
                Icon(Icons.Filled.KeyboardArrowDown, null, Modifier.padding(start = 6.dp).size(20.dp))
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            SORTS.forEachIndexed { i, s ->
                DropdownMenuItem(
                    text = { Text(stringResource(s), color = if (i == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface) },
                    onClick = { onSelect(i); open = false },
                )
            }
        }
    }
}

@Composable
private fun WordCard(app: App, w: Word, scope: CoroutineScope) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Surface(onClick = { menu = true }, shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(w.original, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    val (label, color) = if (w.learned) stringResource(R.string.learned) to Success else reviewLabel(w.dueDay) to MaterialTheme.colorScheme.primary
                    Text(
                        label,
                        Modifier.clip(CircleShape).background(color.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelMedium, color = color,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(w.translated, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                w.bookTitle?.let { BookLine(it, Modifier.padding(top = 12.dp)) }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.listen_pronunciation)) }, onClick = { pronounce(app, scope, w); menu = false })
            DropdownMenuItem(
                text = { Text(stringResource(if (w.learned) R.string.review_again else R.string.mark_learned)) },
                onClick = { app.db.setLearned(w.id, !w.learned); menu = false },
            )
            DropdownMenuItem(text = { Text(stringResource(R.string.delete)) }, onClick = { app.db.deleteWord(w.id); menu = false })
        }
    }
}

@Composable
private fun reviewLabel(dueDay: Long?): String = when (val days = (dueDay ?: localDay()) - localDay()) {
    in Long.MIN_VALUE..0L -> stringResource(R.string.review_today)
    1L -> stringResource(R.string.review_tomorrow)
    else -> stringResource(R.string.review_in_days, days.toInt())
}

@Composable
fun BookLine(title: String, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.AutoMirrored.Outlined.MenuBook, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(12.dp))
        Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

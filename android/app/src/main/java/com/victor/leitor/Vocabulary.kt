package com.victor.leitor

import androidx.compose.ui.res.stringResource
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material3.TextButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.AssistChip
import androidx.compose.material.icons.outlined.Hearing
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.Role
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

@Composable
fun Vocabulary(app: App, modifier: Modifier) {
    val version by app.db.changes.collectAsState()
    val all = remember(version) { app.db.words() }
    val due = remember(version) { app.db.dueWords() }
    val current = due.firstOrNull()
    var sort by rememberSaveable { mutableIntStateOf(0) }
    var practice by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    // dictation over the example sentences of saved words, in the language each word was read in
    val examples = remember(all) { all.mapNotNull { w -> w.example?.takeIf { it.split(' ').size >= 3 }?.let { it to w.source } }.shuffled().take(10) }
    val ctx = LocalContext.current
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    val words = when (sort) {
        1 -> all.sortedBy { it.original.lowercase() }
        2 -> all.sortedBy { it.bookTitle.orEmpty() }
        else -> all
    }
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
        } else LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { WordStats(all.size, all.count { it.learned }, due.size) }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = app.prefs.listenFirst, onClick = { app.prefs.listenFirst = !app.prefs.listenFirst },
                        label = { Text(stringResource(R.string.listen_first)) }, leadingIcon = { Icon(Icons.Outlined.Headphones, null) },
                    )
                    if (examples.isNotEmpty()) {
                        AssistChip(
                            onClick = { practice = examples }, label = { Text(stringResource(R.string.listening_practice)) },
                            leadingIcon = { Icon(Icons.Outlined.Hearing, null) },
                        )
                    }
                }
            }
            item { Flashcard(app, current, scope, app.prefs.listenFirst) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    RoundAction(Icons.Filled.Refresh, stringResource(R.string.repeat), MaterialTheme.colorScheme.primary, enabled = current != null) {
                        current?.let { app.db.answer(it, known = false) }
                    }
                    RoundAction(Icons.Filled.Check, stringResource(R.string.memorize), Success, enabled = current != null) {
                        current?.let { app.db.answer(it, known = true) }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.saved_words), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    SortPill(sort) { sort = it }
                }
            }
            items(words, key = { it.id }) { w -> WordCard(app, w, scope) }
        }
    }
    practice?.let { DictationSheet(app, it) { practice = null } }
}

private fun pronounce(app: App, scope: CoroutineScope, w: Word) {
    scope.launch {
        if (!app.speech.speak(w.original, w.source)) {
            app.notices.show(Notice(app.getString(R.string.install_voice, langName(w.source)), NoticeKind.ERROR))
        }
    }
}

@Composable
private fun WordStats(saved: Int, learned: Int, due: Int) {
    Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(vertical = 16.dp)) {
            listOf(saved to R.string.stat_saved, learned to R.string.stat_learned, due to R.string.stat_due).forEach { (n, label) ->
                Column(Modifier.weight(1f).padding(horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$n", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(stringResource(label), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun Flashcard(app: App, word: Word?, scope: CoroutineScope, listenFirst: Boolean) {
    // listening first: the card only plays the word until the reader asks to see it
    var shown by remember(word?.id, listenFirst) { mutableStateOf(!listenFirst) }
    LaunchedEffect(word?.id, listenFirst) { if (listenFirst && word != null) pronounce(app, scope, word) }
    Box(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Surface(
            shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, border = cardBorder,
            modifier = Modifier.matchParentSize().padding(horizontal = 12.dp).offset(y = 12.dp),
        ) {}
        Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 28.dp).heightIn(min = 160.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (word == null) {
                    Image(painterResource(R.drawable.celebrate), null, Modifier.size(96.dp).padding(bottom = 8.dp))
                    Text(stringResource(R.string.nothing_to_review), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.nothing_to_review_hint), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else if (!shown) {
                    FilledIconButton(onClick = { pronounce(app, scope, word) }, Modifier.size(72.dp)) {
                        Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation), Modifier.size(36.dp))
                    }
                    Text(
                        stringResource(R.string.listen_and_guess), Modifier.padding(top = 14.dp),
                        textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(onClick = { shown = true }, Modifier.padding(top = 6.dp)) { Text(stringResource(R.string.show_answer)) }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(word.original, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        IconButton(onClick = { pronounce(app, scope, word) }) { Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation)) }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(word.translated, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                    word.example?.let { Example(it, word.original, Modifier.padding(top = 18.dp)) }
                    word.bookTitle?.let { BookLine(it, Modifier.padding(top = 16.dp)) }
                }
            }
        }
    }
}

@Composable
private fun Example(sentence: String, word: String, modifier: Modifier) {
    val text = buildAnnotatedString {
        append("“$sentence”")
        val i = sentence.indexOf(word, ignoreCase = true)
        if (i >= 0) addStyle(SpanStyle(fontWeight = FontWeight.SemiBold, fontStyle = FontStyle.Normal, color = MaterialTheme.colorScheme.onSurface), i + 1, i + 1 + word.length)
    }
    Text(text, modifier, style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

@Composable
private fun RoundAction(icon: ImageVector, label: String, color: Color, enabled: Boolean, onClick: () -> Unit) {
    // the label is part of the button: people tap the word as often as the circle
    Column(
        Modifier.clip(RoundedCornerShape(16.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(if (enabled) color else color.copy(alpha = 0.4f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.background)
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.titleMedium)
    }
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

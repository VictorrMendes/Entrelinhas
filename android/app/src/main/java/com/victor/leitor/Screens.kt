package com.victor.leitor

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val BOOK_MIME_TYPES = arrayOf(
    "application/epub+zip", "application/pdf", "text/plain", "application/x-fictionbook+xml",
    "application/x-fictionbook", "application/zip", "application/octet-stream",
)

val CardShape = RoundedCornerShape(20.dp)

@Composable
fun Library(app: App, modifier: Modifier, explore: () -> Unit, review: () -> Unit, open: (Long) -> Unit) {
    val version by app.db.changes.collectAsState()
    val books = remember(version) { app.db.books() }
    val current = remember(books) { books.filter { it.status == Status.IN_PROGRESS }.maxByOrNull { it.lastOpenedAt ?: 0L } }
    val due = remember(version) { app.db.dueWords().size }
    var filter by rememberSaveable { mutableIntStateOf(0) }
    var deleting by remember { mutableStateOf<Book?>(null) }
    var shelving by remember { mutableStateOf<Book?>(null) }
    var goalSheet by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { if (it.isNotEmpty()) app.importBooks(it) }
    // shelves follow the three status filters; a shelf that lost its last book falls back to "all"
    val shelves = remember(books) { books.flatMap { it.shelves }.distinct().sorted() }
    val shelf = shelves.getOrNull(filter - 3)
    val shown = books.filter {
        when {
            shelf != null -> shelf in it.shelves
            filter == 1 -> it.status == Status.IN_PROGRESS
            filter == 2 -> it.status == Status.COMPLETED
            else -> true
        }
    }

    Column(modifier.fillMaxSize()) {
        ScreenTitle(stringResource(R.string.library))
        if (app.importing) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { StreakCard(app, version) { goalSheet = true } }
            if (current != null || due > 0) item { ContinueCard(app, current, due, version, open, review) }
            item {
                val labels = listOf(stringResource(R.string.filter_all), stringResource(R.string.filter_in_progress), stringResource(R.string.filter_completed)) + shelves
                Pills(labels, if (filter >= 3 && shelf == null) 0 else filter) { filter = it }
            }
            item {
                // IntrinsicSize gives both tiles the height of the taller one
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ActionTile(Icons.Filled.Add, stringResource(R.string.add_book), stringResource(R.string.add_book_hint), Modifier.weight(1f)) {
                        pick.launch(BOOK_MIME_TYPES)
                    }
                    ActionTile(Icons.Outlined.Explore, stringResource(R.string.free_books), stringResource(R.string.free_books_short_hint), Modifier.weight(1f)) {
                        explore()
                    }
                }
            }
            if (shown.isEmpty()) {
                item {
                    Empty(
                        stringResource(if (books.isEmpty()) R.string.library_empty_title else R.string.library_filter_empty),
                        stringResource(R.string.library_empty_text),
                        R.drawable.empty_library,
                    )
                }
            }
            items(shown, key = { it.id }) { b -> BookCard(app, b, version, onOpen = { open(b.id) }, onShelves = { shelving = b }, onDelete = { deleting = b }) }
        }
    }
    if (goalSheet) GoalSheet(app, version) { goalSheet = false }
    deleting?.let { b ->
        Confirm(stringResource(R.string.delete_book_title, b.title), stringResource(R.string.delete_book_text), { deleting = null }) { app.deleteBook(b.id) }
    }
    shelving?.let { b ->
        ShelvesDialog(b, shelves, onDismiss = { shelving = null }) {
            app.db.setShelves(b.id, it)
            shelving = null
        }
    }
}

@Composable
private fun ShelvesDialog(book: Book, all: List<String>, onDismiss: () -> Unit, onSave: (List<String>) -> Unit) {
    var chosen by remember { mutableStateOf(book.shelves.toSet()) }
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.shelves_of, book.title), maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                all.forEach { s ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { chosen = if (s in chosen) chosen - s else chosen + s },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(s in chosen, onCheckedChange = null, Modifier.padding(12.dp))
                        Text(s, style = MaterialTheme.typography.bodyLarge)
                    }
                }
                OutlinedTextField(
                    name, { name = it.replace('\n', ' ').take(40) }, Modifier.fillMaxWidth().padding(top = 8.dp),
                    label = { Text(stringResource(R.string.new_shelf)) }, singleLine = true, shape = RoundedCornerShape(14.dp),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave((chosen + name.trim()).filter { it.isNotBlank() }.sorted()) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** The two things most worth doing next, one line each: the book read last and today's review. */
@Composable
private fun ContinueCard(app: App, book: Book?, due: Int, version: Int, onOpen: (Long) -> Unit, onReview: () -> Unit) {
    Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth()) {
        Column {
            book?.let { b ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(b.id) }.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cover(app.coverFile(b.id), b.fileType, version, Modifier.size(36.dp, 50.dp))
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(stringResource(R.string.continue_reading), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(b.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text("${(b.progress * 100).roundToInt()}%", Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (due > 0) {
                if (book != null) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    Modifier.fillMaxWidth().clickable(onClick = onReview).padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Style, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                    }
                    Text(pluralStringResource(R.plurals.words_due_today, due, due), Modifier.weight(1f).padding(start = 12.dp), style = MaterialTheme.typography.bodyLarge)
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun ActionTile(icon: ImageVector, title: String, subtitle: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface,
        border = cardBorder,
        modifier = modifier.fillMaxHeight(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.height(12.dp))
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(subtitle, Modifier.padding(top = 2.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun BookCard(app: App, b: Book, version: Int, onOpen: () -> Unit, onShelves: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Surface(onClick = onOpen, shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp)) {
            Cover(app.coverFile(b.id), b.fileType, version, Modifier.size(84.dp, 118.dp))
            Column(Modifier.weight(1f).padding(start = 14.dp, top = 4.dp)) {
                Row {
                    Text(b.title, Modifier.weight(1f).padding(top = 6.dp), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Box {
                        Box(
                            Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.background).clickable { menu = true },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.MoreHoriz, stringResource(R.string.more_options), Modifier.size(20.dp)) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.shelves)) }, onClick = { menu = false; onShelves() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.delete)) }, onClick = { menu = false; onDelete() })
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Badge(
                        when (b.status) {
                            Status.COMPLETED -> stringResource(R.string.status_completed)
                            Status.IN_PROGRESS -> stringResource(R.string.status_in_progress)
                            Status.READY -> stringResource(R.string.status_new)
                        },
                    )
                    b.level?.let { Badge(stringResource(R.string.level_badge, it)) }
                }
                Spacer(Modifier.height(12.dp))
                Row {
                    Text(stringResource(R.string.progress_saved), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    Text("${(b.progress * 100).roundToInt()}%", style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(8.dp))
                ProgressLine(b.progress)
            }
        }
    }
}

@Composable
private fun Badge(text: String) {
    Text(
        text,
        Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)).padding(horizontal = 14.dp, vertical = 5.dp),
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
private fun ProgressLine(fraction: Float) {
    Box(Modifier.fillMaxWidth().height(4.dp)) {
        if (fraction > 0f) {
            Box(Modifier.fillMaxWidth(fraction.coerceIn(0.015f, 1f)).fillMaxHeight().clip(CircleShape).background(MaterialTheme.colorScheme.primary))
        }
    }
}

/** [version] re-checks the cover file, which is written after the book row appears. */
@Composable
fun Cover(file: File, fileType: String, version: Int, modifier: Modifier) {
    val exists = remember(file, version) { file.exists() }
    val bitmap by produceState<ImageBitmap?>(null, file, exists) {
        if (exists) value = withContext(Dispatchers.IO) { decodeSampled(file, maxWidth = 360)?.asImageBitmap() }
    }
    Box(modifier.clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
        val b = bitmap
        if (b != null) {
            Image(b, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.AutoMirrored.Outlined.MenuBook, null, tint = MaterialTheme.colorScheme.primary)
                Text(fileType.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

private data class Choice(val title: String, val subtitle: String)



private val THEMES = listOf(
    R.string.theme_system to R.string.theme_system_hint,
    R.string.theme_light to R.string.theme_light_hint,
    R.string.theme_dark to R.string.theme_dark_hint,
)

@Composable
private fun choices(options: List<Pair<Int, Int>>) = options.map { (title, subtitle) -> Choice(stringResource(title), stringResource(subtitle)) }

@Composable
fun Settings(app: App, modifier: Modifier) {
    val p = app.prefs
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    val models by produceState<Set<String>?>(null, refresh) {
        value = runCatching { app.translator.downloadedLanguages() }.getOrDefault(emptySet())
    }
    var dialog by remember { mutableStateOf<String?>(null) }
    val setReminder = rememberReminderSetter(app)

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        ScreenTitle(stringResource(R.string.tab_settings))
        AccountSection(app)
        Section(stringResource(R.string.section_app))
        SettingCard(stringResource(R.string.theme), value = stringResource(THEMES[p.theme.coerceIn(0, 2)].first)) { dialog = "theme" }
        Section(stringResource(R.string.section_reading))
        SettingCard(stringResource(R.string.daily_goal), value = stringResource(R.string.n_min, p.dailyGoalMinutes)) { dialog = "goal" }
        SettingCard(stringResource(R.string.daily_reminder), value = stringResource(ReminderTime.entries[p.reminder].label)) { dialog = "reminder" }
        SettingCard(stringResource(R.string.speech_rate), value = rateLabel(p.speechRate)) { dialog = "speed" }
        Section(stringResource(R.string.section_translation))
        SettingCard(stringResource(R.string.default_language), value = langName(p.defaultTarget)) { dialog = "language" }
        SettingCard(stringResource(R.string.use_offline), subtitle = stringResource(R.string.use_offline_hint), checked = p.useOffline) { p.useOffline = !p.useOffline }
        SettingCard(
            stringResource(R.string.delete_models),
            subtitle = models?.let { m ->
                if (m.size <= 1) stringResource(R.string.no_models) else stringResource(R.string.installed_models, m.sortedBy(::langName).joinToString { langName(it) })
            } ?: "…",
        ) { dialog = "models" }
        Section(stringResource(R.string.section_storage))
        SettingCard(stringResource(R.string.delete_all_books), subtitle = stringResource(R.string.delete_all_books_hint)) { dialog = "books" }
        Section(stringResource(R.string.section_about))
        SettingCard(stringResource(R.string.about), subtitle = stringResource(R.string.about_version, BuildConfig.VERSION_NAME, BuildConfig.BACKEND_URL), onClick = null)
        val version = "${BuildConfig.VERSION_NAME}-${BuildConfig.VERSION_CODE}"
        SettingCard(
            stringResource(R.string.updates_title),
            subtitle = when {
                !app.updater.enabled -> stringResource(R.string.updates_local, version)
                app.updating -> stringResource(R.string.updates_busy)
                else -> stringResource(R.string.updates_hint, version)
            },
            onClick = if (app.updater.enabled && !app.updating) ({ app.checkForUpdate() }) else null,
        )
        SignOutButton(app)
        Spacer(Modifier.height(24.dp))
    }

    when (dialog) {
        "theme" -> ChoiceDialog(stringResource(R.string.theme), choices(THEMES), p.theme, { dialog = null }) { p.theme = it }
        "goal" -> ChoiceDialog(
            stringResource(R.string.daily_goal),
            GOAL_OPTIONS.map { Choice(stringResource(R.string.goal_option, it), stringResource(R.string.goal_option_hint, it)) },
            GOAL_OPTIONS.indexOf(p.dailyGoalMinutes),
            { dialog = null },
        ) { p.dailyGoalMinutes = GOAL_OPTIONS[it] }
        "reminder" -> ChoiceDialog(
            stringResource(R.string.daily_reminder),
            ReminderTime.entries.map {
                Choice(stringResource(it.label), stringResource(if (it.hour == null) R.string.reminder_off_hint else R.string.reminder_on_hint))
            },
            p.reminder,
            { dialog = null },
        ) { setReminder(it) }
        "speed" -> ChoiceDialog(stringResource(R.string.speech_rate), SPEECH_RATES.map { Choice(rateLabel(it), "") }, SPEECH_RATES.indexOf(p.speechRate), { dialog = null }) {
            p.speechRate = SPEECH_RATES[it]
        }
        "language" -> LanguageDialog(p.defaultTarget, { dialog = null }) { p.defaultTarget = it }
        "models" -> Confirm(stringResource(R.string.delete_models_title), stringResource(R.string.delete_models_text), { dialog = null }) {
            scope.launch {
                runCatching { app.translator.deleteAllModels() }
                refresh++
            }
        }
        "books" -> Confirm(stringResource(R.string.delete_all_books_title), stringResource(R.string.delete_all_books_text), { dialog = null }) {
            app.deleteAllBooks()
        }
    }
}

@Composable
fun SettingCard(title: String, subtitle: String? = null, value: String? = null, checked: Boolean? = null, onClick: (() -> Unit)?) {
    val content: @Composable () -> Unit = {
        Row(Modifier.padding(horizontal = 20.dp, vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                subtitle?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            value?.let { Text(it, Modifier.padding(start = 12.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            checked?.let { Switch(checked = it, onCheckedChange = { onClick?.invoke() }, modifier = Modifier.padding(start = 12.dp)) }
        }
    }
    val m = Modifier.fillMaxWidth().padding(bottom = 10.dp)
    if (onClick == null) {
        Surface(shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = m, content = content)
    } else {
        Surface(onClick = onClick, shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = m, content = content)
    }
}

@Composable
private fun ChoiceDialog(title: String, options: List<Choice>, selected: Int, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                options.forEachIndexed { i, o ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { onPick(i); onDismiss() }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = i == selected, onClick = { onPick(i); onDismiss() })
                        Column {
                            Text(o.title, style = MaterialTheme.typography.titleMedium)
                            Text(o.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}

@Composable
private fun LanguageDialog(selected: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.translation_language)) },
        text = {
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(LANGUAGES) { tag ->
                    Text(
                        langName(tag),
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { onPick(tag); onDismiss() }.padding(horizontal = 12.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        color = if (tag == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}

@Composable
fun ScreenTitle(text: String) {
    Text(
        text,
        Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 20.dp),
        style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp),
        fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
    )
}

@Composable
fun Pills(labels: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    // scrolls instead of wrapping when the labels don't fit (narrow phones, large font scale)
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        labels.forEachIndexed { i, label ->
            val active = i == selected
            Surface(
                onClick = { onSelect(i) },
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface,
                border = if (active) BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.8f)) else cardBorder,
            ) {
                Text(
                    label,
                    Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
fun LanguagePicker(value: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(langName(value)) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.heightIn(max = 420.dp)) {
            LANGUAGES.forEach { tag ->
                DropdownMenuItem(text = { Text(langName(tag)) }, onClick = { onPick(tag); open = false })
            }
        }
    }
}

@Composable
fun Confirm(title: String, text: String, onDismiss: () -> Unit, action: String = stringResource(R.string.delete), onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = { onConfirm(); onDismiss() }) { Text(action) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun Empty(title: String, text: String, image: Int? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        image?.let { Image(painterResource(it), null, Modifier.size(140.dp).padding(bottom = 12.dp)) }
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun Section(title: String) =
    Text(title, Modifier.padding(start = 6.dp, top = 16.dp, bottom = 10.dp), style = MaterialTheme.typography.titleMedium)

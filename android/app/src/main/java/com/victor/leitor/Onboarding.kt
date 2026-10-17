package com.victor.leitor

import androidx.annotation.StringRes
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private data class Page(val symbol: String, @StringRes val title: Int, @StringRes val text: Int)

private val PAGES = listOf(
    Page("📚", R.string.onboarding_read_title, R.string.onboarding_read_text),
    Page("📥", R.string.onboarding_import_title, R.string.onboarding_import_text),
    Page("👆", R.string.onboarding_tap_title, R.string.onboarding_tap_text),
    Page("文A", R.string.onboarding_paragraph_title, R.string.onboarding_paragraph_text),
    Page("📶", R.string.onboarding_offline_title, R.string.onboarding_offline_text),
)

@Composable
fun Onboarding(app: App, onDone: () -> Unit) {
    val pageCount = PAGES.size + 2
    val pager = rememberPagerState { pageCount }
    val scope = rememberCoroutineScope()
    val last = pager.currentPage == pageCount - 1
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp)) {
            Box(Modifier.fillMaxWidth().height(48.dp), contentAlignment = Alignment.CenterEnd) {
                if (!last) TextButton(onClick = { scope.launch { pager.animateScrollToPage(pageCount - 1) } }) { Text(stringResource(R.string.skip)) }
            }
            HorizontalPager(pager, Modifier.weight(1f)) { i ->
                when {
                    i < PAGES.size -> PageContent(PAGES[i])
                    i == PAGES.size -> KitPage(app)
                    else -> SetupPage(app)
                }
            }
            Row(Modifier.align(Alignment.CenterHorizontally).padding(vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (0 until pageCount).forEach { i ->
                    val active = i == pager.currentPage
                    Box(
                        Modifier.height(8.dp).width(if (active) 24.dp else 8.dp).clip(CircleShape)
                            .background(if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                    )
                }
            }
            Button(
                onClick = { if (last) onDone() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(stringResource(if (last) R.string.start else R.string.next)) }
        }
    }
}

/** Optional: someone with no books yet starts with the level's first kit, a few words a day. */
@Composable
private fun KitPage(app: App) {
    var level by remember { mutableStateOf(KIT_LEVELS.first()) }
    var perDay by remember { mutableStateOf(app.prefs.newWordsPerDay) }
    val first = remember(level) { loadKits(app, level).first() }
    var added by remember { mutableStateOf(app.prefs.addedKits.split(',').contains(first.id)) }
    Column(
        Modifier.fillMaxSize().padding(horizontal = 4.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🗂️", fontSize = 64.sp)
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.onboarding_kit_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(
            stringResource(R.string.onboarding_kit_text),
            Modifier.padding(top = 6.dp, bottom = 14.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Pills(KIT_LEVELS, KIT_LEVELS.indexOf(level)) {
            level = KIT_LEVELS[it]
            added = false
        }
        Text(stringResource(R.string.kits_per_day), Modifier.padding(top = 18.dp, bottom = 10.dp), style = MaterialTheme.typography.titleMedium)
        Pills(NEW_WORDS_OPTIONS.map { "$it" }, NEW_WORDS_OPTIONS.indexOf(perDay)) {
            perDay = NEW_WORDS_OPTIONS[it]
            app.prefs.newWordsPerDay = perDay
        }
        Button(
            onClick = {
                app.db.queueKit(first.title, first.words)
                app.prefs.addedKits = (app.prefs.addedKits.split(',').filter { it.isNotEmpty() } + first.id).joinToString(",")
                app.releaseKitWords()
                added = true
            },
            enabled = !added,
            modifier = Modifier.padding(top = 22.dp),
        ) { Text(if (added) stringResource(R.string.kit_added) else stringResource(R.string.onboarding_kit_add, first.title)) }
    }
}

@Composable
private fun SetupPage(app: App) {
    val setReminder = rememberReminderSetter(app)
    var signIn by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(horizontal = 4.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.mascot), null, Modifier.size(132.dp))
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.your_daily_goal), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            stringResource(R.string.daily_goal_hint),
            Modifier.padding(top = 6.dp, bottom = 14.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Pills(GOAL_OPTIONS.map { stringResource(R.string.n_min, it) }, GOAL_OPTIONS.indexOf(app.prefs.dailyGoalMinutes)) { app.prefs.dailyGoalMinutes = GOAL_OPTIONS[it] }
        Text(stringResource(R.string.daily_reminder), Modifier.padding(top = 22.dp, bottom = 10.dp), style = MaterialTheme.typography.titleMedium)
        Pills(ReminderTime.entries.map { stringResource(it.label) }, app.prefs.reminder) { setReminder(it) }
        Row(Modifier.padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.translate_to), style = MaterialTheme.typography.bodyLarge)
            LanguagePicker(app.prefs.defaultTarget) { app.prefs.defaultTarget = it }
        }
        if (app.prefs.accountEmail == null) TextButton(onClick = { signIn = true }, Modifier.padding(top = 12.dp)) { Text(stringResource(R.string.sign_in_restore)) }
        else Text(stringResource(R.string.signed_in_as, app.prefs.accountName ?: app.prefs.accountEmail.orEmpty()), Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (signIn) SignInSheet(app) { signIn = false }
}

@Composable
private fun PageContent(page: Page) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 8.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(168.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text(page.symbol, fontSize = 64.sp, color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Spacer(Modifier.height(40.dp))
        Text(stringResource(page.title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(page.text),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

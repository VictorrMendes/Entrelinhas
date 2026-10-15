package com.victor.leitor

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app get() = application as App

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) importFrom(intent)
        setContent { AppTheme(app.prefs.theme) { Root(app) } }
    }

    override fun onResume() {
        super.onResume()
        app.foreground = true
    }

    override fun onPause() {
        app.foreground = false
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        importFrom(intent)
    }

    @Suppress("DEPRECATION")
    private fun importFrom(intent: Intent?) {
        val uri = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            else -> null
        }
        if (uri != null) app.importBooks(listOf(uri))
    }
}

private val TABS = listOf(
    R.string.tab_books to Icons.AutoMirrored.Outlined.MenuBook,
    R.string.tab_vocabulary to Icons.Outlined.Bookmarks,
    R.string.tab_progress to Icons.Filled.BarChart,
    R.string.tab_settings to Icons.Outlined.Settings,
)

@Composable
fun Root(app: App) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var reading by rememberSaveable { mutableStateOf<Long?>(null) }
    var exploring by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        app.notices.events.collect { notice ->
            snackbar.currentSnackbarData?.dismiss()
            launch {
                if (snackbar.showSnackbar(notice) != SnackbarResult.ActionPerformed) return@launch
                when (val action = notice.action) {
                    is NoticeAction.OpenBook -> { exploring = false; reading = action.id }
                    NoticeAction.OpenVocabulary -> { reading = null; exploring = false; tab = 1 }
                    NoticeAction.OpenProgress -> { reading = null; exploring = false; tab = 2 }
                    is NoticeAction.Run -> action.block()
                    null -> Unit
                }
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
        val bookId = reading
        when {
            !app.prefs.onboarded -> Onboarding(app) { app.prefs.onboarded = true }
            bookId != null -> {
                BackHandler { reading = null }
                Reader(app, bookId) { reading = null }
            }
            exploring -> FreeBooks(app, onBack = { exploring = false }) { exploring = false; reading = it }
            else -> Scaffold(bottomBar = { BottomBar(TABS, tab) { tab = it } }) { pad ->
                val modifier = Modifier.padding(pad).consumeWindowInsets(pad)
                when (tab) {
                    0 -> Library(app, modifier, explore = { exploring = true }) { reading = it }
                    1 -> Vocabulary(app, modifier)
                    2 -> Progress(app, modifier)
                    else -> Settings(app, modifier)
                }
            }
        }
        // above the bottom bars of the tabs and of the reader
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 80.dp)) { NoticeBar(it) }
    }
}

@Composable
private fun BottomBar(items: List<Pair<Int, ImageVector>>, selected: Int, onSelect: (Int) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(72.dp)) {
            items.forEachIndexed { i, (label, icon) ->
                val active = i == selected
                val color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                Column(
                    Modifier.weight(1f).fillMaxHeight().selectable(selected = active, role = Role.Tab) { onSelect(i) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(
                        Modifier.width(56.dp).height(30.dp).clip(CircleShape)
                            .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(icon, null, Modifier.size(22.dp), tint = color)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(label), style = MaterialTheme.typography.labelMedium, color = color, maxLines = 1)
                }
            }
        }
    }
}

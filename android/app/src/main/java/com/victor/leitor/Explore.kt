@file:OptIn(ExperimentalMaterial3Api::class)

package com.victor.leitor

import androidx.annotation.StringRes
import androidx.compose.ui.res.stringResource
import android.annotation.SuppressLint
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

private data class Site(val name: String, val url: String, @StringRes val text: Int, val formats: String)

private val SITES = listOf(
    Site("Project Gutenberg", "https://www.gutenberg.org/ebooks/", R.string.site_gutenberg, "EPUB · TXT"),
    Site("Standard Ebooks", "https://standardebooks.org/ebooks", R.string.site_standard_ebooks, "EPUB"),
    Site("Wikisource", "https://wikisource.org/wiki/Main_Page", R.string.site_wikisource, "EPUB · PDF"),
    Site("Internet Archive", "https://archive.org/details/texts", R.string.site_internet_archive, "EPUB · PDF · TXT"),
)

@Composable
fun FreeBooks(app: App, onBack: () -> Unit, onOpen: (Long) -> Unit) {
    var site by rememberSaveable { mutableStateOf<Int?>(null) }
    val current = site
    if (current != null) {
        Browser(app, SITES[current], onClose = { site = null }, onOpen = onOpen)
        return
    }
    BackHandler(onBack = onBack)
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.free_books)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
            )
        },
    ) { pad ->
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(painterResource(R.drawable.empty_explore), null, Modifier.size(140.dp))
                    Text(
                        stringResource(R.string.free_books_hint),
                        Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            itemsIndexed(SITES) { i, s ->
                Surface(
                    onClick = { site = i }, shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(s.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(s.text), Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(s.formats, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun Browser(app: App, site: Site, onClose: () -> Unit, onOpen: (Long) -> Unit) {
    var web by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    var progress by remember { mutableIntStateOf(0) }
    var title by remember { mutableStateOf(site.name) }
    var added by remember { mutableStateOf<Long?>(null) }
    BackHandler { if (canGoBack) web?.goBack() else onClose() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.close)) } },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().imePadding()) {
            if (progress < 100 || app.importing) LinearProgressIndicator(Modifier.fillMaxWidth())
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = object : WebViewClient() {
                            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                                canGoBack = view.canGoBack()
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView, newProgress: Int) {
                                progress = newProgress
                            }

                            override fun onReceivedTitle(view: WebView, t: String?) {
                                if (!t.isNullOrBlank()) title = t
                            }
                        }
                        setDownloadListener { url, userAgent, disposition, mime, _ ->
                            val name = URLUtil.guessFileName(url, disposition, mime)
                            app.notices.show(Notice(ctx.getString(R.string.downloading, name)))
                            app.importDownload(url, name, userAgent) { added = it }
                        }
                        loadUrl(site.url)
                        web = this
                    }
                },
                onRelease = { it.destroy() },
                modifier = Modifier.weight(1f).fillMaxWidth(),
            )
        }
    }
    added?.let { id ->
        AlertDialog(
            onDismissRequest = { added = null },
            title = { Text(stringResource(R.string.book_added)) },
            text = { Text(app.db.book(id)?.title ?: stringResource(R.string.already_in_library)) },
            confirmButton = { TextButton(onClick = { added = null; onOpen(id) }) { Text(stringResource(R.string.read_now)) } },
            dismissButton = { TextButton(onClick = { added = null }) { Text(stringResource(R.string.keep_browsing)) } },
        )
    }
}

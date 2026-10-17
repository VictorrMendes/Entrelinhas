package com.victor.leitor

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

data class KitWord(val word: String, val translation: String, val example: String)

data class KitPack(val id: String, val title: String, val words: List<KitWord>)

val NEW_WORDS_OPTIONS = listOf(10, 15, 20, 30)
val KIT_LEVELS = listOf("A1", "A2", "B1", "B2")

/** A level's word kits, shipped in assets/kits (built by backend/scripts/build-kit.ts); titles start with the level. */
fun loadKits(ctx: Context, level: String): List<KitPack> {
    val packs = JSONObject(ctx.assets.open("kits/en-${level.lowercase()}.json").bufferedReader().use { it.readText() }).getJSONArray("packs")
    val seen = HashSet<String>() // the A1 file lists a few words twice (two parts of speech)
    return List(packs.length()) { i ->
        val p = packs.getJSONObject(i)
        val words = p.getJSONArray("words")
        KitPack(p.getString("id"), "$level · ${p.getString("title")}", List(words.length()) { j ->
            words.getJSONObject(j).let { KitWord(it.getString("word"), it.getString("translation"), it.getString("example")) }
        }.filter { seen.add(it.word.lowercase()) })
    }
}

/** "Kits de palavras": ready-made packs (A1–B2) for someone with no books yet; an added kit comes in a few words a day. */
@Composable
fun KitsMode(app: App, onClose: () -> Unit) {
    var level by remember { mutableStateOf(KIT_LEVELS.first()) }
    val kits = remember(level) { loadKits(app, level) }
    var open by remember { mutableStateOf<KitPack?>(null) }
    var added by remember { mutableStateOf(app.prefs.addedKits.split(',').filter { it.isNotEmpty() }.toSet()) }
    var perDay by remember { mutableStateOf(app.prefs.newWordsPerDay) }
    val pack = open
    BackHandler(enabled = pack != null) { open = null }

    Column(Modifier.fillMaxSize()) {
        StudyTopBar(pack?.title ?: stringResource(R.string.kits_title), onClose = { if (pack != null) open = null else onClose() })
        if (pack == null) {
            LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Pills(KIT_LEVELS, KIT_LEVELS.indexOf(level)) { level = KIT_LEVELS[it] } }
                item {
                    Text(stringResource(R.string.kits_per_day), style = MaterialTheme.typography.titleSmall)
                    Pills(NEW_WORDS_OPTIONS.map { "$it" }, NEW_WORDS_OPTIONS.indexOf(perDay)) {
                        perDay = NEW_WORDS_OPTIONS[it]
                        app.prefs.newWordsPerDay = perDay
                    }
                }
                items(kits) { k ->
                    Surface(onClick = { open = k }, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(k.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                Text(stringResource(R.string.kit_words, k.words.size), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (k.id in added) Icon(Icons.Outlined.CheckCircle, stringResource(R.string.kit_added), tint = Success)
                        }
                    }
                }
            }
        } else {
            val scope = rememberCoroutineScope()
            LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Button(
                        onClick = {
                            app.db.queueKit(pack.title, pack.words)
                            added = added + pack.id
                            app.prefs.addedKits = added.joinToString(",")
                            app.releaseKitWords()
                        },
                        enabled = pack.id !in added,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (pack.id in added) stringResource(R.string.kit_added_per_day, perDay) else stringResource(R.string.kit_add)) }
                }
                items(pack.words) { w ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                            Text(w.word, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(w.translation, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                            Text(w.example, style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = { scope.launch { app.speech.speak(w.word, "en") } }) {
                            Icon(Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.listen_pronunciation))
                        }
                    }
                }
            }
        }
    }
}

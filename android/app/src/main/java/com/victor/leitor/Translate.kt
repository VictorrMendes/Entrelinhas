package com.victor.leitor

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** [serverDown]: the server, or the tunnel in front of it, failed (5xx); the offline pack can still answer. */
class TranslateException(val code: String, message: String, val serverDown: Boolean = false) : Exception(message)

data class Translated(val text: String, val offline: Boolean)

val LANGUAGES: List<String> by lazy { TranslateLanguage.getAllLanguages().sortedBy(::langName) }

fun langName(tag: String): String =
    Locale.forLanguageTag(tag).getDisplayName(Locale.getDefault()).replaceFirstChar { it.titlecase(Locale.getDefault()) }

/** The backend's limit for an explained text and its sentence. */
private const val MAX_EXPLAIN = 1000

/** Online through the backend; ML Kit when offline is forced in Settings, or when the network fails and the pair is downloaded. */
class TranslateService(private val ctx: Context, private val prefs: Prefs, private val db: Db, private val backend: Backend) {
    private val clients = HashMap<String, Translator>()
    private val models = RemoteModelManager.getInstance()

    /** Only online results are cached, so a later online translation can replace an offline one. */
    suspend fun translate(text: String, src: String, tgt: String, bookId: Long, context: String? = null): Translated {
        if (src == tgt) return Translated(text, false)
        val key = cacheKey(src, tgt, text, context)
        withContext(Dispatchers.IO) { db.cachedTranslation(key) }?.let { return Translated(it, false) }
        val (out, offline) = route(src, tgt) { online ->
            if (online) {
                val req = JSONObject().put("text", text).put("sourceLang", src).put("targetLang", tgt).put("bookId", "$bookId")
                if (context != null) req.put("context", context)
                post("/translate", req).getJSONObject("data").getString("translatedText")
            } else {
                client(src, tgt).translate(text).await()
            }
        }
        if (!offline) withContext(Dispatchers.IO) { db.cacheTranslation(key, out) }
        return Translated(out, offline)
    }

    /** One translation per sentence, in order: what the interlinear layout shows under each line. */
    suspend fun translateSentences(sentences: List<String>, src: String, tgt: String, bookId: Long): Translated {
        if (src == tgt) return Translated(sentences.joinToString("\n"), false)
        val keys = sentences.map { cacheKey(src, tgt, it, null) }
        val cached = withContext(Dispatchers.IO) { keys.map { db.cachedTranslation(it) } }
        val missing = sentences.indices.filter { cached[it] == null }
        if (missing.isEmpty()) return Translated(cached.joinToString("\n"), false)
        val (out, offline) = route(src, tgt) { online ->
            if (online) {
                missing.chunked(MAX_BATCH).flatMap { chunk ->
                    val items = JSONArray().apply { chunk.forEach { put(JSONObject().put("blockId", "$it").put("text", sentences[it])) } }
                    val req = JSONObject().put("sourceLanguage", src).put("targetLanguage", tgt).put("bookId", "$bookId").put("items", items)
                    val arr = post("/translate/batch", req).getJSONObject("data").getJSONArray("items")
                    (0 until arr.length()).map { i -> arr.getJSONObject(i).let { it.getString("blockId").toInt() to it.getString("translatedText") } }
                }.toMap()
            } else {
                missing.associateWith { client(src, tgt).translate(sentences[it]).await() }
            }
        }
        if (!offline) withContext(Dispatchers.IO) { out.forEach { (i, t) -> db.cacheTranslation(keys[i], t) } }
        // a sentence the model skipped falls back to the original, so lines never shift
        return Translated(sentences.indices.joinToString("\n") { (cached[it] ?: out[it] ?: sentences[it]).replace('\n', ' ') }, offline)
    }

    // Bump PROMPT_VERSION when the backend prompts change, so answers from the old prompt aren't served from cache.
    private fun cacheKey(src: String, tgt: String, text: String, context: String?) =
        sha256Hex("$PROMPT_VERSION|$src|$tgt|$text|${context.orEmpty()}".toByteArray())

    private companion object {
        const val PROMPT_VERSION = 2
        const val MAX_BATCH = 20
    }

    private suspend fun <T> route(src: String, tgt: String, block: suspend (online: Boolean) -> T): Pair<T, Boolean> {
        if (prefs.useOffline) {
            if (!isDownloaded(src, tgt)) {
                throw TranslateException(
                    "OFFLINE_PAIR_MISSING",
                    ctx.getString(R.string.offline_pair_missing, langName(src), langName(tgt)),
                )
            }
            return block(false) to true
        }
        return try {
            block(true) to false
        } catch (e: Exception) {
            if (e !is IOException && !(e is TranslateException && e.serverDown)) throw e
            if (isDownloaded(src, tgt)) block(false) to true
            else if (e is IOException) throw TranslateException("NETWORK", ctx.getString(R.string.translation_no_connection))
            else throw e
        }
    }

    /** What [text] means in [sentence], with grammar notes and an example, explained by AI in [tgt]. Needs a connection. */
    suspend fun explain(text: String, sentence: String, src: String, tgt: String): String = try {
        val body = JSONObject().put("text", text.take(MAX_EXPLAIN)).put("sentence", sentence.take(MAX_EXPLAIN)).put("sourceLang", src).put("targetLang", tgt)
        post("/explain", body).getJSONObject("data").getString("explanation")
    } catch (e: IOException) {
        throw TranslateException("NETWORK", ctx.getString(R.string.translation_no_connection))
    }

    /** The CEFR level (A1–C2) a learner needs for a book, judged by AI from a few excerpts of it. */
    suspend fun level(sample: String, lang: String): String =
        post("/level", JSONObject().put("sample", sample).put("language", lang)).getJSONObject("data").getString("level")

    private suspend fun post(path: String, body: JSONObject): JSONObject = try {
        backend.json("POST", path, body)
    } catch (e: ApiException) {
        throw TranslateException(e.code, errorMessage(e.code, e.message), serverDown = e.status >= 500)
    }

    private fun errorMessage(code: String, message: String?) = when (code) {
        "LIMIT_EXCEEDED" -> ctx.getString(R.string.translation_limit)
        "RATE_LIMIT" -> ctx.getString(R.string.translation_rate_limit)
        "NOT_FOUND" -> ctx.getString(R.string.server_outdated) // the app was updated before the server
        "HTTP_502", "HTTP_503", "HTTP_504" -> ctx.getString(R.string.server_unavailable) // the proxy's own error page, not ours
        else -> message?.takeIf { it.isNotBlank() } ?: ctx.getString(R.string.translation_online_failed)
    }

    private fun client(src: String, tgt: String): Translator = synchronized(clients) {
        clients.getOrPut("$src>$tgt") {
            Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(src).setTargetLanguage(tgt).build())
        }
    }

    suspend fun downloadedLanguages(): Set<String> =
        models.getDownloadedModels(TranslateRemoteModel::class.java).await().map { it.language }.toSet() + TranslateLanguage.ENGLISH

    suspend fun isDownloaded(src: String, tgt: String) = downloadedLanguages().let { src in it && tgt in it }

    suspend fun download(src: String, tgt: String) {
        client(src, tgt).downloadModelIfNeeded(DownloadConditions.Builder().build()).await()
    }

    suspend fun deleteAllModels() {
        models.getDownloadedModels(TranslateRemoteModel::class.java).await()
            .filter { it.language != TranslateLanguage.ENGLISH } // English is built in
            .forEach { models.deleteDownloadedModel(it).await() }
    }

    suspend fun detectLanguage(sample: String): String? {
        val identifier = LanguageIdentification.getClient()
        return try {
            identifier.identifyLanguage(sample).await().takeIf { it != "und" }?.let { TranslateLanguage.fromLanguageTag(it) }
        } catch (e: Exception) {
            null
        } finally {
            identifier.close()
        }
    }
}

suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { c ->
    addOnSuccessListener { c.resume(it) }
    addOnFailureListener { c.resumeWithException(it) }
    addOnCanceledListener { c.cancel() }
}

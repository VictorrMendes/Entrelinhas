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
import org.json.JSONObject
import java.io.IOException
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class TranslateException(val code: String, message: String) : Exception(message)

data class Translated(val text: String, val offline: Boolean)

val LANGUAGES: List<String> by lazy { TranslateLanguage.getAllLanguages().sortedBy(::langName) }

fun langName(tag: String): String =
    Locale.forLanguageTag(tag).getDisplayName(Locale.getDefault()).replaceFirstChar { it.titlecase(Locale.getDefault()) }

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

    // Bump PROMPT_VERSION when the backend prompts change, so answers from the old prompt aren't served from cache.
    private fun cacheKey(src: String, tgt: String, text: String, context: String?) =
        sha256Hex("$PROMPT_VERSION|$src|$tgt|$text|${context.orEmpty()}".toByteArray())

    private companion object {
        const val PROMPT_VERSION = 2
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
        } catch (e: IOException) {
            if (isDownloaded(src, tgt)) block(false) to true
            else throw TranslateException("NETWORK", ctx.getString(R.string.translation_no_connection))
        }
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject = try {
        backend.json("POST", path, body)
    } catch (e: ApiException) {
        throw TranslateException(e.code, errorMessage(e.code, e.message))
    }

    private fun errorMessage(code: String, message: String?) = when (code) {
        "LIMIT_EXCEEDED" -> ctx.getString(R.string.translation_limit)
        "RATE_LIMIT" -> ctx.getString(R.string.translation_rate_limit)
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

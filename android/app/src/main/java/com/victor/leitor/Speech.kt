package com.victor.leitor

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CompletableDeferred
import java.util.Locale

class Speech(private val ctx: Context) {
    private var tts: TextToSpeech? = null
    private val ready = CompletableDeferred<Boolean>()

    /** Called on a background thread when an utterance ends or fails. */
    @Volatile
    var onDone: ((String) -> Unit)? = null

    var rate = 1f

    private fun engine(): TextToSpeech = tts ?: TextToSpeech(ctx.applicationContext) { ready.complete(it == TextToSpeech.SUCCESS) }.also { t ->
        tts = t
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) {
                utteranceId?.let { onDone?.invoke(it) }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                utteranceId?.let { onDone?.invoke(it) }
            }
        })
    }

    /** False when the device has no voice for [lang]. */
    suspend fun speak(text: String, lang: String, id: String = "say", queue: Boolean = false): Boolean {
        val t = engine()
        if (!ready.await()) return false
        val result = t.setLanguage(Locale.forLanguageTag(lang))
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) return false
        t.setSpeechRate(rate)
        return t.speak(text, if (queue) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.SUCCESS
    }

    fun stop() {
        tts?.stop()
    }
}

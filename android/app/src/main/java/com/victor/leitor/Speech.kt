package com.victor.leitor

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import kotlinx.coroutines.CompletableDeferred
import java.util.Locale

val SPEECH_RATES = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f)

fun rateLabel(rate: Float) = "${rate}x".replace('.', ',')

/** A voice of the device's speech engine; network voices sound better but need internet. */
data class VoiceOption(val name: String, val quality: Int, val network: Boolean)

/** [voiceFor] is the voice the reader picked for a language, if any. */
class Speech(private val ctx: Context, private val voiceFor: (lang: String) -> String?) {
    private var tts: TextToSpeech? = null
    private val ready = CompletableDeferred<Boolean>()

    /** Called on a background thread when an utterance ends or fails. */
    @Volatile
    var onDone: ((String) -> Unit)? = null

    /** Called on a background thread with the character range about to be spoken (Android 8+). */
    @Volatile
    var onRange: ((id: String, start: Int, end: Int) -> Unit)? = null

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

            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                utteranceId?.let { onRange?.invoke(it, start, end) }
            }
        })
    }

    /** Voices for [lang], best first: higher quality, then the ones that also work offline. */
    suspend fun voices(lang: String): List<VoiceOption> {
        val t = engine()
        if (!ready.await()) return emptyList()
        return t.voices.orEmpty()
            .filter { it.locale.language == Locale.forLanguageTag(lang).language && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
            .sortedWith(compareByDescending<Voice> { it.quality }.thenBy { it.isNetworkConnectionRequired }.thenBy { it.name })
            .map { VoiceOption(it.name, it.quality, it.isNetworkConnectionRequired) }
    }

    /** False when the device has no voice for [lang]. */
    suspend fun speak(text: String, lang: String, id: String = "say", queue: Boolean = false, rate: Float = this.rate, voice: String? = voiceFor(lang)): Boolean {
        val t = engine()
        if (!ready.await()) return false
        val chosen = voice?.let { name -> t.voices?.firstOrNull { it.name == name } }
        if (chosen != null) {
            t.voice = chosen
        } else {
            val result = t.setLanguage(Locale.forLanguageTag(lang))
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) return false
        }
        t.setSpeechRate(rate)
        return t.speak(text, if (queue) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.SUCCESS
    }

    fun stop() {
        tts?.stop()
    }
}

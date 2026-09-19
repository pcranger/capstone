package com.crosswise.feedback

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * Text-to-speech with priorities: urgent messages interrupt less important ones, stale low-priority
 * messages are dropped instead of piling up behind the traffic situation they describe.
 */
class Speaker(context: Context) {
    private val ids = AtomicInteger()
    private val pending = HashMap<String, Priority>()
    private val lock = Any()

    @Volatile
    private var ready = false

    /** The most recent urgent message requested while the TTS engine was still starting (guarded by [lock]). */
    private var beforeReady: Pair<String, Priority>? = null

    @Volatile
    var speechRate: Float = 1.0f
        set(value) {
            field = value
            if (ready) tts.setSpeechRate(value)
        }

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) onReady() else Log.e(TAG, "TTS init failed: $status")
    }

    private fun onReady() {
        val result = tts.setLanguage(Locale.getDefault())
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.US)
        }
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        tts.setSpeechRate(speechRate)
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) = Unit
            override fun onDone(utteranceId: String) = finished(utteranceId)

            @Suppress("OVERRIDE_DEPRECATION") // still abstract in the platform class
            override fun onError(utteranceId: String) = finished(utteranceId)
            override fun onError(utteranceId: String, errorCode: Int) = finished(utteranceId)
            override fun onStop(utteranceId: String, interrupted: Boolean) = finished(utteranceId)
        })
        val waiting = synchronized(lock) {
            ready = true
            beforeReady.also { beforeReady = null }
        }
        waiting?.let { (text, priority) -> speak(text, priority, interrupt = true) }
    }

    private fun finished(id: String) {
        synchronized(lock) { pending.remove(id) }
    }

    /**
     * @param interrupt allow this message to cut off what is being said (only honored if nothing more
     * urgent is playing).
     */
    fun speak(text: String, priority: Priority, interrupt: Boolean) {
        val id = "u${ids.incrementAndGet()}"
        synchronized(lock) {
            if (!ready) {
                if (priority >= Priority.HIGH) beforeReady = text to priority
                return
            }
            val highestPending = pending.values.maxOrNull()
            val busy = highestPending != null
            val queueMode = when {
                !busy -> TextToSpeech.QUEUE_ADD
                interrupt && priority >= highestPending!! -> TextToSpeech.QUEUE_FLUSH
                priority >= Priority.HIGH -> TextToSpeech.QUEUE_ADD
                priority == Priority.NORMAL && highestPending!! <= Priority.NORMAL -> TextToSpeech.QUEUE_FLUSH
                else -> return // LOW while busy, or NORMAL behind urgent speech: drop, it would be stale
            }
            if (queueMode == TextToSpeech.QUEUE_FLUSH) pending.clear()
            pending[id] = priority
            tts.speak(text, queueMode, Bundle(), id)
        }
    }

    fun stop() {
        if (!ready) return
        synchronized(lock) { pending.clear() }
        tts.stop()
    }

    fun release() {
        ready = false
        tts.stop()
        tts.shutdown()
    }

    private companion object {
        const val TAG = "Speaker"
    }
}

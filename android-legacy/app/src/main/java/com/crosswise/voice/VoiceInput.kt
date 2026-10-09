package com.crosswise.voice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.*
import android.speech.*
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow

/** Foreground, on-device, serialized turns. No server fallback or stored microphone audio. */
class VoiceInput(private val context: Context, private val scope: CoroutineScope,
    private val busy: () -> Boolean, private val command: (String) -> Unit) {
    val status = MutableStateFlow("Voice off")
    var active = false; private set
    private var recognizer: SpeechRecognizer? = null
    private var generation = 0
    private var loop: Job? = null
    private var watchdog: Job? = null
    private var locale = "en-AU"
    fun start() {
        stop()
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status.value = "Allow microphone in Android settings."; return
        }
        if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            status.value = "Offline voice unavailable. Use the map or install offline English in Android settings."; return
        }
        active = true; next()
    }
    fun stop() { watchdog?.cancel(); active = false; generation++; loop?.cancel(); loop = null; recognizer?.cancel(); recognizer?.destroy(); recognizer = null; status.value = "Voice off" }
    fun interrupt() { if (!active) return; watchdog?.cancel(); recognizer?.cancel(); recognizer?.destroy(); recognizer = null; generation++; next() }
    private fun next() {
        loop?.cancel()
        loop = scope.launch {
            delay(400)
            while (active && busy()) { status.value = "Speaking / working…"; delay(150) }
            if (active) listen()
        }
    }
    private fun listen() {
        if (Build.VERSION.SDK_INT < 31) return
        val id = ++generation
        val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(context); recognizer = r
        fun current() = active && id == generation
        fun dispose() { watchdog?.cancel(); r.destroy(); if (recognizer === r) recognizer = null }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                if (!current()) return
                status.value = "Listening…"
                val tone = ToneGenerator(AudioManager.STREAM_MUSIC, 35); tone.startTone(ToneGenerator.TONE_PROP_BEEP, 70)
                Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 150)
            }
            override fun onResults(results: Bundle?) {
                if (!current()) return
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                dispose(); if (text.isNotBlank()) command(text); if (active) next()
            }
            override fun onError(error: Int) {
                if (!current()) return
                dispose()
                if (error in listOf(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) && locale != "en-US") { locale = "en-US"; next(); return }
                if (error in listOf(SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) { next(); return }
                active = false
                status.value = when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow microphone in Android settings."
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Install offline English in Android speech settings."
                    else -> "Voice unavailable ($error). Tap Voice to retry."
                }
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        watchdog = scope.launch {
            delay(25_000)
            if (current()) { generation++; r.cancel(); dispose(); active = false; status.value = "Voice timed out. Tap Voice to retry." }
        }
        runCatching { r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)) }.onFailure { dispose(); active = false; status.value = "Voice unavailable. Tap Voice to retry." }
    }
}

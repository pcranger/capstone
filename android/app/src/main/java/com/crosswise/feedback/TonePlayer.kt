package com.crosswise.feedback

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Synthesizes short stereo earcons on the fly (no audio assets). Panning is equal-power, so with
 * headphones (bone-conduction headphones keep the ears open to traffic) the cue appears to come from
 * the side the user should attend to.
 */
class TonePlayer {
    private data class Note(val frequencyHz: Double, val durationMs: Int, val gapMs: Int = 25)

    private val queue = LinkedBlockingQueue<ShortArray>()
    private val cache = HashMap<Pair<ToneKind, Int>, ShortArray>()

    @Volatile
    private var running = true

    @Volatile
    var volume: Float = 0.8f

    private val track: AudioTrack? = runCatching {
        AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            .setBufferSizeInBytes(
                maxOf(
                    AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT),
                    4096,
                ),
            )
            .build()
            .also { it.play() }
    }.onFailure { Log.e(TAG, "AudioTrack unavailable", it) }.getOrNull()

    private val writer = Thread({
        while (running) {
            val buffer = queue.poll(250, TimeUnit.MILLISECONDS) ?: continue
            track?.write(buffer, 0, buffer.size)
        }
    }, "crosswise-tones").apply {
        isDaemon = true
        start()
    }

    fun play(kind: ToneKind, pan: Float) {
        if (track == null) return
        // Sonar ticks are only useful if they are current: never let them queue up.
        if (kind == ToneKind.SONAR && queue.isNotEmpty()) return
        if (queue.size > 4) queue.clear()
        val panStep = (pan.coerceIn(-1f, 1f) * PAN_STEPS).roundToInt()
        val buffer = synchronized(cache) { cache.getOrPut(kind to panStep) { render(kind, panStep / PAN_STEPS.toFloat()) } }
        queue.offer(if (volume >= 0.999f) buffer else scaled(buffer))
    }

    fun release() {
        running = false
        queue.clear()
        writer.interrupt()
        track?.run {
            runCatching { stop() }
            release()
        }
    }

    private fun scaled(buffer: ShortArray): ShortArray = ShortArray(buffer.size) { (buffer[it] * volume).toInt().toShort() }

    private fun notesFor(kind: ToneKind): Pair<List<Note>, Double> = when (kind) {
        ToneKind.SONAR -> listOf(Note(1400.0, 35)) to 0.45
        ToneKind.CENTERED -> listOf(Note(1760.0, 60), Note(2349.0, 90)) to 0.55
        ToneKind.WALK_CHIME -> listOf(Note(880.0, 90), Note(1175.0, 90), Note(1568.0, 160)) to 0.7
        ToneKind.STOP -> listOf(Note(440.0, 260)) to 0.6
        ToneKind.ALERT -> List(3) { listOf(Note(2000.0, 70, 10), Note(1500.0, 70, 10)) }.flatten() to 0.85
        ToneKind.CRITICAL -> List(5) { listOf(Note(2500.0, 55, 5), Note(1800.0, 55, 5)) }.flatten() to 1.0
        ToneKind.VEER -> listOf(Note(660.0, 120)) to 0.6
        ToneKind.LOST -> listOf(Note(700.0, 100), Note(500.0, 140)) to 0.5
    }

    private fun render(kind: ToneKind, pan: Float): ShortArray {
        val (notes, gain) = notesFor(kind)
        val angle = (pan + 1.0) * PI / 4.0
        val left = cos(angle) * gain
        val right = sin(angle) * gain
        val totalFrames = notes.sumOf { (it.durationMs + it.gapMs) * SAMPLE_RATE / 1000 }
        val out = ShortArray(totalFrames * 2)
        var frame = 0
        for (note in notes) {
            val n = note.durationMs * SAMPLE_RATE / 1000
            val fade = min(n / 2, SAMPLE_RATE * 5 / 1000)
            for (i in 0 until n) {
                val envelope = when {
                    i < fade -> i / fade.toDouble()
                    i > n - fade -> (n - i) / fade.toDouble()
                    else -> 1.0
                }
                val s = sin(2.0 * PI * note.frequencyHz * i / SAMPLE_RATE) * envelope * Short.MAX_VALUE
                out[frame * 2] = (s * left).toInt().toShort()
                out[frame * 2 + 1] = (s * right).toInt().toShort()
                frame++
            }
            frame += note.gapMs * SAMPLE_RATE / 1000
        }
        return out
    }

    private companion object {
        const val TAG = "TonePlayer"
        const val SAMPLE_RATE = 44_100
        const val PAN_STEPS = 4
    }
}

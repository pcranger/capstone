package com.crosswise.logging

import android.content.Context
import android.util.Log
import com.crosswise.crossing.EngineSnapshot
import com.crosswise.feedback.Cue
import java.io.BufferedWriter
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Writes one CSV row per analyzed frame so field tests can be evaluated afterwards
 * (latency, phase accuracy against a video annotated by a sighted observer, false alerts).
 */
class SessionLogger(context: Context) {
    private val directory: File = File(context.getExternalFilesDir(null) ?: context.filesDir, "logs")
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "crosswise-logger") }
    private var writer: BufferedWriter? = null
    private var lastFlushMs = 0L

    val directoryPath: String get() = directory.absolutePath

    fun start() = executor.execute {
        if (writer != null) return@execute
        runCatching {
            directory.mkdirs()
            val name = "session_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".csv"
            writer = File(directory, name).bufferedWriter().apply {
                write(HEADER)
                newLine()
            }
        }.onFailure { Log.e(TAG, "Cannot open log", it) }
    }

    fun log(
        timestampMs: Long,
        fps: Float,
        inferenceMs: Long,
        detections: Int,
        snapshot: EngineSnapshot,
        cues: List<Cue>,
        cueText: (Cue.Speak) -> String,
    ) {
        val s = snapshot.signal
        val minTtc = snapshot.hazards.minOfOrNull { it.ttcSeconds }
        val spoken = cues.filterIsInstance<Cue.Speak>().joinToString(" | ") { cueText(it) }
        val row = listOf(
            timestampMs, "%.1f".format(Locale.US, fps), inferenceMs, detections, snapshot.mode,
            s.phase, s.trusted, "%.2f".format(Locale.US, s.walkEvidence), "%.2f".format(Locale.US, s.dontWalkEvidence),
            s.freshWalk, s.primaryBox?.centerX?.let { "%.3f".format(Locale.US, it) } ?: "",
            snapshot.aimBearingDeg?.let { "%.1f".format(Locale.US, it) } ?: "",
            snapshot.pitchDeg?.let { "%.1f".format(Locale.US, it) } ?: "",
            snapshot.veer?.deviationDeg?.let { "%.1f".format(Locale.US, it) } ?: "",
            snapshot.walking, snapshot.hazards.size, minTtc?.let { "%.2f".format(Locale.US, it) } ?: "",
            "\"" + spoken.replace("\"", "'") + "\"",
        ).joinToString(",")
        executor.execute {
            val w = writer ?: return@execute
            runCatching {
                w.write(row)
                w.newLine()
                if (timestampMs - lastFlushMs > 1_000) {
                    w.flush()
                    lastFlushMs = timestampMs
                }
            }
        }
    }

    fun stop() = executor.execute {
        runCatching { writer?.close() }
        writer = null
    }

    private companion object {
        const val TAG = "SessionLogger"
        const val HEADER = "t_ms,fps,infer_ms,detections,mode,phase,trusted,walk_ev,dont_walk_ev,fresh_walk," +
            "signal_cx,aim_bearing_deg,pitch_deg,veer_dev_deg,walking,hazards,min_ttc_s,spoken"
    }
}

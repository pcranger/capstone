package com.crosswise.tracking

import com.crosswise.core.BoxF
import com.crosswise.perception.Detection
import com.crosswise.perception.ObjectCategory
import com.crosswise.perception.SignalColor
import kotlin.math.max

data class TrackSample(
    val timestampMs: Long,
    val box: BoxF,
    val score: Float,
    val category: ObjectCategory,
    val colorHint: SignalColor?,
)

/**
 * Objects that may legitimately change class between frames stay in one group, so e.g. a signal
 * switching from red to green keeps its track (and its phase history).
 */
enum class TrackGroup {
    SIGNAL, VEHICLE, CROSSWALK, PERSON, OTHER;

    companion object {
        fun of(category: ObjectCategory): TrackGroup = when {
            category.isSignal -> SIGNAL
            category.isVehicle -> VEHICLE
            category == ObjectCategory.CROSSWALK -> CROSSWALK
            category == ObjectCategory.PERSON -> PERSON
            else -> OTHER
        }
    }
}

class Track internal constructor(val id: Int, first: TrackSample) {
    private val history = ArrayDeque<TrackSample>().apply { addLast(first) }

    val group: TrackGroup = TrackGroup.of(first.category)
    val firstSeenMs: Long = first.timestampMs
    var lastSeenMs: Long = first.timestampMs
        private set
    var hits: Int = 1
        private set

    /** Smoothed detection confidence; decays while the object is not detected. */
    var confidence: Float = first.score
        private set

    /** Last box, shifted by camera motion accumulated since it was last detected. */
    var box: BoxF = first.box
        private set

    val latest: TrackSample get() = history.last()
    val category: ObjectCategory get() = latest.category
    val samples: List<TrackSample> get() = history

    fun isSeenAt(timestampMs: Long) = lastSeenMs == timestampMs

    internal fun addSample(sample: TrackSample) {
        history.addLast(sample)
        lastSeenMs = sample.timestampMs
        hits++
        confidence = 0.6f * confidence + 0.4f * sample.score
        box = sample.box
    }

    internal fun markMissed(shiftX: Float, shiftY: Float) {
        confidence *= 0.7f
        box = box.offset(shiftX, shiftY)
    }

    internal fun shift(shiftX: Float, shiftY: Float) {
        box = box.offset(shiftX, shiftY)
    }

    internal fun trimBefore(timestampMs: Long) {
        while (history.size > 1 && history.first().timestampMs < timestampMs) history.removeFirst()
    }
}

/**
 * Greedy IoU + center-distance tracker. Camera rotation (from the gyroscope) can be passed in as an
 * image-space shift so small objects like signal heads keep their identity while the user scans.
 */
class ObjectTracker(
    private val maxMissMs: Long = 900,
    private val historyMs: Long = 3_000,
    private val minIou: Float = 0.15f,
) {
    private val tracks = ArrayList<Track>()
    private var nextId = 1

    val activeTracks: List<Track> get() = tracks

    /**
     * @param shiftX expected horizontal image motion of static scene points since the previous call,
     * in normalized units (+ = moves right). Similarly [shiftY] (+ = moves down).
     */
    fun update(detections: List<Detection>, timestampMs: Long, shiftX: Float = 0f, shiftY: Float = 0f): List<Track> {
        val predicted = tracks.map { it.box.offset(shiftX, shiftY) }
        val pairs = ArrayList<MatchCandidate>()
        for (ti in tracks.indices) {
            val tb = predicted[ti]
            for (di in detections.indices) {
                val det = detections[di]
                if (TrackGroup.of(det.category) != tracks[ti].group) continue
                val iou = tb.iou(det.box)
                val gate = max(tb.diagonal, det.box.diagonal) * 1.5f + 0.02f
                val dist = tb.centerDistance(det.box)
                if (iou >= minIou || dist <= gate) {
                    pairs += MatchCandidate(ti, di, iou + 0.5f * (1f - (dist / gate).coerceIn(0f, 1f)))
                }
            }
        }
        pairs.sortByDescending { it.score }

        val trackUsed = BooleanArray(tracks.size)
        val detectionUsed = BooleanArray(detections.size)
        for (p in pairs) {
            if (trackUsed[p.track] || detectionUsed[p.detection]) continue
            trackUsed[p.track] = true
            detectionUsed[p.detection] = true
            tracks[p.track].addSample(detections[p.detection].toSample(timestampMs))
        }
        for (ti in tracks.indices) {
            if (!trackUsed[ti]) tracks[ti].markMissed(shiftX, shiftY)
        }
        for (di in detections.indices) {
            if (!detectionUsed[di]) tracks += Track(nextId++, detections[di].toSample(timestampMs))
        }
        tracks.removeAll { timestampMs - it.lastSeenMs > maxMissMs }
        tracks.forEach { it.trimBefore(timestampMs - historyMs) }
        return tracks
    }

    /** Applies camera motion without new detections (e.g. between analyzed frames). */
    fun shiftAll(shiftX: Float, shiftY: Float) = tracks.forEach { it.shift(shiftX, shiftY) }

    fun clear() {
        tracks.clear()
    }

    private fun Detection.toSample(t: Long) = TrackSample(t, box, score, category, colorHint)

    private class MatchCandidate(val track: Int, val detection: Int, val score: Float)
}

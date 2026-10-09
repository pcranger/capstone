package com.crosswise.signal

import com.crosswise.core.BoxF
import com.crosswise.perception.ObjectCategory
import com.crosswise.perception.SignalColor
import com.crosswise.tracking.Track
import com.crosswise.tracking.TrackGroup
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sqrt

enum class SignalPhase {
    UNKNOWN, DONT_WALK, WALK, WALK_FLASHING, DONT_WALK_FLASHING;

    val isWalk: Boolean get() = this == WALK || this == WALK_FLASHING
    val isDontWalk: Boolean get() = this == DONT_WALK || this == DONT_WALK_FLASHING
}

data class SignalSnapshot(
    val phase: SignalPhase = SignalPhase.UNKNOWN,
    /** False when the phase comes from the color heuristic on a generic light (could be a vehicle signal). */
    val trusted: Boolean = true,
    val walkEvidence: Float = 0f,
    val dontWalkEvidence: Float = 0f,
    val primaryTrackId: Int? = null,
    val primaryBox: BoxF? = null,
    /** When the current phase began, only if that moment was actually observed. */
    val phaseOnsetMs: Long? = null,
    /** True when this WALK phase was seen starting (DONT_WALK -> WALK), i.e. the full walk interval is ahead. */
    val freshWalk: Boolean = false,
    val lastSeenMs: Long? = null,
)

sealed interface SignalEvent {
    data class Acquired(val phase: SignalPhase, val trusted: Boolean) : SignalEvent
    data class Changed(
        val from: SignalPhase,
        val to: SignalPhase,
        val freshWalk: Boolean,
        val trusted: Boolean,
    ) : SignalEvent
    data class Lost(val lastPhase: SignalPhase, val lastBox: BoxF?) : SignalEvent
}

/**
 * Turns noisy per-frame detections of one pedestrian signal into a stable phase with events.
 *
 * Design choices (see docs/DESIGN.md):
 *  - Leaky evidence accumulators make the output frame-rate independent.
 *  - Asymmetric dwell: announcing WALK needs more evidence and time than announcing DON'T WALK,
 *    because a false "walk" is far more dangerous than a late one.
 *  - Flashing (clearance interval) is detected from the on/off rhythm of detections, which a
 *    single-frame classifier cannot see.
 *  - A WALK phase is "fresh" only if the transition from DON'T WALK was observed; otherwise the user
 *    is told the walk sign may already be ending (O&M practice: start at the onset of the walk interval).
 */
class SignalPhaseTracker(private val config: Config = Config()) {

    data class Config(
        val evidenceTauMs: Double = 450.0,
        val walkOnEvidence: Float = 0.45f,
        val walkDwellMs: Long = 700,
        val dontWalkOnEvidence: Float = 0.35f,
        val dontWalkDwellMs: Long = 300,
        val dominance: Float = 2f,
        val lostAfterMs: Long = 1_800,
        val freshMaxGapMs: Long = 3_000,
        val freshMinDontWalkMs: Long = 1_000,
        val flashWindowMs: Long = 4_000,
        val flashMinRunMs: Long = 180,
        val flashMaxRunMs: Long = 1_300,
        val flashMaxCv: Float = 0.45f,
        val switchRatio: Float = 1.6f,
        val continuityDistance: Float = 0.12f,
        val candidateMaxAgeMs: Long = 300,
    )

    private class Presence(val t: Long, val walk: Boolean, val dontWalk: Boolean)

    private var lastUpdateMs: Long? = null
    private var primaryId: Int? = null
    private var primaryBox: BoxF? = null
    private var primaryLastSeenMs: Long? = null
    private var walkEvidence = 0f
    private var dontWalkEvidence = 0f
    private var trusted = true
    private val presence = ArrayDeque<Presence>()

    private var phase = SignalPhase.UNKNOWN
    private var phaseOnsetMs: Long? = null
    private var freshWalk = false
    private var pending: SignalPhase? = null
    private var pendingSinceMs = 0L

    private var dontWalkPhaseStartMs: Long? = null
    private var lastDontWalkSeenMs: Long? = null
    private var lastDontWalkDurationMs = 0L

    val snapshot: SignalSnapshot
        get() = SignalSnapshot(
            phase = phase,
            trusted = trusted,
            walkEvidence = walkEvidence,
            dontWalkEvidence = dontWalkEvidence,
            primaryTrackId = primaryId,
            primaryBox = primaryBox,
            phaseOnsetMs = phaseOnsetMs,
            freshWalk = freshWalk,
            lastSeenMs = primaryLastSeenMs,
        )

    val currentPhase: SignalPhase get() = phase

    fun reset() {
        lastUpdateMs = null
        primaryId = null
        primaryBox = null
        primaryLastSeenMs = null
        clearPhaseHistory()
        lastDontWalkSeenMs = null
        lastDontWalkDurationMs = 0L
        dontWalkPhaseStartMs = null
        phase = SignalPhase.UNKNOWN
        phaseOnsetMs = null
        freshWalk = false
        trusted = true
    }

    fun update(timestampMs: Long, tracks: List<Track>, shiftX: Float = 0f, shiftY: Float = 0f): List<SignalEvent> {
        val events = ArrayList<SignalEvent>(2)
        val dt = lastUpdateMs?.let { (timestampMs - it).coerceIn(1L, 1_000L) } ?: NOMINAL_FRAME_MS
        lastUpdateMs = timestampMs
        primaryBox = primaryBox?.offset(shiftX, shiftY)

        selectPrimary(timestampMs, tracks, events)

        var observedWalk = 0f
        var observedDontWalk = 0f
        val primary = tracks.firstOrNull { it.id == primaryId }
        if (primary != null && primary.isSeenAt(timestampMs)) {
            val sample = primary.latest
            primaryBox = primary.box
            primaryLastSeenMs = timestampMs
            when {
                sample.category == ObjectCategory.PED_WALK -> {
                    observedWalk = sample.score
                    trusted = true
                }
                sample.category == ObjectCategory.PED_DONT_WALK -> {
                    observedDontWalk = sample.score
                    trusted = true
                }
                sample.category == ObjectCategory.TRAFFIC_LIGHT && sample.colorHint == SignalColor.GREEN -> {
                    observedWalk = sample.score * UNTRUSTED_WEIGHT
                    trusted = false
                }
                sample.category == ObjectCategory.TRAFFIC_LIGHT && sample.colorHint == SignalColor.RED -> {
                    observedDontWalk = sample.score * UNTRUSTED_WEIGHT
                    trusted = false
                }
            }
        }
        if (observedDontWalk > 0f) lastDontWalkSeenMs = timestampMs

        val decay = exp(-dt / config.evidenceTauMs).toFloat()
        walkEvidence = decay * walkEvidence + (1f - decay) * observedWalk
        dontWalkEvidence = decay * dontWalkEvidence + (1f - decay) * observedDontWalk

        if (primaryId != null) {
            presence.addLast(Presence(timestampMs, observedWalk > 0f, observedDontWalk > 0f))
            while (presence.isNotEmpty() && timestampMs - presence.first().t > config.flashWindowMs) presence.removeFirst()
        }

        val lastSeen = primaryLastSeenMs
        if (phase != SignalPhase.UNKNOWN && (lastSeen == null || timestampMs - lastSeen > config.lostAfterMs)) {
            events += SignalEvent.Lost(phase, primaryBox)
            endPhase(timestampMs)
            clearPhaseHistory()
            return events
        }

        val candidate: SignalPhase? = when {
            isFlashing { it.walk } && walkEvidence > 0.12f -> SignalPhase.WALK_FLASHING
            isFlashing { it.dontWalk } && dontWalkEvidence > 0.12f -> SignalPhase.DONT_WALK_FLASHING
            walkEvidence >= config.walkOnEvidence && walkEvidence >= config.dominance * dontWalkEvidence -> SignalPhase.WALK
            dontWalkEvidence >= config.dontWalkOnEvidence && dontWalkEvidence >= config.dominance * walkEvidence ->
                SignalPhase.DONT_WALK
            else -> null
        }
        if (candidate == null || candidate == phase) {
            pending = null
            return events
        }
        if (pending != candidate) {
            pending = candidate
            pendingSinceMs = timestampMs
        }
        val dwell = when (candidate) {
            SignalPhase.WALK -> config.walkDwellMs
            SignalPhase.DONT_WALK -> config.dontWalkDwellMs
            else -> 0L
        }
        if (timestampMs - pendingSinceMs < dwell) return events

        confirm(candidate, pendingSinceMs, events)
        return events
    }

    private fun confirm(next: SignalPhase, onsetMs: Long, events: MutableList<SignalEvent>) {
        val previous = phase
        if (previous.isDontWalk && !next.isDontWalk) {
            lastDontWalkDurationMs = onsetMs - (dontWalkPhaseStartMs ?: onsetMs)
        }
        when (next) {
            SignalPhase.WALK -> {
                freshWalk = when {
                    previous.isDontWalk -> lastDontWalkDurationMs >= config.freshMinDontWalkMs
                    previous == SignalPhase.UNKNOWN -> {
                        val gap = lastDontWalkSeenMs?.let { onsetMs - it }
                        gap != null && gap <= config.freshMaxGapMs && lastDontWalkDurationMs >= config.freshMinDontWalkMs
                    }
                    else -> false
                }
                phaseOnsetMs = if (freshWalk) onsetMs else null
            }
            SignalPhase.WALK_FLASHING -> {
                freshWalk = false
                phaseOnsetMs = null
            }
            SignalPhase.DONT_WALK, SignalPhase.DONT_WALK_FLASHING -> {
                if (!previous.isDontWalk) dontWalkPhaseStartMs = onsetMs
                freshWalk = false
                phaseOnsetMs = if (previous != SignalPhase.UNKNOWN) onsetMs else null
            }
            SignalPhase.UNKNOWN -> Unit
        }
        phase = next
        pending = null
        events += if (previous == SignalPhase.UNKNOWN && !(next == SignalPhase.WALK && freshWalk)) {
            SignalEvent.Acquired(next, trusted)
        } else {
            val from = if (previous == SignalPhase.UNKNOWN) SignalPhase.DONT_WALK else previous
            SignalEvent.Changed(from, next, freshWalk, trusted)
        }
    }

    private fun endPhase(timestampMs: Long) {
        if (phase.isDontWalk) lastDontWalkDurationMs = timestampMs - (dontWalkPhaseStartMs ?: timestampMs)
        phase = SignalPhase.UNKNOWN
        phaseOnsetMs = null
        freshWalk = false
    }

    private fun clearPhaseHistory() {
        walkEvidence = 0f
        dontWalkEvidence = 0f
        presence.clear()
        pending = null
    }

    private fun bearsPhase(track: Track): Boolean = track.samples.any {
        it.category == ObjectCategory.PED_WALK || it.category == ObjectCategory.PED_DONT_WALK ||
            (it.category == ObjectCategory.TRAFFIC_LIGHT && it.colorHint != null)
    }

    private fun primaryScore(track: Track): Float {
        val b = track.box
        val centerWeight = 1f - 0.8f * abs(b.centerX - 0.5f)
        val sizeWeight = (b.height / 0.04f).coerceIn(0.3f, 1f)
        val maturity = min(1f, track.hits / 5f)
        return track.confidence * centerWeight * sizeWeight * maturity
    }

    private fun selectPrimary(timestampMs: Long, tracks: List<Track>, events: MutableList<SignalEvent>) {
        val candidates = tracks.filter {
            it.group == TrackGroup.SIGNAL && timestampMs - it.lastSeenMs <= config.candidateMaxAgeMs &&
                it.hits >= 2 && bearsPhase(it)
        }
        val best = candidates.maxByOrNull(::primaryScore) ?: return
        val current = tracks.firstOrNull { it.id == primaryId }
        if (current != null && current.id == best.id) return
        if (current != null && primaryScore(best) <= config.switchRatio * primaryScore(current)) return

        val referenceBox = current?.box ?: primaryBox
        // Same window as fresh-walk detection, so a brief occlusion during DON'T WALK keeps the history.
        val recentlySeen = primaryLastSeenMs?.let { timestampMs - it <= config.freshMaxGapMs } == true
        val continuation = referenceBox != null && recentlySeen &&
            best.box.centerDistance(referenceBox) <= config.continuityDistance
        if (primaryId != null && !continuation) {
            // The user is now looking at a different physical signal: its history does not carry over.
            if (phase != SignalPhase.UNKNOWN) events += SignalEvent.Lost(phase, primaryBox)
            endPhase(timestampMs)
            clearPhaseHistory()
            lastDontWalkSeenMs = null
            lastDontWalkDurationMs = 0L
        }
        primaryId = best.id
    }

    private inline fun isFlashing(selector: (Presence) -> Boolean): Boolean {
        if (presence.size < 8) return false
        val span = presence.last().t - presence.first().t
        if (span < config.flashWindowMs * 0.6) return false

        val on = ArrayList<Long>()
        val off = ArrayList<Long>()
        var runValue = selector(presence.first())
        var runStart = presence.first().t
        var isFirstRun = true
        for (i in 1 until presence.size) {
            val p = presence[i]
            val v = selector(p)
            if (v != runValue) {
                if (!isFirstRun) (if (runValue) on else off) += p.t - runStart
                isFirstRun = false
                runValue = v
                runStart = p.t
            }
        }
        // The last run is still open (partial), so it is not counted.
        if (on.size < 2 || off.size < 2) return false
        if ((on + off).any { it < config.flashMinRunMs || it > config.flashMaxRunMs }) return false
        return coefficientOfVariation(on) <= config.flashMaxCv && coefficientOfVariation(off) <= config.flashMaxCv
    }

    private fun coefficientOfVariation(values: List<Long>): Float {
        val mean = values.average()
        if (mean <= 0.0) return Float.MAX_VALUE
        val variance = values.sumOf { (it - mean) * (it - mean) } / values.size
        return (sqrt(variance) / mean).toFloat()
    }

    private companion object {
        const val NOMINAL_FRAME_MS = 100L
        const val UNTRUSTED_WEIGHT = 0.8f
    }
}

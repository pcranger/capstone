package com.crosswise.crossing

import com.crosswise.feedback.Cue
import com.crosswise.feedback.HapticPattern
import com.crosswise.feedback.ToneKind
import kotlin.math.abs

/**
 * "Signal sonar": while the user scans the intersection, ticks speed up as the signal (or crosswalk)
 * gets closer to the center of the camera view and come from its side in stereo headphones.
 * A distinct chime + tick marks the moment it is centered.
 */
class AimGuide(
    private val centeredToleranceDeg: Float = 4f,
    private val centeredHoldMs: Long = 600,
    private val farBearingDeg: Float = 25f,
    private val slowestIntervalMs: Long = 900,
    private val fastestIntervalMs: Long = 180,
) {
    private var lastTickMs = Long.MIN_VALUE / 2
    private var centeredSinceMs: Long? = null
    private var announcedTarget: Int? = null

    /**
     * Returns the tones/haptics to play for this frame. [onCentered] is invoked once per target, after it
     * has stayed centered for [centeredHoldMs]. [sparse] limits ticks to when the user drifts off target.
     */
    fun update(
        timestampMs: Long,
        targetId: Int?,
        bearingDeg: Float?,
        sparse: Boolean,
        onCentered: () -> Unit,
    ): List<Cue> {
        if (targetId == null || bearingDeg == null) {
            centeredSinceMs = null
            return emptyList()
        }
        val cues = ArrayList<Cue>(3)
        val magnitude = abs(bearingDeg)
        if (magnitude <= centeredToleranceDeg) {
            val since = centeredSinceMs ?: timestampMs.also { centeredSinceMs = it }
            if (timestampMs - since >= centeredHoldMs && announcedTarget != targetId) {
                announcedTarget = targetId
                cues += Cue.Tone(ToneKind.CENTERED)
                cues += Cue.Haptic(HapticPattern.CENTERED_TICK)
                onCentered()
            }
        } else {
            centeredSinceMs = null
        }

        // While waiting at the curb (sparse), only tick if the user has drifted off target.
        if (sparse && magnitude <= 10f) return cues
        val t = ((magnitude - centeredToleranceDeg) / (farBearingDeg - centeredToleranceDeg)).coerceIn(0f, 1f)
        val baseInterval = fastestIntervalMs + (slowestIntervalMs - fastestIntervalMs) * t
        val interval = if (sparse) maxOf(2_000L, baseInterval.toLong()) else baseInterval.toLong()
        if (timestampMs - lastTickMs >= interval) {
            lastTickMs = timestampMs
            cues += Cue.Tone(ToneKind.SONAR, pan = (bearingDeg / 30f).coerceIn(-1f, 1f))
        }
        return cues
    }

    fun reset() {
        centeredSinceMs = null
        announcedTarget = null
    }
}

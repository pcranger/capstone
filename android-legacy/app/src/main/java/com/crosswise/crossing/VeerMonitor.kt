package com.crosswise.crossing

import com.crosswise.core.Angles
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

enum class VeerState { ON_COURSE, DRIFTED_LEFT, DRIFTED_RIGHT }

data class VeerStatus(
    /** Smoothed heading minus locked heading, degrees. + means the user now faces right of the crossing line. */
    val deviationDeg: Float,
    val state: VeerState,
    val lockedHeadingDeg: Float,
)

/**
 * Keeps the user's heading locked to the direction they faced when the crossing started and reports
 * sustained drift. Uses the gyroscope-based rotation vector (no compass), which is immune to the
 * magnetic disturbance from nearby cars and stays accurate over the ~10-30 s of a crossing.
 */
class VeerMonitor(
    private val warnDeg: Float = 12f,
    private val clearDeg: Float = 6f,
    private val sustainMs: Long = 1_000,
    private val smoothingTauMs: Double = 600.0,
) {
    private var lockedHeading: Float? = null
    private var sinSum = 0.0
    private var cosSum = 1.0
    private var lastMs: Long? = null
    private var state = VeerState.ON_COURSE
    private var driftSinceMs: Long? = null

    val isLocked: Boolean get() = lockedHeading != null

    fun lock(headingDeg: Float, timestampMs: Long) {
        lockedHeading = headingDeg
        val rad = Math.toRadians(headingDeg.toDouble())
        sinSum = sin(rad)
        cosSum = cos(rad)
        lastMs = timestampMs
        state = VeerState.ON_COURSE
        driftSinceMs = null
    }

    fun unlock() {
        lockedHeading = null
        lastMs = null
        driftSinceMs = null
        state = VeerState.ON_COURSE
    }

    fun update(headingDeg: Float, timestampMs: Long): VeerStatus? {
        val locked = lockedHeading ?: return null
        val dt = lastMs?.let { (timestampMs - it).coerceIn(0L, 1_000L) } ?: 0L
        lastMs = timestampMs
        val alpha = 1.0 - exp(-dt / smoothingTauMs)
        val rad = Math.toRadians(headingDeg.toDouble())
        sinSum += alpha * (sin(rad) - sinSum)
        cosSum += alpha * (cos(rad) - cosSum)
        val smoothed = Angles.toDeg(atan2(sinSum, cosSum))
        val deviation = Angles.wrap180(smoothed - locked)

        val drifting = when {
            deviation >= warnDeg -> VeerState.DRIFTED_RIGHT
            deviation <= -warnDeg -> VeerState.DRIFTED_LEFT
            else -> null
        }
        when {
            state == VeerState.ON_COURSE -> {
                if (drifting == null) {
                    driftSinceMs = null
                } else {
                    val since = driftSinceMs ?: timestampMs.also { driftSinceMs = it }
                    if (timestampMs - since >= sustainMs) state = drifting
                }
            }
            abs(deviation) <= clearDeg -> {
                state = VeerState.ON_COURSE
                driftSinceMs = null
            }
            drifting != null && drifting != state -> state = drifting
        }
        return VeerStatus(deviation, state, locked)
    }
}

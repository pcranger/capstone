package com.crosswise.sensors

import com.crosswise.core.Angles
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.sqrt

/** Orientation of the rear camera's optical axis in a gravity-aligned world frame. */
data class OrientationSample(
    val timestampMs: Long,
    /** Heading of the camera axis projected on the ground plane, 0..360. Reference is arbitrary but stable. */
    val headingDeg: Float,
    /** Elevation of the camera axis: + when pointing above the horizon, -90 when pointing at the ground. */
    val pitchDeg: Float,
)

object OrientationMath {

    /** Same convention as Android's SensorManager.getRotationMatrixFromVector (device -> world, row-major). */
    fun rotationMatrixFromVector(values: FloatArray): FloatArray {
        val q1 = values[0]
        val q2 = values[1]
        val q3 = values[2]
        val q0 = if (values.size >= 4) values[3] else {
            val t = 1f - q1 * q1 - q2 * q2 - q3 * q3
            if (t > 0f) sqrt(t) else 0f
        }
        val sqQ1 = 2f * q1 * q1
        val sqQ2 = 2f * q2 * q2
        val sqQ3 = 2f * q3 * q3
        val q1q2 = 2f * q1 * q2
        val q3q0 = 2f * q3 * q0
        val q1q3 = 2f * q1 * q3
        val q2q0 = 2f * q2 * q0
        val q2q3 = 2f * q2 * q3
        val q1q0 = 2f * q1 * q0
        return floatArrayOf(
            1f - sqQ2 - sqQ3, q1q2 - q3q0, q1q3 + q2q0,
            q1q2 + q3q0, 1f - sqQ1 - sqQ3, q2q3 - q1q0,
            q1q3 - q2q0, q2q3 + q1q0, 1f - sqQ1 - sqQ2,
        )
    }

    /**
     * Heading and pitch of the rear camera (device -Z axis). When the camera points almost straight
     * up or down the heading is taken from the top edge of the phone instead, which is what a user
     * holding the phone flat perceives as "forward".
     */
    fun cameraOrientation(r: FloatArray, timestampMs: Long): OrientationSample {
        val fx = -r[2]
        val fy = -r[5]
        val fz = -r[8]
        val norm = sqrt(fx * fx + fy * fy + fz * fz).coerceAtLeast(1e-6f)
        val pitch = Angles.toDeg(asin((fz / norm).coerceIn(-1f, 1f).toDouble()))
        val heading = if (abs(pitch) < 70f) {
            Angles.toDeg(atan2(fx.toDouble(), fy.toDouble()))
        } else {
            Angles.toDeg(atan2(r[1].toDouble(), r[4].toDouble()))
        }
        return OrientationSample(timestampMs, Angles.wrap360(heading), pitch)
    }
}

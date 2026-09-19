package com.crosswise.tracking

import kotlin.math.ln
import kotlin.math.sqrt

data class TtcEstimate(
    /** Time to contact in seconds; [Float.POSITIVE_INFINITY] when the object is not getting closer. */
    val seconds: Float,
    /** d(ln size)/dt in 1/s. Positive = approaching (expanding). */
    val expansionRate: Float,
    /** Goodness of the log-linear fit, 0..1. */
    val rSquared: Float,
    /** Latest apparent height as a fraction of the frame height. */
    val heightFraction: Float,
)

/**
 * Monocular time-to-contact from optical expansion ("tau", Lee 1976): for an object approaching at
 * constant speed, TTC ≈ size / (d size / dt) = 1 / (d ln(size) / dt). No depth model is needed and the
 * estimate does not depend on the object's real size or the camera intrinsics.
 */
object Looming {

    fun estimate(
        samples: List<TrackSample>,
        frameAspect: Float,
        windowMs: Long = 1_000,
        minSpanMs: Long = 350,
        minSamples: Int = 4,
    ): TtcEstimate? {
        val last = samples.lastOrNull() ?: return null
        val recent = samples.filter { last.timestampMs - it.timestampMs <= windowMs }
        if (recent.size < minSamples) return null
        // A box clipped at the left/right/top border grows only because more of the object becomes
        // visible, which would look like looming. Skip those windows entirely.
        if (recent.any { it.box.left <= 0.005f || it.box.right >= 0.995f || it.box.top <= 0.005f }) return null
        val bottomClipped = recent.any { it.box.bottom >= 0.995f }

        val t0 = recent.first().timestampMs
        val span = last.timestampMs - t0
        if (span < minSpanMs) return null

        val n = recent.size
        val xs = DoubleArray(n) { (recent[it].timestampMs - t0) / 1000.0 }
        val ys = DoubleArray(n) {
            val b = recent[it].box
            // Width alone when the bottom is clipped; otherwise geometric mean of width and height.
            val size = if (bottomClipped) b.width * frameAspect else sqrt(b.width * frameAspect * b.height)
            ln(size.coerceAtLeast(1e-4f).toDouble())
        }
        val meanX = xs.average()
        val meanY = ys.average()
        var sxy = 0.0
        var sxx = 0.0
        var syy = 0.0
        for (i in 0 until n) {
            val dx = xs[i] - meanX
            val dy = ys[i] - meanY
            sxy += dx * dy
            sxx += dx * dx
            syy += dy * dy
        }
        if (sxx <= 1e-9) return null
        val slope = sxy / sxx
        val r2 = if (syy <= 1e-12) 1.0 else (sxy * sxy) / (sxx * syy)
        val seconds = if (slope > 1e-3) (1.0 / slope).toFloat() else Float.POSITIVE_INFINITY
        return TtcEstimate(seconds, slope.toFloat(), r2.toFloat(), last.box.height)
    }
}

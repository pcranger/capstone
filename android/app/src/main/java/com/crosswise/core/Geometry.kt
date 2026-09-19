package com.crosswise.core

import kotlin.math.atan
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.tan

/** Axis-aligned box in normalized image coordinates (0..1, origin top-left, upright frame). */
data class BoxF(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = max(0f, right - left)
    val height: Float get() = max(0f, bottom - top)
    val area: Float get() = width * height
    val centerX: Float get() = (left + right) / 2f
    val centerY: Float get() = (top + bottom) / 2f
    val diagonal: Float get() = sqrt(width * width + height * height)

    fun iou(other: BoxF): Float {
        val ix = min(right, other.right) - max(left, other.left)
        val iy = min(bottom, other.bottom) - max(top, other.top)
        if (ix <= 0f || iy <= 0f) return 0f
        val inter = ix * iy
        val union = area + other.area - inter
        return if (union <= 0f) 0f else inter / union
    }

    fun centerDistance(other: BoxF): Float {
        val dx = centerX - other.centerX
        val dy = centerY - other.centerY
        return sqrt(dx * dx + dy * dy)
    }

    fun offset(dx: Float, dy: Float) = BoxF(left + dx, top + dy, right + dx, bottom + dy)

    fun clamp01() = BoxF(
        left.coerceIn(0f, 1f), top.coerceIn(0f, 1f),
        right.coerceIn(0f, 1f), bottom.coerceIn(0f, 1f),
    )

    /** True when the box touches the frame border (object probably truncated). */
    fun touchesEdge(margin: Float = 0.01f) =
        left <= margin || top <= margin || right >= 1f - margin || bottom >= 1f - margin

    companion object {
        fun fromCenter(cx: Float, cy: Float, w: Float, h: Float) =
            BoxF(cx - w / 2f, cy - h / 2f, cx + w / 2f, cy + h / 2f)
    }
}

object Angles {
    /** Wraps any angle in degrees into (-180, 180]. */
    fun wrap180(deg: Float): Float {
        var a = deg % 360f
        if (a <= -180f) a += 360f
        if (a > 180f) a -= 360f
        return a
    }

    fun wrap360(deg: Float): Float {
        val a = deg % 360f
        return if (a < 0f) a + 360f else a
    }

    fun toDeg(rad: Double) = Math.toDegrees(rad).toFloat()
    fun toRad(deg: Float) = Math.toRadians(deg.toDouble())

    /**
     * Horizontal bearing (degrees, + = right of the optical axis) of a point at normalized x,
     * for a pinhole camera with the given horizontal field of view.
     */
    fun bearingFromImageX(xNorm: Float, hfovDeg: Float): Float {
        val halfTan = tan(toRad(hfovDeg / 2f))
        return toDeg(atan((xNorm - 0.5) * 2.0 * halfTan))
    }

    /** Vertical elevation (degrees, + = above the optical axis) of a point at normalized y. */
    fun elevationFromImageY(yNorm: Float, vfovDeg: Float): Float {
        val halfTan = tan(toRad(vfovDeg / 2f))
        return toDeg(atan((0.5 - yNorm) * 2.0 * halfTan))
    }
}

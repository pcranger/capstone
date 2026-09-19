package com.crosswise.perception

import android.graphics.Bitmap
import android.graphics.Color
import androidx.core.graphics.get
import com.crosswise.core.BoxF

/**
 * Baseline-only: estimates whether a generic "traffic light" box is lit red or green from its pixels.
 *
 * Used when the loaded model (e.g. plain COCO) has no pedestrian-signal classes. It cannot tell a
 * pedestrian signal from a vehicle signal, so results are always reported to the user as unverified.
 */
object SignalColorHeuristic {
    private const val MAX_SAMPLES_PER_AXIS = 32

    fun estimate(frame: Bitmap, box: BoxF): SignalColor? {
        val left = (box.left * frame.width).toInt().coerceIn(0, frame.width - 1)
        val right = (box.right * frame.width).toInt().coerceIn(left + 1, frame.width)
        val top = (box.top * frame.height).toInt().coerceIn(0, frame.height - 1)
        val bottom = (box.bottom * frame.height).toInt().coerceIn(top + 1, frame.height)
        val stepX = maxOf(1, (right - left) / MAX_SAMPLES_PER_AXIS)
        val stepY = maxOf(1, (bottom - top) / MAX_SAMPLES_PER_AXIS)
        val hsv = FloatArray(3)
        var red = 0
        var green = 0
        var total = 0
        var y = top
        while (y < bottom) {
            var x = left
            while (x < right) {
                Color.colorToHSV(frame[x, y], hsv)
                total++
                if (hsv[2] > 0.5f) {
                    val h = hsv[0]
                    val s = hsv[1]
                    if (s > 0.45f && (h < 20f || h > 335f)) red++
                    // Pedestrian "green" LEDs often look cyan on camera sensors.
                    else if (s > 0.30f && h in 90f..200f) green++
                }
                x += stepX
            }
            y += stepY
        }
        return classify(red, green, total)
    }

    /** Pure decision rule, split out for unit tests. */
    fun classify(redPixels: Int, greenPixels: Int, totalPixels: Int): SignalColor? {
        if (totalPixels == 0) return null
        val r = redPixels.toFloat() / totalPixels
        val g = greenPixels.toFloat() / totalPixels
        return when {
            r >= 0.06f && r > 2.5f * g -> SignalColor.RED
            g >= 0.06f && g > 2.5f * r -> SignalColor.GREEN
            else -> null
        }
    }
}

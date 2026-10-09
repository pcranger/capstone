package com.crosswise.sensors

import kotlin.math.sqrt

/**
 * Detects walking from raw accelerometer magnitude (no permission needed, unlike the step detector).
 * Walking shows up as a 1.3–2.8 Hz oscillation of roughly ±1 m/s² or more around gravity.
 */
class WalkingDetector(
    private val windowMs: Long = 2_000,
    private val minRms: Float = 0.9f,
    private val minCrossingsPerSecond: Float = 1.6f,
    private val maxCrossingsPerSecond: Float = 7.0f,
) {
    private data class Sample(val t: Long, val value: Float)

    private val samples = ArrayDeque<Sample>()
    private var gravityEstimate = 9.81f
    private var initialized = false

    var isWalking: Boolean = false
        private set

    fun onAccelerometer(timestampMs: Long, ax: Float, ay: Float, az: Float) {
        val magnitude = sqrt(ax * ax + ay * ay + az * az)
        if (!initialized) {
            gravityEstimate = magnitude
            initialized = true
        }
        gravityEstimate += 0.02f * (magnitude - gravityEstimate)
        samples.addLast(Sample(timestampMs, magnitude - gravityEstimate))
        while (samples.isNotEmpty() && timestampMs - samples.first().t > windowMs) samples.removeFirst()
        isWalking = evaluate()
    }

    private fun evaluate(): Boolean {
        if (samples.size < 10) return false
        val span = samples.last().t - samples.first().t
        if (span < windowMs * 0.75) return false
        var sumSq = 0f
        var crossings = 0
        var side = 0 // -1 below -hysteresis, +1 above +hysteresis
        for (s in samples) {
            sumSq += s.value * s.value
            val newSide = when {
                s.value > HYSTERESIS -> 1
                s.value < -HYSTERESIS -> -1
                else -> side
            }
            if (side != 0 && newSide != side) crossings++
            side = newSide
        }
        val rms = sqrt(sumSq / samples.size)
        val crossingsPerSecond = crossings / (span / 1000f)
        return rms >= minRms && crossingsPerSecond in minCrossingsPerSecond..maxCrossingsPerSecond
    }

    private companion object {
        const val HYSTERESIS = 0.35f
    }

    fun reset() {
        samples.clear()
        initialized = false
        isWalking = false
    }
}

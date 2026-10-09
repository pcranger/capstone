package com.crosswise.feedback

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * A small, learnable vibration vocabulary. Patterns differ in rhythm (not only strength) so they are
 * distinguishable on phones without amplitude control.
 */
class Haptics(context: Context) {
    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Vibrator::class.java)
    }

    /** timings (off, on, off, on...) in ms and matching amplitudes 0..255. */
    private fun pattern(p: HapticPattern): Pair<LongArray, IntArray> = when (p) {
        HapticPattern.WALK -> longArrayOf(0, 120, 80, 120, 80, 120) to intArrayOf(0, 255, 0, 255, 0, 255)
        HapticPattern.DONT_WALK -> longArrayOf(0, 500) to intArrayOf(0, 200)
        HapticPattern.FLASHING -> longArrayOf(0, 60, 140, 60, 140, 60) to intArrayOf(0, 180, 0, 180, 0, 180)
        HapticPattern.LOST -> longArrayOf(0, 50, 120, 50) to intArrayOf(0, 110, 0, 110)
        HapticPattern.CENTERED_TICK -> longArrayOf(0, 30) to intArrayOf(0, 160)
        HapticPattern.VEER_LEFT -> longArrayOf(0, 60, 90, 220) to intArrayOf(0, 220, 0, 220)
        HapticPattern.VEER_RIGHT -> longArrayOf(0, 220, 90, 60) to intArrayOf(0, 220, 0, 220)
        HapticPattern.ALERT -> longArrayOf(0, 80, 50, 80, 50, 80, 50, 80) to intArrayOf(0, 255, 0, 255, 0, 255, 0, 255)
        HapticPattern.CRITICAL -> longArrayOf(0, 400, 80, 400) to intArrayOf(0, 255, 0, 255)
    }

    fun play(p: HapticPattern) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val (timings, amplitudes) = pattern(p)
        val effect = if (v.hasAmplitudeControl()) {
            VibrationEffect.createWaveform(timings, amplitudes, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }
        v.vibrate(effect)
    }

    fun cancel() {
        vibrator?.cancel()
    }
}

package com.crosswise.sensors

import com.crosswise.crossing.VeerMonitor
import com.crosswise.crossing.VeerState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

class SensorsTest {

    private fun rotX(deg: Double): DoubleArray {
        val a = Math.toRadians(deg)
        return doubleArrayOf(1.0, 0.0, 0.0, 0.0, cos(a), -sin(a), 0.0, sin(a), cos(a))
    }

    private fun rotZ(deg: Double): DoubleArray {
        val a = Math.toRadians(deg)
        return doubleArrayOf(cos(a), -sin(a), 0.0, sin(a), cos(a), 0.0, 0.0, 0.0, 1.0)
    }

    private fun mul(a: DoubleArray, b: DoubleArray): FloatArray = FloatArray(9) { i ->
        val r = i / 3
        val c = i % 3
        (0 until 3).sumOf { k -> a[r * 3 + k] * b[k * 3 + c] }.toFloat()
    }

    @Test
    fun quaternionMatchesAndroidConvention() {
        // +90° about X: phone upright, screen toward the user.
        val s = sin(PI / 4).toFloat()
        val r = OrientationMath.rotationMatrixFromVector(floatArrayOf(s, 0f, 0f, s))
        val expected = rotX(90.0)
        r.indices.forEach { assertEquals(expected[it].toFloat(), r[it], 1e-5f) }
    }

    @Test
    fun uprightPhoneFacingNorthAndEast() {
        val north = OrientationMath.cameraOrientation(mul(rotZ(0.0), rotX(90.0)), 0)
        assertEquals(0f, north.pitchDeg, 1e-3f)
        assertEquals(0f, north.headingDeg, 1e-3f)

        // Turning right (clockwise seen from above) is a negative rotation about world Z.
        val east = OrientationMath.cameraOrientation(mul(rotZ(-90.0), rotX(90.0)), 0)
        assertEquals(90f, east.headingDeg, 1e-3f)
    }

    @Test
    fun tiltingUpRaisesPitch() {
        val up = OrientationMath.cameraOrientation(mul(rotZ(-30.0), rotX(110.0)), 0)
        assertEquals(20f, up.pitchDeg, 1e-3f)
        assertEquals(30f, up.headingDeg, 1e-3f)
    }

    @Test
    fun flatPhoneUsesTopEdgeAsHeading() {
        val flat = OrientationMath.cameraOrientation(mul(rotZ(-45.0), rotX(0.0)), 0)
        assertEquals(-90f, flat.pitchDeg, 1e-3f)
        assertEquals(45f, flat.headingDeg, 1e-3f)
    }

    @Test
    fun walkingDetectorSeesStepsNotStillness() {
        val walking = WalkingDetector()
        var t = 0L
        while (t < 3_000) {
            val bounce = 2.0 * sin(2 * PI * 1.8 * t / 1000.0)
            walking.onAccelerometer(t, 0f, (9.81 + bounce).toFloat(), 0.3f)
            t += 20
        }
        assertTrue(walking.isWalking)

        val still = WalkingDetector()
        val rng = Random(1)
        t = 0
        while (t < 3_000) {
            still.onAccelerometer(t, rng.nextFloat() * 0.1f, 9.81f + rng.nextFloat() * 0.1f, 0.2f)
            t += 20
        }
        assertFalse(still.isWalking)
    }

    @Test
    fun veerMonitorWarnsAfterSustainedDriftAcrossNorth() {
        val veer = VeerMonitor()
        veer.lock(350f, 0)
        var t = 0L
        var state = VeerState.ON_COURSE
        while (t <= 3_000) {
            state = veer.update(8f, t)!!.state // 18° to the right of the locked heading
            t += 50
        }
        assertEquals(VeerState.DRIFTED_RIGHT, state)
        while (t <= 6_000) {
            state = veer.update(352f, t)!!.state
            t += 50
        }
        assertEquals(VeerState.ON_COURSE, state)
    }

    @Test
    fun veerMonitorIgnoresBodySway() {
        val veer = VeerMonitor()
        veer.lock(90f, 0)
        var t = 0L
        var worst = 0f
        while (t <= 10_000) {
            // ±15° sway at step frequency averages out.
            val heading = 90f + 15f * sin(2 * PI * 1.8 * t / 1000.0).toFloat()
            val status = veer.update(heading, t)!!
            assertEquals(VeerState.ON_COURSE, status.state)
            worst = maxOf(worst, kotlin.math.abs(status.deviationDeg))
            t += 20
        }
        assertTrue("worst=$worst", worst < 12f)
    }
}

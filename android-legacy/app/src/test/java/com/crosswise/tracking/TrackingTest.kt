package com.crosswise.tracking

import com.crosswise.TestFixtures.det
import com.crosswise.core.BoxF
import com.crosswise.perception.ObjectCategory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackingTest {

    @Test
    fun signalKeepsIdentityWhenPhaseFlips() {
        val tracker = ObjectTracker()
        tracker.update(listOf(det(ObjectCategory.PED_DONT_WALK)), 0)
        val id = tracker.activeTracks.single().id
        tracker.update(listOf(det(ObjectCategory.PED_WALK)), 100)
        val track = tracker.activeTracks.single()
        assertEquals(id, track.id)
        assertEquals(ObjectCategory.PED_WALK, track.category)
        assertEquals(2, track.hits)
    }

    @Test
    fun vehiclesAndSignalsNeverMerge() {
        val tracker = ObjectTracker()
        val box = BoxF(0.4f, 0.4f, 0.6f, 0.6f)
        tracker.update(listOf(det(ObjectCategory.CAR, box)), 0)
        tracker.update(listOf(det(ObjectCategory.TRAFFIC_LIGHT, box)), 100)
        assertEquals(2, tracker.activeTracks.size)
    }

    @Test
    fun gyroShiftKeepsSmallObjectWhileScanning() {
        val tracker = ObjectTracker()
        tracker.update(listOf(det(ObjectCategory.PED_WALK, BoxF(0.50f, 0.2f, 0.52f, 0.24f))), 0)
        // Camera turned right: the signal jumped 0.2 to the left, far beyond its own size.
        val moved = det(ObjectCategory.PED_WALK, BoxF(0.30f, 0.2f, 0.32f, 0.24f))
        tracker.update(listOf(moved), 100, shiftX = -0.2f)
        assertEquals(1, tracker.activeTracks.size)

        val noShift = ObjectTracker()
        noShift.update(listOf(det(ObjectCategory.PED_WALK, BoxF(0.50f, 0.2f, 0.52f, 0.24f))), 0)
        noShift.update(listOf(moved), 100)
        assertEquals(2, noShift.activeTracks.size)
    }

    @Test
    fun tracksExpireAfterMisses() {
        val tracker = ObjectTracker(maxMissMs = 500)
        tracker.update(listOf(det(ObjectCategory.CAR)), 0)
        tracker.update(emptyList(), 400)
        assertEquals(1, tracker.activeTracks.size)
        tracker.update(emptyList(), 600)
        assertTrue(tracker.activeTracks.isEmpty())
    }

    private fun samples(sizeAt: (Double) -> Double, cx: Float = 0.5f, frames: Int = 10, stepMs: Long = 100): List<TrackSample> =
        (0 until frames).map { i ->
            val t = i * stepMs
            val h = sizeAt(t / 1000.0).toFloat()
            TrackSample(t, BoxF.fromCenter(cx, 0.6f, h * 0.5625f, h), 0.8f, ObjectCategory.CAR, null)
        }

    @Test
    fun loomingRecoversTimeToContact() {
        // Constant-speed approach with contact at t = 3 s: size ∝ 1 / (3 - t).
        val est = Looming.estimate(samples({ t -> 0.06 * 3.0 / (3.0 - t) }), frameAspect = 0.5625f)
        assertNotNull(est)
        // Over the 0.0–0.9 s window the true TTC goes from 3.0 to 2.1 s.
        assertTrue("ttc=${est!!.seconds}", est.seconds in 2.0f..3.0f)
        assertTrue(est.rSquared > 0.95f)
    }

    @Test
    fun recedingObjectHasNoContact() {
        val est = Looming.estimate(samples({ t -> 0.2 / (1.0 + t) }), frameAspect = 0.5625f)
        assertEquals(Float.POSITIVE_INFINITY, est!!.seconds)
    }

    @Test
    fun clippedBoxIsIgnored() {
        assertNull(Looming.estimate(samples({ t -> 0.06 * 3.0 / (3.0 - t) }, cx = 0.02f), frameAspect = 0.5625f))
    }
}

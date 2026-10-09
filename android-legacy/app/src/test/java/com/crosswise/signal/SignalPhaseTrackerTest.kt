package com.crosswise.signal

import com.crosswise.TestFixtures.det
import com.crosswise.perception.Detection
import com.crosswise.perception.ObjectCategory
import com.crosswise.perception.SignalColor
import com.crosswise.tracking.ObjectTracker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class SignalPhaseTrackerTest {
    private val tracker = ObjectTracker()
    private val phases = SignalPhaseTracker()
    private val events = mutableListOf<Pair<Long, SignalEvent>>()
    private var now = 0L

    /** Feeds frames every 100 ms for [durationMs]; [detection] may return null for "not detected". */
    private fun run(durationMs: Long, detection: (Long) -> Detection?) {
        val end = now + durationMs
        while (now < end) {
            val d = detection(now)
            val tracks = tracker.update(listOfNotNull(d), now)
            phases.update(now, tracks).forEach { events += now to it }
            now += 100
        }
    }

    private val red = { _: Long -> det(ObjectCategory.PED_DONT_WALK) }
    private val green = { _: Long -> det(ObjectCategory.PED_WALK) }

    @Test
    fun observedRedToGreenIsAFreshWalk() {
        run(3_000, red)
        run(3_000, green)
        val acquired = events.first().second as SignalEvent.Acquired
        assertEquals(SignalPhase.DONT_WALK, acquired.phase)
        val changed = events.map { it.second }.filterIsInstance<SignalEvent.Changed>().single()
        assertEquals(SignalPhase.WALK, changed.to)
        assertTrue(changed.freshWalk)
        assertTrue(phases.snapshot.freshWalk)
        // Announced within ~1.5 s of the real change at t = 3000.
        val changedAt = events.first { it.second is SignalEvent.Changed }.first
        assertTrue("changedAt=$changedAt", changedAt in 3_000..4_500)
    }

    @Test
    fun greenFirstSeenIsNotFresh() {
        run(3_000, green)
        val acquired = events.single().second as SignalEvent.Acquired
        assertEquals(SignalPhase.WALK, acquired.phase)
        assertFalse(phases.snapshot.freshWalk)
    }

    @Test
    fun briefGreenBlipDuringRedIsIgnored() {
        run(3_000, red)
        run(300, green)
        run(2_000, red)
        assertEquals(1, events.size)
        assertEquals(SignalPhase.DONT_WALK, phases.currentPhase)
    }

    @Test
    fun rhythmicGreenIsFlashing() {
        run(2_000, green)
        run(6_000) { t -> if ((t / 500) % 2 == 0L) det(ObjectCategory.PED_WALK) else null }
        val changed = events.map { it.second }.filterIsInstance<SignalEvent.Changed>()
        assertEquals(SignalPhase.WALK_FLASHING, changed.last().to)
        assertEquals(SignalPhase.WALK_FLASHING, phases.currentPhase)
    }

    @Test
    fun randomMissesAreNotFlashing() {
        val rng = Random(42)
        run(8_000) { if (rng.nextFloat() < 0.12f) null else det(ObjectCategory.PED_WALK) }
        assertEquals(SignalPhase.WALK, phases.currentPhase)
        assertTrue(events.none { (it.second as? SignalEvent.Changed)?.to == SignalPhase.WALK_FLASHING })
    }

    @Test
    fun signalOutOfViewIsReportedLost() {
        run(2_000, red)
        run(2_500) { null }
        assertTrue(events.last().second is SignalEvent.Lost)
        assertEquals(SignalPhase.UNKNOWN, phases.currentPhase)
    }

    @Test
    fun shortOcclusionDuringRedStillGivesFreshWalk() {
        run(3_000, red)
        run(2_000) { null } // e.g. a bus passes; "lost" is announced
        run(3_000, green)
        val changed = events.map { it.second }.filterIsInstance<SignalEvent.Changed>().single()
        assertTrue(changed.freshWalk)
    }

    @Test
    fun colorHeuristicPhaseIsUntrusted() {
        run(3_000) { det(ObjectCategory.TRAFFIC_LIGHT, colorHint = SignalColor.GREEN) }
        val acquired = events.single().second as SignalEvent.Acquired
        assertEquals(SignalPhase.WALK, acquired.phase)
        assertFalse(acquired.trusted)
    }

    @Test
    fun genericLightWithoutColorIsIgnored() {
        run(3_000) { det(ObjectCategory.TRAFFIC_LIGHT) }
        assertTrue(events.isEmpty())
    }
}

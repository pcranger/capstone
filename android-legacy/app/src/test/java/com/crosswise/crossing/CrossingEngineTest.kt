package com.crosswise.crossing

import com.crosswise.TestFixtures.det
import com.crosswise.TestFixtures.frame
import com.crosswise.core.BoxF
import com.crosswise.feedback.Cue
import com.crosswise.feedback.Phrase
import com.crosswise.perception.Detection
import com.crosswise.perception.ObjectCategory
import com.crosswise.perception.SignalColorHeuristic
import com.crosswise.perception.SignalColor
import com.crosswise.sensors.OrientationSample
import com.crosswise.signal.SignalPhase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossingEngineTest {
    private val engine = CrossingEngine()
    private val geometry = CameraGeometry(hfovDeg = 60f, vfovDeg = 90f)
    private val spoken = mutableListOf<Pair<Long, Phrase>>()
    private var now = 0L
    private var heading = 0f
    private var walking = false

    private fun collect(output: EngineOutput) {
        output.cues.filterIsInstance<Cue.Speak>().forEach { spoken += now to it.phrase }
    }

    /** Runs camera frames (10 Hz) and sensor ticks (10 Hz) together. */
    private fun run(durationMs: Long, detections: (Long) -> List<Detection>) {
        val end = now + durationMs
        while (now < end) {
            collect(engine.onSensors(now, OrientationSample(now, heading, 5f), walking))
            collect(engine.onFrame(frame(now, *detections(now).toTypedArray()), geometry))
            now += 100
        }
    }

    private fun phrases() = spoken.map { it.second }

    @Test
    fun fullCrossingScenario() {
        collect(engine.command(UserCommand.START_ASSIST, now))
        assertEquals(AssistMode.SEARCHING, engine.mode)

        run(3_000) { listOf(det(ObjectCategory.PED_DONT_WALK)) }
        assertEquals(AssistMode.WAITING, engine.mode)
        assertTrue(Phrase.DONT_WALK in phrases())

        run(2_000) { listOf(det(ObjectCategory.PED_WALK)) }
        assertTrue(Phrase.WALK_STARTED in phrases())
        assertFalse(Phrase.WALK_ALREADY_ON in phrases())

        // The user starts walking toward the signal: crossing mode starts by itself.
        walking = true
        run(2_000) { listOf(det(ObjectCategory.PED_WALK)) }
        assertEquals(AssistMode.CROSSING, engine.mode)
        assertTrue(Phrase.CROSSING_DETECTED in phrases())

        // Drifting 20° to the right for a few seconds -> "bear left".
        heading = 20f
        run(3_000) { emptyList() }
        assertTrue(Phrase.BEAR_LEFT in phrases())
        // The far signal leaving the view mid-crossing is not announced.
        assertFalse(Phrase.SIGNAL_LOST in phrases())

        // A car on the left approaches fast (contact in ~2.5 s).
        val carStart = now
        run(1_500) { t ->
            val remaining = 3.0 - (t - carStart) / 1000.0
            val h = (0.08 * 3.0 / remaining).toFloat()
            listOf(det(ObjectCategory.CAR, BoxF.fromCenter(0.2f, 0.6f, h * 0.8f, h), 0.9f))
        }
        assertTrue(phrases().any { it == Phrase.VEHICLE_LEFT || it == Phrase.VEHICLE_CLOSE_LEFT })

        // A refuge pause cannot establish arrival at the far footpath.
        walking = false
        heading = 0f
        run(6_000) { emptyList() }
        assertEquals(AssistMode.CROSSING, engine.mode)
        assertFalse(Phrase.CROSSING_ENDED in phrases())
        collect(engine.command(UserCommand.END_CROSSING, now))
        assertEquals(AssistMode.SEARCHING, engine.mode)
        assertTrue(Phrase.CROSSING_ENDED in phrases())
        assertNull(engine.snapshot.veer)
        assertNull(engine.snapshot.crossingElapsedMs)
        assertEquals(SignalPhase.UNKNOWN, engine.snapshot.signal.phase)
        assertTrue(engine.command(UserCommand.END_CROSSING, now).cues.isEmpty())
        collect(engine.command(UserCommand.START_CROSSING, now))
        assertEquals(AssistMode.CROSSING, engine.mode)
        assertEquals(0L, engine.snapshot.crossingElapsedMs)
    }

    private fun assertLongCrossing(isWalking: Boolean) {
        engine.command(UserCommand.START_ASSIST, now)
        run(1_000) { emptyList() }
        engine.command(UserCommand.START_CROSSING, now)
        walking = isWalking
        run(125_000) { emptyList() }
        assertEquals(AssistMode.CROSSING, engine.mode)
        assertTrue(engine.snapshot.crossingElapsedMs!! >= 120_000)
        assertTrue(engine.snapshot.veer != null)
        assertFalse(Phrase.CROSSING_ENDED in phrases())
        val carStart = now
        run(1_500) { t ->
            val h = (0.24 / (3 - (t - carStart) / 1000.0)).toFloat()
            listOf(det(ObjectCategory.CAR, BoxF.fromCenter(0.2f, 0.6f, h * 0.8f, h), 0.9f))
        }
        assertTrue(phrases().any { it == Phrase.VEHICLE_LEFT || it == Phrase.VEHICLE_CLOSE_LEFT })
    }

    @Test
    fun crossingRemainsActivePastTwoMinutesWhileStill() = assertLongCrossing(false)

    @Test
    fun crossingRemainsActivePastTwoMinutesWhileWalking() = assertLongCrossing(true)

    @Test
    fun sensorGapDoesNotCompleteCrossingButExplicitShortcutDoes() {
        engine.command(UserCommand.START_ASSIST, 0)
        engine.command(UserCommand.START_CROSSING, 0)
        collect(engine.onSensors(180_000, null, false))
        assertEquals(AssistMode.CROSSING, engine.mode)
        assertFalse(Phrase.CROSSING_ENDED in phrases())
        collect(engine.command(UserCommand.TOGGLE_CROSSING, 180_001))
        assertEquals(AssistMode.SEARCHING, engine.mode)
        assertTrue(Phrase.CROSSING_ENDED in phrases())
    }

    @Test
    fun stoppingAssistanceCancelsWithoutClaimingCompletion() {
        engine.command(UserCommand.START_ASSIST, now)
        run(1_000) { emptyList() }
        engine.command(UserCommand.START_CROSSING, now)
        collect(engine.command(UserCommand.STOP_ASSIST, now))
        assertEquals(AssistMode.IDLE, engine.mode)
        assertNull(engine.snapshot.veer)
        assertNull(engine.snapshot.crossingElapsedMs)
        collect(engine.onSensors(180_000, null, false))
        assertEquals(AssistMode.IDLE, engine.mode)
        assertEquals(listOf(Phrase.ASSIST_STOPPED), phrases())
    }

    @Test
    fun walkingDuringDontWalkIsFlaggedOnce() {
        engine.command(UserCommand.START_ASSIST, now)
        run(3_000) { listOf(det(ObjectCategory.PED_DONT_WALK)) }
        walking = true
        run(4_000) { listOf(det(ObjectCategory.PED_DONT_WALK)) }
        assertEquals(1, phrases().count { it == Phrase.WALKING_ON_DONT_WALK })
        assertEquals(AssistMode.WAITING, engine.mode)
    }

    @Test
    fun passingVehicleIsNotAHazard() {
        engine.command(UserCommand.START_ASSIST, now)
        val start = now
        run(3_000) { t ->
            val x = 0.1f + 0.25f * (t - start) / 1000f // crosses the view at constant size
            listOf(det(ObjectCategory.CAR, BoxF.fromCenter(x, 0.5f, 0.12f, 0.1f)))
        }
        assertTrue(phrases().none { it.name.startsWith("VEHICLE") })
    }

    @Test
    fun repeatStatusDescribesSignalAge() {
        engine.command(UserCommand.START_ASSIST, now)
        run(3_000) { listOf(det(ObjectCategory.PED_DONT_WALK)) }
        run(4_000) { listOf(det(ObjectCategory.PED_WALK)) }
        val status = engine.command(UserCommand.REPEAT_STATUS, now).cues.filterIsInstance<Cue.Speak>()
        val elapsed = status.first()
        assertEquals(Phrase.STATUS_WALK_ELAPSED, elapsed.phrase)
        assertTrue((elapsed.args.single() as Int) in 2..4)
        assertEquals(Phrase.STATUS_NO_VEHICLES, status[1].phrase)
    }

    @Test
    fun idleEngineStaysSilentButTracksState() {
        run(3_000) { listOf(det(ObjectCategory.PED_DONT_WALK)) }
        assertTrue(spoken.isEmpty())
        val start = engine.command(UserCommand.START_ASSIST, now).cues.filterIsInstance<Cue.Speak>().map { it.phrase }
        assertEquals(listOf(Phrase.ASSIST_STARTED, Phrase.DONT_WALK), start)
        assertEquals(AssistMode.WAITING, engine.mode)
        assertNull(engine.snapshot.veer)
    }

    @Test
    fun colorHeuristicDecisionRule() {
        assertEquals(SignalColor.RED, SignalColorHeuristic.classify(redPixels = 20, greenPixels = 1, totalPixels = 100))
        assertEquals(SignalColor.GREEN, SignalColorHeuristic.classify(redPixels = 0, greenPixels = 12, totalPixels = 100))
        assertNull(SignalColorHeuristic.classify(redPixels = 10, greenPixels = 8, totalPixels = 100))
        assertNull(SignalColorHeuristic.classify(redPixels = 2, greenPixels = 0, totalPixels = 100))
    }
}

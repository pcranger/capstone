package com.crosswise.crossing

import com.crosswise.core.Angles
import com.crosswise.core.BoxF
import com.crosswise.feedback.Cue
import com.crosswise.feedback.HapticPattern
import com.crosswise.feedback.Phrase
import com.crosswise.feedback.Priority
import com.crosswise.feedback.ToneKind
import com.crosswise.feedback.Verbosity
import com.crosswise.perception.FrameDetections
import com.crosswise.perception.ObjectCategory
import com.crosswise.sensors.OrientationSample
import com.crosswise.signal.SignalEvent
import com.crosswise.signal.SignalPhase
import com.crosswise.signal.SignalPhaseTracker
import com.crosswise.signal.SignalSnapshot
import com.crosswise.tracking.ObjectTracker
import com.crosswise.tracking.TrackGroup
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * IDLE: camera may run, nothing is announced.
 * SEARCHING: looking for a pedestrian signal; tilt/scan hints and aiming sonar.
 * WAITING: a signal is being tracked at the curb; phase changes are announced.
 * CROSSING: heading locked, veer guidance and more sensitive vehicle alerts.
 */
enum class AssistMode { IDLE, SEARCHING, WAITING, CROSSING }

enum class UserCommand { START_ASSIST, STOP_ASSIST, START_CROSSING, END_CROSSING, TOGGLE_CROSSING, REPEAT_STATUS }

data class EngineSettings(
    val aimSonar: Boolean = true,
    val veerGuidance: Boolean = true,
    val vehicleAlerts: Boolean = true,
    val autoDetectCrossing: Boolean = true,
    val verbosity: Verbosity = Verbosity.NORMAL,
)

data class CameraGeometry(val hfovDeg: Float, val vfovDeg: Float)

data class TrackView(
    val id: Int,
    val box: BoxF,
    val category: ObjectCategory,
    val confidence: Float,
    val isPrimarySignal: Boolean,
)

data class EngineSnapshot(
    val mode: AssistMode = AssistMode.IDLE,
    val signal: SignalSnapshot = SignalSnapshot(),
    val hazards: List<VehicleHazard> = emptyList(),
    val veer: VeerStatus? = null,
    val aimBearingDeg: Float? = null,
    val pitchDeg: Float? = null,
    val walking: Boolean = false,
    val tracks: List<TrackView> = emptyList(),
    val crossingElapsedMs: Long? = null,
)

class EngineOutput(val cues: List<Cue>, val snapshot: EngineSnapshot)

class CrossingEngine(settings: EngineSettings = EngineSettings()) {

    @Volatile
    var settings: EngineSettings = settings

    private val tracker = ObjectTracker()
    private val signal = SignalPhaseTracker()
    private val hazardMonitor = HazardMonitor()
    private val veer = VeerMonitor()
    private val aim = AimGuide()
    private val lastSpokenMs = HashMap<Phrase, Long>()

    var mode: AssistMode = AssistMode.IDLE
        private set

    private var orientation: OrientationSample? = null
    private val recentHeadings = ArrayDeque<OrientationSample>()
    private var lastFrameOrientation: OrientationSample? = null
    private var geometry = CameraGeometry(hfovDeg = 60f, vfovDeg = 45f)
    private var walking = false
    private var walkingSinceMs: Long? = null
    private var stillSinceMs: Long? = null
    private var crossingStartMs: Long? = null
    private var searchingSinceMs = 0L
    private var lastAnySignalSeenMs: Long? = null
    private var pitchLowSinceMs: Long? = null
    private var pitchHighSinceMs: Long? = null
    private var warnedWalkingOnDontWalk = false
    private val announcedHazards = HashMap<Int, Pair<HazardLevel, Long>>()
    private var hazards: List<VehicleHazard> = emptyList()
    private var veerStatus: VeerStatus? = null
    private var lastVeerState = VeerState.ON_COURSE
    private var lastVeerSpeechMs = 0L
    private var lastVeerToneMs = 0L
    private var aimBearing: Float? = null
    private var trackViews: List<TrackView> = emptyList()
    private var lastTimestampMs = 0L

    @get:Synchronized
    val snapshot: EngineSnapshot
        get() = EngineSnapshot(
            mode = mode,
            signal = signal.snapshot,
            hazards = hazards,
            veer = veerStatus,
            aimBearingDeg = aimBearing,
            pitchDeg = orientation?.pitchDeg,
            walking = walking,
            tracks = trackViews,
            crossingElapsedMs = crossingStartMs?.let { lastTimestampMs - it },
        )

    @Synchronized
    fun command(command: UserCommand, nowMs: Long): EngineOutput {
        lastTimestampMs = maxOf(lastTimestampMs, nowMs)
        val cues = ArrayList<Cue>()
        when (command) {
            UserCommand.START_ASSIST -> if (mode == AssistMode.IDLE) {
                val phase = signal.currentPhase
                mode = if (phase == SignalPhase.UNKNOWN) AssistMode.SEARCHING else AssistMode.WAITING
                searchingSinceMs = nowMs
                cues += Cue.Speak(Phrase.ASSIST_STARTED, Priority.HIGH)
                if (phase != SignalPhase.UNKNOWN) {
                    cues += signalCues(SignalEvent.Acquired(phase, signal.snapshot.trusted), nowMs, force = true)
                }
            }
            UserCommand.STOP_ASSIST -> if (mode != AssistMode.IDLE) {
                endCrossingInternal()
                mode = AssistMode.IDLE
                cues += Cue.Speak(Phrase.ASSIST_STOPPED, Priority.HIGH)
            }
            UserCommand.START_CROSSING -> startCrossing(nowMs, detected = false, cues)
            UserCommand.END_CROSSING -> if (mode == AssistMode.CROSSING) endCrossing(nowMs, cues)
            UserCommand.TOGGLE_CROSSING ->
                if (mode == AssistMode.CROSSING) endCrossing(nowMs, cues) else startCrossing(nowMs, detected = false, cues)
            UserCommand.REPEAT_STATUS -> if (mode != AssistMode.IDLE) cues += statusCues(nowMs)
        }
        return EngineOutput(cues, snapshot)
    }

    /** Call regularly (about 10 Hz) with the latest sensor state, independent of the camera frame rate. */
    @Synchronized
    fun onSensors(nowMs: Long, sample: OrientationSample?, isWalking: Boolean): EngineOutput {
        lastTimestampMs = maxOf(lastTimestampMs, nowMs)
        if (sample != null) {
            orientation = sample
            recentHeadings.addLast(sample)
            while (recentHeadings.isNotEmpty() && nowMs - recentHeadings.first().timestampMs > HEADING_AVERAGE_MS) {
                recentHeadings.removeFirst()
            }
        }
        updateWalking(nowMs, isWalking)
        val cues = ArrayList<Cue>()
        when (mode) {
            AssistMode.IDLE -> Unit
            AssistMode.CROSSING -> {
                crossingGuidance(nowMs, cues)
                val start = crossingStartMs ?: nowMs
                val still = stillSinceMs
                val arrived = nowMs - start >= 6_000 && still != null && nowMs - still >= 5_000
                if (arrived || nowMs - start >= 120_000) endCrossing(nowMs, cues)
            }
            AssistMode.SEARCHING, AssistMode.WAITING -> curbGuidance(nowMs, cues)
        }
        return EngineOutput(cues, snapshot)
    }

    @Synchronized
    fun onFrame(frame: FrameDetections, cameraGeometry: CameraGeometry): EngineOutput {
        val now = frame.timestampMs
        lastTimestampMs = maxOf(lastTimestampMs, now)
        geometry = cameraGeometry
        val cues = ArrayList<Cue>()

        var shiftX = 0f
        var shiftY = 0f
        val current = orientation
        val previous = lastFrameOrientation
        if (current != null && previous != null && geometry.hfovDeg > 1f && geometry.vfovDeg > 1f) {
            val dYaw = Angles.wrap180(current.headingDeg - previous.headingDeg)
            val dPitch = current.pitchDeg - previous.pitchDeg
            if (abs(dYaw) < 45f && abs(dPitch) < 45f) {
                shiftX = -dYaw / geometry.hfovDeg
                shiftY = dPitch / geometry.vfovDeg
            }
        }
        lastFrameOrientation = current

        val tracks = tracker.update(frame.detections, now, shiftX, shiftY)
        val events = signal.update(now, tracks, shiftX, shiftY)
        val signalSnapshot = signal.snapshot
        if (tracks.any { it.group == TrackGroup.SIGNAL && it.isSeenAt(now) }) lastAnySignalSeenMs = now

        for (event in events) {
            when (event) {
                is SignalEvent.Acquired, is SignalEvent.Changed ->
                    if (mode == AssistMode.SEARCHING) mode = AssistMode.WAITING
                is SignalEvent.Lost -> if (mode == AssistMode.WAITING) {
                    mode = AssistMode.SEARCHING
                    searchingSinceMs = now
                }
            }
            if (signalSnapshot.phase.isDontWalk) warnedWalkingOnDontWalk = false
            if (mode != AssistMode.IDLE) cues += signalCues(event, now, force = false)
        }

        val frameAspect = frame.frameWidth.toFloat() / frame.frameHeight.coerceAtLeast(1)
        hazards = if (settings.vehicleAlerts) {
            hazardMonitor.assess(tracks, now, frameAspect, crossing = mode == AssistMode.CROSSING)
        } else {
            emptyList()
        }
        if (mode != AssistMode.IDLE) cues += hazardCues(now)

        // Aiming sonar toward the signal (or crosswalk) while at the curb.
        aimBearing = null
        val primaryTrack = tracks.firstOrNull { it.id == signalSnapshot.primaryTrackId && now - it.lastSeenMs <= 300 }
        val signalTarget = primaryTrack ?: tracks
            .filter { it.group == TrackGroup.SIGNAL && it.hits >= 2 && it.isSeenAt(now) }
            .maxByOrNull { it.confidence }
        val target = signalTarget ?: tracks
            .filter { it.group == TrackGroup.CROSSWALK && it.hits >= 3 && it.isSeenAt(now) }
            .maxByOrNull { it.box.area }
        if (target != null) aimBearing = Angles.bearingFromImageX(target.box.centerX, geometry.hfovDeg)
        if (settings.aimSonar && (mode == AssistMode.SEARCHING || mode == AssistMode.WAITING)) {
            cues += aim.update(now, target?.id, aimBearing, sparse = mode == AssistMode.WAITING) {
                if (settings.verbosity == Verbosity.DETAILED) {
                    val phrase = if (target === signalTarget) Phrase.SIGNAL_CENTERED else Phrase.CROSSWALK_CENTERED
                    speak(cues, phrase, Priority.LOW, now)
                }
            }
        }

        trackViews = tracks.filter { now - it.lastSeenMs <= 300 }.map {
            TrackView(it.id, it.box, it.category, it.confidence, it.id == signalSnapshot.primaryTrackId)
        }
        return EngineOutput(cues, snapshot)
    }

    // ---------------------------------------------------------------------------------------------

    private fun updateWalking(nowMs: Long, isWalking: Boolean) {
        if (isWalking) {
            if (walkingSinceMs == null) walkingSinceMs = nowMs
            stillSinceMs = null
        } else {
            if (stillSinceMs == null) stillSinceMs = nowMs
            walkingSinceMs = null
        }
        walking = isWalking
    }

    private fun startCrossing(nowMs: Long, detected: Boolean, cues: MutableList<Cue>) {
        if (mode != AssistMode.SEARCHING && mode != AssistMode.WAITING) return
        mode = AssistMode.CROSSING
        crossingStartMs = nowMs
        stillSinceMs = null
        aim.reset()
        val heading = orientation
        if (heading != null && settings.veerGuidance) {
            // Average the last second: a single reading can sit at the extreme of walking sway.
            veer.lock(averageHeading() ?: heading.headingDeg, nowMs)
            lastVeerState = VeerState.ON_COURSE
            cues += Cue.Speak(if (detected) Phrase.CROSSING_DETECTED else Phrase.CROSSING_STARTED, Priority.HIGH)
        } else {
            cues += Cue.Speak(if (heading == null) Phrase.NO_HEADING_SENSOR else Phrase.CROSSING_STARTED, Priority.HIGH)
        }
    }

    private fun endCrossing(nowMs: Long, cues: MutableList<Cue>) {
        endCrossingInternal()
        mode = AssistMode.SEARCHING
        searchingSinceMs = nowMs
        // The next crossing starts with a different signal: do not carry the old phase over.
        signal.reset()
        tracker.clear()
        cues += Cue.Speak(Phrase.CROSSING_ENDED, Priority.NORMAL)
    }

    private fun endCrossingInternal() {
        veer.unlock()
        veerStatus = null
        crossingStartMs = null
        aim.reset()
    }

    private fun crossingGuidance(nowMs: Long, cues: MutableList<Cue>) {
        val sample = orientation ?: return
        if (!settings.veerGuidance) return
        val status = veer.update(sample.headingDeg, nowMs) ?: return
        veerStatus = status
        val changed = status.state != lastVeerState
        lastVeerState = status.state
        when (status.state) {
            VeerState.ON_COURSE -> if (changed) cues += Cue.Tone(ToneKind.CENTERED)
            VeerState.DRIFTED_RIGHT, VeerState.DRIFTED_LEFT -> {
                // Drifted right -> the correct direction is to the left, so the cue comes from the left.
                val towardLeft = status.state == VeerState.DRIFTED_RIGHT
                val pan = if (towardLeft) -1f else 1f
                if (changed || nowMs - lastVeerSpeechMs >= 4_000) {
                    lastVeerSpeechMs = nowMs
                    cues += Cue.Speak(if (towardLeft) Phrase.BEAR_LEFT else Phrase.BEAR_RIGHT, Priority.NORMAL)
                    cues += Cue.Haptic(if (towardLeft) HapticPattern.VEER_LEFT else HapticPattern.VEER_RIGHT)
                }
                if (changed || nowMs - lastVeerToneMs >= 900) {
                    lastVeerToneMs = nowMs
                    cues += Cue.Tone(ToneKind.VEER, pan)
                }
            }
        }
    }

    private fun curbGuidance(nowMs: Long, cues: MutableList<Cue>) {
        val phase = signal.currentPhase
        val walkingFor = walkingSinceMs?.let { nowMs - it } ?: 0L
        // The walking detector itself needs ~1.5 s of steps, so keep this extra delay short.
        if (settings.autoDetectCrossing && walkingFor >= 1_000) {
            // Only when roughly facing the signal, so walking along the curb does not lock a wrong heading.
            if (phase.isWalk && abs(aimBearing ?: 0f) <= 30f) {
                startCrossing(nowMs, detected = true, cues)
                return
            }
            if (phase.isDontWalk && !warnedWalkingOnDontWalk && abs(aimBearing ?: 90f) <= 25f) {
                warnedWalkingOnDontWalk = true
                cues += Cue.Speak(Phrase.WALKING_ON_DONT_WALK, Priority.HIGH)
            }
        }
        if (mode != AssistMode.SEARCHING || settings.verbosity == Verbosity.MINIMAL) return

        val pitch = orientation?.pitchDeg
        if (pitch != null) {
            pitchLowSinceMs = if (pitch < -35f) pitchLowSinceMs ?: nowMs else null
            pitchHighSinceMs = if (pitch > 50f) pitchHighSinceMs ?: nowMs else null
            if (pitchLowSinceMs?.let { nowMs - it >= 1_500 } == true) {
                speak(cues, Phrase.TILT_UP, Priority.NORMAL, nowMs, minIntervalMs = 6_000)
            } else if (pitchHighSinceMs?.let { nowMs - it >= 1_500 } == true) {
                speak(cues, Phrase.TILT_DOWN, Priority.NORMAL, nowMs, minIntervalMs = 6_000)
            }
        }
        val noSignalFor = nowMs - maxOf(searchingSinceMs, lastAnySignalSeenMs ?: 0L)
        if (noSignalFor >= 10_000) speak(cues, Phrase.SEARCH_HINT, Priority.LOW, nowMs, minIntervalMs = 20_000)
    }

    private fun signalCues(event: SignalEvent, nowMs: Long, force: Boolean): List<Cue> {
        val cues = ArrayList<Cue>(3)
        fun dontWalk(trusted: Boolean) {
            if (trusted) {
                cues += Cue.Speak(Phrase.DONT_WALK, Priority.HIGH)
                cues += Cue.Haptic(HapticPattern.DONT_WALK)
                cues += Cue.Tone(ToneKind.STOP)
            } else {
                cues += Cue.Speak(Phrase.LIGHT_RED_UNVERIFIED, Priority.HIGH)
            }
        }
        fun walkOfUnknownAge(trusted: Boolean) {
            if (trusted) {
                cues += Cue.Speak(Phrase.WALK_ALREADY_ON, Priority.HIGH)
                cues += Cue.Haptic(HapticPattern.WALK)
            } else {
                cues += Cue.Speak(Phrase.LIGHT_GREEN_UNVERIFIED, Priority.HIGH)
            }
        }
        fun flashing(phrase: Phrase) {
            cues += Cue.Speak(phrase, Priority.HIGH)
            cues += Cue.Haptic(HapticPattern.FLASHING)
        }
        when (event) {
            is SignalEvent.Acquired -> when (event.phase) {
                SignalPhase.WALK -> walkOfUnknownAge(event.trusted)
                SignalPhase.WALK_FLASHING -> flashing(Phrase.WALK_FLASHING)
                SignalPhase.DONT_WALK -> dontWalk(event.trusted)
                SignalPhase.DONT_WALK_FLASHING -> flashing(Phrase.DONT_WALK_FLASHING)
                SignalPhase.UNKNOWN -> Unit
            }
            is SignalEvent.Changed -> when (event.to) {
                SignalPhase.WALK -> when {
                    !event.trusted -> walkOfUnknownAge(trusted = false)
                    event.freshWalk -> {
                        cues += Cue.Speak(Phrase.WALK_STARTED, Priority.HIGH)
                        cues += Cue.Haptic(HapticPattern.WALK)
                        cues += Cue.Tone(ToneKind.WALK_CHIME)
                    }
                    else -> walkOfUnknownAge(trusted = true)
                }
                SignalPhase.WALK_FLASHING -> flashing(Phrase.WALK_FLASHING)
                SignalPhase.DONT_WALK -> if (mode == AssistMode.CROSSING && event.from.isWalk) {
                    cues += Cue.Speak(Phrase.SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING, Priority.HIGH)
                    cues += Cue.Haptic(HapticPattern.DONT_WALK)
                } else {
                    dontWalk(event.trusted)
                }
                SignalPhase.DONT_WALK_FLASHING -> flashing(Phrase.DONT_WALK_FLASHING)
                SignalPhase.UNKNOWN -> Unit
            }
            is SignalEvent.Lost -> {
                // Mid-crossing the far signal naturally leaves the view; don't distract the user.
                if (mode == AssistMode.CROSSING && !force) return cues
                if (settings.verbosity == Verbosity.MINIMAL) {
                    cues += Cue.Haptic(HapticPattern.LOST)
                    return cues
                }
                cues += Cue.Speak(Phrase.SIGNAL_LOST, Priority.NORMAL)
                cues += Cue.Haptic(HapticPattern.LOST)
                cues += Cue.Tone(ToneKind.LOST)
                val box = event.lastBox
                val hint = when {
                    box == null -> null
                    box.centerY < 0.15f -> Phrase.TILT_UP
                    box.centerY > 0.85f -> Phrase.TILT_DOWN
                    box.centerX < 0.12f -> Phrase.TURN_LEFT_SLIGHTLY
                    box.centerX > 0.88f -> Phrase.TURN_RIGHT_SLIGHTLY
                    else -> null
                }
                if (hint != null) speak(cues, hint, Priority.NORMAL, nowMs, minIntervalMs = 3_000)
            }
        }
        return cues
    }

    private fun hazardCues(nowMs: Long): List<Cue> {
        announcedHazards.entries.removeAll { (id, value) ->
            hazards.none { it.trackId == id } && nowMs - value.second > 5_000
        }
        // One announcement per frame: the most urgent hazard that is new, escalated, or due for a repeat.
        val hazard = hazards.firstOrNull { h ->
            val previous = announcedHazards[h.trackId]
            previous == null ||
                (h.level == HazardLevel.CRITICAL && previous.first == HazardLevel.WARNING) ||
                nowMs - previous.second >= 3_000
        } ?: return emptyList()
        announcedHazards[hazard.trackId] = hazard.level to nowMs
        val critical = hazard.level == HazardLevel.CRITICAL
        val phrase = when (hazard.side) {
            Side.LEFT -> if (critical) Phrase.VEHICLE_CLOSE_LEFT else Phrase.VEHICLE_LEFT
            Side.AHEAD -> if (critical) Phrase.VEHICLE_CLOSE_AHEAD else Phrase.VEHICLE_AHEAD
            Side.RIGHT -> if (critical) Phrase.VEHICLE_CLOSE_RIGHT else Phrase.VEHICLE_RIGHT
        }
        val pan = when (hazard.side) {
            Side.LEFT -> -1f
            Side.AHEAD -> 0f
            Side.RIGHT -> 1f
        }
        return listOf(
            Cue.Speak(phrase, if (critical) Priority.CRITICAL else Priority.HIGH),
            Cue.Haptic(if (critical) HapticPattern.CRITICAL else HapticPattern.ALERT),
            Cue.Tone(if (critical) ToneKind.CRITICAL else ToneKind.ALERT, pan),
        )
    }

    private fun statusCues(nowMs: Long): List<Cue> {
        val cues = ArrayList<Cue>()
        val s = signal.snapshot
        val signalPhrase = when {
            s.phase == SignalPhase.UNKNOWN -> Cue.Speak(Phrase.STATUS_NO_SIGNAL, Priority.HIGH)
            !s.trusted && s.phase.isWalk -> Cue.Speak(Phrase.LIGHT_GREEN_UNVERIFIED, Priority.HIGH)
            !s.trusted -> Cue.Speak(Phrase.LIGHT_RED_UNVERIFIED, Priority.HIGH)
            s.phase == SignalPhase.WALK && s.freshWalk && s.phaseOnsetMs != null -> Cue.Speak(
                Phrase.STATUS_WALK_ELAPSED, Priority.HIGH, listOf(((nowMs - s.phaseOnsetMs) / 1000L).toInt()),
            )
            s.phase == SignalPhase.WALK -> Cue.Speak(Phrase.STATUS_WALK_UNKNOWN_AGE, Priority.HIGH)
            s.phase == SignalPhase.WALK_FLASHING -> Cue.Speak(Phrase.STATUS_WALK_FLASHING, Priority.HIGH)
            else -> Cue.Speak(Phrase.STATUS_DONT_WALK, Priority.HIGH)
        }
        cues += signalPhrase
        cues += if (hazards.isEmpty()) {
            Cue.Speak(Phrase.STATUS_NO_VEHICLES, Priority.HIGH)
        } else {
            Cue.Speak(Phrase.STATUS_VEHICLES, Priority.HIGH, listOf(hazards.size))
        }
        veerStatus?.let { v ->
            cues += Cue.Speak(
                when (v.state) {
                    VeerState.ON_COURSE -> Phrase.STATUS_ON_COURSE
                    VeerState.DRIFTED_RIGHT -> Phrase.STATUS_OFF_COURSE_RIGHT
                    VeerState.DRIFTED_LEFT -> Phrase.STATUS_OFF_COURSE_LEFT
                },
                Priority.HIGH,
            )
        }
        return cues
    }

    /** Circular mean of the headings from the last [HEADING_AVERAGE_MS]. */
    private fun averageHeading(): Float? {
        if (recentHeadings.isEmpty()) return null
        var sinSum = 0.0
        var cosSum = 0.0
        for (s in recentHeadings) {
            val rad = Angles.toRad(s.headingDeg)
            sinSum += sin(rad)
            cosSum += cos(rad)
        }
        return Angles.wrap360(Angles.toDeg(atan2(sinSum, cosSum)))
    }

    private fun speak(
        cues: MutableList<Cue>,
        phrase: Phrase,
        priority: Priority,
        nowMs: Long,
        minIntervalMs: Long = 4_000,
    ) {
        val last = lastSpokenMs[phrase]
        if (last != null && nowMs - last < minIntervalMs) return
        lastSpokenMs[phrase] = nowMs
        cues += Cue.Speak(phrase, priority)
    }

    private companion object {
        const val HEADING_AVERAGE_MS = 1_000L
    }
}

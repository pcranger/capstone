package com.crosswise.feedback

/**
 * Everything the app can say or play. The engine emits [Cue]s; the Android layer turns them into
 * speech (localized via string resources), synthesized tones and vibration patterns.
 */
enum class Priority { LOW, NORMAL, HIGH, CRITICAL }

enum class Phrase {
    ASSIST_STARTED,
    ASSIST_STOPPED,
    MODEL_MISSING,
    BASELINE_MODEL,
    SEARCH_HINT,
    TILT_UP,
    TILT_DOWN,
    TURN_LEFT_SLIGHTLY,
    TURN_RIGHT_SLIGHTLY,
    SIGNAL_CENTERED,
    CROSSWALK_CENTERED,

    WALK_STARTED,
    WALK_ALREADY_ON,
    WALK_FLASHING,
    DONT_WALK,
    DONT_WALK_FLASHING,
    SIGNAL_LOST,
    LIGHT_GREEN_UNVERIFIED,
    LIGHT_RED_UNVERIFIED,
    SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING,
    WALKING_ON_DONT_WALK,

    CROSSING_STARTED,
    CROSSING_DETECTED,
    CROSSING_ENDED,
    NO_HEADING_SENSOR,
    BEAR_LEFT,
    BEAR_RIGHT,

    VEHICLE_LEFT,
    VEHICLE_AHEAD,
    VEHICLE_RIGHT,
    VEHICLE_CLOSE_LEFT,
    VEHICLE_CLOSE_AHEAD,
    VEHICLE_CLOSE_RIGHT,

    STATUS_NO_SIGNAL,
    STATUS_WALK_ELAPSED,
    STATUS_WALK_UNKNOWN_AGE,
    STATUS_WALK_FLASHING,
    STATUS_DONT_WALK,
    STATUS_NO_VEHICLES,
    STATUS_VEHICLES,
    STATUS_ON_COURSE,
    STATUS_OFF_COURSE_LEFT,
    STATUS_OFF_COURSE_RIGHT,
}

enum class ToneKind { SONAR, CENTERED, WALK_CHIME, STOP, ALERT, CRITICAL, VEER, LOST }

enum class HapticPattern { WALK, DONT_WALK, FLASHING, LOST, CENTERED_TICK, VEER_LEFT, VEER_RIGHT, ALERT, CRITICAL }

sealed interface Cue {
    data class Speak(val phrase: Phrase, val priority: Priority, val args: List<Any> = emptyList()) : Cue

    /** [pan] from -1 (left ear) to +1 (right ear): the sound comes from the direction to attend to. */
    data class Tone(val kind: ToneKind, val pan: Float = 0f) : Cue

    data class Haptic(val pattern: HapticPattern) : Cue
}

enum class Verbosity { MINIMAL, NORMAL, DETAILED }

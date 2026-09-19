package com.crosswise.feedback

import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import com.crosswise.R

sealed interface PhraseResource {
    data class Text(@param:StringRes val id: Int) : PhraseResource

    /** Quantity string; the first argument is the count. */
    data class Plural(@param:PluralsRes val id: Int) : PhraseResource
}

/** Maps engine phrases to localizable resources. */
fun Phrase.resource(): PhraseResource = when (this) {
    Phrase.ASSIST_STARTED -> PhraseResource.Text(R.string.say_assist_started)
    Phrase.ASSIST_STOPPED -> PhraseResource.Text(R.string.say_assist_stopped)
    Phrase.MODEL_MISSING -> PhraseResource.Text(R.string.say_model_missing)
    Phrase.BASELINE_MODEL -> PhraseResource.Text(R.string.say_baseline_model)
    Phrase.SEARCH_HINT -> PhraseResource.Text(R.string.say_search_hint)
    Phrase.TILT_UP -> PhraseResource.Text(R.string.say_tilt_up)
    Phrase.TILT_DOWN -> PhraseResource.Text(R.string.say_tilt_down)
    Phrase.TURN_LEFT_SLIGHTLY -> PhraseResource.Text(R.string.say_turn_left_slightly)
    Phrase.TURN_RIGHT_SLIGHTLY -> PhraseResource.Text(R.string.say_turn_right_slightly)
    Phrase.SIGNAL_CENTERED -> PhraseResource.Text(R.string.say_signal_centered)
    Phrase.CROSSWALK_CENTERED -> PhraseResource.Text(R.string.say_crosswalk_centered)
    Phrase.WALK_STARTED -> PhraseResource.Text(R.string.say_walk_started)
    Phrase.WALK_ALREADY_ON -> PhraseResource.Text(R.string.say_walk_already_on)
    Phrase.WALK_FLASHING -> PhraseResource.Text(R.string.say_walk_flashing)
    Phrase.DONT_WALK -> PhraseResource.Text(R.string.say_dont_walk)
    Phrase.DONT_WALK_FLASHING -> PhraseResource.Text(R.string.say_dont_walk_flashing)
    Phrase.SIGNAL_LOST -> PhraseResource.Text(R.string.say_signal_lost)
    Phrase.LIGHT_GREEN_UNVERIFIED -> PhraseResource.Text(R.string.say_light_green_unverified)
    Phrase.LIGHT_RED_UNVERIFIED -> PhraseResource.Text(R.string.say_light_red_unverified)
    Phrase.SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING -> PhraseResource.Text(R.string.say_signal_changed_dont_walk_while_crossing)
    Phrase.WALKING_ON_DONT_WALK -> PhraseResource.Text(R.string.say_walking_on_dont_walk)
    Phrase.CROSSING_STARTED -> PhraseResource.Text(R.string.say_crossing_started)
    Phrase.CROSSING_DETECTED -> PhraseResource.Text(R.string.say_crossing_detected)
    Phrase.CROSSING_ENDED -> PhraseResource.Text(R.string.say_crossing_ended)
    Phrase.NO_HEADING_SENSOR -> PhraseResource.Text(R.string.say_no_heading_sensor)
    Phrase.BEAR_LEFT -> PhraseResource.Text(R.string.say_bear_left)
    Phrase.BEAR_RIGHT -> PhraseResource.Text(R.string.say_bear_right)
    Phrase.VEHICLE_LEFT -> PhraseResource.Text(R.string.say_vehicle_left)
    Phrase.VEHICLE_AHEAD -> PhraseResource.Text(R.string.say_vehicle_ahead)
    Phrase.VEHICLE_RIGHT -> PhraseResource.Text(R.string.say_vehicle_right)
    Phrase.VEHICLE_CLOSE_LEFT -> PhraseResource.Text(R.string.say_vehicle_close_left)
    Phrase.VEHICLE_CLOSE_AHEAD -> PhraseResource.Text(R.string.say_vehicle_close_ahead)
    Phrase.VEHICLE_CLOSE_RIGHT -> PhraseResource.Text(R.string.say_vehicle_close_right)
    Phrase.STATUS_NO_SIGNAL -> PhraseResource.Text(R.string.say_status_no_signal)
    Phrase.STATUS_WALK_ELAPSED -> PhraseResource.Plural(R.plurals.say_status_walk_elapsed)
    Phrase.STATUS_WALK_UNKNOWN_AGE -> PhraseResource.Text(R.string.say_status_walk_unknown_age)
    Phrase.STATUS_WALK_FLASHING -> PhraseResource.Text(R.string.say_status_walk_flashing)
    Phrase.STATUS_DONT_WALK -> PhraseResource.Text(R.string.say_status_dont_walk)
    Phrase.STATUS_NO_VEHICLES -> PhraseResource.Text(R.string.say_status_no_vehicles)
    Phrase.STATUS_VEHICLES -> PhraseResource.Plural(R.plurals.say_status_vehicles)
    Phrase.STATUS_ON_COURSE -> PhraseResource.Text(R.string.say_status_on_course)
    Phrase.STATUS_OFF_COURSE_LEFT -> PhraseResource.Text(R.string.say_status_off_course_left)
    Phrase.STATUS_OFF_COURSE_RIGHT -> PhraseResource.Text(R.string.say_status_off_course_right)
}

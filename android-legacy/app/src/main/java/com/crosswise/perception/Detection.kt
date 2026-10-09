package com.crosswise.perception

import com.crosswise.core.BoxF

/** What a detected object means for the crossing task, independent of the model's own label names. */
enum class ObjectCategory(val isVehicle: Boolean = false, val isSignal: Boolean = false) {
    PED_DONT_WALK(isSignal = true),
    PED_WALK(isSignal = true),
    /** A light we can see but whose meaning the model does not know (e.g. COCO "traffic light"). */
    TRAFFIC_LIGHT(isSignal = true),
    PED_COUNTDOWN,
    CROSSWALK,
    PERSON,
    BICYCLE(isVehicle = true),
    MOTORCYCLE(isVehicle = true),
    CAR(isVehicle = true),
    BUS(isVehicle = true),
    TRUCK(isVehicle = true),
    OTHER,
}

/** Lit color of a generic traffic light, estimated from pixels when the model does not know the phase. */
enum class SignalColor { RED, GREEN }

data class Detection(
    val box: BoxF,
    val classIndex: Int,
    val label: String,
    val score: Float,
    val category: ObjectCategory,
    val colorHint: SignalColor? = null,
)

/** Output of one detector call on one camera frame. */
data class FrameDetections(
    val timestampMs: Long,
    val detections: List<Detection>,
    /** Size of the upright frame the normalized boxes refer to. */
    val frameWidth: Int,
    val frameHeight: Int,
    val inferenceMs: Long,
)

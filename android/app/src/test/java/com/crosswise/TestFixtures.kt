package com.crosswise

import com.crosswise.core.BoxF
import com.crosswise.perception.Detection
import com.crosswise.perception.FrameDetections
import com.crosswise.perception.ObjectCategory
import com.crosswise.perception.SignalColor

object TestFixtures {
    val SIGNAL_BOX = BoxF(0.48f, 0.20f, 0.52f, 0.28f)

    fun det(
        category: ObjectCategory,
        box: BoxF = SIGNAL_BOX,
        score: Float = 0.8f,
        colorHint: SignalColor? = null,
    ) = Detection(box, category.ordinal, category.name.lowercase(), score, category, colorHint)

    fun frame(t: Long, vararg detections: Detection) =
        FrameDetections(t, detections.toList(), frameWidth = 720, frameHeight = 1280, inferenceMs = 30)
}

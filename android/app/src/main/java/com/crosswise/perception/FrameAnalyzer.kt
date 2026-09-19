package com.crosswise.perception

import android.graphics.Bitmap

/**
 * What the camera pipeline talks to. Two implementations: [LiteRtDetector] for box models and
 * [SegmentationDetector] for YOLO-seg models, which also return a mask for the overlay.
 */
interface FrameAnalyzer : AutoCloseable {
    val info: ModelInfo
    var options: DetectorOptions

    /** Analyses one upright frame. Not thread-safe: call from a single analysis thread. */
    fun detect(frame: Bitmap, timestampMs: Long): FrameDetections

    /** The latest segmentation mask, or null for a plain detector. */
    val mask: Bitmap? get() = null
}

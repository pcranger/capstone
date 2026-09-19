package com.crosswise.perception

import com.crosswise.core.BoxF
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Letterbox geometry used when resizing an upright camera frame into the square model input
 * (same convention as Ultralytics: keep aspect ratio, pad evenly with gray).
 */
data class Letterbox(val srcWidth: Int, val srcHeight: Int, val dstWidth: Int, val dstHeight: Int) {
    val scale: Float = min(dstWidth / srcWidth.toFloat(), dstHeight / srcHeight.toFloat())
    val scaledWidth: Int = (srcWidth * scale).roundToInt()
    val scaledHeight: Int = (srcHeight * scale).roundToInt()
    val padX: Float = (dstWidth - scaledWidth) / 2f
    val padY: Float = (dstHeight - scaledHeight) / 2f

    /** Model-input pixel x -> normalized source x. */
    fun toSourceX(x: Float): Float = ((x - padX) / scale) / srcWidth
    fun toSourceY(y: Float): Float = ((y - padY) / scale) / srcHeight
}

/** How the detection head of a LiteRT YOLO export is laid out. */
enum class YoloOutputFormat {
    /** [1, 4 + nc, anchors]: cx, cy, w, h then class scores (Ultralytics raw export, channels first). */
    RAW_CHANNELS_FIRST,
    /** [1, anchors, 4 + nc]: same content, channels last (some third-party exports). */
    RAW_CHANNELS_LAST,
    /** [1, maxDet, 6]: x1, y1, x2, y2, score, class (YOLO26 / YOLOv10 NMS-free export). */
    END_TO_END,
}

object YoloDecoder {

    /** Number of anchor points a YOLO head with strides 8/16/32 produces for this input size. */
    fun expectedAnchors(inputWidth: Int, inputHeight: Int): Int =
        intArrayOf(8, 16, 32).sumOf { s -> (inputWidth / s) * (inputHeight / s) }

    fun inferFormat(
        outputShape: IntArray,
        inputWidth: Int,
        inputHeight: Int,
        numClasses: Int?,
        end2endHint: Boolean?,
    ): YoloOutputFormat {
        require(outputShape.size == 3) { "Expected a 3D detection output, got ${outputShape.contentToString()}" }
        val a = outputShape[1]
        val b = outputShape[2]
        if (end2endHint == true && b == 6) return YoloOutputFormat.END_TO_END
        val anchors = expectedAnchors(inputWidth, inputHeight)
        if (end2endHint == null && b == 6 && a != anchors) return YoloOutputFormat.END_TO_END
        if (numClasses != null) {
            if (a == 4 + numClasses) return YoloOutputFormat.RAW_CHANNELS_FIRST
            if (b == 4 + numClasses) return YoloOutputFormat.RAW_CHANNELS_LAST
        }
        return if (a < b) YoloOutputFormat.RAW_CHANNELS_FIRST else YoloOutputFormat.RAW_CHANNELS_LAST
    }

    /**
     * Decodes one output tensor into detections with boxes in normalized *source frame* coordinates.
     *
     * Coordinate units are auto-detected: Ultralytics LiteRT raw exports are normalized to the input
     * size (0..1) while litert-torch end-to-end exports are in input pixels.
     */
    fun decode(
        output: FloatArray,
        outputShape: IntArray,
        format: YoloOutputFormat,
        letterbox: Letterbox,
        labels: List<String>,
        categories: List<ObjectCategory>,
        scoreThreshold: Float,
        iouThreshold: Float = 0.5f,
        maxDetections: Int = 100,
    ): List<Detection> {
        val candidates = when (format) {
            YoloOutputFormat.END_TO_END -> decodeEndToEnd(output, outputShape, letterbox, scoreThreshold)
            else -> decodeRaw(output, outputShape, format, letterbox, scoreThreshold)
        }
        val kept = if (format == YoloOutputFormat.END_TO_END) candidates else nms(candidates, iouThreshold)
        return kept.sortedByDescending { it.score }.take(maxDetections).map { c ->
            Detection(
                box = c.box,
                classIndex = c.classIndex,
                label = labels.getOrElse(c.classIndex) { "class_${c.classIndex}" },
                score = c.score,
                category = categories.getOrElse(c.classIndex) { ObjectCategory.OTHER },
            )
        }
    }

    internal data class Candidate(val box: BoxF, val classIndex: Int, val score: Float)

    private fun decodeRaw(
        out: FloatArray,
        shape: IntArray,
        format: YoloOutputFormat,
        lb: Letterbox,
        threshold: Float,
    ): List<Candidate> {
        val channelsFirst = format == YoloOutputFormat.RAW_CHANNELS_FIRST
        val channels = if (channelsFirst) shape[1] else shape[2]
        val anchors = if (channelsFirst) shape[2] else shape[1]
        val numClasses = channels - 4
        if (numClasses <= 0) return emptyList()
        fun at(channel: Int, anchor: Int): Float =
            if (channelsFirst) out[channel * anchors + anchor] else out[anchor * channels + channel]

        // Decide units once: normalized exports never exceed ~1.5 in any coordinate.
        var maxCoord = 0f
        for (i in 0 until min(anchors, 512)) maxCoord = max(maxCoord, max(at(0, i), at(1, i)))
        val unitScaleX = if (maxCoord <= 2f) lb.dstWidth.toFloat() else 1f
        val unitScaleY = if (maxCoord <= 2f) lb.dstHeight.toFloat() else 1f

        val result = ArrayList<Candidate>()
        for (i in 0 until anchors) {
            var best = -1
            var bestScore = threshold
            for (c in 0 until numClasses) {
                val s = at(4 + c, i)
                if (s > bestScore) {
                    bestScore = s
                    best = c
                }
            }
            if (best < 0) continue
            val cx = at(0, i) * unitScaleX
            val cy = at(1, i) * unitScaleY
            val w = at(2, i) * unitScaleX
            val h = at(3, i) * unitScaleY
            val box = BoxF(
                lb.toSourceX(cx - w / 2f), lb.toSourceY(cy - h / 2f),
                lb.toSourceX(cx + w / 2f), lb.toSourceY(cy + h / 2f),
            ).clamp01()
            if (box.area > 0f) result += Candidate(box, best, bestScore)
        }
        return result
    }

    private fun decodeEndToEnd(out: FloatArray, shape: IntArray, lb: Letterbox, threshold: Float): List<Candidate> {
        val rows = shape[1]
        val cols = shape[2]
        if (cols < 6) return emptyList()
        var maxCoord = 0f
        for (r in 0 until rows) {
            if (out[r * cols + 4] <= 0f) continue
            for (k in 0 until 4) maxCoord = max(maxCoord, out[r * cols + k])
        }
        val sx = if (maxCoord <= 2f) lb.dstWidth.toFloat() else 1f
        val sy = if (maxCoord <= 2f) lb.dstHeight.toFloat() else 1f
        val result = ArrayList<Candidate>()
        for (r in 0 until rows) {
            val base = r * cols
            val score = out[base + 4]
            if (score < threshold) continue
            val box = BoxF(
                lb.toSourceX(out[base] * sx), lb.toSourceY(out[base + 1] * sy),
                lb.toSourceX(out[base + 2] * sx), lb.toSourceY(out[base + 3] * sy),
            ).clamp01()
            if (box.area > 0f) result += Candidate(box, out[base + 5].roundToInt(), score)
        }
        return result
    }

    /** Per-class greedy non-maximum suppression. */
    internal fun nms(candidates: List<Candidate>, iouThreshold: Float): List<Candidate> {
        val kept = ArrayList<Candidate>()
        candidates.groupBy { it.classIndex }.values.forEach { group ->
            val sorted = group.sortedByDescending { it.score }.toMutableList()
            while (sorted.isNotEmpty()) {
                val best = sorted.removeAt(0)
                kept += best
                sorted.removeAll { it.box.iou(best.box) > iouThreshold }
            }
        }
        return kept
    }
}

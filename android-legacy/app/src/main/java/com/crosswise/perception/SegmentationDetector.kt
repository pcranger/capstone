package com.crosswise.perception

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.os.SystemClock
import androidx.core.graphics.createBitmap
import com.crosswise.core.BoxF
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Runs a YOLO **segmentation** model and paints its masks.
 *
 * Ported from `TrueSightSegmenter` in the AN-S3 project (UOW research), keeping its class list, palette and mask
 * maths so a model trained there looks the same here. Two differences, both to fit this app:
 *
 *  * the boxes the segmenter already computes are mapped onto CrossWise categories, so vehicle and person warnings
 *    keep working while a segmentation model is selected instead of the app going quiet;
 *  * the mask is produced at proto resolution and scaled by the UI, not per frame at full size.
 *
 * A segmentation model has no pedestrian-signal *state*, so the phase logic still reports an unverified signal at
 * best — that is a property of the model, not of this class.
 */
class SegmentationDetector private constructor(
    private val interpreter: Interpreter,
    override val info: ModelInfo,
    @Volatile override var options: DetectorOptions,
    private val featureCount: Int,
    private val anchorCount: Int,
    private val maskHeight: Int,
    private val maskWidth: Int,
    private val maskChannels: Int,
) : FrameAnalyzer {

    private val inputBitmap = createBitmap(info.inputWidth, info.inputHeight)
    private val canvas = Canvas(inputBitmap)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val matrix = Matrix()
    private val pixels = IntArray(info.inputWidth * info.inputHeight)
    private val inputBuffer = ByteBuffer
        .allocateDirect(4 * info.inputWidth * info.inputHeight * 3)
        .order(ByteOrder.nativeOrder())

    private val output0 = Array(1) { Array(featureCount) { FloatArray(anchorCount) } }
    private val output1 = Array(1) { Array(maskHeight) { Array(maskWidth) { FloatArray(maskChannels) } } }

    @Volatile
    override var mask: Bitmap? = null
        private set

    override fun detect(frame: Bitmap, timestampMs: Long): FrameDetections {
        val start = SystemClock.elapsedRealtime()
        // The segmenter was trained on a plain resize, not a letterbox, so keep that geometry: boxes come back in
        // 0..1 of the whole frame either way.
        matrix.reset()
        matrix.postScale(info.inputWidth / frame.width.toFloat(), info.inputHeight / frame.height.toFloat())
        canvas.drawBitmap(frame, matrix, paint)
        inputBitmap.getPixels(pixels, 0, info.inputWidth, 0, 0, info.inputWidth, info.inputHeight)

        inputBuffer.rewind()
        for (p in pixels) {
            inputBuffer.putFloat(((p shr 16) and 0xFF) / 255f)
            inputBuffer.putFloat(((p shr 8) and 0xFF) / 255f)
            inputBuffer.putFloat((p and 0xFF) / 255f)
        }
        inputBuffer.rewind()
        interpreter.runForMultipleInputsOutputs(arrayOf<Any>(inputBuffer), mapOf<Int, Any>(0 to output0, 1 to output1))

        val found = postProcess(output0[0])
        mask = if (found.isEmpty()) null else paintMask(found)

        val detections = found.map { d ->
            Detection(
                box = d.box,
                classIndex = d.cls,
                label = info.labels.getOrElse(d.cls) { "class_${d.cls}" },
                score = d.score,
                category = SegClasses.categoryFor(info.labels.getOrElse(d.cls) { "class_${d.cls}" }),
            )
        }
        return FrameDetections(
            timestampMs = timestampMs,
            detections = detections,
            frameWidth = frame.width,
            frameHeight = frame.height,
            inferenceMs = SystemClock.elapsedRealtime() - start,
        )
    }

    private class Raw(val box: BoxF, val cls: Int, val score: Float, val coeffs: FloatArray)

    private fun postProcess(feature: Array<FloatArray>): List<Raw> {
        val classes = featureCount - BOX_FEATURES - MASK_COEFFS
        val candidates = ArrayList<Raw>()
        for (anchor in 0 until anchorCount) {
            var best = 0f
            var bestClass = 0
            for (c in 0 until classes) {
                val score = feature[BOX_FEATURES + c][anchor]
                if (score > best) {
                    best = score
                    bestClass = c
                }
            }
            if (best < options.scoreThreshold) continue

            val cx = feature[0][anchor]
            val cy = feature[1][anchor]
            val w = feature[2][anchor]
            val h = feature[3][anchor]
            val coeffs = FloatArray(MASK_COEFFS) { feature[BOX_FEATURES + classes + it][anchor] }
            candidates.add(
                Raw(BoxF(cx - w / 2f, cy - h / 2f, cx + w / 2f, cy + h / 2f), bestClass, best, coeffs),
            )
        }

        // Per-class NMS, exactly as the source project does it.
        val kept = ArrayList<Raw>()
        for (cls in 0 until classes) {
            val sameClass = candidates.filter { it.cls == cls }.sortedByDescending { it.score }
            val used = BooleanArray(sameClass.size)
            for (i in sameClass.indices) {
                if (used[i]) continue
                kept.add(sameClass[i])
                for (j in i + 1 until sameClass.size) {
                    if (!used[j] && sameClass[i].box.iou(sameClass[j].box) > options.iouThreshold) used[j] = true
                }
            }
        }
        return kept.sortedByDescending { it.score }.take(MAX_ITEMS)
    }

    /** One ARGB bitmap at proto resolution; the overlay scales it to the preview. */
    private fun paintMask(detections: List<Raw>): Bitmap {
        val protos = output1[0]
        val out = IntArray(maskWidth * maskHeight)
        for (d in detections) {
            val color = SegClasses.COLORS.getOrElse(d.cls) { Color.WHITE }
            val left = (d.box.left.coerceIn(0f, 1f) * maskWidth).toInt()
            val top = (d.box.top.coerceIn(0f, 1f) * maskHeight).toInt()
            val right = (d.box.right.coerceIn(0f, 1f) * maskWidth).toInt()
            val bottom = (d.box.bottom.coerceIn(0f, 1f) * maskHeight).toInt()
            for (y in max(0, top) until min(maskHeight, bottom)) {
                val row = protos[y]
                for (x in max(0, left) until min(maskWidth, right)) {
                    val cell = row[x]
                    var value = 0f
                    for (c in 0 until MASK_COEFFS) value += d.coeffs[c] * cell[c]
                    val alpha = alphaOf(1f / (1f + exp(-value)))
                    if (alpha > 0) {
                        out[y * maskWidth + x] =
                            Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
                    }
                }
            }
        }
        return createBitmap(maskWidth, maskHeight).apply {
            setPixels(out, 0, maskWidth, 0, 0, maskWidth, maskHeight)
        }
    }

    private fun alphaOf(probability: Float): Int {
        val ramp = ((probability - MASK_THRESHOLD + SOFT_EDGE) / (2f * SOFT_EDGE)).coerceIn(0f, 1f)
        return (ramp * MAX_ALPHA).roundToInt()
    }

    override fun close() {
        interpreter.close()
        inputBitmap.recycle()
        mask = null
    }

    companion object {
        private const val BOX_FEATURES = 4
        private const val MASK_COEFFS = 32
        private const val MAX_ITEMS = 30
        private const val MASK_THRESHOLD = 0.5f
        private const val SOFT_EDGE = 0.18f
        private const val MAX_ALPHA = 120

        /** True when the model looks like a YOLO-seg export: a detection head plus a 4D prototype tensor. */
        fun looksLikeSegmentation(interpreter: Interpreter): Boolean =
            interpreter.outputTensorCount >= 2 &&
                (0 until interpreter.outputTensorCount).any { interpreter.getOutputTensor(it).shape().size == 4 }

        fun create(context: Context, source: ModelSource, options: DetectorOptions): SegmentationDetector {
            val bytes = when (source) {
                is ModelSource.Asset -> context.assets.open(source.path).use { it.readBytes() }
                is ModelSource.LocalFile -> File(source.path).readBytes()
            }
            val metadata = ModelMetadata.parse(bytes)
            val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
                put(bytes)
                rewind()
            }
            val interpreter = Interpreter(
                buffer,
                Interpreter.Options().setNumThreads(options.cpuThreads).setUseXNNPACK(true),
            )
            val input = interpreter.getInputTensor(0)
            require(input.dataType() == DataType.FLOAT32) { "Segmentation input must be FLOAT32" }
            val inShape = input.shape()

            val head = (0 until interpreter.outputTensorCount)
                .first { interpreter.getOutputTensor(it).shape().size == 3 }
            val protos = (0 until interpreter.outputTensorCount)
                .first { interpreter.getOutputTensor(it).shape().size == 4 }
            require(head == 0 && protos == 1) { "Unexpected output order for a segmentation model" }
            val headShape = interpreter.getOutputTensor(head).shape()
            val protoShape = interpreter.getOutputTensor(protos).shape()

            val classes = headShape[1] - BOX_FEATURES - MASK_COEFFS
            val labels = SegClasses.labelsFor(classes, metadata?.names)
            val info = ModelInfo(
                displayName = source.displayName,
                inputWidth = inShape[2],
                inputHeight = inShape[1],
                channelsFirst = false,
                outputShape = headShape.toList(),
                format = YoloOutputFormat.SEGMENTATION,
                labels = labels,
                backend = "CPU (XNNPACK, ${options.cpuThreads} threads)",
            )
            return SegmentationDetector(
                interpreter, info, options,
                featureCount = headShape[1],
                anchorCount = headShape[2],
                maskHeight = protoShape[1],
                maskWidth = protoShape[2],
                maskChannels = protoShape[3],
            )
        }
    }
}

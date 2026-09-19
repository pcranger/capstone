package com.crosswise.perception

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.os.SystemClock
import android.util.Log
import androidx.core.graphics.createBitmap
import com.google.ai.edge.litert.Accelerator
import com.google.ai.edge.litert.CompiledModel
import com.google.ai.edge.litert.Environment
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

sealed interface ModelSource {
    val displayName: String

    /** A model bundled under `app/src/main/assets`. */
    data class Asset(val path: String) : ModelSource {
        override val displayName: String get() = path.substringAfterLast('/')
    }

    /** A model imported by the user at runtime (copied into app storage). */
    data class LocalFile(val path: String) : ModelSource {
        override val displayName: String get() = File(path).name
    }
}

data class DetectorOptions(
    val preferGpu: Boolean = true,
    val cpuThreads: Int = 4,
    val scoreThreshold: Float = 0.35f,
    val iouThreshold: Float = 0.5f,
)

data class ModelInfo(
    val displayName: String,
    val inputWidth: Int,
    val inputHeight: Int,
    val channelsFirst: Boolean,
    val outputShape: List<Int>,
    val format: YoloOutputFormat,
    val labels: List<String>,
    val backend: String,
) {
    /** False for e.g. a plain COCO model: phases then come from the (unverified) color heuristic. */
    val hasPedestrianSignalClasses: Boolean = labels.map(LabelMapper::categoryFor)
        .any { it == ObjectCategory.PED_WALK || it == ObjectCategory.PED_DONT_WALK }
}

/**
 * Runs an Ultralytics YOLO model exported with `format="litert"` (or legacy `tflite`).
 *
 * Handles NCHW (litert-torch) and NHWC (onnx2tf) inputs, raw and NMS-free outputs, and reads the
 * class names embedded in the model. Tries the GPU via the LiteRT CompiledModel API and falls back
 * to the CPU Interpreter (XNNPACK).
 */
class LiteRtDetector private constructor(
    private val runner: Runner,
    val info: ModelInfo,
    @Volatile var options: DetectorOptions,
) : AutoCloseable {

    private val categories = info.labels.map(LabelMapper::categoryFor)
    private val area = info.inputWidth * info.inputHeight
    private val inputArray = FloatArray(3 * area)
    private val pixels = IntArray(area)
    private val inputBitmap = createBitmap(info.inputWidth, info.inputHeight)
    private val canvas = Canvas(inputBitmap)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val matrix = Matrix()
    private val padColor = Color.rgb(114, 114, 114)

    /** Detects objects in an upright frame. Not thread-safe: call from a single analysis thread. */
    fun detect(frame: Bitmap, timestampMs: Long): FrameDetections {
        val start = SystemClock.elapsedRealtime()
        val letterbox = Letterbox(frame.width, frame.height, info.inputWidth, info.inputHeight)
        canvas.drawColor(padColor)
        matrix.reset()
        matrix.postScale(letterbox.scale, letterbox.scale)
        matrix.postTranslate(letterbox.padX, letterbox.padY)
        canvas.drawBitmap(frame, matrix, paint)
        inputBitmap.getPixels(pixels, 0, info.inputWidth, 0, 0, info.inputWidth, info.inputHeight)

        for (i in 0 until area) {
            val p = pixels[i]
            val r = ((p shr 16) and 0xFF) / 255f
            val g = ((p shr 8) and 0xFF) / 255f
            val b = (p and 0xFF) / 255f
            if (info.channelsFirst) {
                inputArray[i] = r
                inputArray[area + i] = g
                inputArray[2 * area + i] = b
            } else {
                val o = i * 3
                inputArray[o] = r
                inputArray[o + 1] = g
                inputArray[o + 2] = b
            }
        }

        val output = runner.run(inputArray)
        val opts = options
        var detections = YoloDecoder.decode(
            output = output,
            outputShape = info.outputShape.toIntArray(),
            format = info.format,
            letterbox = letterbox,
            labels = info.labels,
            categories = categories,
            scoreThreshold = opts.scoreThreshold,
            iouThreshold = opts.iouThreshold,
        )
        if (!info.hasPedestrianSignalClasses) {
            detections = detections.map { d ->
                if (d.category == ObjectCategory.TRAFFIC_LIGHT) d.copy(colorHint = SignalColorHeuristic.estimate(frame, d.box)) else d
            }
        }
        return FrameDetections(
            timestampMs = timestampMs,
            detections = detections,
            frameWidth = frame.width,
            frameHeight = frame.height,
            inferenceMs = SystemClock.elapsedRealtime() - start,
        )
    }

    override fun close() {
        runner.close()
        inputBitmap.recycle()
    }

    private interface Runner : AutoCloseable {
        fun run(input: FloatArray): FloatArray
    }

    private class InterpreterRunner(
        private val interpreter: Interpreter,
        inputElements: Int,
        private val outputIndex: Int,
        outputElements: Int,
    ) : Runner {
        private val inBuffer = ByteBuffer.allocateDirect(inputElements * 4).order(ByteOrder.nativeOrder())
        private val outBuffer = ByteBuffer.allocateDirect(outputElements * 4).order(ByteOrder.nativeOrder())
        private val outArray = FloatArray(outputElements)

        override fun run(input: FloatArray): FloatArray {
            inBuffer.rewind()
            inBuffer.asFloatBuffer().put(input)
            outBuffer.rewind()
            interpreter.runForMultipleInputsOutputs(arrayOf<Any>(inBuffer), mapOf<Int, Any>(outputIndex to outBuffer))
            outBuffer.rewind()
            outBuffer.asFloatBuffer().get(outArray)
            return outArray
        }

        override fun close() = interpreter.close()
    }

    private class CompiledModelRunner(
        private val environment: Environment,
        private val model: CompiledModel,
        private val outputIndex: Int,
    ) : Runner {
        private val inputs = model.createInputBuffers()
        private val outputs = model.createOutputBuffers()

        override fun run(input: FloatArray): FloatArray {
            inputs[0].writeFloat(input)
            model.run(inputs, outputs)
            return outputs[outputIndex].readFloat()
        }

        override fun close() {
            inputs.forEach { it.close() }
            outputs.forEach { it.close() }
            model.close()
            environment.close()
        }
    }

    companion object {
        private const val TAG = "LiteRtDetector"

        /** Loads a model. Blocking; call off the main thread. */
        fun create(context: Context, source: ModelSource, options: DetectorOptions): LiteRtDetector {
            val bytes = when (source) {
                is ModelSource.Asset -> context.assets.open(source.path).use { it.readBytes() }
                is ModelSource.LocalFile -> File(source.path).readBytes()
            }
            val metadata = ModelMetadata.parse(bytes)
            val modelBuffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
                put(bytes)
                rewind()
            }

            val interpreter = Interpreter(
                modelBuffer,
                Interpreter.Options().setNumThreads(options.cpuThreads).setUseXNNPACK(true),
            )
            val inputTensor = interpreter.getInputTensor(0)
            require(inputTensor.dataType() == DataType.FLOAT32) {
                "Model input must be FLOAT32 (got ${inputTensor.dataType()}). Export with Ultralytics format=litert."
            }
            val inShape = inputTensor.shape()
            require(inShape.size == 4) { "Expected a 4D image input, got ${inShape.contentToString()}" }
            val channelsFirst = inShape[1] == 3 && inShape[3] != 3
            val inputHeight = if (channelsFirst) inShape[2] else inShape[1]
            val inputWidth = if (channelsFirst) inShape[3] else inShape[2]

            val outputIndex = (0 until interpreter.outputTensorCount)
                .firstOrNull { interpreter.getOutputTensor(it).shape().size == 3 }
                ?: error("No 3D detection output found; is this a detection model?")
            val outShape = interpreter.getOutputTensor(outputIndex).shape()

            val labels = metadata?.names?.takeIf { it.isNotEmpty() } ?: run {
                val channels = minOf(outShape[1], outShape[2])
                if (outShape[2] == 6 && outShape[1] != YoloDecoder.expectedAnchors(inputWidth, inputHeight)) {
                    emptyList()
                } else {
                    List(channels - 4) { "class_$it" }
                }
            }
            val format = YoloDecoder.inferFormat(
                outShape, inputWidth, inputHeight, labels.size.takeIf { it > 0 }, metadata?.endToEnd,
            )

            var backendName = "CPU (XNNPACK, ${options.cpuThreads} threads)"
            var runner: Runner = InterpreterRunner(
                interpreter, inShape.fold(1) { a, b -> a * b }, outputIndex, outShape.fold(1) { a, b -> a * b },
            )

            if (options.preferGpu) {
                val gpuRunner = runCatching {
                    val env = Environment.create()
                    try {
                        val compiled = when (source) {
                            is ModelSource.Asset -> CompiledModel.create(
                                context.assets, source.path, CompiledModel.Options(Accelerator.GPU), env,
                            )
                            is ModelSource.LocalFile -> CompiledModel.create(
                                source.path, CompiledModel.Options(Accelerator.GPU), env,
                            )
                        }
                        CompiledModelRunner(env, compiled, outputIndex).also { candidate ->
                            // Warm up and sanity-check: a broken delegate tends to return NaNs.
                            val probe = candidate.run(FloatArray(inShape.fold(1) { a, b -> a * b }) { 0.5f })
                            check(probe.isNotEmpty() && probe.none { it.isNaN() }) { "GPU produced invalid output" }
                        }
                    } catch (t: Throwable) {
                        env.close()
                        throw t
                    }
                }.onFailure { Log.w(TAG, "GPU unavailable, using CPU: ${it.message}") }.getOrNull()
                if (gpuRunner != null) {
                    runner.close()
                    runner = gpuRunner
                    backendName = "GPU (LiteRT CompiledModel)"
                }
            }

            val info = ModelInfo(
                displayName = source.displayName,
                inputWidth = inputWidth,
                inputHeight = inputHeight,
                channelsFirst = channelsFirst,
                outputShape = outShape.toList(),
                format = format,
                labels = labels,
                backend = backendName,
            )
            Log.i(TAG, "Loaded $info")
            return LiteRtDetector(runner, info, options)
        }
    }
}

package com.crosswise.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.hardware.camera2.CameraCharacteristics
import android.util.Log
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.graphics.createBitmap
import androidx.lifecycle.LifecycleOwner
import com.crosswise.core.Angles
import com.crosswise.crossing.CameraGeometry
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.atan

/**
 * Binds CameraX preview + analysis. Analysis frames are 16:9 RGBA, converted to upright bitmaps
 * (the app is portrait-only) on a single background thread.
 */
class CameraPipeline(context: Context) {
    private val appContext = context.applicationContext
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "crosswise-analysis")
    }
    private var provider: ProcessCameraProvider? = null
    private var uprightBitmap: Bitmap? = null
    private val rotateMatrix = Matrix()
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

    /** Field of view of the upright analysis frame; defaults are typical for a phone main camera. */
    @Volatile
    var geometry: CameraGeometry = CameraGeometry(hfovDeg = 40f, vfovDeg = 65f)
        private set

    suspend fun bind(owner: LifecycleOwner, previewView: PreviewView?, onFrame: (Bitmap, Long) -> Unit) {
        val cameraProvider = provider ?: awaitProvider().also { provider = it }
        val resolution = ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(
                ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
            )
            .build()
        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(resolution)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
        analysis.setAnalyzer(analysisExecutor) { image ->
            try {
                val timestamp = android.os.SystemClock.elapsedRealtime()
                onFrame(toUpright(image), timestamp)
            } catch (t: Throwable) {
                Log.e(TAG, "Frame analysis failed", t)
            } finally {
                image.close()
            }
        }

        cameraProvider.unbindAll()
        val camera = if (previewView != null) {
            val preview = Preview.Builder().setResolutionSelector(resolution).build()
            preview.setSurfaceProvider(previewView.surfaceProvider)
            cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        } else {
            cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, analysis)
        }
        geometry = computeGeometry(camera, analysis.resolutionInfo?.resolution) ?: geometry
    }

    fun unbind() {
        provider?.unbindAll()
    }

    fun shutdown() {
        unbind()
        analysisExecutor.shutdown()
    }

    private suspend fun awaitProvider(): ProcessCameraProvider = suspendCancellableCoroutine { cont ->
        val future = ProcessCameraProvider.getInstance(appContext)
        future.addListener({
            try {
                cont.resume(future.get())
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }, ContextCompat.getMainExecutor(appContext))
    }

    /** Rotates the sensor-oriented frame into an upright bitmap, reusing one buffer. */
    private fun toUpright(image: ImageProxy): Bitmap {
        val source = image.toBitmap()
        val rotation = image.imageInfo.rotationDegrees
        if (rotation == 0) return source
        val swap = rotation == 90 || rotation == 270
        val width = if (swap) source.height else source.width
        val height = if (swap) source.width else source.height
        val target = uprightBitmap?.takeIf { it.width == width && it.height == height }
            ?: createBitmap(width, height).also { uprightBitmap = it }
        rotateMatrix.reset()
        rotateMatrix.postTranslate(-source.width / 2f, -source.height / 2f)
        rotateMatrix.postRotate(rotation.toFloat())
        rotateMatrix.postTranslate(width / 2f, height / 2f)
        Canvas(target).drawBitmap(source, rotateMatrix, paint)
        return target
    }

    @OptIn(ExperimentalCamera2Interop::class)
    private fun computeGeometry(camera: Camera, analysisSize: Size?): CameraGeometry? = runCatching {
        val info = Camera2CameraInfo.from(camera.cameraInfo)
        val focal = info.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
            ?.minOrNull() ?: return null
        val sensor = info.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: return null
        val longSide = maxOf(sensor.width, sensor.height)
        val shortSide = minOf(sensor.width, sensor.height)
        val sensorAspect = longSide / shortSide
        val frameAspect = analysisSize?.let { maxOf(it.width, it.height).toFloat() / minOf(it.width, it.height) }
            ?: sensorAspect
        // The analysis stream crops the sensor to its own aspect ratio.
        val usedLong = if (frameAspect >= sensorAspect) longSide else shortSide * frameAspect
        val usedShort = if (frameAspect >= sensorAspect) longSide / frameAspect else shortSide
        val longFov = Angles.toDeg(2.0 * atan(usedLong / (2.0 * focal)))
        val shortFov = Angles.toDeg(2.0 * atan(usedShort / (2.0 * focal)))
        // Portrait: the upright image's width is the sensor's short side.
        CameraGeometry(hfovDeg = shortFov, vfovDeg = longFov).takeIf {
            it.hfovDeg in 15f..150f && it.vfovDeg in 15f..150f
        }
    }.onFailure { Log.w(TAG, "Could not read camera FOV", it) }.getOrNull()

    private companion object {
        const val TAG = "CameraPipeline"
    }
}

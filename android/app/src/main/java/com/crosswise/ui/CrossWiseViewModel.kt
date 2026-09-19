package com.crosswise.ui

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import androidx.core.graphics.get
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.crosswise.camera.CameraPipeline
import com.crosswise.crossing.AssistMode
import com.crosswise.crossing.CrossingEngine
import com.crosswise.crossing.EngineSnapshot
import com.crosswise.crossing.UserCommand
import com.crosswise.feedback.Cue
import com.crosswise.feedback.FeedbackEngine
import com.crosswise.feedback.Phrase
import com.crosswise.feedback.Priority
import com.crosswise.logging.SessionLogger
import com.crosswise.perception.DetectorOptions
import com.crosswise.perception.LiteRtDetector
import com.crosswise.perception.ModelInfo
import com.crosswise.perception.ASSET_PREFIX
import com.crosswise.perception.ModelSource
import com.crosswise.sensors.MotionSensors
import com.crosswise.settings.AppSettings
import com.crosswise.settings.SettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

sealed interface ModelState {
    data object Loading : ModelState
    data object Missing : ModelState
    data class Ready(val info: ModelInfo) : ModelState
    data class Failed(val message: String) : ModelState
}

data class UiState(
    val snapshot: EngineSnapshot = EngineSnapshot(),
    val fps: Float = 0f,
    val inferenceMs: Long = 0,
    /** Width / height of the upright analysis frame, used to place overlay boxes. */
    val frameAspect: Float = 9f / 16f,
    /** Last spoken message, shown as a caption. */
    val caption: String? = null,
    /** Mean luminance of the last analysed frame, 0..1 — feeds the "too dark / lens covered" warning. */
    val frameBrightness: Float = 0.5f,
)

class CrossWiseViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application
    private val settingsRepository = SettingsRepository(application)

    val settings: StateFlow<AppSettings> =
        settingsRepository.settings.stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())
    val settingsLoaded: StateFlow<Boolean> =
        settingsRepository.settings.map { true }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val camera = CameraPipeline(application)
    private val sensors = MotionSensors(application)
    private val engine = CrossingEngine()
    private val feedback = FeedbackEngine(application)
    private val logger = SessionLogger(application)
    val logDirectory: String get() = logger.directoryPath

    private val modelState = MutableStateFlow<ModelState>(ModelState.Loading)
    val model: StateFlow<ModelState> = modelState.asStateFlow()

    private val uiState = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = uiState.asStateFlow()

    /** Guards the detector: inference and model swaps never overlap (closing mid-inference would crash). */
    private val detectorLock = Any()

    @Volatile
    private var detector: LiteRtDetector? = null
    private var loadedModelKey: Pair<String?, Boolean>? = null

    private var fps = 0f
    private val modelLibraryState = MutableStateFlow<List<ModelSource>>(emptyList())
    private var lastFrameMs = 0L
    private var brightness = 0.5f
    private var lastPublishMs = 0L

    init {
        viewModelScope.launch {
            settingsRepository.settings.collect { s ->
                engine.settings = s.engineSettings()
                feedback.config = s.feedbackConfig()
                // options is @Volatile: no need to wait for an inference to finish on the main thread.
                detector?.let { it.options = it.options.copy(scoreThreshold = s.scoreThreshold) }
                val key = s.customModelPath to s.useGpu
                if (key != loadedModelKey) {
                    loadedModelKey = key
                    loadModel(s)
                }
                if (engine.mode != AssistMode.IDLE) {
                    if (s.logSessions) logger.start() else logger.stop()
                }
            }
        }
        // Sensor-driven guidance (veer, tilt, auto crossing) runs at 10 Hz regardless of camera speed.
        viewModelScope.launch {
            while (isActive) {
                delay(100)
                val output = engine.onSensors(SystemClock.elapsedRealtime(), sensors.latestOrientation, sensors.isWalking)
                deliver(output.cues)
                if (output.snapshot.mode != AssistMode.IDLE) publish(output.snapshot)
            }
        }
    }

    // ---- Lifecycle -------------------------------------------------------------------------------

    fun onForeground() = sensors.start()

    fun onBackground() {
        // The camera stops in the background, so any signal state would go stale: say so and stop.
        if (engine.mode != AssistMode.IDLE) command(UserCommand.STOP_ASSIST)
        sensors.stop()
    }

    // ---- Camera frames (analysis thread) ---------------------------------------------------------

    fun onFrame(frame: Bitmap, timestampMs: Long) {
        val result = synchronized(detectorLock) { detector?.detect(frame, timestampMs) } ?: return
        brightness = 0.8f * brightness + 0.2f * meanLuminance(frame)
        val output = engine.onFrame(result, camera.geometry)
        deliver(output.cues)

        val dt = timestampMs - lastFrameMs
        lastFrameMs = timestampMs
        if (dt in 1..2_000) fps = if (fps == 0f) 1000f / dt else 0.9f * fps + 0.1f * (1000f / dt)

        if (settings.value.logSessions && output.snapshot.mode != AssistMode.IDLE) {
            logger.log(timestampMs, fps, result.inferenceMs, result.detections.size, output.snapshot, output.cues, feedback::textOf)
        }
        publish(
            output.snapshot,
            inferenceMs = result.inferenceMs,
            frameAspect = result.frameWidth.toFloat() / result.frameHeight.coerceAtLeast(1),
        )
    }

    /**
     * Average brightness of a coarse grid of pixels. A lens covered by a finger or a pocket looks the same to the
     * detector as an empty street — it simply finds nothing — so the app has to notice it and say so.
     */
    private fun meanLuminance(frame: Bitmap): Float {
        val step = 16
        var sum = 0L
        var count = 0
        var y = 0
        while (y < frame.height) {
            var x = 0
            while (x < frame.width) {
                val pixel = frame[x, y]
                sum += ((pixel shr 16 and 0xFF) * 77 + (pixel shr 8 and 0xFF) * 150 + (pixel and 0xFF) * 29) shr 8
                count++
                x += step
            }
            y += step
        }
        return if (count == 0) 0.5f else sum.toFloat() / count / 255f
    }

    /** Plays one cue on demand, for the Practice screen: the real sounds, with no traffic involved. */
    fun practice(cues: List<Cue>) = deliver(cues)

    // ---- User actions ----------------------------------------------------------------------------

    fun command(command: UserCommand) {
        val now = SystemClock.elapsedRealtime()
        val output = engine.command(command, now)
        val extra = ArrayList<Cue>()
        when (command) {
            UserCommand.START_ASSIST -> {
                if (settings.value.logSessions) logger.start()
                when (val m = modelState.value) {
                    ModelState.Missing, is ModelState.Failed -> extra += Cue.Speak(Phrase.MODEL_MISSING, Priority.HIGH)
                    is ModelState.Ready -> if (!m.info.hasPedestrianSignalClasses) {
                        extra += Cue.Speak(Phrase.BASELINE_MODEL, Priority.HIGH)
                    }
                    ModelState.Loading -> Unit
                }
            }
            UserCommand.STOP_ASSIST -> logger.stop()
            else -> Unit
        }
        deliver(output.cues + extra)
        publish(output.snapshot, force = true)
    }

    /** Volume up toggles crossing mode, volume down repeats the status (only while assist is on). */
    fun handleVolumeKey(keyCode: Int, repeatCount: Int): Boolean {
        if (!settings.value.volumeKeys || engine.mode == AssistMode.IDLE) return false
        return when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> {
                if (repeatCount == 0) command(UserCommand.TOGGLE_CROSSING)
                true
            }
            KeyEvent.KEYCODE_VOLUME_DOWN -> {
                if (repeatCount == 0) command(UserCommand.REPEAT_STATUS)
                true
            }
            else -> false
        }
    }

    fun updateSettings(transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch { settingsRepository.update(transform) }
    }

    fun importModel(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val dir = File(app.filesDir, "models").apply { mkdirs() }
                // Imports accumulate into a library instead of replacing each other: comparing two detectors is
                // the whole point of being able to import one.
                val name = displayNameOf(uri)?.substringAfterLast('/')?.takeIf { it.endsWith(".tflite") }
                    ?: "imported_${System.currentTimeMillis()}.tflite"
                val target = File(dir, name)
                app.contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { input.copyTo(it) }
                } ?: error("Cannot open the selected file")
                settingsRepository.update { it.copy(customModelPath = target.absolutePath) }
                refreshModelLibrary()
            }.onFailure {
                Log.e(TAG, "Model import failed", it)
                modelState.value = ModelState.Failed(it.message ?: "Import failed")
            }
        }
    }

    fun useBundledModel() = updateSettings { it.copy(customModelPath = null) }

    /** Everything the app can load right now: models shipped in the APK plus everything imported since. */
    val modelLibrary: StateFlow<List<ModelSource>> get() = modelLibraryState.asStateFlow()

    fun selectModel(source: ModelSource) = updateSettings { it.copy(customModelPath = source.reference) }

    fun deleteModel(source: ModelSource) {
        if (source !is ModelSource.LocalFile) return
        viewModelScope.launch(Dispatchers.IO) {
            if (settings.value.customModelPath == source.path) {
                settingsRepository.update { it.copy(customModelPath = null) }
            }
            File(source.path).delete()
            refreshModelLibrary()
        }
    }

    private fun refreshModelLibrary() {
        val assets = runCatching { app.assets.list("models")?.toList() }.getOrNull().orEmpty()
            .filter { it.endsWith(".tflite") }
            .map { ModelSource.Asset("models/$it") }
        val imported = File(app.filesDir, "models").listFiles().orEmpty()
            .filter { it.extension == "tflite" }
            .sortedBy { it.name }
            .map { ModelSource.LocalFile(it.absolutePath) }
        modelLibraryState.value = assets + imported
    }

    private fun displayNameOf(uri: Uri): String? = runCatching {
        app.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
        }
    }.getOrNull()

    // ---- Internals -------------------------------------------------------------------------------

    private fun loadModel(s: AppSettings) {
        viewModelScope.launch(Dispatchers.Default) {
            modelState.value = ModelState.Loading
            val source = when {
                s.customModelPath == null -> bundledModel()
                s.customModelPath.startsWith(ASSET_PREFIX) ->
                    ModelSource.Asset(s.customModelPath.removePrefix(ASSET_PREFIX))
                File(s.customModelPath).exists() -> ModelSource.LocalFile(s.customModelPath)
                else -> bundledModel()
            }
            if (source == null) {
                swapDetector(null)
                modelState.value = ModelState.Missing
                return@launch
            }
            try {
                val loaded = LiteRtDetector.create(
                    app, source, DetectorOptions(preferGpu = s.useGpu, scoreThreshold = s.scoreThreshold),
                )
                swapDetector(loaded)
                modelState.value = ModelState.Ready(loaded.info)
            } catch (t: Throwable) {
                Log.e(TAG, "Model load failed", t)
                swapDetector(null)
                modelState.value = ModelState.Failed(t.message ?: t.javaClass.simpleName)
            }
        }
    }

    init {
        refreshModelLibrary()
    }

    private fun bundledModel(): ModelSource? {
        val names = runCatching { app.assets.list("models")?.toList() }.getOrNull().orEmpty()
        val name = names.firstOrNull { it == BUNDLED_MODEL } ?: names.firstOrNull { it.endsWith(".tflite") }
        return name?.let { ModelSource.Asset("models/$it") }
    }

    private fun swapDetector(next: LiteRtDetector?) {
        val previous = synchronized(detectorLock) {
            val old = detector
            detector = next
            old
        }
        previous?.close()
    }

    private fun deliver(cues: List<Cue>) {
        if (cues.isEmpty()) return
        feedback.dispatch(cues)
        cues.lastOrNull { it is Cue.Speak }?.let { speak ->
            val text = feedback.textOf(speak as Cue.Speak)
            uiState.update { it.copy(caption = text) }
        }
    }

    private fun publish(
        snapshot: EngineSnapshot,
        inferenceMs: Long? = null,
        frameAspect: Float? = null,
        force: Boolean = false,
    ) {
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastPublishMs < 66) return
        lastPublishMs = now
        uiState.update {
            it.copy(
                snapshot = snapshot,
                fps = fps,
                inferenceMs = inferenceMs ?: it.inferenceMs,
                frameAspect = frameAspect ?: it.frameAspect,
                frameBrightness = brightness,
            )
        }
    }

    override fun onCleared() {
        sensors.stop()
        camera.shutdown()
        logger.stop()
        feedback.release()
        swapDetector(null)
    }

    private companion object {
        const val TAG = "CrossWiseViewModel"
        const val BUNDLED_MODEL = "crosswise.tflite"
    }
}

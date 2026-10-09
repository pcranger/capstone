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
import com.crosswise.R
import com.crosswise.BuildConfig
import com.crosswise.nav.JourneyCoordinator
import com.crosswise.voice.VoiceCommands
import com.crosswise.voice.VoiceInput
import com.crosswise.settings.InterfaceMode
import com.crosswise.ai.GeminiService
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
import com.crosswise.nav.GuidanceManager
import com.crosswise.nav.NavigationService
import com.crosswise.nav.WalkingRoute
import com.crosswise.perception.DetectorOptions
import com.crosswise.perception.FrameAnalyzer
import com.crosswise.perception.LiteRtDetector
import com.crosswise.perception.SegmentationDetector
import com.crosswise.perception.YoloOutputFormat
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
    /** Segmentation mask from the active model, or null when a box model is loaded. */
    val mask: Bitmap? = null,
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

    /** Where the readable settings file lives, shown in Settings so a key can be placed by hand. */
    val configPath: String get() = settingsRepository.file.path

    private val modelState = MutableStateFlow<ModelState>(ModelState.Loading)
    val model: StateFlow<ModelState> = modelState.asStateFlow()

    private val uiState = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = uiState.asStateFlow()

    /** Guards the detector: inference and model swaps never overlap (closing mid-inference would crash). */
    private val detectorLock = Any()

    @Volatile
    private var detector: FrameAnalyzer? = null
    private var loadedModelKey: Pair<String?, Boolean>? = null

    private var fps = 0f
    private val modelLibraryState = MutableStateFlow<List<ModelSource>>(emptyList())
    private val noticeState = MutableStateFlow<String?>(null)
    @Volatile private var lastFrameMs = 0L
    private var brightness = 0.5f
    private val gemini = GeminiService()
    private val navigation = NavigationService()
    private val guidance = GuidanceManager()
    private val routeState = MutableStateFlow<WalkingRoute?>(null)
    private val navigatingState = MutableStateFlow(false)
    @Volatile private var wantFrame = false
    @Volatile private var latestFrame: Bitmap? = null
    private val describingState = MutableStateFlow(false)
    private var lastPublishMs = 0L

    init {
        viewModelScope.launch {
            settingsRepository.settings.collect { s ->
                engine.settings = s.engineSettings().copy(autoDetectCrossing = s.interfaceMode == InterfaceMode.DEVELOPER && s.autoDetectCrossing && !navigatingState.value)
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

    val journey = JourneyCoordinator(app, viewModelScope, BuildConfig.MAPS_API_KEY, ::speakNow)
    val mapOpen = MutableStateFlow(false)
    private val voice = VoiceInput(app, viewModelScope, { feedback.speaking || journey.state.value.busy }, ::handleVoice)
    val voiceStatus get() = voice.status
    val voiceActive get() = voice.active
    private var home = false
    private var foreground = false
    private var greeted = false
    fun homeVisible(value: Boolean) { home = value; if (!value) stopVoice() else { foreground = true; onForeground(); startVoice() } }
    fun startVoice() {
        if (!home || !foreground || !settings.value.speech) return
        if (!greeted) { greeted = true; speakNow("Welcome to CrossWise. After the tone, say navigate to, then your destination.") }
        voice.start()
    }
    fun toggleVoice() { if (voice.active) stopVoice() else startVoice() }
    fun stopVoice() { voice.stop(); journey.cancel() }
    fun frameFresh(now: Long) = lastFrameMs > 0 && now - lastFrameMs in 0..2000
    fun stopJourney() { journey.end(); command(UserCommand.STOP_ASSIST) }
    fun startPlannedJourney() { journey.start() }
    fun beginCrossing() { journey.crossing(true); command(UserCommand.START_CROSSING) }
    fun finishCrossing() { command(UserCommand.END_CROSSING); journey.crossing(false); if (journey.state.value.phase == "walking") journey.repeat() }
    fun repeatGuidance() { if (journey.state.value.phase == "walking" && !journey.state.value.crossing) journey.repeat() else command(UserCommand.REPEAT_STATUS) }
    fun readManual() = speakNow(VoiceCommands.MANUAL)
    private fun handleVoice(text: String) {
        val c = VoiceCommands.parse(text)
        when (c?.kind) {
            "help" -> readManual()
            "off" -> voice.stop()
            "navigate", "search" -> { mapOpen.value = true; journey.search(c.argument, c.kind == "navigate") }
            "choose" -> journey.state.value.candidates.getOrNull(c.argument.toInt())?.let { journey.select(it, true) } ?: speakNow("No matching choice.")
            "start" -> if (journey.state.value.route == null) journey.confirm(true) else journey.start()
            "save" -> journey.save(alias = c.argument.ifBlank { null })
            "repeat" -> repeatGuidance()
            "pause" -> if (journey.state.value.phase == "walking") journey.pause() else speakNow("No journey running.")
            "resume" -> journey.start()
            "end" -> { journey.end(); command(UserCommand.STOP_ASSIST) }
            "cancel" -> { journey.cancelPlanning(); speakNow("Cancelled.") }
            "retry" -> if (journey.state.value.selected != null) journey.confirm() else journey.search()
            else -> speakNow("Command not recognised. Say manual.")
        }
    }

    init {
        viewModelScope.launch { journey.state.collect { state ->
            engine.settings = settings.value.engineSettings().copy(autoDetectCrossing = state.phase == "idle" && settings.value.interfaceMode == InterfaceMode.DEVELOPER && settings.value.autoDetectCrossing)
            if (state.phase == "walking" && engine.mode == AssistMode.IDLE) command(UserCommand.START_ASSIST)
        } }
    }

    // ---- Lifecycle -------------------------------------------------------------------------------

    fun onForeground() { foreground = true; sensors.start(); journey.foreground(); if (home && !voice.active) startVoice() }

    fun onBackground() {
        // The camera stops in the background, so any signal state would go stale: say so and stop.
        if (engine.mode != AssistMode.IDLE) command(UserCommand.STOP_ASSIST)
        sensors.stop(); foreground = false; voice.stop(); journey.background()
    }

    // ---- Camera frames (analysis thread) ---------------------------------------------------------

    fun onFrame(frame: Bitmap, timestampMs: Long) {
        if (wantFrame) latestFrame = frame.copy(Bitmap.Config.ARGB_8888, false).also { wantFrame = false }
        val result = synchronized(detectorLock) { detector?.detect(frame, timestampMs) } ?: return
        brightness = 0.8f * brightness + 0.2f * meanLuminance(frame)
        if (journey.state.value.phase != "idle") engine.settings = engine.settings.copy(autoDetectCrossing = false)
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

    /** True while a scan is in flight, so the button can say so instead of looking broken. */
    val describing: StateFlow<Boolean> get() = describingState.asStateFlow()

    val route: StateFlow<WalkingRoute?> get() = routeState.asStateFlow()
    val navigating: StateFlow<Boolean> get() = navigatingState.asStateFlow()

    /**
     * Finds a walking route and starts speaking it. Guidance is a separate job from crossing assistance: the two
     * run together, and a route instruction never outranks a vehicle warning.
     */
    fun navigateTo(query: String) {
        val key = BuildConfig.MAPS_API_KEY
        if (key.isBlank()) {
            noticeState.value = app.getString(R.string.nav_no_key)
            speakNow(app.getString(R.string.nav_no_key))
            return
        }
        val here = lastLocation()
        if (here == null) {
            noticeState.value = app.getString(R.string.nav_no_location)
            speakNow(app.getString(R.string.nav_no_location))
            return
        }
        viewModelScope.launch {
            speakNow(app.getString(R.string.nav_searching, query))
            navigation.findRoute(query, here, key)
                .onSuccess { found ->
                    routeState.value = found
                    guidance.start(found)
                    navigatingState.value = true
                    speakNow(
                        app.getString(
                            R.string.nav_started,
                            found.destination,
                            found.distanceMeters,
                            found.durationSeconds / 60,
                        ),
                    )
                    startGuidanceLoop()
                }
                .onFailure {
                    val message = app.getString(R.string.nav_failed, query)
                    noticeState.value = message
                    speakNow(message)
                }
        }
    }

    fun stopNavigation() {
        guidance.stop()
        navigatingState.value = false
        routeState.value = null
        locationManager?.removeUpdates(locationListener)
        speakNow(app.getString(R.string.nav_stopped))
    }

    /** True when the app may use GPS; the Navigate screen asks for it, and guidance is refused without it. */
    fun hasLocationPermission(): Boolean =
        androidx.core.content.ContextCompat.checkSelfPermission(
            app, android.Manifest.permission.ACCESS_FINE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

    private fun startGuidanceLoop() {
        val manager = locationManager ?: return
        // Checked inline rather than through the helper so the lint analysis can follow it.
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                app, android.Manifest.permission.ACCESS_FINE_LOCATION,
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            noticeState.value = app.getString(R.string.nav_permission)
            return
        }
        runCatching {
            manager.requestLocationUpdates(
                android.location.LocationManager.GPS_PROVIDER, 2_000L, 2f, locationListener,
            )
        }.onFailure { Log.w(TAG, "No GPS updates", it) }
    }

    private val locationListener = android.location.LocationListener { location ->
        if (!navigatingState.value) return@LocationListener
        val heading = uiState.value.snapshot.aimBearingDeg ?: 0f
        guidance.update(location, heading)?.let { instruction ->
            // NORMAL, never HIGH: a route step must not talk over a vehicle warning.
            deliver(listOf(Cue.SpeakText(instruction, Priority.NORMAL)))
        }
        if (guidance.arrived) stopNavigation()
    }

    private val locationManager: android.location.LocationManager? by lazy {
        app.getSystemService(android.content.Context.LOCATION_SERVICE) as? android.location.LocationManager
    }

    private fun lastLocation(): android.location.Location? = runCatching {
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                app, android.Manifest.permission.ACCESS_FINE_LOCATION,
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }
        val manager = locationManager ?: return null
        manager.getLastKnownLocation(android.location.LocationManager.GPS_PROVIDER)
            ?: manager.getLastKnownLocation(android.location.LocationManager.NETWORK_PROVIDER)
    }.getOrNull()

    /**
     * The three-view scan from AN-S3: the traveler is asked to point left, ahead and right, one frame is taken at
     * each, and Gemini answers in a sentence or two. Spoken, because the person who needs it is not reading.
     */
    fun describeSurroundings() {
        if (describingState.value) return
        val key = BuildConfig.GEMINI_API_KEY
        if (key.isBlank()) {
            noticeState.value = app.getString(R.string.gemini_no_key)
            speakNow(app.getString(R.string.gemini_no_key))
            return
        }
        describingState.launchScan(key)
    }

    private fun MutableStateFlow<Boolean>.launchScan(key: String) {
        value = true
        viewModelScope.launch {
            val views = ArrayList<Pair<String, Bitmap>>(3)
            try {
                for ((label, phrase) in SCAN_STEPS) {
                    speakNow(app.getString(phrase))
                    delay(2_200)
                    captureFrame()?.let { views += label to it }
                }
                speakNow(app.getString(R.string.gemini_thinking))
                val answer = gemini.describeSurroundings(views, key)
                val text = answer.getOrElse { app.getString(R.string.gemini_failed) }
                noticeState.value = text
                speakNow(text)
            } finally {
                views.forEach { it.second.recycle() }
                value = false
            }
        }
    }

    private suspend fun captureFrame(): Bitmap? {
        wantFrame = true
        repeat(20) {
            latestFrame?.let { frame ->
                latestFrame = null
                return frame
            }
            delay(50)
        }
        return null
    }

    private fun speakNow(text: String) = deliver(listOf(Cue.SpeakText(text, Priority.HIGH)))

    // ---- User actions ----------------------------------------------------------------------------

    fun command(command: UserCommand) {
        val now = SystemClock.elapsedRealtime()
        val output = engine.command(command, now)
        if (command == UserCommand.START_ASSIST && settings.value.logSessions) logger.start()
        if (command == UserCommand.STOP_ASSIST) logger.stop()
        deliver(output.cues.filterNot { it is Cue.Speak && it.phrase in setOf(Phrase.BASELINE_MODEL) })
        publish(output.snapshot, force = true)
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
                noticeState.value = app.getString(R.string.notice_model_imported, target.name)
            }.onFailure {
                Log.e(TAG, "Model import failed", it)
                modelState.value = ModelState.Failed(it.message ?: "Import failed")
            }
        }
    }

    fun useBundledModel() = updateSettings { it.copy(customModelPath = null) }

    /** Everything the app can load right now: models shipped in the APK plus everything imported since. */
    val modelLibrary: StateFlow<List<ModelSource>> get() = modelLibraryState.asStateFlow()

    /** One-shot message for the UI (and TalkBack): a model was imported, switched, or failed to load. */
    val notice: StateFlow<String?> get() = noticeState.asStateFlow()

    fun clearNotice() {
        noticeState.value = null
    }

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
                val detectorOptions = DetectorOptions(preferGpu = s.useGpu, scoreThreshold = s.scoreThreshold)
                val loaded = if (isSegmentation(source)) {
                    SegmentationDetector.create(app, source, detectorOptions)
                } else {
                    LiteRtDetector.create(app, source, detectorOptions)
                }
                swapDetector(loaded)
                modelState.value = ModelState.Ready(loaded.info)

            } catch (t: Throwable) {
                Log.e(TAG, "Model load failed", t)
                swapDetector(null)
                modelState.value = ModelState.Failed(t.message ?: t.javaClass.simpleName)
                noticeState.value = app.getString(R.string.notice_model_failed, source.displayName)
            }
        }
    }

    init {
        refreshModelLibrary()
    }

    /** Reads the output tensors once to tell a YOLO-seg export from a plain detector. */
    private fun isSegmentation(source: ModelSource): Boolean = runCatching {
        val bytes = when (source) {
            is ModelSource.Asset -> app.assets.open(source.path).use { it.readBytes() }
            is ModelSource.LocalFile -> java.io.File(source.path).readBytes()
        }
        val buffer = java.nio.ByteBuffer.allocateDirect(bytes.size)
            .order(java.nio.ByteOrder.nativeOrder()).apply { put(bytes); rewind() }
        org.tensorflow.lite.Interpreter(buffer, org.tensorflow.lite.Interpreter.Options().setNumThreads(1)).use {
            SegmentationDetector.looksLikeSegmentation(it)
        }
    }.getOrDefault(false)

    private fun bundledModel(): ModelSource? {
        val names = runCatching { app.assets.list("models")?.toList() }.getOrNull().orEmpty()
        val name = names.firstOrNull { it == BUNDLED_MODEL } ?: names.firstOrNull { it.endsWith(".tflite") }
        return name?.let { ModelSource.Asset("models/$it") }
    }

    private fun swapDetector(next: FrameAnalyzer?) {
        val previous = synchronized(detectorLock) {
            val old = detector
            detector = next
            old
        }
        previous?.close()
    }

    private fun deliver(cues: List<Cue>) {
        if (cues.isEmpty()) return
        val filtered = if (journey.state.value.phase == "walking" && !journey.state.value.crossing)
            cues.filter { it !is Cue.Speak || it.priority >= Priority.HIGH } else cues
        if (filtered.any { it is Cue.Speak || it is Cue.SpeakText }) android.os.Handler(android.os.Looper.getMainLooper()).post { voice.interrupt() }
        feedback.dispatch(filtered)
        cues.lastOrNull { it is Cue.Speak || it is Cue.SpeakText }?.let { spoken ->
            val text = when (spoken) {
                is Cue.Speak -> feedback.textOf(spoken)
                is Cue.SpeakText -> spoken.text
                else -> return@let
            }
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
                mask = detector?.mask,
            )
        }
    }

    override fun onCleared() {
        voice.stop(); journey.background()
        sensors.stop()
        camera.shutdown()
        logger.stop()
        feedback.release()
        swapDetector(null)
    }

    private companion object {
        /** Label sent to the model, and the phrase spoken before each capture. */
        private val SCAN_STEPS = listOf(
            "left" to R.string.gemini_point_left,
            "front" to R.string.gemini_point_front,
            "right" to R.string.gemini_point_right,
        )

        const val TAG = "CrossWiseViewModel"
        const val BUNDLED_MODEL = "yolo26n.tflite"
    }
}

package com.crosswise.ui

import androidx.camera.view.PreviewView
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.crossing.*
import com.crosswise.perception.ObjectCategory
import com.crosswise.settings.*
import com.crosswise.signal.SignalPhase
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

@Composable
fun MainScreen(viewModel: CrossWiseViewModel, settings: AppSettings, onOpenSettings: () -> Unit,
    onMap: () -> Unit, hasCamera: Boolean, onPermission: () -> Unit, modifier: Modifier = Modifier) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val model by viewModel.model.collectAsStateWithLifecycle()
    val journey by viewModel.journey.state.collectAsStateWithLifecycle()
    val voice by viewModel.voiceStatus.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(view) { val previous = view.keepScreenOn; view.keepScreenOn = true; onDispose { view.keepScreenOn = previous } }
    val preview = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER; implementationMode = PreviewView.ImplementationMode.COMPATIBLE } }
    var retry by remember { mutableIntStateOf(0) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(owner, hasCamera, settings.showPreview, retry) {
        if (hasCamera) runCatching { viewModel.camera.bind(owner, preview.takeIf { settings.showPreview }, viewModel::onFrame) }
            .onFailure { cameraError = "Camera unavailable. Retry." }
    }
    var now by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = android.os.SystemClock.elapsedRealtime() } }
    val fresh = hasCamera && viewModel.frameFresh(maxOf(now, android.os.SystemClock.elapsedRealtime()))
    val dev = settings.interfaceMode == InterfaceMode.DEVELOPER
    var details by remember { mutableStateOf(false) }
    var controls by remember { mutableStateOf(false) }
    val s = ui.snapshot
    val active = s.mode != AssistMode.IDLE
    val hazard = s.hazards.firstOrNull().takeIf { fresh && active }
    val status = when {
        !hasCamera -> "Allow camera access."
        model !is ModelState.Ready -> if (model is ModelState.Loading) "Loading detection…" else "Detection unavailable. Check Developer settings."
        cameraError != null || !fresh -> "Camera unavailable. Retry."
        hazard != null -> "Vehicle ${hazard.side.name.lowercase()}."
        active && ui.frameBrightness < 0.04f -> "Camera blocked or too dark. Check the lens."
        active && ui.frameBrightness < 0.12f -> "Too dark. Improve the view."
        active && (s.pitchDeg ?: 0f) < -35 -> "Raise phone. Point ahead."
        active && (s.pitchDeg ?: 0f) > 50 -> "Lower phone. Point ahead."
        !active -> "Camera assistance off"
        journey.phase == "walking" && !journey.crossing -> "Watching nearby traffic"
        s.signal.phase == SignalPhase.UNKNOWN -> "No signal verified"
        !s.signal.trusted -> "Signal colour unverified"
        else -> s.signal.phase.name.replace('_', ' ').lowercase()
    }
    BoxWithConstraints(modifier.fillMaxSize().background(Color.Black)) {
        val detailHeight = maxHeight * 0.38f
        if (hasCamera && settings.showPreview) Box(Modifier.fillMaxSize().clipToBounds().clearAndSetSemantics {}) {
            AndroidView(factory = { preview }, modifier = Modifier.fillMaxSize())
            if (dev && fresh) { SegmentationOverlay(ui.mask, Modifier.fillMaxSize()); if (settings.showOverlay) DetectionOverlay(s, ui.frameAspect, Modifier.fillMaxSize()) }
        }
        Column(Modifier.align(Alignment.TopCenter).fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().background(CrossWiseColors.Glass).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (dev) "CrossWise · Developer" else "CrossWise", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                IconPill(Icons.Default.Mic, if (viewModel.voiceActive) "Stop listening" else "Voice", onClick = viewModel::toggleVoice)
                IconPill(Icons.Default.Settings, "Settings", onClick = onOpenSettings)
            }
            Text(voice, style = MaterialTheme.typography.bodySmall, modifier = Modifier.background(CrossWiseColors.Glass).fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
            if (dev) Row(Modifier.align(Alignment.End).padding(8.dp).background(CrossWiseColors.Glass, RoundedCornerShape(24.dp)), verticalAlignment = Alignment.CenterVertically) {
                IconPill(if (fresh) Icons.Default.Visibility else Icons.Default.VideocamOff, status, onClick = { details = !details })
                for ((category, icon) in listOf(ObjectCategory.CAR to Icons.Default.DirectionsCar, ObjectCategory.MOTORCYCLE to Icons.Default.TwoWheeler)) {
                    val count = if (fresh) s.tracks.count { it.category == category }.toString() else "—"
                    IconButton(onClick = { details = true }, modifier = Modifier.semantics { contentDescription = "${category.name}: $count" }) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, Modifier.size(18.dp)); Text(count, style = MaterialTheme.typography.labelSmall) }
                    }
                }
                IconPill(Icons.Default.Warning, "Alerts: ${if (fresh) s.hazards.size else "unavailable"}", onClick = { details = true })
                IconPill(if (details) Icons.Default.Close else Icons.Default.Tune, if (details) "Close diagnostics" else "Open diagnostics", onClick = { details = !details })
            }
            if (!dev || details) Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().heightIn(max = if (dev) detailHeight else 160.dp)
                .background(CrossWiseColors.Glass, RoundedCornerShape(12.dp)).verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(status, style = MaterialTheme.typography.titleMedium)
                if (!hasCamera) TextButton(onClick = onPermission) { Text("Allow camera") }
                else if (!fresh) TextButton(onClick = { cameraError = null; retry++ }) { Text("Retry camera") }
                if (!dev && journey.phase == "walking") Text(journey.route?.steps?.getOrNull(journey.step)?.instruction.orEmpty())
                if (dev) {
                    Text(if (fresh) "LIVE DIAGNOSTICS · ${s.mode}" else "STALE FRAME", style = MaterialTheme.typography.labelMedium)
                    Text((model as? ModelState.Ready)?.info?.let { "${it.displayName} · ${it.backend} · ${it.inputWidth}px" } ?: "Model unavailable")
                    if (fresh) {
                        Text("${ui.fps.roundToInt()} FPS · ${ui.inferenceMs} ms · Light ${(ui.frameBrightness * 100).roundToInt()}%")
                        Text("Pitch ${s.pitchDeg?.roundToInt() ?: "—"}° · Aim ${s.aimBearingDeg?.roundToInt() ?: "—"}°")
                        Text("Signal ${s.signal.phase} · ${if (s.signal.trusted) "model evidence" else "unverified"}")
                        s.veer?.let { Text("Drift ${it.deviationDeg.roundToInt()}°") }
                        s.crossingElapsedMs?.let { Text("Crossing ${it / 1000}s") }
                        Text("${s.tracks.count { it.category.isVehicle }} vehicles · ${s.tracks.count { it.category == ObjectCategory.PERSON }} people · ${s.hazards.size} alerts")
                        s.tracks.forEach { t ->
                            Text("#${t.id} ${t.category} ${(t.confidence * 100).roundToInt()}% · box ${(t.box.width * 100).roundToInt()}×${(t.box.height * 100).roundToInt()}%")
                            s.hazards.find { it.trackId == t.id }?.let { Text("${it.side} · ${it.level} · optical TTC ${"%.1f".format(it.ttcSeconds)}s", color = CrossWiseColors.Caution) }
                        }
                        Text("Counts include stationary objects. Optical TTC is an image estimate, not measured speed or distance.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(CrossWiseColors.Glass), horizontalAlignment = Alignment.CenterHorizontally) {
            if (s.mode == AssistMode.CROSSING || journey.crossing) TextButton(onClick = { viewModel.finishCrossing() }) { Text("I’m on the footpath") }
            if (dev || controls) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                if (journey.phase != "idle") {
                    TextButton(onClick = { if (journey.phase == "walking") viewModel.journey.pause() else viewModel.journey.start() }) { Text(if (journey.phase == "walking") "Pause" else "Resume") }
                    TextButton(onClick = { viewModel.stopJourney() }) { Text("End journey") }
                } else TextButton(onClick = { viewModel.command(if (active) UserCommand.STOP_ASSIST else UserCommand.START_ASSIST) }) { Text(if (active) "Stop assistance" else "Start camera assistance") }
                if (active && s.mode != AssistMode.CROSSING) TextButton(onClick = { viewModel.beginCrossing() }) { Text("I’m crossing") }
                IconPill(Icons.Default.Refresh, "Repeat", onClick = viewModel::repeatGuidance)
            }
            if (!dev) TextButton(onClick = { controls = !controls }) { Text(if (controls) "Hide controls" else "More controls") }
            IconPill(Icons.Default.KeyboardArrowUp, "Show map", onClick = onMap)
        }
    }
}
/** Draws tracked objects over the center-cropped preview (same crop as PreviewView FILL_CENTER). */
@Composable
private fun DetectionOverlay(snapshot: EngineSnapshot, frameAspect: Float, modifier: Modifier) {
    Canvas(modifier) {
        val viewAspect = size.width / size.height
        val contentWidth: Float
        val contentHeight: Float
        if (viewAspect > frameAspect) {
            contentWidth = size.width
            contentHeight = size.width / frameAspect
        } else {
            contentHeight = size.height
            contentWidth = size.height * frameAspect
        }
        val offsetX = (size.width - contentWidth) / 2f
        val offsetY = (size.height - contentHeight) / 2f
        for (track in snapshot.tracks) {
            val color = when (track.category) {
                ObjectCategory.PED_WALK -> Color(0xFF00E676)
                ObjectCategory.PED_DONT_WALK -> Color(0xFFFF5252)
                ObjectCategory.TRAFFIC_LIGHT, ObjectCategory.PED_COUNTDOWN -> Color(0xFFFFD600)
                ObjectCategory.CROSSWALK -> Color.White
                ObjectCategory.PERSON -> Color(0xFFE040FB)
                else -> if (track.category.isVehicle) Color(0xFF00E5FF) else Color.Gray
            }
            val box = track.box
            val left = (offsetX + box.left * contentWidth).coerceIn(0f, size.width)
            val top = (offsetY + box.top * contentHeight).coerceIn(0f, size.height)
            val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { textSize = 12.dp.toPx(); this.color = color.toArgb(); typeface = android.graphics.Typeface.DEFAULT_BOLD }
            val label = "#${track.id} ${track.category.name.lowercase()} ${(track.confidence * 100).roundToInt()}%"
            drawContext.canvas.nativeCanvas.drawText(label, left.coerceAtMost((size.width - paint.measureText(label)).coerceAtLeast(0f)), (top - 6f).coerceAtLeast(paint.textSize), paint)
            drawRect(
                color = color,
                topLeft = Offset(offsetX + box.left * contentWidth, offsetY + box.top * contentHeight),
                size = Size(box.width * contentWidth, box.height * contentHeight),
                style = Stroke(width = if (track.isPrimarySignal) 8f else 4f),
            )
        }
    }
}

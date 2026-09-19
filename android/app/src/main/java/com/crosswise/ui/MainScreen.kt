package com.crosswise.ui

import android.os.SystemClock
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.R
import com.crosswise.crossing.AssistMode
import com.crosswise.crossing.EngineSnapshot
import com.crosswise.crossing.Side
import com.crosswise.crossing.UserCommand
import com.crosswise.crossing.VeerState
import com.crosswise.perception.ObjectCategory
import com.crosswise.settings.AppSettings
import com.crosswise.signal.SignalPhase
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
fun MainScreen(
    viewModel: CrossWiseViewModel,
    settings: AppSettings,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val model by viewModel.model.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> viewModel.onForeground()
                Lifecycle.Event.ON_STOP -> viewModel.onBackground()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(lifecycleOwner, settings.showPreview) {
        viewModel.camera.bind(lifecycleOwner, previewView.takeIf { settings.showPreview }, viewModel::onFrame)
    }

    val assistOn = ui.snapshot.mode != AssistMode.IDLE
    var detailsOpen by rememberSaveable { mutableStateOf(false) }
    val view = LocalView.current
    DisposableEffect(assistOn) {
        view.keepScreenOn = assistOn
        onDispose { view.keepScreenOn = false }
    }

    // Camera-first: the viewfinder is the surface, everything else floats over it in the thumb zone.
    // A scrim top and bottom keeps the chrome legible over a bright sky without hiding the street.
    Box(modifier.fillMaxSize().background(CrossWiseColors.Background)) {
        if (settings.showPreview) {
            // clipToBounds is required — PreviewView scales its texture to FILL_CENTER and a Compose interop view
            // is not clipped by default, so without it the preview paints over the chrome.
            Box(Modifier.fillMaxSize().clipToBounds()) {
                AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                if (settings.showOverlay) DetectionOverlay(ui.snapshot, ui.frameAspect, Modifier.fillMaxSize())
            }
        }

        Box(Modifier.fillMaxWidth().height(140.dp).align(Alignment.TopCenter).background(CrossWiseColors.TopScrim))
        Box(Modifier.fillMaxWidth().height(260.dp).align(Alignment.BottomCenter).background(CrossWiseColors.BottomScrim))

        Row(
            Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(horizontal = Dimens.gutter, vertical = Dimens.gapSmall),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.app_name),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    modelLabel(model, ui),
                    style = MaterialTheme.typography.labelMedium,
                    color = CrossWiseColors.OnSurfaceMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconPill(
                icon = Icons.Filled.Settings,
                contentDescription = stringResource(R.string.action_settings),
                onClick = onOpenSettings,
            )
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(horizontal = Dimens.gutter)
                .padding(bottom = Dimens.gapMedium),
            verticalArrangement = Arrangement.spacedBy(Dimens.gapSmall),
        ) {
            WarningsPanel(ui, model, expanded = detailsOpen)
            if (detailsOpen) ScenePanel(ui)
            StatusPanel(ui, large = settings.largeStatus, onToggleDetails = { detailsOpen = !detailsOpen }, detailsOpen = detailsOpen)
            Controls(ui.snapshot.mode, viewModel::command)
        }
    }
}

@Composable
private fun modelLabel(model: ModelState, ui: UiState): String = when (model) {
    ModelState.Loading -> stringResource(R.string.model_loading)
    ModelState.Missing -> stringResource(R.string.model_missing)
    is ModelState.Failed -> stringResource(R.string.model_failed, model.message)
    // Short backend here ("GPU"), full detail in Settings: this line must stay one line and stay quiet.
    is ModelState.Ready -> stringResource(
        R.string.model_ready, model.info.displayName, model.info.inputWidth,
        model.info.backend.substringBefore(" ("),
    ) + " · " + stringResource(R.string.perf_stats, ui.fps, ui.inferenceMs.toInt())
}

@Composable
private fun StatusPanel(
    ui: UiState,
    large: Boolean,
    detailsOpen: Boolean,
    onToggleDetails: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = ui.snapshot
    val signal = snapshot.signal
    val accent = when {
        snapshot.mode == AssistMode.IDLE -> CrossWiseColors.Unknown
        !signal.trusted && signal.phase != SignalPhase.UNKNOWN -> CrossWiseColors.Caution
        signal.phase == SignalPhase.WALK && signal.freshWalk -> CrossWiseColors.Walk
        signal.phase.isWalk -> CrossWiseColors.Caution
        signal.phase.isDontWalk -> CrossWiseColors.DontWalk
        snapshot.mode == AssistMode.CROSSING -> CrossWiseColors.Crossing
        else -> CrossWiseColors.Unknown
    }
    val title = when (signal.phase) {
        SignalPhase.UNKNOWN -> stringResource(R.string.phase_unknown)
        SignalPhase.WALK -> stringResource(R.string.phase_walk)
        SignalPhase.WALK_FLASHING -> stringResource(R.string.phase_walk_flashing)
        SignalPhase.DONT_WALK -> stringResource(R.string.phase_dont_walk)
        SignalPhase.DONT_WALK_FLASHING -> stringResource(R.string.phase_dont_walk_flashing)
    }
    val mode = when (snapshot.mode) {
        AssistMode.IDLE -> stringResource(R.string.mode_idle)
        AssistMode.SEARCHING -> stringResource(R.string.mode_searching)
        AssistMode.WAITING -> stringResource(R.string.mode_waiting)
        AssistMode.CROSSING -> stringResource(R.string.mode_crossing)
    }
    val detail = when {
        signal.phase == SignalPhase.UNKNOWN -> null
        !signal.trusted -> stringResource(R.string.phase_detail_unverified)
        signal.phase == SignalPhase.WALK && signal.freshWalk && signal.phaseOnsetMs != null -> {
            val seconds = ((SystemClock.elapsedRealtime() - signal.phaseOnsetMs) / 1000L).toInt()
            stringResource(R.string.phase_detail_fresh, seconds)
        }
        signal.phase == SignalPhase.WALK -> stringResource(R.string.phase_detail_unknown_age)
        else -> null
    }

    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dimens.radiusHero))
            .background(CrossWiseColors.Glass)
            .border(1.dp, CrossWiseColors.Hairline, RoundedCornerShape(Dimens.radiusHero))
            .padding(Dimens.cardPadding)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Dimens.gapSmall / 2),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The state colour reads as a lit indicator beside the words rather than a block behind them,
            // so the panel can stay sheer enough to see the street through.
            Box(Modifier.size(12.dp).clip(CircleShape).background(accent))
            Text(
                mode.uppercase(),
                style = MaterialTheme.typography.labelLarge,
                color = CrossWiseColors.OnSurfaceMuted,
                modifier = Modifier.padding(start = Dimens.gapSmall).weight(1f),
            )
            TextButton(onClick = onToggleDetails, modifier = Modifier.heightIn(min = 40.dp)) {
                Text(
                    stringResource(if (detailsOpen) R.string.action_hide_details else R.string.action_details),
                    style = MaterialTheme.typography.labelLarge,
                    color = CrossWiseColors.Accent,
                )
            }
        }
        Text(
            title,
            style = if (large) MaterialTheme.typography.displayLarge else MaterialTheme.typography.displayMedium,
            color = if (accent == CrossWiseColors.Unknown) CrossWiseColors.OnSurface else Color.White,
        )
        if (detail != null) {
            Text(detail, style = MaterialTheme.typography.bodyLarge, color = CrossWiseColors.OnSurfaceMuted)
        }
        snapshot.veer?.let { veer ->
            val degrees = abs(veer.deviationDeg).roundToInt()
            Text(
                when (veer.state) {
                    VeerState.ON_COURSE -> stringResource(R.string.veer_on_course)
                    VeerState.DRIFTED_LEFT -> stringResource(R.string.veer_drift_left, degrees)
                    VeerState.DRIFTED_RIGHT -> stringResource(R.string.veer_drift_right, degrees)
                },
                style = MaterialTheme.typography.bodyLarge,
            )
        }
        snapshot.hazards.firstOrNull()?.let { hazard ->
            val side = when (hazard.side) {
                Side.LEFT -> stringResource(R.string.side_left)
                Side.AHEAD -> stringResource(R.string.side_ahead)
                Side.RIGHT -> stringResource(R.string.side_right)
            }
            Text(
                stringResource(R.string.hazard_banner, side),
                style = MaterialTheme.typography.titleMedium,
                color = CrossWiseColors.OnHazard,
                modifier = Modifier
                    .padding(top = Dimens.gapSmall / 2)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Dimens.radiusRow))
                    .background(CrossWiseColors.Hazard)
                    .padding(horizontal = Dimens.gapMedium, vertical = Dimens.gapSmall),
            )
        }
        ui.caption?.let {
            Text(
                "\u201c$it\u201d",
                style = MaterialTheme.typography.bodyMedium,
                color = CrossWiseColors.OnSurfaceMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun Controls(mode: AssistMode, onCommand: (UserCommand) -> Unit) {
    val assistOn = mode != AssistMode.IDLE
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Dimens.gapSmall),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BigButton(
            text = stringResource(if (assistOn) R.string.action_stop_short else R.string.action_start_short),
            description = stringResource(if (assistOn) R.string.action_stop_assist else R.string.action_start_assist),
            color = if (assistOn) CrossWiseColors.DontWalk else CrossWiseColors.Walk,
            onClick = { onCommand(if (assistOn) UserCommand.STOP_ASSIST else UserCommand.START_ASSIST) },
            modifier = Modifier.weight(1f),
            primary = true,
        )
        BigButton(
            text = stringResource(
                if (mode == AssistMode.CROSSING) R.string.action_crossing_end_short else R.string.action_crossing_short,
            ),
            description = stringResource(
                if (mode == AssistMode.CROSSING) R.string.action_end_crossing else R.string.action_start_crossing,
            ),
            color = CrossWiseColors.Crossing,
            enabled = assistOn,
            onClick = { onCommand(UserCommand.TOGGLE_CROSSING) },
            modifier = Modifier.weight(1f),
        )
        IconPill(
            icon = Icons.Filled.Refresh,
            contentDescription = stringResource(R.string.action_repeat_status),
            enabled = assistOn,
            onClick = { onCommand(UserCommand.REPEAT_STATUS) },
        )
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
            drawRect(
                color = color,
                topLeft = Offset(offsetX + box.left * contentWidth, offsetY + box.top * contentHeight),
                size = Size(box.width * contentWidth, box.height * contentHeight),
                style = Stroke(width = if (track.isPrimarySignal) 8f else 4f),
            )
        }
    }
}

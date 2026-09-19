package com.crosswise.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.R

@Composable
fun CrossWiseApp(viewModel: CrossWiseViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val settingsLoaded by viewModel.settingsLoaded.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var hasCamera by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var askedForCamera by rememberSaveable { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasCamera = granted
        askedForCamera = true
    }
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf(Tab.ASSIST) }

    // Re-check when returning from the system settings screen.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                hasCamera = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(settingsLoaded, settings.acceptedSafetyNotice) {
        if (settingsLoaded && settings.acceptedSafetyNotice && !hasCamera) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }
    BackHandler(enabled = showSettings || tab != Tab.ASSIST) {
        showSettings = false
        tab = Tab.ASSIST
    }

    Box(Modifier.fillMaxSize().background(CrossWiseColors.Background).safeDrawingPadding()) {
        when {
            !settingsLoaded -> Unit
            !settings.acceptedSafetyNotice -> MessageScreen(
                title = stringResource(R.string.safety_title),
                body = stringResource(R.string.safety_body),
                action = stringResource(R.string.safety_accept),
                onAction = { viewModel.updateSettings { it.copy(acceptedSafetyNotice = true) } },
            )
            !hasCamera -> MessageScreen(
                title = stringResource(R.string.app_name),
                body = stringResource(R.string.camera_permission_needed),
                action = stringResource(R.string.action_grant_camera),
                onAction = {
                    val activity = context as? Activity
                    val canAskAgain = activity == null ||
                        ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)
                    if (askedForCamera && !canAskAgain) {
                        // "Don't ask again" was chosen: the system dialog would not appear, so open app settings.
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                        )
                    } else {
                        permissionLauncher.launch(Manifest.permission.CAMERA)
                    }
                },
            )
            else -> {
                // Assist stays mounted under the other tabs so the camera, engine and announcements keep running
                // while the traveler reads the guide or practises a cue. Only its semantics are hidden.
                val assistVisible = tab == Tab.ASSIST && !showSettings
                Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f)) {
                        MainScreen(
                            viewModel,
                            settings,
                            onOpenSettings = { showSettings = true },
                            modifier = if (assistVisible) Modifier else Modifier.clearAndSetSemantics {},
                        )
                        if (!assistVisible) {
                            Box(
                                Modifier
                                    .fillMaxSize()
                                    .background(CrossWiseColors.Background)
                                    .clickable(
                                        interactionSource = remember { MutableInteractionSource() },
                                        indication = null,
                                    ) {},
                            ) {
                                when {
                                    showSettings -> SettingsScreen(viewModel, onBack = { showSettings = false })
                                    tab == Tab.PRACTICE -> PracticeScreen(viewModel)
                                    tab == Tab.GUIDE -> GuideScreen(viewModel)
                                    else -> Unit
                                }
                            }
                        }
                    }
                    BottomTabs(
                        current = if (showSettings) Tab.SETTINGS else tab,
                        onSelect = { selected ->
                            showSettings = selected == Tab.SETTINGS
                            if (selected != Tab.SETTINGS) tab = selected
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageScreen(title: String, body: String, action: String, onAction: () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            color = Color.White,
            modifier = Modifier.semantics { heading() },
        )
        Text(body, color = Color.White, fontSize = 20.sp, lineHeight = 28.sp)
        BigButton(text = action, color = CrossWiseColors.Crossing, onClick = onAction, modifier = Modifier.fillMaxWidth())
    }
}


enum class Tab(val label: Int) {
    ASSIST(R.string.tab_assist),
    PRACTICE(R.string.tab_practice),
    GUIDE(R.string.tab_guide),
    SETTINGS(R.string.tab_settings),
}

/**
 * Four destinations, always in the same place. Text labels rather than icons: an icon has to be learned, and the
 * people most likely to rely on this app are the least likely to see it clearly.
 */
@Composable
private fun BottomTabs(current: Tab, onSelect: (Tab) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(CrossWiseColors.Surface)
            .padding(horizontal = Dimens.gapSmall, vertical = Dimens.gapSmall),
        horizontalArrangement = Arrangement.spacedBy(Dimens.gapSmall),
    ) {
        Tab.entries.forEach { entry ->
            val selected = entry == current
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = Dimens.touchTarget)
                    .background(
                        if (selected) CrossWiseColors.SurfaceVariant else Color.Transparent,
                        RoundedCornerShape(Dimens.radiusRow),
                    )
                    .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(entry) }),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(entry.label),
                    style = MaterialTheme.typography.titleMedium,
                    color = if (selected) CrossWiseColors.OnSurface else CrossWiseColors.OnSurfaceMuted,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

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
    BackHandler(enabled = showSettings) { showSettings = false }

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
                // Settings are drawn on top so the camera and engine keep running underneath. While they are open,
                // the main screen is hidden from TalkBack and a blocker swallows taps that would fall through.
                MainScreen(
                    viewModel,
                    settings,
                    onOpenSettings = { showSettings = true },
                    modifier = if (showSettings) Modifier.clearAndSetSemantics {} else Modifier,
                )
                if (showSettings) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                            .clearAndSetSemantics {},
                    )
                    SettingsScreen(viewModel, onBack = { showSettings = false })
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

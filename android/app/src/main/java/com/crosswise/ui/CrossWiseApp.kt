package com.crosswise.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.*
import androidx.lifecycle.compose.*

@Composable
fun CrossWiseApp(vm: CrossWiseViewModel) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val loaded by vm.settingsLoaded.collectAsStateWithLifecycle()
    val context = LocalContext.current
    fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    var camera by remember { mutableStateOf(granted(Manifest.permission.CAMERA)) }
    var asked by rememberSaveable { mutableStateOf(false) }
    var permissionReady by remember { mutableStateOf(false) }
    var panel by rememberSaveable { mutableStateOf<String?>(null) }
    val mapOpen by vm.mapOpen.collectAsStateWithLifecycle()
    val journey by vm.journey.state.collectAsStateWithLifecycle()
    LaunchedEffect(journey.phase) { if (journey.phase == "walking") vm.mapOpen.value = false }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        camera = granted(Manifest.permission.CAMERA); permissionReady = true; vm.journey.foreground()
    }
    LaunchedEffect(loaded) {
        if (loaded && !asked) { asked = true; launcher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.RECORD_AUDIO)) }
        else if (loaded) permissionReady = true
    }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) { camera = granted(Manifest.permission.CAMERA); vm.onForeground() }
            if (event == Lifecycle.Event.ON_STOP) vm.onBackground()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(panel, permissionReady) { vm.homeVisible(permissionReady && panel == null) }
    BackHandler(panel != null || mapOpen) { if (panel != null) panel = null else vm.mapOpen.value = false }
    if (!loaded) return
    Box(Modifier.fillMaxSize().background(CrossWiseColors.Background).safeDrawingPadding()) {
        MainScreen(vm, settings, onOpenSettings = { panel = "settings" }, onMap = { vm.mapOpen.value = true }, hasCamera = camera,
            onPermission = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) },
            modifier = if (mapOpen || panel != null) Modifier.clearAndSetSemantics {} else Modifier)
        if (mapOpen) NavigateScreen(vm, onClose = { vm.mapOpen.value = false })
        if (panel != null) Column(Modifier.fillMaxSize().background(CrossWiseColors.Background)) {
            when (panel) {
                "settings" -> SettingsScreen(vm, { panel = null }, { panel = "guide" }, { panel = "practice" })
                else -> {
                    TextButton(onClick = { panel = "settings" }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Back") }
                    if (panel == "guide") GuideScreen(vm) else PracticeScreen(vm)
                }
            }
        }
    }
}

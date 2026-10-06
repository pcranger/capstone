package com.crosswise.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.nav.*
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.*
import com.google.maps.android.compose.*

@Composable
fun NavigateScreen(vm: CrossWiseViewModel, onClose: () -> Unit = {}) {
    val j = vm.journey
    val s by j.state.collectAsStateWithLifecycle()
    val fix by j.location.collectAsStateWithLifecycle()
    val saved by j.saved.collectAsStateWithLifecycle()
    val replacing by j.replacing.collectAsStateWithLifecycle()
    val canUndo by j.canUndo.collectAsStateWithLifecycle()
    val voice by vm.voiceStatus.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    var alias by remember(s.selected?.id) { mutableStateOf("") }
    var aliasOpen by remember(s.selected?.id) { mutableStateOf(false) }
    var steps by remember { mutableStateOf(false) }
    var allSaved by remember { mutableStateOf(false) }
    var following by remember { mutableStateOf(true) }
    var ready by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(LatLng(0.0, 0.0), 2f) }
    var locationTick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(1000); locationTick++ } }
    val valid = remember(fix, locationTick) { j.fresh() }
    LaunchedEffect(fix, ready, following) { if (ready && following && valid != null) camera.move(CameraUpdateFactory.newLatLngZoom(LatLng(valid.latitude, valid.longitude), 17f)) }
    LaunchedEffect(s.route, ready) { if (ready) s.route?.points?.takeIf { it.size > 1 }?.let { points ->
        following = false; val bounds = LatLngBounds.builder(); points.forEach { bounds.include(LatLng(it.latitude, it.longitude)) }; camera.move(CameraUpdateFactory.newLatLngBounds(bounds.build(), 80))
    } }
    LaunchedEffect(camera.isMoving) { if (camera.isMoving && camera.cameraMoveStartedReason == CameraMoveStartedReason.GESTURE) following = false }
    BoxWithConstraints(Modifier.fillMaxSize().background(CrossWiseColors.Background).imePadding()) {
        val sheetHeight = maxHeight * if (expanded) 0.68f else 0.30f
        GoogleMap(Modifier.fillMaxSize(), cameraPositionState = camera, onMapLoaded = { ready = true },
            contentPadding = PaddingValues(bottom = sheetHeight + 12.dp, top = 64.dp, end = 64.dp),
            uiSettings = MapUiSettings(zoomControlsEnabled = false, myLocationButtonEnabled = false, mapToolbarEnabled = false),
            onMapClick = { expanded = false; vm.stopVoice() },
            onPOIClick = { poi -> vm.stopVoice(); if (j.changeDestination()) { j.resolve(SavedPlace(poi.placeId, poi.name)); expanded = true } }) {
            s.route?.let { Polyline(points = it.points.map { p -> LatLng(p.latitude, p.longitude) }, color = CrossWiseColors.Accent, width = 8f) }
            s.selected?.let { Marker(state = rememberUpdatedMarkerState(LatLng(it.point.latitude, it.point.longitude)), title = it.name) }
            s.candidates.forEach { place -> Marker(state = rememberUpdatedMarkerState(LatLng(place.point.latitude, place.point.longitude)), title = place.name,
                onClick = { vm.stopVoice(); j.select(place); expanded = true; true }) }
            valid?.let { Circle(center = LatLng(it.latitude, it.longitude), radius = it.accuracy.toDouble(), fillColor = CrossWiseColors.Accent.copy(alpha = 0.15f), strokeColor = CrossWiseColors.Accent)
                Marker(state = rememberUpdatedMarkerState(LatLng(it.latitude, it.longitude)), title = "Approximate location", icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE)) }
        }
        Row(Modifier.align(Alignment.TopStart).padding(12.dp).background(CrossWiseColors.Glass, RoundedCornerShape(24.dp))) {
            IconPill(Icons.Default.Explore, "North up", onClick = { if (ready) camera.move(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(camera.position).bearing(0f).tilt(0f).build())) })
            IconPill(Icons.Default.MyLocation, "Recenter", onClick = { following = true; j.foreground() })
        }
        Column(Modifier.align(Alignment.BottomEnd).padding(bottom = sheetHeight + 12.dp, end = 12.dp)) {
            IconPill(Icons.Default.Mic, "Voice", onClick = vm::toggleVoice)
            IconPill(Icons.Default.FullscreenExit, "Close full-screen map", onClick = onClose)
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(sheetHeight).background(CrossWiseColors.Surface, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))) {
            Text(voice, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            IconButton(onClick = { expanded = !expanded }, modifier = Modifier.align(Alignment.CenterHorizontally).semantics { contentDescription = if (expanded) "Collapse destination panel" else "Expand destination panel" }) {
                Icon(if (expanded) Icons.Default.KeyboardArrowDown else Icons.Default.KeyboardArrowUp, null)
            }
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (s.phase != "idle" && s.route != null) {
                    Text(if (s.phase == "paused") "Journey paused" else "${s.step + 1} of ${s.route!!.steps.size} · ${s.route!!.destination}")
                    Text(if (s.crossing) "Crossing assistance" else s.route!!.steps.getOrNull(s.step)?.instruction.orEmpty(), style = MaterialTheme.typography.titleMedium)
                    if (s.crossing) TextButton(onClick = vm::finishCrossing) { Text("I’m on the footpath") }
                    else if (s.phase == "walking") TextButton(onClick = j::next) { Text(if (s.step + 1 == s.route!!.steps.size) "I am at my destination" else "I completed this instruction") }
                    Row {
                        TextButton(onClick = vm::repeatGuidance) { Text("Repeat") }
                        TextButton(onClick = { if (s.phase == "walking") j.pause() else j.start() }) { Text(if (s.phase == "walking") "Pause" else "Resume") }
                        TextButton(onClick = vm::stopJourney) { Text("End") }
                    }
                    TextButton(onClick = { vm.stopVoice(); j.changeDestination(); expanded = true }) { Text("Change destination") }
                } else {
                    if (replacing) TextButton(onClick = j::cancelPlanning) { Text("Cancel destination change") }
                    OutlinedTextField(s.query, onValueChange = { vm.stopVoice(); j.edit(it); expanded = true }, label = { Text("Where to?") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (s.selected == null && s.query.isNotBlank()) Button(onClick = { vm.stopVoice(); expanded = true; j.search() }, enabled = !s.busy) { Text("Search") }
                    if (s.selected == null && s.candidates.isEmpty() && saved.isNotEmpty()) {
                        Text("Recently saved", style = MaterialTheme.typography.labelMedium)
                        saved.take(if (allSaved) saved.size else 3).forEach { item -> Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = { vm.stopVoice(); j.resolve(item); expanded = true }, modifier = Modifier.weight(1f)) { Text(item.alias) }
                            IconPill(Icons.Default.Star, "Remove ${item.alias}", onClick = { j.remove(item.id) })
                        } }
                        if (saved.size > 3 && !allSaved) TextButton(onClick = { allSaved = true; expanded = true }) { Text("All saved places") }
                    }
                    s.candidates.forEachIndexed { i, p -> PlaceRow(p, saved.any { it.id == p.id }, { vm.stopVoice(); j.select(p) }, { j.save(p) }, { j.remove(p.id) }, "${i + 1}. ") }
                    s.selected?.let { p ->
                        PlaceRow(p, saved.any { it.id == p.id }, null, { j.save(p) }, { j.remove(p.id) })
                        if (s.route == null) Button(onClick = { vm.stopVoice(); j.confirm() }, enabled = !s.busy) { Text("Confirm place") }
                        TextButton(onClick = { aliasOpen = !aliasOpen }) { Text("Save with a name") }
                        if (aliasOpen) { OutlinedTextField(alias, { alias = it }, label = { Text("Saved name") }); Button(onClick = { j.save(p, alias); aliasOpen = false }, enabled = alias.isNotBlank()) { Text("Save") } }
                    }
                    s.route?.let { route ->
                        Text("${route.distanceMeters} metres · About ${maxOf(1, route.durationSeconds / 60)} minutes")
                        Button(onClick = { vm.stopVoice(); vm.startPlannedJourney() }, enabled = !s.busy) { Text("Start journey") }
                        TextButton(onClick = { steps = !steps }) { Text(if (steps) "Hide instructions" else "Review instructions") }
                        if (steps) route.steps.forEachIndexed { i, step -> Text("${i + 1}. ${step.instruction}") }
                    }
                    if (s.selected != null || s.candidates.isNotEmpty()) TextButton(onClick = { vm.stopVoice(); j.edit() }) { Text("New search") }
                }
                if (canUndo) TextButton(onClick = j::undoRemove) { Text("Undo remove") }
                if (s.busy) { Text("Working…"); TextButton(onClick = { vm.stopVoice(); j.cancel() }) { Text("Cancel") } }
                s.error?.let { Text(it, color = CrossWiseColors.Caution) }
                if (s.route != null) Text("Google walking routes may omit sidewalks or pedestrian paths.", style = MaterialTheme.typography.bodySmall)
                Text("Google Maps", style = MaterialTheme.typography.labelMedium)
                Row { TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.google.com/help/terms_maps/"))) }) { Text("Terms") }
                    TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://policies.google.com/privacy"))) }) { Text("Privacy") } }
            }
        }
    }
}
@Composable
private fun PlaceRow(place: PlaceCandidate, saved: Boolean, select: (() -> Unit)?, save: () -> Unit, remove: () -> Unit, prefix: String = "") {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).then(if (select != null) Modifier.clickable(onClick = select).semantics { role = Role.Button } else Modifier).padding(vertical = 8.dp)) {
            Text(prefix + place.name, style = MaterialTheme.typography.titleMedium); Text(place.address, style = MaterialTheme.typography.bodySmall)
        }
        IconPill(if (saved) Icons.Default.Star else Icons.Default.StarBorder, if (saved) "Remove ${place.name}" else "Save ${place.name}", onClick = if (saved) remove else save)
    }
}

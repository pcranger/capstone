package com.crosswise.nav

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.json.JSONArray
import org.json.JSONObject

data class SavedPlace(val id: String, val alias: String)
data class JourneyState(
    val query: String = "", val candidates: List<PlaceCandidate> = emptyList(), val selected: PlaceCandidate? = null,
    val route: WalkingRoute? = null, val phase: String = "idle", val step: Int = 0, val crossing: Boolean = false,
    val busy: Boolean = false, val error: String? = null,
)

/** Shared foreground GPS owner. Route pause leaves location running; route progress is explicit. */
class JourneyCoordinator(private val context: Context, private val scope: CoroutineScope, private val key: String,
    private val say: (String) -> Unit) {
    val state = MutableStateFlow(JourneyState())
    val location = MutableStateFlow<Location?>(null)
    private val prefs = context.getSharedPreferences("saved_places", Context.MODE_PRIVATE)
    val saved = MutableStateFlow(readSaved())
    private val service = NavigationService()
    private val manager = context.getSystemService(LocationManager::class.java)
    private var job: Job? = null
    private var generation = 0
    private var original: JourneyState? = null
    val replacing = MutableStateFlow(false)
    private var removed: SavedPlace? = null
    private var watching = false
    private val listener = LocationListener { fix -> location.value = fix }
    fun foreground() {
        if (watching || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            runCatching { manager.requestLocationUpdates(provider, 2000L, 0f, listener, Looper.getMainLooper()); watching = true }
        }
    }
    fun background() { cancel(); manager.removeUpdates(listener); watching = false; if (state.value.phase == "walking") pause() }
    fun fresh(): Location? = location.value?.takeIf { it.hasAccuracy() && it.accuracy <= 35 &&
        SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos in 0..15_000_000_000L }
    private suspend fun awaitFix(): Location {
        foreground()
        return withTimeoutOrNull(25_000) { while (fresh() == null) delay(250); fresh()!! }
            ?: error("Location unavailable. Enable precise location and retry.")
    }
    fun edit(query: String = state.value.query) { autoStart = false; cancel(); state.update { it.copy(query = query, candidates = emptyList(), selected = null, route = if (it.phase == "idle") null else it.route, error = null) } }
    fun cancel() { generation++; job?.cancel(); job = null; state.update { it.copy(busy = false) } }
    private fun request(block: suspend () -> Unit) {
        cancel(); val id = generation; state.update { it.copy(busy = true, error = null) }
        job = scope.launch {
            try { block() } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (id == generation) { val message = e.message ?: "Request failed. Retry."; state.update { it.copy(error = message) }; say(message) } }
            finally { if (id == generation) state.update { it.copy(busy = false) } }
        }
    }
    fun changeDestination(): Boolean {
        if (state.value.crossing) { say("Confirm the far footpath first."); return false }
        if (state.value.phase != "idle") { cancel(); original = state.value.copy(phase = "paused"); replacing.value = true; state.value = JourneyState() }
        return true
    }
    fun cancelPlanning() { autoStart = false; cancel(); original?.let { state.value = it }; original = null; replacing.value = false }
    fun search(query: String = state.value.query, navigate: Boolean = false) {
        if (query.isBlank() || !changeDestination()) return
        request {
            val alias = saved.value.firstOrNull { it.alias.equals(query.trim(), true) }
            val results = if (alias != null) listOf(service.details(alias.id, key)) else service.search(query, fresh(), key)
            ensureActive()
            state.update { it.copy(query = query, candidates = results, selected = null, route = null, phase = "idle", step = 0) }
            if (results.isEmpty()) say("No matches. Try a place and suburb.")
            else if (results.size == 1 && navigate) { state.update { it.copy(selected = results.first()) }; plan(results.first(), true) }
            else say(results.mapIndexed { i, p -> "${i + 1}. ${p.name}. ${p.address}." }.joinToString(" ") + " Say first, second or third.")
            autoStart = navigate
        }
    }
    private var autoStart = false
    fun select(place: PlaceCandidate, voice: Boolean = false) {
        cancel(); state.update { it.copy(selected = place, candidates = emptyList(), route = null, error = null) }
        if (voice && autoStart) confirm(true) else if (voice) say("${place.name}. Say confirm to start, or save.")
    }
    fun resolve(saved: SavedPlace) = request { autoStart = false; val place = service.details(saved.id, key); ensureActive(); state.update { it.copy(selected = place, candidates = emptyList(), route = null) } }
    fun confirm(start: Boolean = false) { val place = state.value.selected ?: return; request { plan(place, start) } }
    private suspend fun plan(place: PlaceCandidate, start: Boolean) {
        val fix = awaitFix(); val route = service.walking(fix, place, key); ensureActive()
        require(route.points.isNotEmpty() && route.steps.isNotEmpty()) { "No walking instructions. Try another place." }
        state.update { it.copy(route = route, step = 0) }
        if (start) begin() else say("${place.name}. ${route.distanceMeters} metres. Say start.")
    }
    fun start() = request { begin() }
    private suspend fun begin() {
        val s = state.value; val route = s.route ?: error("Choose a destination first.")
        check(!s.crossing) { "Confirm the far footpath first." }
        val fix = awaitFix()
        if (s.phase == "idle") check(NavigationService.distanceMeters(GeoPoint(fix.latitude, fix.longitude), route.points.first()) <= 40) { "Find a new route from your current position." }
        original = null; replacing.value = false
        state.update { it.copy(phase = "walking") }; repeat()
    }
    fun pause() { cancel(); if (state.value.phase == "walking") { state.update { it.copy(phase = "paused") }; say("Paused.") } }
    fun end() { cancel(); original = null; replacing.value = false; state.value = JourneyState(); say("Journey ended.") }
    fun next() { val s = state.value; if (s.phase != "walking" || s.crossing) return
        if (s.step + 1 >= (s.route?.steps?.size ?: 0)) end() else { state.update { it.copy(step = it.step + 1) }; repeat() }
    }
    fun crossing(value: Boolean) { state.update { it.copy(crossing = value) } }
    fun repeat() { val s = state.value; if (!s.crossing) say(s.route?.steps?.getOrNull(s.step)?.instruction ?: "Say navigate to a place.") }
    fun save(place: PlaceCandidate? = state.value.selected, alias: String? = null) {
        place ?: return
        val label = alias?.trim()?.takeIf { it.isNotBlank() } ?: place.name
        saved.value = listOf(SavedPlace(place.id, label)) + saved.value.filter { it.id != place.id }
        persist(); say("Saved as $label.")
    }
    val canUndo = MutableStateFlow(false)
    fun remove(id: String) { removed = saved.value.find { it.id == id }; canUndo.value = removed != null; saved.value = saved.value.filter { it.id != id }; persist(); say("Removed.") }
    fun undoRemove() { removed?.let { p -> saved.value = listOf(p) + saved.value.filter { it.id != p.id }; persist() }; removed = null; canUndo.value = false; say("Restored.") }
    private fun persist() { prefs.edit().putString("places", JSONArray().apply { saved.value.forEach { put(JSONObject().put("id", it.id).put("alias", it.alias)) } }.toString()).apply() }
    private fun readSaved(): List<SavedPlace> = runCatching { val list = JSONArray(prefs.getString("places", "[]")); (0 until list.length()).map { list.getJSONObject(it).let { p -> SavedPlace(p.getString("id"), p.getString("alias")) } } }.getOrDefault(emptyList())
    private suspend fun ensureActive() { currentCoroutineContext().ensureActive() }
}

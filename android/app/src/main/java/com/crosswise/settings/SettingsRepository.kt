package com.crosswise.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.crosswise.crossing.EngineSettings
import com.crosswise.feedback.FeedbackConfig
import com.crosswise.feedback.Verbosity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Typeface for the whole app; see docs/UI_DESIGN.md. */
enum class AppFont { MODERN, CLASSIC, HYPERLEGIBLE }

data class AppSettings(
    val speech: Boolean = true,
    val tones: Boolean = true,
    val haptics: Boolean = true,
    val speechRate: Float = 1.1f,
    val verbosity: Verbosity = Verbosity.NORMAL,
    val aimSonar: Boolean = true,
    val veerGuidance: Boolean = true,
    val vehicleAlerts: Boolean = true,
    val autoDetectCrossing: Boolean = true,
    val volumeKeys: Boolean = true,
    val useGpu: Boolean = true,
    val scoreThreshold: Float = 0.35f,
    val showPreview: Boolean = true,
    val showOverlay: Boolean = true,
    val logSessions: Boolean = false,
    val appFont: AppFont = AppFont.MODERN,
    /** Everything below covers the camera, so each one is opt-in and off by default unless it is a warning. */
    val showWarnings: Boolean = true,
    val showScene: Boolean = false,
    val showModelLine: Boolean = false,
    val geminiEnabled: Boolean = true,
    val navigationEnabled: Boolean = false,
    val geminiApiKey: String = "",
    val mapsApiKey: String = "",
    /** Low-vision mode: the phase word takes the whole bottom panel instead of a compact line. */
    val largeStatus: Boolean = false,
    /** Absolute path of a user-imported model, or null for the bundled asset. */
    val customModelPath: String? = null,
    val acceptedSafetyNotice: Boolean = false,
) {
    fun engineSettings() = EngineSettings(
        aimSonar = aimSonar,
        veerGuidance = veerGuidance,
        vehicleAlerts = vehicleAlerts,
        autoDetectCrossing = autoDetectCrossing,
        verbosity = verbosity,
    )

    fun feedbackConfig() = FeedbackConfig(speech = speech, tones = tones, haptics = haptics, speechRate = speechRate)
}

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "crosswise_settings")

class SettingsRepository(context: Context) {
    private val store = context.applicationContext.dataStore

    /** The readable mirror of these settings; also how a hand-placed API key reaches the app. */
    val file = SettingsFile(context)

    private object Keys {
        val speech = booleanPreferencesKey("speech")
        val tones = booleanPreferencesKey("tones")
        val haptics = booleanPreferencesKey("haptics")
        val speechRate = floatPreferencesKey("speech_rate")
        val verbosity = stringPreferencesKey("verbosity")
        val appFont = stringPreferencesKey("app_font")
        val showWarnings = booleanPreferencesKey("show_warnings")
        val showScene = booleanPreferencesKey("show_scene")
        val showModelLine = booleanPreferencesKey("show_model_line")
        val geminiEnabled = booleanPreferencesKey("gemini_enabled")
        val navigationEnabled = booleanPreferencesKey("navigation_enabled")
        val geminiApiKey = stringPreferencesKey("gemini_api_key")
        val mapsApiKey = stringPreferencesKey("maps_api_key")
        val largeStatus = booleanPreferencesKey("large_status")
        val aimSonar = booleanPreferencesKey("aim_sonar")
        val veer = booleanPreferencesKey("veer")
        val vehicleAlerts = booleanPreferencesKey("vehicle_alerts")
        val autoCrossing = booleanPreferencesKey("auto_crossing")
        val volumeKeys = booleanPreferencesKey("volume_keys")
        val useGpu = booleanPreferencesKey("use_gpu")
        val threshold = floatPreferencesKey("score_threshold")
        val showPreview = booleanPreferencesKey("show_preview")
        val showOverlay = booleanPreferencesKey("show_overlay")
        val logSessions = booleanPreferencesKey("log_sessions")
        val customModel = stringPreferencesKey("custom_model_path")
        val acceptedSafety = booleanPreferencesKey("accepted_safety_notice")
    }

    // The conf file is applied on top of DataStore, so editing it by hand takes effect on the next read, and
    // whatever the app writes back keeps the file current.
    val settings: Flow<AppSettings> = store.data.map { file.mergeInto(fromPreferences(it)) }

    suspend fun update(transform: (AppSettings) -> AppSettings) {
        store.edit { p ->
            val next = transform(file.mergeInto(fromPreferences(p)))
            file.write(next)
            p[Keys.speech] = next.speech
            p[Keys.tones] = next.tones
            p[Keys.haptics] = next.haptics
            p[Keys.speechRate] = next.speechRate
            p[Keys.verbosity] = next.verbosity.name
            p[Keys.appFont] = next.appFont.name
            p[Keys.showWarnings] = next.showWarnings
            p[Keys.showScene] = next.showScene
            p[Keys.showModelLine] = next.showModelLine
            p[Keys.geminiEnabled] = next.geminiEnabled
            p[Keys.navigationEnabled] = next.navigationEnabled
            p[Keys.geminiApiKey] = next.geminiApiKey
            p[Keys.mapsApiKey] = next.mapsApiKey
            p[Keys.largeStatus] = next.largeStatus
            p[Keys.aimSonar] = next.aimSonar
            p[Keys.veer] = next.veerGuidance
            p[Keys.vehicleAlerts] = next.vehicleAlerts
            p[Keys.autoCrossing] = next.autoDetectCrossing
            p[Keys.volumeKeys] = next.volumeKeys
            p[Keys.useGpu] = next.useGpu
            p[Keys.threshold] = next.scoreThreshold
            p[Keys.showPreview] = next.showPreview
            p[Keys.showOverlay] = next.showOverlay
            p[Keys.logSessions] = next.logSessions
            val customModel = next.customModelPath
            if (customModel == null) p.remove(Keys.customModel) else p[Keys.customModel] = customModel
            p[Keys.acceptedSafety] = next.acceptedSafetyNotice
        }
    }

    private fun fromPreferences(p: Preferences): AppSettings {
        val d = AppSettings()
        return AppSettings(
            speech = p[Keys.speech] ?: d.speech,
            tones = p[Keys.tones] ?: d.tones,
            haptics = p[Keys.haptics] ?: d.haptics,
            speechRate = p[Keys.speechRate] ?: d.speechRate,
            verbosity = p[Keys.verbosity]?.let { v -> Verbosity.entries.firstOrNull { it.name == v } } ?: d.verbosity,
            appFont = p[Keys.appFont]?.let { v -> AppFont.entries.firstOrNull { it.name == v } } ?: d.appFont,
            showWarnings = p[Keys.showWarnings] ?: d.showWarnings,
            showScene = p[Keys.showScene] ?: d.showScene,
            showModelLine = p[Keys.showModelLine] ?: d.showModelLine,
            geminiEnabled = p[Keys.geminiEnabled] ?: d.geminiEnabled,
            navigationEnabled = p[Keys.navigationEnabled] ?: d.navigationEnabled,
            geminiApiKey = p[Keys.geminiApiKey] ?: d.geminiApiKey,
            mapsApiKey = p[Keys.mapsApiKey] ?: d.mapsApiKey,
            largeStatus = p[Keys.largeStatus] ?: d.largeStatus,
            aimSonar = p[Keys.aimSonar] ?: d.aimSonar,
            veerGuidance = p[Keys.veer] ?: d.veerGuidance,
            vehicleAlerts = p[Keys.vehicleAlerts] ?: d.vehicleAlerts,
            autoDetectCrossing = p[Keys.autoCrossing] ?: d.autoDetectCrossing,
            volumeKeys = p[Keys.volumeKeys] ?: d.volumeKeys,
            useGpu = p[Keys.useGpu] ?: d.useGpu,
            scoreThreshold = p[Keys.threshold] ?: d.scoreThreshold,
            showPreview = p[Keys.showPreview] ?: d.showPreview,
            showOverlay = p[Keys.showOverlay] ?: d.showOverlay,
            logSessions = p[Keys.logSessions] ?: d.logSessions,
            customModelPath = p[Keys.customModel],
            acceptedSafetyNotice = p[Keys.acceptedSafety] ?: d.acceptedSafetyNotice,
        )
    }
}

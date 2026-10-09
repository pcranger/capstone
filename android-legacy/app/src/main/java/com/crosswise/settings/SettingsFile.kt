package com.crosswise.settings

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Mirrors the user's settings to a readable JSON file next to the app's data.
 *
 * DataStore is the source of truth at runtime, but it is a binary blob: nobody can read it on a bench, copy it to a
 * second test phone, or put an API key into it without building the app. The conf file is the human-facing side of
 * the same state — written on every change, and read back at startup when a key is missing from DataStore, which is
 * how an API key dropped onto the device by hand gets picked up.
 *
 * Location: `Android/data/com.crosswise.app/files/crosswise.conf.json` — reachable over USB without root.
 */
class SettingsFile(context: Context) {

    private val file = File(context.getExternalFilesDir(null) ?: context.filesDir, FILE_NAME)

    val path: String get() = file.absolutePath

    fun write(settings: AppSettings) {
        runCatching {
            val json = JSONObject().apply {
                put("speech", settings.speech)
                put("tones", settings.tones)
                put("haptics", settings.haptics)
                put("speechRate", settings.speechRate.toDouble())
                put("verbosity", settings.verbosity.name)
                put("appFont", settings.appFont.name)
                put("largeStatus", settings.largeStatus)
                put("showWarnings", settings.showWarnings)
                put("showScene", settings.showScene)
                put("showModelLine", settings.showModelLine)
                put("showPreview", settings.showPreview)
                put("showOverlay", settings.showOverlay)
                put("aimSonar", settings.aimSonar)
                put("veerGuidance", settings.veerGuidance)
                put("vehicleAlerts", settings.vehicleAlerts)
                put("autoDetectCrossing", settings.autoDetectCrossing)
                put("volumeKeys", settings.volumeKeys)
                put("useGpu", settings.useGpu)
                put("scoreThreshold", settings.scoreThreshold.toDouble())
                put("logSessions", settings.logSessions)
                put("customModelPath", settings.customModelPath ?: JSONObject.NULL)
                put("geminiEnabled", settings.geminiEnabled)
                put("navigationEnabled", settings.navigationEnabled)


            }
            file.parentFile?.mkdirs()
            file.writeText(json.toString(2))
        }.onFailure { Log.w(TAG, "Could not write $FILE_NAME", it) }
    }

    /**
     * Applies whatever the file contains on top of [current]. Only keys present in the file are touched, so a
     * hand-written file with nothing but an API key in it works exactly as expected.
     */
    fun mergeInto(current: AppSettings): AppSettings {
        // Write it the first time it is read, so the file is there to be edited without changing a setting first.
        if (!file.exists()) {
            write(current)
            return current
        }
        return runCatching {
            val json = JSONObject(file.readText())
            current.copy(
                speech = json.optBoolean("speech", current.speech),
                tones = json.optBoolean("tones", current.tones),
                haptics = json.optBoolean("haptics", current.haptics),
                speechRate = json.optDouble("speechRate", current.speechRate.toDouble()).toFloat(),
                appFont = json.optString("appFont").toEnum(current.appFont),
                largeStatus = json.optBoolean("largeStatus", current.largeStatus),
                showWarnings = json.optBoolean("showWarnings", current.showWarnings),
                showScene = json.optBoolean("showScene", current.showScene),
                showModelLine = json.optBoolean("showModelLine", current.showModelLine),
                showPreview = json.optBoolean("showPreview", current.showPreview),
                showOverlay = json.optBoolean("showOverlay", current.showOverlay),
                aimSonar = json.optBoolean("aimSonar", current.aimSonar),
                veerGuidance = json.optBoolean("veerGuidance", current.veerGuidance),
                vehicleAlerts = json.optBoolean("vehicleAlerts", current.vehicleAlerts),
                autoDetectCrossing = json.optBoolean("autoDetectCrossing", current.autoDetectCrossing),
                volumeKeys = json.optBoolean("volumeKeys", current.volumeKeys),
                useGpu = json.optBoolean("useGpu", current.useGpu),
                scoreThreshold = json.optDouble("scoreThreshold", current.scoreThreshold.toDouble()).toFloat(),
                logSessions = json.optBoolean("logSessions", current.logSessions),
                // Also file-driven: swapping the active model on a test phone is then one line in a text file.
                customModelPath = if (json.isNull("customModelPath")) null
                else json.optString("customModelPath", current.customModelPath ?: "").ifBlank { null },
                geminiEnabled = json.optBoolean("geminiEnabled", current.geminiEnabled),
                navigationEnabled = json.optBoolean("navigationEnabled", current.navigationEnabled),
                geminiApiKey = json.optString("geminiApiKey", current.geminiApiKey),
                mapsApiKey = json.optString("mapsApiKey", current.mapsApiKey),
            )
        }.getOrElse {
            Log.w(TAG, "Could not read $FILE_NAME", it)
            current
        }
    }

    private inline fun <reified T : Enum<T>> String?.toEnum(fallback: T): T =
        enumValues<T>().firstOrNull { it.name == this } ?: fallback

    companion object {
        private const val TAG = "SettingsFile"
        const val FILE_NAME = "crosswise.conf.json"
    }
}

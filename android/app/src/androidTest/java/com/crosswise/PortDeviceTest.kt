package com.crosswise

import android.Manifest
import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import com.crosswise.perception.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class PortDeviceTest {
    @get:Rule(order = 0) val permissions = GrantPermissionRule.grant(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    @get:Rule(order = 1) val ui = createAndroidComposeRule<MainActivity>()

    @Test fun cameraSettingsDiagnosticsAndMapCanBeOpenedAndClosed() {
        ui.waitUntil(30_000) { ui.onAllNodesWithContentDescription("Settings").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithContentDescription("Settings").performClick()
        ui.onNodeWithText("Developer", useUnmergedTree = true).performClick()
        ui.onNodeWithText("Back").performClick()
        ui.waitUntil(10_000) { ui.onAllNodesWithContentDescription("Open diagnostics").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithContentDescription("Open diagnostics").performClick()
        ui.onNodeWithContentDescription("Close diagnostics").assertExists().performClick()
        ui.onNodeWithContentDescription("Show map").performClick()
        ui.onNodeWithText("Where to?").assertExists()
        ui.onNodeWithContentDescription("Expand destination panel").performClick()
        ui.onNodeWithContentDescription("Collapse destination panel").performClick()
        ui.onNodeWithContentDescription("Close full-screen map").performClick()
        ui.onNodeWithContentDescription("Settings").performClick()
        ui.onNodeWithText("User", useUnmergedTree = true).performClick()
        ui.onNodeWithText("Back").performClick()
        ui.waitUntil(10_000) { ui.onAllNodesWithText("More controls").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("More controls").assertExists()
        ui.onNodeWithContentDescription("Open diagnostics").assertDoesNotExist()
    }

    @Test fun yoloDetectsVehiclesAndPeopleInReferencePhoto() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrumentation.context.assets.open("bus.jpg").use { android.graphics.BitmapFactory.decodeStream(it) }
        try {
            LiteRtDetector.create(instrumentation.targetContext, ModelSource.Asset("models/yolo26n.tflite"), DetectorOptions(preferGpu = false)).use { detector ->
                val result = detector.detect(bitmap, 1L)
                assertTrue("Expected bus", result.detections.any { it.category == ObjectCategory.BUS })
                assertTrue("Expected pedestrian", result.detections.any { it.category == ObjectCategory.PERSON })
            }
        } finally { bitmap.recycle() }
    }

    @Test fun bundledModelsRunOnAndroidCpuWithoutInvalidBoxes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val frame = Bitmap.createBitmap(480, 640, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
        try {
            for (name in listOf("yolo26n.tflite", "crosswise.tflite")) {
                LiteRtDetector.create(context, ModelSource.Asset("models/$name"), DetectorOptions(preferGpu = false)).use { detector ->
                    val result = detector.detect(frame, 1L)
                    assertEquals(480, result.frameWidth); assertEquals(640, result.frameHeight)
                    assertTrue(detector.info.labels.isNotEmpty())
                    result.detections.forEach { d ->
                        assertTrue(d.score.isFinite() && d.score in 0f..1f)
                        assertTrue(d.box.left >= 0 && d.box.top >= 0 && d.box.right <= 1 && d.box.bottom <= 1)
                    }
                }
            }
        } finally { frame.recycle() }
    }
}

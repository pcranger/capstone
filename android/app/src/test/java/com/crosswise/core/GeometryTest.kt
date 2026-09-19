package com.crosswise.core

import org.junit.Assert.assertEquals
import org.junit.Test

class GeometryTest {
    @Test
    fun iouOfIdenticalAndDisjointBoxes() {
        val a = BoxF(0.1f, 0.1f, 0.3f, 0.3f)
        assertEquals(1f, a.iou(a), 1e-6f)
        assertEquals(0f, a.iou(BoxF(0.5f, 0.5f, 0.6f, 0.6f)), 1e-6f)
    }

    @Test
    fun iouOfHalfOverlap() {
        val a = BoxF(0f, 0f, 0.2f, 0.2f)
        val b = BoxF(0.1f, 0f, 0.3f, 0.2f)
        // intersection 0.02, union 0.06
        assertEquals(1f / 3f, a.iou(b), 1e-5f)
    }

    @Test
    fun wrapAngles() {
        assertEquals(10f, Angles.wrap180(370f), 1e-4f)
        assertEquals(-170f, Angles.wrap180(190f), 1e-4f)
        assertEquals(180f, Angles.wrap180(-180f), 1e-4f)
        assertEquals(350f, Angles.wrap360(-10f), 1e-4f)
    }

    @Test
    fun bearingFromImagePosition() {
        assertEquals(0f, Angles.bearingFromImageX(0.5f, 60f), 1e-4f)
        assertEquals(30f, Angles.bearingFromImageX(1f, 60f), 1e-3f)
        assertEquals(-30f, Angles.bearingFromImageX(0f, 60f), 1e-3f)
        assertEquals(22.5f, Angles.elevationFromImageY(0f, 45f), 1e-3f)
    }
}

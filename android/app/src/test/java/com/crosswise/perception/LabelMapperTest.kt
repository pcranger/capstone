package com.crosswise.perception

import org.junit.Assert.assertEquals
import org.junit.Test

class LabelMapperTest {
    private fun assertMaps(expected: ObjectCategory, vararg names: String) {
        names.forEach { assertEquals("label '$it'", expected, LabelMapper.categoryFor(it)) }
    }

    @Test
    fun canonicalNames() {
        assertMaps(ObjectCategory.PED_DONT_WALK, "ped_red")
        assertMaps(ObjectCategory.PED_WALK, "ped_green")
        assertMaps(ObjectCategory.CROSSWALK, "crosswalk")
        assertMaps(ObjectCategory.MOTORCYCLE, "motorcycle", "motorbike")
    }

    @Test
    fun cocoNames() {
        assertMaps(ObjectCategory.TRAFFIC_LIGHT, "traffic light")
        assertMaps(ObjectCategory.PERSON, "person")
        assertMaps(ObjectCategory.CAR, "car")
        assertMaps(ObjectCategory.OTHER, "handbag", "stop sign", "fire hydrant")
    }

    @Test
    fun communityDatasetNames() {
        assertMaps(ObjectCategory.PED_DONT_WALK, "red-pedestrian-light", "Red Pedestrian Traffic Light", "dont_walk", "red man")
        assertMaps(ObjectCategory.PED_WALK, "green-pedestrian-light", "Green Pedestrian Traffic Light", "walk", "green man")
        assertMaps(ObjectCategory.CROSSWALK, "zebra_crossing", "Pedestrian Crossing", "Zebra Cross")
        assertMaps(ObjectCategory.PERSON, "pedestrian")
    }

    @Test
    fun colorWithoutPedestrianHintIsNotTrusted() {
        assertMaps(ObjectCategory.TRAFFIC_LIGHT, "red light", "green-light", "traffic_signal")
    }
}

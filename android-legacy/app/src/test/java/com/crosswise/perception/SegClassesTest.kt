package com.crosswise.perception

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SegClassesTest {
    @Test fun broadLabelsDoNotEstablishCrosswalkOrPerson() {
        for (label in listOf("Markings", "Paved", "Road", "People/Animals", "Curb", "Sidewalk")) {
            assertEquals(ObjectCategory.OTHER, SegClasses.categoryFor(label))
        }
        assertEquals(ObjectCategory.TRAFFIC_LIGHT, SegClasses.categoryFor("Signals"))
        assertEquals(ObjectCategory.CAR, SegClasses.categoryFor("Vehicles"))
    }

    @Test fun metadataOrderControlsMeaning() {
        val labels = SegClasses.labelsFor(3, listOf("Vehicles", "Markings", "crosswalk"))
        assertEquals(listOf(ObjectCategory.CAR, ObjectCategory.OTHER, ObjectCategory.CROSSWALK),
            labels.map(SegClasses::categoryFor))
    }

    @Test fun missingMetadataDoesNotInventTaxonomy() {
        val labels = SegClasses.labelsFor(16, null)
        assertEquals(16, labels.size)
        assertTrue(labels.all { SegClasses.categoryFor(it) == ObjectCategory.OTHER })
    }

    @Test(expected = IllegalArgumentException::class)
    fun inconsistentMetadataIsRejected() {
        SegClasses.labelsFor(16, listOf("crosswalk"))
    }
}

package com.crosswise.perception

import android.graphics.Color

/**
 * The sixteen sidewalk classes and the palette from the AN-S3 project (UOW research), kept byte-identical so a
 * model trained there is read here exactly as its authors intended — same order, same colours, same legend.
 *
 * These are surfaces and regions, not the traffic objects this app's crossing logic is built on, so only the four
 * that overlap are mapped onto CrossWise categories; the rest exist to be seen, not to steer a decision.
 */
object SegClasses {

    val LABELS = listOf(
        "Road", "Paved", "Markings", "Steps", "Structures", "Entrances", "Obstacles", "Signals",
        "Signs", "Vegetation", "Natural", "Hazards", "Water", "Sky", "People/Animals", "Vehicles",
    )

    val COLORS = listOf(
        Color.parseColor("#9013fe"), // Road
        Color.parseColor("#24ca19"), // Paved
        Color.parseColor("#ffffff"), // Markings
        Color.parseColor("#f8e71c"), // Steps
        Color.parseColor("#9b9b9b"), // Structures
        Color.parseColor("#4a4a4a"), // Entrances
        Color.parseColor("#fd66dc"), // Obstacles
        Color.parseColor("#d6b673"), // Signals
        Color.parseColor("#50e3c2"), // Signs
        Color.parseColor("#417505"), // Vegetation
        Color.parseColor("#ff9f00"), // Natural
        Color.parseColor("#8b572a"), // Hazards
        Color.parseColor("#2f64c6"), // Water
        Color.parseColor("#75b5ff"), // Sky
        Color.parseColor("#ff0a28"), // People/Animals
        Color.parseColor("#293092"), // Vehicles
    )

    /**
     * Only where the meaning genuinely carries over. "Markings" becomes a crosswalk because painted road markings
     * are what the crossing logic looks for; "Signals" becomes an unverified traffic light because this model
     * knows a signal is present but not what colour it shows.
     */
    fun categoryOf(index: Int): ObjectCategory = when (LABELS.getOrNull(index)) {
        "People/Animals" -> ObjectCategory.PERSON
        "Vehicles" -> ObjectCategory.CAR
        "Signals" -> ObjectCategory.TRAFFIC_LIGHT
        "Markings" -> ObjectCategory.CROSSWALK
        else -> ObjectCategory.OTHER
    }
}

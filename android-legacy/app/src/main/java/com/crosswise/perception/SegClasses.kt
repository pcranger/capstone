package com.crosswise.perception

import android.graphics.Color

/**
 * The sixteen sidewalk classes and the palette from the AN-S3 project (UOW research), kept byte-identical so a
 * model trained there is read here exactly as its authors intended — same order, same colours, same legend.
 *
 * These are surfaces and regions. Broad labels must not imply a specific crossing or pedestrian signal state.
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
     * Map explicit labels, not class positions. Markings include parking bays and lane paint;
     * People/Animals cannot establish that a person is present.
     */
    fun categoryFor(label: String): ObjectCategory = when (val name = LabelMapper.normalize(label)) {
        "vehicles" -> ObjectCategory.CAR
        "signals" -> ObjectCategory.TRAFFIC_LIGHT
        else -> LabelMapper.CANONICAL[name] ?: ObjectCategory.OTHER
    }

    fun labelsFor(classes: Int, names: List<String>?): List<String> {
        require(classes > 0) { "Invalid segmentation class count." }
        require(names == null || names.size == classes) { "Segmentation labels do not match the model output." }
        return names?.toList() ?: List(classes) { "class_$it" }
    }
}

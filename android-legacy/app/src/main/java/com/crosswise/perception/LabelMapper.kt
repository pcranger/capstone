package com.crosswise.perception

/**
 * Maps a model's class names to [ObjectCategory].
 *
 * The CrossWise training pipeline (ml/) emits the canonical names in [CANONICAL]; COCO names are
 * supported so an off-the-shelf COCO model can be used as a baseline; the token rules make most
 * community datasets (Roboflow etc.) work without code changes. Matching is done on whole tokens
 * so that e.g. COCO "handbag" is not mistaken for a "hand" (don't walk) signal.
 */
object LabelMapper {

    val CANONICAL: Map<String, ObjectCategory> = mapOf(
        "ped_red" to ObjectCategory.PED_DONT_WALK,
        "ped_green" to ObjectCategory.PED_WALK,
        "ped_countdown" to ObjectCategory.PED_COUNTDOWN,
        "crosswalk" to ObjectCategory.CROSSWALK,
        "person" to ObjectCategory.PERSON,
        "pedestrian" to ObjectCategory.PERSON,
        "pedestrians" to ObjectCategory.PERSON,
        "people" to ObjectCategory.PERSON,
        "bicycle" to ObjectCategory.BICYCLE,
        "bike" to ObjectCategory.BICYCLE,
        "car" to ObjectCategory.CAR,
        "van" to ObjectCategory.CAR,
        "taxi" to ObjectCategory.CAR,
        "motorcycle" to ObjectCategory.MOTORCYCLE,
        "motorbike" to ObjectCategory.MOTORCYCLE,
        "scooter" to ObjectCategory.MOTORCYCLE,
        "bus" to ObjectCategory.BUS,
        "truck" to ObjectCategory.TRUCK,
        "lorry" to ObjectCategory.TRUCK,
        "traffic_light" to ObjectCategory.TRAFFIC_LIGHT,
    )

    private val separators = Regex("[^a-z0-9]+")

    fun normalize(rawName: String): String = rawName.trim().lowercase()
        .replace("'", "")
        .replace(separators, "_")
        .trim('_')

    fun categoryFor(rawName: String): ObjectCategory {
        val n = normalize(rawName)
        CANONICAL[n]?.let { return it }

        val tokens = n.split('_').filter { it.isNotEmpty() }
        fun tok(vararg words: String) = tokens.any { it in words }
        fun prefix(vararg words: String) = tokens.any { t -> words.any { t.startsWith(it) } }

        val lightWord = prefix("light", "signal", "lamp")
        val colorWord = tok("red", "green")
        if (prefix("zebra", "crosswalk", "crossing") && !lightWord && !colorWord) return ObjectCategory.CROSSWALK
        if (prefix("countdown", "timer", "digit")) return ObjectCategory.PED_COUNTDOWN

        val pedestrianHint = prefix("ped", "cross") ||
            tok("walk", "walking", "man", "hand", "person", "dontwalk", "nowalk")
        if (lightWord || pedestrianHint) {
            val stop = tok("red", "stop", "dont", "donot", "no", "wait", "hand", "dontwalk", "nowalk")
            val go = tok("green", "go", "walk", "walking", "white")
            return when {
                stop && pedestrianHint -> ObjectCategory.PED_DONT_WALK
                go && pedestrianHint -> ObjectCategory.PED_WALK
                // A red/green light without a pedestrian hint may be a vehicle signal: never trust its phase.
                lightWord -> ObjectCategory.TRAFFIC_LIGHT
                else -> ObjectCategory.OTHER
            }
        }
        return ObjectCategory.OTHER
    }
}

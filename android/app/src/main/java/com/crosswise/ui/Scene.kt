package com.crosswise.ui

import com.crosswise.crossing.EngineSnapshot
import com.crosswise.perception.ObjectCategory

/**
 * Turns the engine snapshot into the short facts the Assist screen shows and TalkBack reads.
 *
 * Directions are given on a **clock face**. Orientation and mobility training uses it ("entrance at 2 o'clock"),
 * every other navigation app for blind travelers uses it, and it carries far more than "left / right": 11 and 1
 * o'clock are both nearly ahead, and the difference matters when a car is coming.
 */
object Scene {

    /** 9 o'clock at the left edge of the frame, 12 straight ahead, 3 at the right edge. */
    fun clockOf(centerX: Float): Int {
        val clamped = centerX.coerceIn(0f, 1f)
        val hour = Math.round(9 + clamped * 6).coerceIn(9, 15)
        return if (hour > 12) hour - 12 else hour
    }

    data class Nearby(val category: ObjectCategory, val count: Int, val nearestClock: Int)

    /** Vehicles and people currently tracked, biggest first — "biggest" is the best proxy we have for closest. */
    fun nearby(snapshot: EngineSnapshot): List<Nearby> = snapshot.tracks
        .filter { it.category in TRAFFIC }
        .groupBy { it.category }
        .map { (category, tracks) ->
            val nearest = tracks.maxBy { it.box.area }
            Nearby(category, tracks.size, clockOf(nearest.box.centerX))
        }
        .sortedByDescending { it.count }

    fun signalClock(snapshot: EngineSnapshot): Int? =
        snapshot.signal.primaryBox?.let { clockOf(it.centerX) }

    fun crosswalkSeen(snapshot: EngineSnapshot): Boolean =
        snapshot.tracks.any { it.category == ObjectCategory.CROSSWALK }

    /** Seconds since the signal was last actually seen, for "signal out of view" wording. */
    fun signalAgeSeconds(snapshot: EngineSnapshot, nowMs: Long): Int? =
        snapshot.signal.lastSeenMs?.let { ((nowMs - it) / 1000L).toInt() }

    /** 0 = no idea, 1 = certain. The larger of the two evidence pools, which is what drove the phase. */
    fun confidence(snapshot: EngineSnapshot): Float =
        maxOf(snapshot.signal.walkEvidence, snapshot.signal.dontWalkEvidence).coerceIn(0f, 1f)

    fun compassPoint(bearingDeg: Float): String {
        val points = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
        val index = Math.floorMod(Math.round(bearingDeg / 45f), 8)
        return points[index]
    }

    private val TRAFFIC = setOf(
        ObjectCategory.PERSON, ObjectCategory.BICYCLE, ObjectCategory.CAR,
        ObjectCategory.MOTORCYCLE, ObjectCategory.BUS, ObjectCategory.TRUCK,
    )
}

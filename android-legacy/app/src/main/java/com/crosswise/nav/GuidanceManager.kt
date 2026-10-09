package com.crosswise.nav

import android.location.Location
import com.crosswise.nav.NavigationService.Companion.bearing
import com.crosswise.nav.NavigationService.Companion.distanceMeters
import com.crosswise.nav.NavigationService.Companion.distanceToSegmentMeters
import com.crosswise.nav.NavigationService.Companion.projectionRatio

/**
 * Turns a route plus a GPS fix into one short spoken instruction.
 *
 * Ported from `GuidanceManager` in the AN-S3 project (UOW research): the same 15 m corridor, the same 5 m arrival
 * threshold, the same anti-backtracking rule (advance only when the walker is 95% along a segment), and the same
 * clock-face phrasing relative to where the phone is pointing — which is the right frame of reference for someone
 * who cannot see the map and is holding the phone.
 *
 * What is different: it only speaks when the instruction actually changes, and it never says a street is clear.
 */
class GuidanceManager {

    private var route: WalkingRoute? = null
    private var index = -1
    private var lastSpoken: String? = null

    val destination: String? get() = route?.destination
    var arrived: Boolean = false
        private set

    fun start(route: WalkingRoute) {
        this.route = route
        index = -1
        lastSpoken = null
        arrived = false
    }

    fun stop() {
        route = null
        index = -1
        lastSpoken = null
    }

    /**
     * @param phoneBearing where the phone is pointing, degrees from north.
     * @return an instruction to speak, or null when nothing has changed.
     */
    fun update(location: Location, phoneBearing: Float): String? {
        val path = route?.points?.takeIf { it.size >= 2 } ?: return null
        val here = GeoPoint(location.latitude, location.longitude)

        val toEnd = distanceMeters(here, path.last())
        if (toEnd < ARRIVAL_METERS) {
            arrived = true
            val text = "You are arriving at ${route?.destination ?: "your destination"}."
            return text.takeIf { it != lastSpoken }?.also { lastSpoken = it; stop() }
        }

        if (index < 0) {
            index = path.indices.drop(1).minByOrNull { distanceToSegmentMeters(here, path[it - 1], path[it]) }
                ?.minus(1) ?: 0
        } else if (index < path.size - 1) {
            // Advance only at the very end of a segment, so a wobbly fix cannot walk the route forwards for you.
            if (projectionRatio(here, path[index], path[index + 1]) > 0.95) index++
        }
        index = index.coerceIn(0, path.size - 2)

        val target = path[index + 1]
        val offPath = distanceToSegmentMeters(here, path[index], target) > CORRIDOR_METERS
        val metres = distanceMeters(here, target).toInt()
        val clock = clockFace(bearing(here, target), phoneBearing)

        val text = when {
            offPath -> "Off the route. Head $clock, ${metres} metres, to get back on it."
            metres <= TURN_SOON_METERS -> "In $metres metres, go $clock."
            else -> "Continue $clock for $metres metres."
        }
        return text.takeIf { it != lastSpoken }?.also { lastSpoken = it }
    }

    /**
     * 12 o'clock is where the phone points, not north. Their convention, and the only one that makes sense when the
     * listener's frame of reference is their own body.
     */
    private fun clockFace(targetBearing: Double, phoneBearing: Float): String {
        val relative = ((targetBearing - phoneBearing) + 360.0) % 360.0
        // Round to the nearest hour rather than truncating, so 359° reads as 12 o'clock and not 11.
        var hour = Math.round(relative / 30.0).toInt()
        if (hour == 0) hour = 12
        if (hour > 12) hour -= 12
        return "$hour o'clock"
    }

    companion object {
        private const val CORRIDOR_METERS = 15.0
        private const val ARRIVAL_METERS = 5.0
        private const val TURN_SOON_METERS = 15
    }
}

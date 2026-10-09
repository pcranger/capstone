package com.crosswise.crossing

import com.crosswise.perception.ObjectCategory
import com.crosswise.tracking.Looming
import com.crosswise.tracking.Track
import com.crosswise.tracking.TrackGroup

enum class HazardLevel { WARNING, CRITICAL }

enum class Side { LEFT, AHEAD, RIGHT }

data class VehicleHazard(
    val trackId: Int,
    val category: ObjectCategory,
    val level: HazardLevel,
    val side: Side,
    val ttcSeconds: Float,
    val heightFraction: Float,
)

/**
 * Flags vehicles that are getting closer to the camera fast, using optical expansion (looming).
 * Vehicles passing across the view keep their size and are deliberately not flagged.
 */
class HazardMonitor(
    private val warnTtcSeconds: Float = 3.0f,
    private val warnTtcWhileCrossing: Float = 4.0f,
    private val criticalTtcSeconds: Float = 1.6f,
    private val minHeightFraction: Float = 0.05f,
    private val minFitQuality: Float = 0.6f,
    private val minHits: Int = 4,
) {
    fun assess(tracks: List<Track>, timestampMs: Long, frameAspect: Float, crossing: Boolean): List<VehicleHazard> {
        val warnTtc = if (crossing) warnTtcWhileCrossing else warnTtcSeconds
        val hazards = ArrayList<VehicleHazard>()
        for (track in tracks) {
            if (track.group != TrackGroup.VEHICLE || track.hits < minHits) continue
            if (timestampMs - track.lastSeenMs > 250) continue
            val ttc = Looming.estimate(track.samples, frameAspect) ?: continue
            if (ttc.heightFraction < minHeightFraction || ttc.rSquared < minFitQuality) continue
            val level = when {
                ttc.seconds <= criticalTtcSeconds -> HazardLevel.CRITICAL
                ttc.seconds <= warnTtc -> HazardLevel.WARNING
                else -> null
            } ?: continue
            val cx = track.box.centerX
            val side = when {
                cx < 0.38f -> Side.LEFT
                cx > 0.62f -> Side.RIGHT
                else -> Side.AHEAD
            }
            hazards += VehicleHazard(track.id, track.category, level, side, ttc.seconds, ttc.heightFraction)
        }
        return hazards.sortedBy { it.ttcSeconds }
    }
}

import type { ObjectCategory } from '../perception/detection';
import { Looming } from '../tracking/looming';
import { type Track, TrackGroup } from '../tracking/objectTracker';

export enum HazardLevel {
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum Side {
  LEFT = 'LEFT',
  AHEAD = 'AHEAD',
  RIGHT = 'RIGHT',
}

export interface VehicleHazard {
  trackId: number;
  uncertain?: boolean;
  approaching?: boolean;
  category: ObjectCategory;
  level: HazardLevel;
  side: Side;
  ttcSeconds: number;
  heightFraction: number;
}

/**
 * Flags vehicles that are getting closer to the camera fast, using optical expansion (looming).
 * Vehicles passing across the view keep their size and are deliberately not flagged.
 */
export class HazardMonitor {
  constructor(
    private readonly warnTtcSeconds = 3.0,
    private readonly warnTtcWhileCrossing = 4.0,
    private readonly criticalTtcSeconds = 1.6,
    private readonly minHeightFraction = 0.05,
    private readonly minFitQuality = 0.6,
    private readonly minHits = 4,
  ) {}

  assess(tracks: readonly Track[], timestampMs: number, frameAspect: number, crossing: boolean): VehicleHazard[] {
    const warnTtc = crossing ? this.warnTtcWhileCrossing : this.warnTtcSeconds;
    const hazards: VehicleHazard[] = [];
    for (const track of tracks) {
      if (track.group !== TrackGroup.VEHICLE || track.hits < this.minHits) continue;
      if (timestampMs - track.lastSeenMs > 250) continue;
      const ttc = Looming.estimate(track.samples, frameAspect);
      if (!ttc) continue;
      if (ttc.heightFraction < this.minHeightFraction || ttc.rSquared < this.minFitQuality) continue;
      let level: HazardLevel | null = null;
      if (ttc.seconds <= this.criticalTtcSeconds) level = HazardLevel.CRITICAL;
      else if (ttc.seconds <= warnTtc) level = HazardLevel.WARNING;
      if (level === null) continue;
      const cx = track.box.centerX;
      const side = cx < 0.38 ? Side.LEFT : cx > 0.62 ? Side.RIGHT : Side.AHEAD;
      hazards.push({
        trackId: track.id,
        category: track.category,
        level,
        side,
        ttcSeconds: ttc.seconds,
        heightFraction: ttc.heightFraction,
      });
    }
    return hazards.sort((a, b) => a.ttcSeconds - b.ttcSeconds);
  }
}

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
  /** Growth only seen on this and the last frame or two: could be sway, a walking jolt or box jitter, so it is not spoken yet (CW-14). */
  pending?: boolean;
  category: ObjectCategory;
  level: HazardLevel;
  side: Side;
  ttcSeconds: number;
  heightFraction: number;
  /** Looming has held for `minFramesToConfirm` assessments in a row. Single-frame spikes are not an approaching car. */
  sustained?: boolean;
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
    private readonly minFramesToConfirm = 3,
    private readonly maxGapMs = 400,
  ) {}

  /** For each track that was looming at the last assessment: how many assessments in a row, and when. */
  private streaks = new Map<number, { frames: number; lastMs: number }>();

  assess(tracks: readonly Track[], timestampMs: number, frameAspect: number, crossing: boolean): VehicleHazard[] {
    const warnTtc = crossing ? this.warnTtcWhileCrossing : this.warnTtcSeconds;
    const hazards: VehicleHazard[] = [];
    const streaks = new Map<number, { frames: number; lastMs: number }>();
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
      const previous = this.streaks.get(track.id);
      const frames = previous && timestampMs - previous.lastMs <= this.maxGapMs ? previous.frames + 1 : 1;
      streaks.set(track.id, { frames, lastMs: timestampMs });
      const cx = track.box.centerX;
      const side = cx < 0.38 ? Side.LEFT : cx > 0.62 ? Side.RIGHT : Side.AHEAD;
      hazards.push({
        trackId: track.id,
        category: track.category,
        level,
        side,
        ttcSeconds: ttc.seconds,
        heightFraction: ttc.heightFraction,
        sustained: frames >= this.minFramesToConfirm,
      });
    }
    this.streaks = streaks;
    return hazards.sort((a, b) => a.ttcSeconds - b.ttcSeconds);
  }
}

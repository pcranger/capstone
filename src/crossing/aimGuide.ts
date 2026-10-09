import { type Cue, Cues, HapticPattern, ToneKind } from '../feedback/cue';

/**
 * "Signal sonar": while the user scans the intersection, ticks speed up as the signal (or crosswalk)
 * gets closer to the center of the camera view and come from its side in stereo headphones.
 * A distinct chime + tick marks the moment it is centered.
 */
export class AimGuide {
  private lastTickMs = Number.MIN_SAFE_INTEGER / 2;
  private centeredSinceMs: number | null = null;
  private announcedTarget: number | null = null;

  constructor(
    private readonly centeredToleranceDeg = 4,
    private readonly centeredHoldMs = 600,
    private readonly farBearingDeg = 25,
    private readonly slowestIntervalMs = 900,
    private readonly fastestIntervalMs = 180,
  ) {}

  /**
   * Returns the tones/haptics to play for this frame. onCentered is invoked once per target, after it
   * has stayed centered for centeredHoldMs. sparse limits ticks to when the user drifts off target.
   */
  update(
    timestampMs: number,
    targetId: number | null,
    bearingDeg: number | null,
    sparse: boolean,
    onCentered: () => void,
  ): Cue[] {
    if (targetId === null || bearingDeg === null) {
      this.centeredSinceMs = null;
      return [];
    }
    const cues: Cue[] = [];
    const magnitude = Math.abs(bearingDeg);
    if (magnitude <= this.centeredToleranceDeg) {
      if (this.centeredSinceMs === null) this.centeredSinceMs = timestampMs;
      if (timestampMs - this.centeredSinceMs >= this.centeredHoldMs && this.announcedTarget !== targetId) {
        this.announcedTarget = targetId;
        cues.push(Cues.tone(ToneKind.CENTERED));
        cues.push(Cues.haptic(HapticPattern.CENTERED_TICK));
        onCentered();
      }
    } else {
      this.centeredSinceMs = null;
    }

    // While waiting at the curb (sparse), only tick if the user has drifted off target.
    if (sparse && magnitude <= 10) return cues;
    const t = Math.min(
      Math.max((magnitude - this.centeredToleranceDeg) / (this.farBearingDeg - this.centeredToleranceDeg), 0),
      1,
    );
    const baseInterval = this.fastestIntervalMs + (this.slowestIntervalMs - this.fastestIntervalMs) * t;
    const interval = sparse ? Math.max(2_000, Math.trunc(baseInterval)) : Math.trunc(baseInterval);
    if (timestampMs - this.lastTickMs >= interval) {
      this.lastTickMs = timestampMs;
      cues.push(Cues.tone(ToneKind.SONAR, Math.min(Math.max(bearingDeg / 30, -1), 1)));
    }
    return cues;
  }

  reset(): void {
    this.centeredSinceMs = null;
    this.announcedTarget = null;
  }
}

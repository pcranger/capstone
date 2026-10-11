import { Angles } from '../core/geometry';

export enum VeerState {
  ON_COURSE = 'ON_COURSE',
  DRIFTED_LEFT = 'DRIFTED_LEFT',
  DRIFTED_RIGHT = 'DRIFTED_RIGHT',
}

export interface VeerStatus {
  /** Smoothed heading minus locked heading, degrees. + means the user now faces right of the crossing line. */
  deviationDeg: number;
  state: VeerState;
  lockedHeadingDeg: number;
}

/**
 * Keeps the user's heading locked to the direction they faced when the crossing started and reports
 * sustained drift. Uses the gyroscope-based attitude (no compass), which is immune to the
 * magnetic disturbance from nearby cars and stays accurate over the ~10-30 s of a crossing.
 */
export class VeerMonitor {
  private lockedHeading: number | null = null;
  private sinSum = 0;
  private cosSum = 1;
  private lastMs: number | null = null;
  private state = VeerState.ON_COURSE;
  private driftSinceMs: number | null = null;

  constructor(
    private readonly warnDeg = 12,
    private readonly clearDeg = 6,
    private readonly sustainMs = 1_000,
    private readonly smoothingTauMs = 600,
  ) {}

  get isLocked(): boolean {
    return this.lockedHeading !== null;
  }

  lock(headingDeg: number, timestampMs: number): void {
    this.lockedHeading = headingDeg;
    const rad = Angles.toRad(headingDeg);
    this.sinSum = Math.sin(rad);
    this.cosSum = Math.cos(rad);
    this.lastMs = timestampMs;
    this.state = VeerState.ON_COURSE;
    this.driftSinceMs = null;
  }

  unlock(): void {
    this.lockedHeading = null;
    this.lastMs = null;
    this.driftSinceMs = null;
    this.state = VeerState.ON_COURSE;
  }

  update(headingDeg: number, timestampMs: number): VeerStatus | null {
    const locked = this.lockedHeading;
    if (locked === null) return null;
    const dt = this.lastMs !== null ? Math.min(Math.max(timestampMs - this.lastMs, 0), 1_000) : 0;
    this.lastMs = timestampMs;
    const alpha = 1 - Math.exp(-dt / this.smoothingTauMs);
    const rad = Angles.toRad(headingDeg);
    this.sinSum += alpha * (Math.sin(rad) - this.sinSum);
    this.cosSum += alpha * (Math.cos(rad) - this.cosSum);
    const smoothed = Angles.toDeg(Math.atan2(this.sinSum, this.cosSum));
    const deviation = Angles.wrap180(smoothed - locked);

    const drifting =
      deviation >= this.warnDeg ? VeerState.DRIFTED_RIGHT : deviation <= -this.warnDeg ? VeerState.DRIFTED_LEFT : null;
    if (this.state === VeerState.ON_COURSE) {
      if (drifting === null) {
        this.driftSinceMs = null;
      } else {
        if (this.driftSinceMs === null) this.driftSinceMs = timestampMs;
        if (timestampMs - this.driftSinceMs >= this.sustainMs) this.state = drifting;
      }
    } else if (Math.abs(deviation) <= this.clearDeg) {
      this.state = VeerState.ON_COURSE;
      this.driftSinceMs = null;
    } else if (drifting !== null && drifting !== this.state) {
      this.state = drifting;
    }
    return { deviationDeg: deviation, state: this.state, lockedHeadingDeg: locked };
  }
}

export type VeerCue = 'DRIFT_LEFT' | 'DRIFT_RIGHT';

/** The phone must point more than this far off the anchor before a steering hint can start. */
export const VEER_CUE_THRESHOLD_DEG = 15;
/** ...and stay off for at least this long. */
export const VEER_CUE_SUSTAIN_MS = 1_500;
/** At most one hint in this window. */
export const VEER_CUE_MIN_GAP_MS = 4_000;

/**
 * Steering hint for the PHONE's direction (not the body's): after the heading has been more than 15 degrees off
 * the anchor for at least 1.5 s while walking, returns 'DRIFT_LEFT' or 'DRIFT_RIGHT', then stays quiet for 4 s.
 * The caller decides whether to speak it; this function does not read settings (veerGuidance is off by default).
 */
export function createVeerCue(): ((anchorDeg: number, headingDeg: number, walking: boolean, now: number) => VeerCue | null) & { reset(): void } {
  let offSince: number | null = null;
  let offSide: VeerCue | null = null;
  let lastCueAt: number | null = null;
  const fn = (anchorDeg: number, headingDeg: number, walking: boolean, now: number): VeerCue | null => {
    const deviation = Angles.wrap180(headingDeg - anchorDeg);
    const side: VeerCue | null = !walking || Math.abs(deviation) <= VEER_CUE_THRESHOLD_DEG ? null : deviation < 0 ? 'DRIFT_LEFT' : 'DRIFT_RIGHT';
    if (side === null || side !== offSide) {
      offSide = side;
      offSince = side === null ? null : now;
      return null;
    }
    if (offSince === null || now - offSince < VEER_CUE_SUSTAIN_MS) return null;
    if (lastCueAt !== null && now - lastCueAt < VEER_CUE_MIN_GAP_MS) return null;
    lastCueAt = now;
    return side;
  };
  fn.reset = () => { offSince = null; offSide = null; lastCueAt = null; };
  return fn;
}

/** Shared instance for the crossing in progress; call veerCue.reset() when a crossing ends. */
export const veerCue = createVeerCue();

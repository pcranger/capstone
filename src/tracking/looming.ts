import type { TrackSample } from './objectTracker';

export interface TtcEstimate {
  /** Time to contact in seconds; Infinity when the object is not getting closer. */
  seconds: number;
  /** d(ln size)/dt in 1/s. Positive = approaching (expanding). */
  expansionRate: number;
  /** Goodness of the log-linear fit, 0..1. */
  rSquared: number;
  /** Latest apparent height as a fraction of the frame height. */
  heightFraction: number;
}

/**
 * Monocular time-to-contact from optical expansion ("tau", Lee 1976): for an object approaching at
 * constant speed, TTC ≈ size / (d size / dt) = 1 / (d ln(size) / dt). No depth model is needed and the
 * estimate does not depend on the object's real size or the camera intrinsics.
 */
export const Looming = {
  estimate(
    samples: readonly TrackSample[],
    frameAspect: number,
    windowMs = 1_000,
    minSpanMs = 350,
    minSamples = 4,
  ): TtcEstimate | null {
    const last = samples[samples.length - 1];
    if (!last) return null;
    const recent = samples.filter((s) => last.timestampMs - s.timestampMs <= windowMs);
    if (recent.length < minSamples) return null;
    // A box clipped at the left/right/top border grows only because more of the object becomes
    // visible, which would look like looming. Skip those windows entirely.
    if (recent.some((s) => s.box.left <= 0.005 || s.box.right >= 0.995 || s.box.top <= 0.005)) return null;
    const bottomClipped = recent.some((s) => s.box.bottom >= 0.995);

    const t0 = recent[0].timestampMs;
    const span = last.timestampMs - t0;
    if (span < minSpanMs) return null;

    const n = recent.length;
    const xs = recent.map((s) => (s.timestampMs - t0) / 1000);
    const ys = recent.map((s) => {
      const b = s.box;
      // Width alone when the bottom is clipped; otherwise geometric mean of width and height.
      const size = bottomClipped ? b.width * frameAspect : Math.sqrt(b.width * frameAspect * b.height);
      return Math.log(Math.max(size, 1e-4));
    });
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    if (sxx <= 1e-9) return null;
    const slope = sxy / sxx;
    const r2 = syy <= 1e-12 ? 1 : (sxy * sxy) / (sxx * syy);
    const seconds = slope > 1e-3 ? 1 / slope : Number.POSITIVE_INFINITY;
    return { seconds, expansionRate: slope, rSquared: r2, heightFraction: last.box.height };
  },
};

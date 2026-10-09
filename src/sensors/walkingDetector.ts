const HYSTERESIS = 0.35;

interface Sample {
  t: number;
  value: number;
}

/**
 * Detects walking from raw accelerometer magnitude (no motion permission needed, unlike the pedometer).
 * Walking shows up as a 1.3–2.8 Hz oscillation of roughly ±1 m/s² or more around gravity.
 */
export class WalkingDetector {
  private samples: Sample[] = [];
  private gravityEstimate = 9.81;
  private initialized = false;
  isWalking = false;

  constructor(
    private readonly windowMs = 2_000,
    private readonly minRms = 0.9,
    private readonly minCrossingsPerSecond = 1.6,
    private readonly maxCrossingsPerSecond = 7.0,
  ) {}

  /** Acceleration including gravity, m/s². */
  onAccelerometer(timestampMs: number, ax: number, ay: number, az: number): void {
    const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!this.initialized) {
      this.gravityEstimate = magnitude;
      this.initialized = true;
    }
    this.gravityEstimate += 0.02 * (magnitude - this.gravityEstimate);
    this.samples.push({ t: timestampMs, value: magnitude - this.gravityEstimate });
    while (this.samples.length > 0 && timestampMs - this.samples[0].t > this.windowMs) this.samples.shift();
    this.isWalking = this.evaluate();
  }

  private evaluate(): boolean {
    const samples = this.samples;
    if (samples.length < 10) return false;
    const span = samples[samples.length - 1].t - samples[0].t;
    if (span < this.windowMs * 0.75) return false;
    let sumSq = 0;
    let crossings = 0;
    let side = 0; // -1 below -hysteresis, +1 above +hysteresis
    for (const s of samples) {
      sumSq += s.value * s.value;
      const newSide = s.value > HYSTERESIS ? 1 : s.value < -HYSTERESIS ? -1 : side;
      if (side !== 0 && newSide !== side) crossings++;
      side = newSide;
    }
    const rms = Math.sqrt(sumSq / samples.length);
    const crossingsPerSecond = crossings / (span / 1000);
    return (
      rms >= this.minRms &&
      crossingsPerSecond >= this.minCrossingsPerSecond &&
      crossingsPerSecond <= this.maxCrossingsPerSecond
    );
  }

  reset(): void {
    this.samples = [];
    this.initialized = false;
    this.isWalking = false;
  }
}

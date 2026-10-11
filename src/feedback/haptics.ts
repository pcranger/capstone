import CrossWiseNative from '../../modules/crosswise-native';
import { HapticPattern } from './cue';

/**
 * A small, learnable vibration vocabulary. Patterns differ in rhythm (not only strength) so they are
 * distinguishable without feeling the difference in intensity.
 *
 * timings (off, on, off, on...) in ms and matching amplitudes 0..255 — identical to the Android app, played
 * through Core Haptics by the native module.
 */
export const HAPTIC_PATTERNS: Record<HapticPattern, [number[], number[]]> = {
  [HapticPattern.WALK]: [
    [0, 120, 80, 120, 80, 120],
    [0, 255, 0, 255, 0, 255],
  ],
  [HapticPattern.DONT_WALK]: [
    [0, 500],
    [0, 200],
  ],
  [HapticPattern.FLASHING]: [
    [0, 60, 140, 60, 140, 60],
    [0, 180, 0, 180, 0, 180],
  ],
  [HapticPattern.LOST]: [
    [0, 50, 120, 50],
    [0, 110, 0, 110],
  ],
  [HapticPattern.CENTERED_TICK]: [
    [0, 30],
    [0, 160],
  ],
  [HapticPattern.VEER_LEFT]: [
    [0, 60, 90, 220],
    [0, 220, 0, 220],
  ],
  [HapticPattern.VEER_RIGHT]: [
    [0, 220, 90, 60],
    [0, 220, 0, 220],
  ],
  // Vehicle warning: one long 600 ms buzz, then two short ones. Nothing in the walk family starts with a long buzz.
  [HapticPattern.ALERT]: [
    [0, 600, 100, 80, 100, 80],
    [0, 255, 0, 255, 0, 255],
  ],
  // Microphone ready: two quick light ticks. CENTERED_TICK is a single tick.
  [HapticPattern.MIC_READY]: [
    [0, 30, 80, 30],
    [0, 160, 0, 160],
  ],
  [HapticPattern.CRITICAL]: [
    [0, 400, 80, 400],
    [0, 255, 0, 255],
  ],
  // Camera help off: one very long, lower buzz. Not CRITICAL's double buzz, so "off" never feels like "car".
  [HapticPattern.STOPPED]: [
    [0, 900],
    [0, 150],
  ],
};

export const Haptics = {
  play(pattern: HapticPattern): void {
    const [timings, amplitudes] = HAPTIC_PATTERNS[pattern];
    CrossWiseNative?.playHaptic(timings, amplitudes);
  },
  cancel(): void {
    CrossWiseNative?.cancelHaptics();
  },
};

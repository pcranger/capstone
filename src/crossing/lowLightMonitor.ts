/**
 * "Low light" warning: the picture is dim but not so dark that the camera is called blocked.
 * Uses the brightness the controller already has (smoothed mean luminance, 0..1); no extra image pass.
 *
 *   below TOO_DARK_BELOW  -> the existing "Camera blocked or too dark." path owns it; this stays quiet
 *   TOO_DARK_BELOW..DIM_BELOW -> dim: due once the frames have stayed dim for DIM_HOLD_MS, then again every LOW_LIGHT_REPEAT_MS
 *   DIM_BELOW and up -> daylight, quiet
 *
 * DIM_BELOW 0.30 was picked from replayed clips (drafts/capstone/replay/LOWLIGHT.md): the dimmest daylight clip sits at a
 * median of 0.33, the brightest dusk/night clip that should warn at 0.27.
 */
export const TOO_DARK_BELOW = 0.12;
export const DIM_BELOW = 0.3;
export const DIM_HOLD_MS = 2_000;
export const LOW_LIGHT_REPEAT_MS = 60_000;

export class LowLightMonitor {
  private dimSince: number | null = null;
  private lastSpokenAt = -Infinity;

  /** Camera help just started: a dim street speaks again after the hold time. */
  reset(): void {
    this.dimSince = null;
    this.lastSpokenAt = -Infinity;
  }

  /** True when the warning is due now. Call about 10 times a second while camera help is on. */
  due(nowMs: number, brightness: number): boolean {
    if (!(brightness >= TOO_DARK_BELOW && brightness < DIM_BELOW)) {
      this.dimSince = null; // too dark (other message) or bright enough: the 2 s clock starts over
      return false;
    }
    this.dimSince ??= nowMs;
    return nowMs - this.dimSince >= DIM_HOLD_MS && nowMs - this.lastSpokenAt >= LOW_LIGHT_REPEAT_MS;
  }

  /** The caller actually spoke it (it may wait while a vehicle warning is still being read). */
  spoke(nowMs: number): void {
    this.lastSpokenAt = nowMs;
  }
}

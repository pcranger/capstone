import { DIM_BELOW, DIM_HOLD_MS, LOW_LIGHT_REPEAT_MS, LowLightMonitor, TOO_DARK_BELOW } from '../src/crossing/lowLightMonitor';

/** Calls due() at 10 Hz like the controller and records every moment it was due and "spoken". */
function run(m: LowLightMonitor, from: number, to: number, brightness: number): number[] {
  const spoken: number[] = [];
  for (let t = from; t <= to; t += 100) if (m.due(t, brightness)) { m.spoke(t); spoken.push(t); }
  return spoken;
}

describe('low light monitor', () => {
  test('fires once after 2 s of dim frames, not before', () => {
    const m = new LowLightMonitor();
    expect(run(m, 0, DIM_HOLD_MS - 100, 0.2)).toEqual([]);
    expect(run(m, DIM_HOLD_MS, DIM_HOLD_MS + 5_000, 0.2)).toEqual([DIM_HOLD_MS]);
  });

  test('repeats at most every 60 s while still dim', () => {
    const m = new LowLightMonitor();
    const at = run(m, 0, 200_000, 0.2);
    expect(at).toEqual([2_000, 62_000, 122_000, 182_000]);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(LOW_LIGHT_REPEAT_MS);
  });

  test('a flicker back to bright restarts the 2 s clock', () => {
    const m = new LowLightMonitor();
    expect(run(m, 0, 1_500, 0.2)).toEqual([]);
    expect(run(m, 1_600, 1_800, 0.6)).toEqual([]);
    expect(run(m, 1_900, 3_400, 0.2)).toEqual([]); // only 1.5 s dim since the flicker
    expect(run(m, 3_500, 4_000, 0.2)).toEqual([3_900]);
  });

  test('too dark never fires: the old "camera blocked or too dark" message owns that band', () => {
    const m = new LowLightMonitor();
    expect(run(m, 0, 30_000, TOO_DARK_BELOW - 0.01)).toEqual([]);
    expect(run(m, 0, 30_000, 0)).toEqual([]);
  });

  test('daylight frames never fire', () => {
    const m = new LowLightMonitor();
    expect(run(m, 0, 120_000, DIM_BELOW)).toEqual([]);
    expect(run(m, 0, 120_000, 0.55)).toEqual([]);
  });

  test('not spoken yet (a vehicle warning is playing): stays due and stops once it is spoken', () => {
    const m = new LowLightMonitor();
    expect(m.due(0, 0.2)).toBe(false);
    expect(m.due(2_000, 0.2)).toBe(true);
    expect(m.due(5_000, 0.2)).toBe(true); // caller held it back; still due, no clock lost
    m.spoke(5_000);
    expect(m.due(6_000, 0.2)).toBe(false);
  });

  test('reset (camera help restarted) lets a dim street speak again after 2 s', () => {
    const m = new LowLightMonitor();
    run(m, 0, 3_000, 0.2);
    m.reset();
    expect(run(m, 10_000, 13_000, 0.2)).toEqual([12_000]);
  });
});

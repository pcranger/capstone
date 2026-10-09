import { BoxF } from '../src/core/geometry';
import { ObjectCategory } from '../src/perception/detection';
import { Looming } from '../src/tracking/looming';
import { ObjectTracker, type TrackSample } from '../src/tracking/objectTracker';
import { det } from './fixtures';

describe('Tracking', () => {
  test('signal keeps identity when phase flips', () => {
    const tracker = new ObjectTracker();
    tracker.update([det(ObjectCategory.PED_DONT_WALK)], 0);
    const id = tracker.activeTracks[0].id;
    tracker.update([det(ObjectCategory.PED_WALK)], 100);
    expect(tracker.activeTracks).toHaveLength(1);
    const track = tracker.activeTracks[0];
    expect(track.id).toBe(id);
    expect(track.category).toBe(ObjectCategory.PED_WALK);
    expect(track.hits).toBe(2);
  });

  test('vehicles and signals never merge', () => {
    const tracker = new ObjectTracker();
    const box = new BoxF(0.4, 0.4, 0.6, 0.6);
    tracker.update([det(ObjectCategory.CAR, box)], 0);
    tracker.update([det(ObjectCategory.TRAFFIC_LIGHT, box)], 100);
    expect(tracker.activeTracks).toHaveLength(2);
  });

  test('gyro shift keeps small object while scanning', () => {
    const tracker = new ObjectTracker();
    tracker.update([det(ObjectCategory.PED_WALK, new BoxF(0.5, 0.2, 0.52, 0.24))], 0);
    // Camera turned right: the signal jumped 0.2 to the left, far beyond its own size.
    const moved = det(ObjectCategory.PED_WALK, new BoxF(0.3, 0.2, 0.32, 0.24));
    tracker.update([moved], 100, -0.2);
    expect(tracker.activeTracks).toHaveLength(1);

    const noShift = new ObjectTracker();
    noShift.update([det(ObjectCategory.PED_WALK, new BoxF(0.5, 0.2, 0.52, 0.24))], 0);
    noShift.update([moved], 100);
    expect(noShift.activeTracks).toHaveLength(2);
  });

  test('tracks expire after misses', () => {
    const tracker = new ObjectTracker(500);
    tracker.update([det(ObjectCategory.CAR)], 0);
    tracker.update([], 400);
    expect(tracker.activeTracks).toHaveLength(1);
    tracker.update([], 600);
    expect(tracker.activeTracks).toHaveLength(0);
  });
});

describe('Looming', () => {
  const samples = (sizeAt: (t: number) => number, cx = 0.5, frames = 10, stepMs = 100): TrackSample[] =>
    Array.from({ length: frames }, (_, i) => {
      const t = i * stepMs;
      const h = sizeAt(t / 1000);
      return {
        timestampMs: t,
        box: BoxF.fromCenter(cx, 0.6, h * 0.5625, h),
        score: 0.8,
        category: ObjectCategory.CAR,
        colorHint: null,
      };
    });

  test('looming recovers time to contact', () => {
    // Constant-speed approach with contact at t = 3 s: size ∝ 1 / (3 - t).
    const est = Looming.estimate(samples((t) => (0.06 * 3) / (3 - t)), 0.5625);
    expect(est).not.toBeNull();
    // Over the 0.0–0.9 s window the true TTC goes from 3.0 to 2.1 s.
    expect(est!.seconds).toBeGreaterThanOrEqual(2);
    expect(est!.seconds).toBeLessThanOrEqual(3);
    expect(est!.rSquared).toBeGreaterThan(0.95);
  });

  test('receding object has no contact', () => {
    const est = Looming.estimate(samples((t) => 0.2 / (1 + t)), 0.5625);
    expect(est!.seconds).toBe(Number.POSITIVE_INFINITY);
  });

  test('clipped box is ignored', () => {
    expect(Looming.estimate(samples((t) => (0.06 * 3) / (3 - t), 0.02), 0.5625)).toBeNull();
  });
});

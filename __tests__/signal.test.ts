import { type Detection, ObjectCategory } from '../src/perception/detection';
import { type SignalEvent, SignalPhase, SignalPhaseTracker } from '../src/signal/signalPhaseTracker';
import { ObjectTracker } from '../src/tracking/objectTracker';
import { det, SIGNAL_BOX, seededRandom } from './fixtures';

describe('SignalPhaseTracker', () => {
  let tracker: ObjectTracker;
  let phases: SignalPhaseTracker;
  let events: [number, SignalEvent][];
  let now: number;

  beforeEach(() => {
    tracker = new ObjectTracker();
    phases = new SignalPhaseTracker();
    events = [];
    now = 0;
  });

  /** Feeds frames every 100 ms for durationMs; detection may return null for "not detected". */
  const run = (durationMs: number, detection: (t: number) => Detection | null) => {
    const end = now + durationMs;
    while (now < end) {
      const d = detection(now);
      const tracks = tracker.update(d ? [d] : [], now);
      for (const e of phases.update(now, tracks)) events.push([now, e]);
      now += 100;
    }
  };

  const red = () => det(ObjectCategory.PED_DONT_WALK);
  const green = () => det(ObjectCategory.PED_WALK);
  const changedEvents = () =>
    events.map((e) => e[1]).filter((e): e is Extract<SignalEvent, { type: 'changed' }> => e.type === 'changed');

  test('observed red to green is a fresh walk', () => {
    run(3_000, red);
    run(3_000, green);
    const acquired = events[0][1];
    expect(acquired.type).toBe('acquired');
    expect(acquired.type === 'acquired' && acquired.phase).toBe(SignalPhase.DONT_WALK);
    const changed = changedEvents();
    expect(changed).toHaveLength(1);
    expect(changed[0].to).toBe(SignalPhase.WALK);
    expect(changed[0].freshWalk).toBe(true);
    expect(phases.snapshot.freshWalk).toBe(true);
    // Announced within ~1.5 s of the real change at t = 3000.
    const changedAt = events.find((e) => e[1].type === 'changed')![0];
    expect(changedAt).toBeGreaterThanOrEqual(3_000);
    expect(changedAt).toBeLessThanOrEqual(4_500);
  });

  test('green first seen is not fresh', () => {
    run(3_000, green);
    expect(events).toHaveLength(1);
    const acquired = events[0][1];
    expect(acquired.type === 'acquired' && acquired.phase).toBe(SignalPhase.WALK);
    expect(phases.snapshot.freshWalk).toBe(false);
  });

  test('brief green blip during red is ignored', () => {
    run(3_000, red);
    run(300, green);
    run(2_000, red);
    expect(events).toHaveLength(1);
    expect(phases.currentPhase).toBe(SignalPhase.DONT_WALK);
  });

  test('rhythmic green is flashing', () => {
    run(2_000, green);
    run(6_000, (t) => (Math.floor(t / 500) % 2 === 0 ? det(ObjectCategory.PED_WALK) : null));
    const changed = changedEvents();
    expect(changed[changed.length - 1].to).toBe(SignalPhase.WALK_FLASHING);
    expect(phases.currentPhase).toBe(SignalPhase.WALK_FLASHING);
  });

  test('random misses are not flashing', () => {
    for (const seed of [42, 7, 1234]) {
      tracker = new ObjectTracker();
      phases = new SignalPhaseTracker();
      events = [];
      now = 0;
      const rng = seededRandom(seed);
      run(8_000, () => (rng() < 0.12 ? null : det(ObjectCategory.PED_WALK)));
      expect(phases.currentPhase).toBe(SignalPhase.WALK);
      expect(changedEvents().some((e) => e.to === SignalPhase.WALK_FLASHING)).toBe(false);
    }
  });

  test('signal out of view is reported lost', () => {
    run(2_000, red);
    run(2_500, () => null);
    expect(events[events.length - 1][1].type).toBe('lost');
    expect(phases.currentPhase).toBe(SignalPhase.UNKNOWN);
  });

  test('short occlusion during red still gives fresh walk', () => {
    run(3_000, red);
    run(2_000, () => null); // e.g. a bus passes; "lost" is announced
    run(3_000, green);
    const changed = changedEvents();
    expect(changed).toHaveLength(1);
    expect(changed[0].freshWalk).toBe(true);
  });

  test('color heuristic phase is untrusted', () => {
    run(3_000, () => det(ObjectCategory.TRAFFIC_LIGHT, SIGNAL_BOX, 0.8, 'GREEN'));
    expect(events).toHaveLength(1);
    const acquired = events[0][1];
    expect(acquired.type === 'acquired' && acquired.phase).toBe(SignalPhase.WALK);
    expect(acquired.type === 'acquired' && acquired.trusted).toBe(false);
  });

  test('generic light without color is ignored', () => {
    run(3_000, () => det(ObjectCategory.TRAFFIC_LIGHT));
    expect(events).toHaveLength(0);
  });
});

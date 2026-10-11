import { CrossingCheck, type CheckEvent, type CheckInput, type CheckVehicle } from '../src/crossing/crossingCheck';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings/settings';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));

const ANCHOR = 350; // not 0, so every test also crosses the 360 wrap
const compass = (rel: number) => (((ANCHOR + rel) % 360) + 360) % 360;
const car = (o: Partial<CheckVehicle> & { id: number }): CheckVehicle => ({
  moving: true, supported: true, approaching: false, bearingDeg: compass(90), heightFraction: 0.3, ...o,
});

/** Feeds frames every 100 ms at a heading relative to the start heading, and collects the events. */
class Rig {
  t = 1000;
  events: CheckEvent[] = [];
  constructor(readonly check: CrossingCheck) { check.start(this.t, ANCHOR); }
  feed(ms: number, rel: number | null, over: Partial<CheckInput> = {}): CheckEvent[] {
    const out: CheckEvent[] = [];
    for (let i = 0; i < ms / 100; i++) {
      this.t += 100;
      const e = this.check.update({
        t: this.t, heading: rel === null ? null : compass(rel), usable: true, walking: false, vehicles: [], ...over,
      });
      if (e) out.push(e);
    }
    this.events.push(...out);
    return out;
  }
  gap(ms: number): void { this.t += ms; }
}
const kinds = (es: CheckEvent[]) => es.map((e) => e.kind);

/** Enters the hold (one frame) and then holds for exactly holdMs, so the last event is the hold's end. */
function hold(rig: Rig, rel: number, over: Partial<CheckInput> = {}, ms = 5000): CheckEvent[] {
  return [...rig.feed(100, rel), ...rig.feed(ms, rel, over)];
}
const rightHold = (rig: Rig, over: Partial<CheckInput> = {}) => hold(rig, 90, over);
const leftHold = (rig: Rig, over: Partial<CheckInput> = {}, rel = -90) => hold(rig, rel, over);

describe('CrossingCheck', () => {
  test('happy path: right then left then face the road gives NONE_SEEN', () => {
    const rig = new Rig(new CrossingCheck());
    expect(kinds(rig.feed(100, 0))).toEqual(['KEEP_TURNING_RIGHT']);
    expect(kinds(rightHold(rig))).toEqual(['HOLD', 'TURN_LEFT']);
    expect(rig.check.phase).toBe('LEFT_TURN');
    expect(rig.check.leftTarget).toBe(-90);
    expect(kinds(rig.feed(5100, -90))).toEqual(['HOLD', 'FACE_ROAD']);
    expect(rig.check.phase).toBe('FACE_ROAD');
    expect(kinds(rig.feed(300, 10))).toEqual(['DONE']);
    const r = rig.check.result()!;
    expect(r.summary).toBe('NONE_SEEN');
    expect(r.right.status).toBe('CHECKED');
    expect(r.left.status).toBe('CHECKED');
    expect(r.right.framesUsed).toBeGreaterThan(40);
    expect(rig.check.phase).toBe('DONE');
  });

  test('no result before both sides are held', () => {
    const rig = new Rig(new CrossingCheck());
    expect(rig.check.result()).toBeNull();
    rightHold(rig);
    expect(rig.check.result()).toBeNull();
  });

  test('moving more than 15 degrees restarts the hold and keeps the evidence', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90); // enters the hold
    rig.feed(2000, 90, { vehicles: [car({ id: 1 })] });
    expect(kinds(rig.feed(100, 110))).toEqual(['HOLD_STILL']); // 20 degrees from where the hold began
    expect(rig.check.phase).toBe('RIGHT_HOLD');
    rig.feed(4000, 110);
    expect(rig.check.phase).toBe('RIGHT_HOLD'); // would be over by now without the restart
    expect(kinds(rig.feed(1500, 110))[0]).toBe('TURN_LEFT');
    rig.feed(5100, -90);
    rig.feed(300, 0);
    const r = rig.check.result()!;
    expect(r.right.movingVehicles).toBe(1);
    expect(r.summary).toBe('MOVING_RIGHT');
  });

  test('walking restarts the hold, and HOLD_STILL is rate limited to 1.5 s', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    rig.feed(3000, 90);
    const walk = rig.feed(1000, 90, { walking: true });
    expect(kinds(walk)).toEqual(['HOLD_STILL']);
    rig.feed(4000, 90);
    expect(rig.check.phase).toBe('RIGHT_HOLD');
    expect(kinds(rig.feed(1200, 90))[0]).toBe('TURN_LEFT');
  });

  test('a frame gap pauses the count but does not reset it', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90); // HOLD
    rig.feed(3000, 90); // 3000 ms counted
    rig.gap(2000); // no frames for 2 s
    rig.feed(100, 90); // first frame after the gap: not counted
    rig.feed(1700, 90); // 4700 ms
    expect(rig.check.phase).toBe('RIGHT_HOLD');
    expect(kinds(rig.feed(500, 90))[0]).toBe('TURN_LEFT');
  });

  test('too little turn and too far, each at most every 1.5 s', () => {
    const rig = new Rig(new CrossingCheck());
    expect(kinds(rig.feed(1400, 20))).toEqual(['KEEP_TURNING_RIGHT']);
    expect(kinds(rig.feed(300, 20))).toEqual(['KEEP_TURNING_RIGHT']);
    const far = new Rig(new CrossingCheck());
    expect(kinds(far.feed(1400, 150))).toEqual(['TOO_FAR']);
    expect(kinds(far.feed(1500, 150))).toEqual(['TOO_FAR']);
    // facing left of the start while the right turn is due still reads "keep turning right"
    expect(kinds(new Rig(new CrossingCheck()).feed(100, -100))).toEqual(['KEEP_TURNING_RIGHT']);
    // 130 is still accepted, 135 is not
    expect(kinds(new Rig(new CrossingCheck()).feed(100, 130))).toEqual(['HOLD']);
    expect(kinds(new Rig(new CrossingCheck()).feed(100, 135))).toEqual(['TOO_FAR']);
    expect(kinds(new Rig(new CrossingCheck()).feed(100, 50))).toEqual(['HOLD']);
    expect(kinds(new Rig(new CrossingCheck()).feed(100, 45))).toEqual(['KEEP_TURNING_RIGHT']);
  });

  test('leaving the window during a hold goes back to the turn phase', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(2000, 90);
    expect(rig.check.phase).toBe('RIGHT_HOLD');
    expect(kinds(rig.feed(100, 160))).toEqual(['TOO_FAR']);
    expect(rig.check.phase).toBe('RIGHT_TURN');
    expect(kinds(rig.feed(100, 90))).toEqual(['HOLD']);
    rig.feed(4000, 90);
    expect(rig.check.phase).toBe('RIGHT_HOLD'); // the 2 s before did not count
  });

  test('a moving car on the right gives MOVING_RIGHT', () => {
    const rig = new Rig(new CrossingCheck());
    rightHold(rig, { vehicles: [car({ id: 7, approaching: true })] });
    rig.feed(5100, -90);
    rig.feed(300, 0);
    const r = rig.check.result()!;
    expect(r.summary).toBe('MOVING_RIGHT');
    expect(r.right.movingVehicles).toBe(1);
    expect(r.right.approaching).toBe(true);
    expect(r.left.movingVehicles).toBe(0);
  });

  test('a moving car on the left gives MOVING_LEFT, and both sides MOVING_BOTH', () => {
    const a = new Rig(new CrossingCheck());
    rightHold(a);
    a.feed(5100, -90, { vehicles: [car({ id: 2, bearingDeg: compass(-90) })] });
    a.feed(300, 0);
    expect(a.check.result()!.summary).toBe('MOVING_LEFT');
    const b = new Rig(new CrossingCheck());
    rightHold(b, { vehicles: [car({ id: 1 })] });
    b.feed(5100, -90, { vehicles: [car({ id: 2, bearingDeg: compass(-90) })] });
    b.feed(300, 0);
    expect(b.check.result()!.summary).toBe('MOVING_BOTH');
  });

  test('an approaching car alone counts as moving', () => {
    const rig = new Rig(new CrossingCheck());
    rightHold(rig, { vehicles: [car({ id: 3, moving: false, approaching: true })] });
    rig.feed(5100, -90);
    rig.feed(300, 0);
    expect(rig.check.result()!.summary).toBe('MOVING_RIGHT');
  });

  test('only an unsure car gives UNSURE; only a stationary car gives UNSURE', () => {
    const a = new Rig(new CrossingCheck());
    rightHold(a, { vehicles: [car({ id: 4, supported: false, moving: false })] });
    a.feed(5100, -90);
    a.feed(300, 0);
    const r = a.check.result()!;
    expect(r.summary).toBe('UNSURE');
    expect(r.right.unsureVehicles).toBe(1);
    expect(r.right.movingVehicles).toBe(0);
    const b = new Rig(new CrossingCheck());
    rightHold(b);
    b.feed(5100, -90, { vehicles: [car({ id: 5, moving: false })] });
    b.feed(300, 0);
    const rb = b.check.result()!;
    expect(rb.summary).toBe('UNSURE');
    expect(rb.left.stationaryVehicles).toBe(1);
  });

  test('more than 3 s unusable stores the side as NOT_CHECKED, never NONE_SEEN', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    rig.feed(1000, 90);
    expect(rig.check.phase).toBe('RIGHT_HOLD');
    const out = rig.feed(3500, 90, { usable: false });
    expect(kinds(out)[0]).toBe('TURN_LEFT');
    expect(rig.check.phase).toBe('LEFT_TURN');
    rig.feed(5100, -90);
    rig.feed(300, 0);
    const r = rig.check.result()!;
    expect(r.right.status).toBe('NOT_CHECKED');
    expect(r.left.status).toBe('CHECKED');
    expect(r.summary).toBe('NOT_CHECKED');
    expect(r.summary).not.toBe('NONE_SEEN');
  });

  test('a null heading counts as unusable; 2 s of it is forgiven', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    rig.feed(2000, null);
    expect(rig.check.phase).toBe('RIGHT_HOLD');
    expect(kinds(rig.feed(1500, null))[0]).toBe('TURN_LEFT');
    expect(rig.check.phase).toBe('LEFT_TURN');
  });

  test('a moving car outranks NOT_CHECKED', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    rig.feed(500, 90, { vehicles: [car({ id: 9 })] });
    rig.feed(3600, 90, { usable: false });
    rig.feed(5100, -90);
    rig.feed(300, 0);
    const r = rig.check.result()!;
    expect(r.right.status).toBe('NOT_CHECKED');
    expect(r.summary).toBe('MOVING_RIGHT');
  });

  test('a far car at anchor+70 sets the left target to anchor-110', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    // two moving cars: the smaller box is farther away, so it gives the road's direction
    const cars = [car({ id: 1, heightFraction: 0.6, bearingDeg: compass(100) }), car({ id: 2, heightFraction: 0.2, bearingDeg: compass(70) })];
    expect(kinds(rig.feed(5000, 90, { vehicles: cars }))[0]).toBe('TURN_LEFT');
    expect(rig.check.leftTarget).toBeCloseTo(-110, 6);
    // 60 left of the start is 50 past the new window's edge, but within the fine band
    expect(kinds(rig.feed(100, -60))).toEqual(['LITTLE_MORE']);
    expect(kinds(rig.feed(1500, -160))).toEqual(['LITTLE_BACK']);
    expect(kinds(rig.feed(1500, -20))).toEqual(['KEEP_TURNING_LEFT']);
    expect(kinds(rig.feed(100, -110))).toEqual(['HOLD']);
    rig.feed(5000, -110);
    rig.feed(300, 0);
    expect(rig.check.result()!.fallbackNote).toBe(false);
  });

  test('the left target is clamped to anchor-130..anchor-50', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    rig.feed(5000, 90, { vehicles: [car({ id: 1, bearingDeg: compass(20) })] }); // 20 + 180 = -160, clamped
    expect(rig.check.leftTarget).toBe(-130);
  });

  test('no car seen: fallbackNote is true and the left target is anchor-90', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    rig.feed(5000, 90, { vehicles: [car({ id: 1, moving: false }), car({ id: 2, supported: false })] });
    expect(rig.check.leftTarget).toBe(-90);
    expect(kinds(rig.feed(100, -50))).toEqual(['HOLD']);
    expect(kinds(rig.feed(1500, -45))).toEqual(['LITTLE_MORE']); // left the window by 5
    rig.feed(5100, -90);
    rig.feed(300, 0);
    expect(rig.check.result()!.fallbackNote).toBe(true);
  });

  test('guidance during the right hold does not reset it', () => {
    const rig = new Rig(new CrossingCheck());
    rig.feed(100, 90);
    const out = rig.feed(5000, 90, { vehicles: [car({ id: 1, bearingDeg: compass(125) })] });
    // car 35 degrees clockwise of the heading: a little more, at most every 2 s, hold still completes
    expect(kinds(out)).toEqual(['LITTLE_MORE', 'LITTLE_MORE', 'LITTLE_MORE', 'TURN_LEFT']);
    const back = new Rig(new CrossingCheck());
    back.feed(100, 90);
    expect(kinds(back.feed(1000, 90, { vehicles: [car({ id: 1, bearingDeg: compass(55) })] }))).toEqual(['LITTLE_BACK']);
  });

  test('face the road: needs the heading within 20 of the start', () => {
    const rig = new Rig(new CrossingCheck());
    rightHold(rig);
    rig.feed(5100, -90);
    expect(rig.feed(500, -30)).toEqual([]);
    expect(kinds(rig.feed(100, 20))).toEqual(['DONE']);
    expect(rig.feed(100, 0)).toEqual([]); // nothing after DONE
  });

  test('holdMs of 3000 and of 8000', () => {
    for (const [holdMs, short, long] of [[3000, 2800, 400], [8000, 7800, 400]]) {
      const rig = new Rig(new CrossingCheck({ holdMs }));
      rig.feed(100, 90);
      rig.feed(short, 90);
      expect(rig.check.phase).toBe('RIGHT_HOLD');
      expect(kinds(rig.feed(long, 90))[0]).toBe('TURN_LEFT');
    }
  });

  test('reset and start begin again', () => {
    const rig = new Rig(new CrossingCheck());
    rightHold(rig, { vehicles: [car({ id: 1 })] });
    rig.check.reset();
    expect(rig.check.phase).toBeNull();
    expect(rig.check.update({ t: 99999, heading: 0, usable: true, walking: false, vehicles: [] })).toBeNull();
    rig.check.start(1, 0);
    expect(rig.check.phase).toBe('RIGHT_TURN');
    expect(rig.check.result()).toBeNull();
  });
});

describe('crossing check settings', () => {
  test('defaults', () => {
    expect(DEFAULT_SETTINGS.holdSeconds).toBe(5);
    expect(DEFAULT_SETTINGS.roadLanes).toBe(2);
  });
  test('holdSeconds is clamped to 3-8', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { holdSeconds: 1 }).holdSeconds).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { holdSeconds: 20 }).holdSeconds).toBe(8);
    expect(mergeSettings(DEFAULT_SETTINGS, { holdSeconds: 6.5 }).holdSeconds).toBe(6.5);
    expect(mergeSettings(DEFAULT_SETTINGS, { holdSeconds: '7' }).holdSeconds).toBe(5);
    expect(mergeSettings(DEFAULT_SETTINGS, { holdSeconds: NaN }).holdSeconds).toBe(5);
  });
  test('roadLanes is clamped to 1-4', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { roadLanes: 0 }).roadLanes).toBe(1);
    expect(mergeSettings(DEFAULT_SETTINGS, { roadLanes: 9 }).roadLanes).toBe(4);
    expect(mergeSettings(DEFAULT_SETTINGS, { roadLanes: 3 }).roadLanes).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { roadLanes: 2.6 }).roadLanes).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { roadLanes: 'x' }).roadLanes).toBe(2);
  });
});

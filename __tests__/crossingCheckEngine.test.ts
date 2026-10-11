import { AssistMode, CrossingEngine, UserCommand } from '../src/crossing/crossingEngine';
import { Priority } from '../src/feedback/cue';
import { ObjectCategory } from '../src/perception/detection';
import { CHECK_RESULT_TEXT, CHECK_TEXT, checkEventText } from '../src/text/checkText';
import { det, frame } from './fixtures';

const geometry = { hfovDeg: 60, vfovDeg: 90 };
type CarState = 'NONE' | 'MOVING' | 'STATIONARY';

/** Drives the real engine with a mocked frame stream (10 Hz sensors and frames) and records what it says. */
class Rig {
  e = new CrossingEngine();
  t = 0;
  heading = 0;
  walking = false;
  brightness = 0.5;
  car: CarState = 'NONE';
  urgent: { t: number; text: string; priority: Priority }[] = [];
  prompts: { t: number; text: string }[] = [];
  tones: string[] = [];
  private lastToken = -1;

  constructor() {
    this.e.settings = { ...this.e.settings, pedestrianSignals: false, autoDetectCrossing: false };
    const motion = (this.e as any).vehicleMotion;
    motion.reliable = true;
    jest.spyOn(motion, 'update').mockImplementation((...args: unknown[]) =>
      new Map((args[0] as any[]).map(tr => [tr.id, { state: this.car === 'MOVING' ? 'MOVING' : 'STATIONARY', direction: 'UNKNOWN', supported: true }])));
  }
  collect(cues: any[]) {
    for (const c of cues) {
      if (c.kind === 'speakText') this.urgent.push({ t: this.t, text: c.text, priority: c.priority });
      if (c.kind === 'tone') this.tones.push(c.tone);
    }
  }
  start() {
    this.collect(this.e.command(UserCommand.START_ASSIST, this.t).cues);
    (this.e as any).vehicleMotion.reliable = true; // START_ASSIST resets perception
  }
  /** Runs for ms at a compass heading relative to the start (rel > 0 is clockwise). */
  run(ms: number, rel = 0) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += 100;
      const h = ((this.heading + rel) % 360 + 360) % 360;
      this.collect(this.e.onSensors(this.t, { timestampMs: this.t, headingDeg: h, pitchDeg: 5 }, this.walking).cues);
      const dets = this.car === 'NONE' ? [] : [det(ObjectCategory.CAR)];
      this.collect(this.e.onFrame({ ...frame(this.t, ...dets), brightness: this.brightness }, geometry).cues);
      const s = this.e.scanInstruction;
      if (s && s.token !== this.lastToken) { this.lastToken = s.token; this.prompts.push({ t: this.t, text: s.text }); }
    }
  }
  say = () => this.urgent.map(u => u.text);
  said = (text: string) => this.prompts.some(p => p.text === text) || this.urgent.some(u => u.text === text);
  /** Steady for a second, then the right look and the left look, ending facing the road. */
  fullCheck(duringRight?: () => void, duringLeft?: () => void) {
    this.start();
    this.run(1400);
    this.run(200, 90); // HOLD
    duringRight?.();
    this.run(5200, 90);
    this.run(300, 0);
    this.run(200, -90); // HOLD
    duringLeft?.();
    this.run(5200, -90);
    this.run(300, 0);
  }
}
const withNote = (t: string) => `${t} ${CHECK_TEXT.fallbackResult}`;
afterEach(() => jest.restoreAllMocks());

describe('guided check in the engine', () => {
  test('Getting ready once, then the start prompt only after the phone has been steady for a second', () => {
    const r = new Rig();
    r.start();
    expect(r.say()).toContain(CHECK_TEXT.gettingReady);
    r.run(500, 0);
    expect(r.prompts).toHaveLength(0);
    r.run(900, 0);
    expect(r.prompts[0].text).toBe(CHECK_TEXT.start);
    expect(r.say().filter(t => t === CHECK_TEXT.gettingReady)).toHaveLength(1);
  });

  test('a moving phone does not start the check (heading changes more than 3 degrees)', () => {
    const r = new Rig();
    r.start();
    for (let i = 0; i < 30; i++) r.run(100, i % 2 ? 10 : 0);
    expect(r.prompts).toHaveLength(0);
  });

  test('NONE_SEEN: urgent result, ticks and end tones, Cross allowed, then it expires after 20 s', () => {
    const r = new Rig();
    r.fullCheck();
    const result = r.urgent.find(u => u.text === withNote(CHECK_RESULT_TEXT.NONE_SEEN))!;
    expect(result.priority).toBe(Priority.CRITICAL);
    expect(r.said(checkEventText('TURN_LEFT') + ' ' + CHECK_TEXT.fallbackNote)).toBe(true);
    expect(r.said(checkEventText('FACE_ROAD'))).toBe(true);
    expect(r.tones.filter(t => t === 'SONAR').length).toBeGreaterThanOrEqual(8);
    expect(r.tones.filter(t => t === 'CENTERED')).toHaveLength(2);
    expect(r.e.snapshot.check).toMatchObject({ stage: 'result', summary: 'NONE_SEEN', canCross: true });
    expect(r.e.canCross(r.t)).toBe(true);
    r.run(19000);
    expect(r.e.canCross(r.t)).toBe(true);
    r.run(1500);
    expect(r.say()).toContain(CHECK_TEXT.expired);
    expect(r.e.canCross(r.t)).toBe(false);
    expect(r.e.crossRefusal(r.t)).toBe(CHECK_TEXT.expired);
    expect(r.e.snapshot.check).toMatchObject({ stage: 'expired', text: CHECK_TEXT.expired, canCross: false });
  });

  test('a moving car during the right hold stops the check at once (urgent), result MOVING_RIGHT, Cross refused', () => {
    const r = new Rig();
    r.start();
    r.run(1400);
    r.run(200, 90);
    r.run(1000, 90);
    r.car = 'MOVING';
    r.run(300, 90);
    const stop = r.urgent.find(u => u.text === CHECK_TEXT.vehicleStopRight)!;
    expect(stop.priority).toBe(Priority.CRITICAL);
    expect(r.e.snapshot.check).toMatchObject({ stage: 'result', summary: 'MOVING_RIGHT', canCross: false });
    expect(r.e.canCross(r.t)).toBe(false);
    expect(r.e.crossRefusal(r.t)).toBe(CHECK_TEXT.notYet);
    r.car = 'NONE';
    r.run(6000, 90);
    expect(r.say()).not.toContain(withNote(CHECK_RESULT_TEXT.NONE_SEEN)); // nothing continues after the stop
  });

  test('a moving car during the left hold gives MOVING_LEFT', () => {
    const r = new Rig();
    r.fullCheck(undefined, () => { r.run(500, -90); r.car = 'MOVING'; });
    expect(r.say()).toContain(CHECK_TEXT.vehicleStopLeft);
    expect(r.e.snapshot.check?.summary).toBe('MOVING_LEFT');
  });

  test('a parked car seen during a hold gives UNSURE, and Cross is still allowed while fresh', () => {
    const r = new Rig();
    r.fullCheck(() => { r.car = 'STATIONARY'; }, () => { r.car = 'NONE'; });
    expect(r.say()).toContain(withNote(CHECK_RESULT_TEXT.UNSURE));
    expect(r.e.snapshot.check).toMatchObject({ summary: 'UNSURE', canCross: true });
  });

  test('a camera that cannot see during the holds gives NOT_CHECKED, never Cross', () => {
    const r = new Rig();
    r.start();
    r.run(1400);
    r.run(200, 90);
    r.brightness = 0.05;
    r.run(4000, 90);
    r.run(200, -90);
    r.run(4000, -90);
    r.run(500, 0);
    expect(r.say()).toContain(withNote(CHECK_RESULT_TEXT.NOT_CHECKED));
    expect(r.e.snapshot.check).toMatchObject({ summary: 'NOT_CHECKED', canCross: false });
  });

  test('WRONG_WAY is spoken when the phone turns left during the right turn', () => {
    const r = new Rig();
    r.start();
    r.run(1400);
    r.run(500, -50);
    expect(r.prompts.map(p => p.text)).toContain(checkEventText('WRONG_WAY'));
  });

  test('a stalled user hears the last prompt again every 6 s, and after 30 s with no progress it stops', () => {
    const r = new Rig();
    r.start();
    r.run(1400);
    const first = r.prompts.find(p => p.text === checkEventText('KEEP_TURNING_RIGHT'))!;
    expect(first).toBeDefined();
    r.run(7000);
    expect(r.prompts.filter(p => p.text === first.text).length).toBeGreaterThanOrEqual(2);
    r.run(25000);
    expect(r.say()).toContain(CHECK_TEXT.stopped);
    expect(r.e.snapshot.check).toMatchObject({ stage: 'stopped', text: CHECK_TEXT.stopped });
    expect(r.e.canCross(r.t)).toBe(false);
  });

  test('Check again starts a new check; the old result no longer allows Cross', () => {
    const r = new Rig();
    r.fullCheck();
    expect(r.e.canCross(r.t)).toBe(true);
    (r as any).collect(r.e.command(UserCommand.CHECK_AGAIN, r.t).cues);
    expect(r.e.canCross(r.t)).toBe(false);
    expect(r.e.snapshot.check?.stage).toBe('waiting');
    r.run(1400);
    expect(r.prompts.slice(-3).map(p => p.text)).toContain(CHECK_TEXT.start);
  });

  test('no text anywhere says "safe"', () => {
    const all = [...Object.values(CHECK_TEXT), ...Object.values(CHECK_RESULT_TEXT), ...(['HOLD', 'TURN_LEFT', 'FACE_ROAD', 'WRONG_WAY', 'TOO_FAR'] as const).map(checkEventText)];
    for (const text of all) expect(text.toLowerCase()).not.toMatch(/\bsafe/);
  });
});

describe('crossing countdown', () => {
  test('says the step count, halfway, "2 steps left" and the end once each; no steering words', () => {
    const r = new Rig();
    r.start();
    r.run(200);
    r.urgent = [];
    (r as any).collect(r.e.command(UserCommand.START_CROSSING, r.t).cues);
    expect(r.e.mode).toBe(AssistMode.CROSSING);
    expect(r.say()).toContain('Crossing. About 12 steps. Use your cane to find the far kerb.');
    r.walking = true;
    r.run(8000);
    const said = r.say();
    expect(said).toContain('Halfway. About 6 steps left.');
    expect(said.filter(t => t === '2 steps left')).toHaveLength(1);
    expect(said.filter(t => t === CHECK_TEXT.crossingEnd)).toHaveLength(1);
    expect(said.indexOf('Halfway. About 6 steps left.')).toBeLessThan(said.indexOf('2 steps left'));
    expect(said.indexOf('2 steps left')).toBeLessThan(said.indexOf(CHECK_TEXT.crossingEnd));
    for (const t of said) expect(t).not.toMatch(/drift|veer|turn slightly/i);
  });

  test('steps = lanes x 6, and nothing is counted while standing still', () => {
    const r = new Rig();
    r.e.settings = { ...r.e.settings, roadLanes: 3 };
    r.start();
    r.run(200);
    r.urgent = [];
    (r as any).collect(r.e.command(UserCommand.START_CROSSING, r.t).cues);
    expect(r.say()).toContain('Crossing. About 18 steps. Use your cane to find the far kerb.');
    r.run(10000);
    expect(r.say()).toHaveLength(1);
  });
});

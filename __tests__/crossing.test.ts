import { BoxF } from '../src/core/geometry';
import {
  AssistMode,
  type CameraGeometry,
  CrossingEngine,
  type EngineOutput,
  UserCommand,
} from '../src/crossing/crossingEngine';
import { Phrase } from '../src/feedback/cue';
import { type Detection, ObjectCategory } from '../src/perception/detection';
import { det, frame } from './fixtures';
import { SignalPhase } from '../src/signal/signalPhaseTracker';
import { VehicleMotion } from '../src/tracking/vehicleMotion';

afterEach(() => jest.restoreAllMocks());

// These scenario tests exercise crossing state and continued warnings; optical flow
// evidence itself is covered by vehicleMotion.test.ts.
function confirmedMotion() {
  jest.spyOn(VehicleMotion.prototype, 'update').mockImplementation(tracks =>
    new Map(tracks.map(t => [t.id, { state: 'MOVING' as const, direction: 'UNKNOWN' as const, supported: true }])));
}

describe('CrossingEngine', () => {
  let engine: CrossingEngine;
  const geometry: CameraGeometry = { hfovDeg: 60, vfovDeg: 90 };
  let spoken: [number, Phrase][];
  let now: number;
  let heading: number;
  let walking: boolean;

  beforeEach(() => {
    engine = new CrossingEngine();
    spoken = [];
    now = 0;
    heading = 0;
    walking = false;
  });

  const collect = (output: EngineOutput) => {
    for (const c of output.cues) if (c.kind === 'speak') spoken.push([now, c.phrase]);
  };

  /** Runs camera frames (10 Hz) and sensor ticks (10 Hz) together. */
  const run = (durationMs: number, detections: (t: number) => Detection[]) => {
    const end = now + durationMs;
    while (now < end) {
      collect(engine.onSensors(now, { timestampMs: now, headingDeg: heading, pitchDeg: 5 }, walking));
      collect(engine.onFrame(frame(now, ...detections(now)), geometry));
      now += 100;
    }
  };

  const phrases = () => spoken.map((s) => s[1]);

  test('full crossing scenario', () => {
    collect(engine.command(UserCommand.START_ASSIST, now));
    expect(engine.mode).toBe(AssistMode.SEARCHING);

    run(3_000, () => [det(ObjectCategory.PED_DONT_WALK)]);
    expect(engine.mode).toBe(AssistMode.WAITING);
    expect(phrases()).toContain(Phrase.DONT_WALK);

    run(2_000, () => [det(ObjectCategory.PED_WALK)]);
    expect(phrases()).toContain(Phrase.WALK_STARTED);
    expect(phrases()).not.toContain(Phrase.WALK_ALREADY_ON);

    // The user starts walking toward the signal: crossing mode starts by itself.
    walking = true;
    run(2_000, () => [det(ObjectCategory.PED_WALK)]);
    expect(engine.mode).toBe(AssistMode.CROSSING);
    expect(phrases()).toContain(Phrase.CROSSING_DETECTED);

    // Turning the phone alone must not produce walking steering advice.
    heading = 20;
    run(3_000, () => []);
    expect(phrases()).not.toContain('BEAR_LEFT');
    // The far signal leaving the view mid-crossing is not announced.
    expect(phrases()).not.toContain(Phrase.SIGNAL_LOST);

    // A car on the left approaches fast (contact in ~2.5 s).
    confirmedMotion();
    const carStart = now;
    run(1_500, (t) => {
      const remaining = 3.0 - (t - carStart) / 1000;
      const h = (0.08 * 3.0) / remaining;
      return [det(ObjectCategory.CAR, BoxF.fromCenter(0.2, 0.6, h * 0.8, h), 0.9)];
    });
    expect(phrases()).toContain(Phrase.VEHICLE_MOVING);

    // A pause could be on a refuge: stillness alone cannot finish crossing mode.
    walking = false;
    heading = 0;
    run(6_000, () => []);
    expect(engine.mode).toBe(AssistMode.CROSSING);
    expect(phrases()).not.toContain(Phrase.CROSSING_ENDED);
    collect(engine.command(UserCommand.END_CROSSING, now));
    expect(engine.mode).toBe(AssistMode.SEARCHING);
    expect(phrases()).toContain(Phrase.CROSSING_ENDED);
    expect(engine.snapshot.veer).toBeNull();
    expect(engine.snapshot.crossingElapsedMs).toBeNull();
    expect(engine.snapshot.signal.phase).toBe(SignalPhase.UNKNOWN);
    // Finishing leaves assistance on for the next crossing; repeated confirmation is harmless.
    expect(engine.command(UserCommand.END_CROSSING, now).cues).toEqual([]);
    collect(engine.command(UserCommand.START_CROSSING, now));
    expect(engine.mode).toBe(AssistMode.CROSSING);
    expect(engine.snapshot.crossingElapsedMs).toBe(0);
  });

  test.each([false, true])('crossing remains active past two minutes with walking=%s', (isWalking) => {
    engine.command(UserCommand.START_ASSIST, now);
    run(1_000, () => []);
    engine.command(UserCommand.START_CROSSING, now);
    walking = isWalking;
    run(125_000, () => []);
    expect(engine.mode).toBe(AssistMode.CROSSING);
    expect(engine.snapshot.crossingElapsedMs).toBeGreaterThanOrEqual(120_000);
    expect(engine.snapshot.veer).not.toBeNull();
    expect(phrases()).not.toContain(Phrase.CROSSING_ENDED);
    // Hazards are still processed while the crossing is paused or unusually long.
    confirmedMotion();
    const carStart = now;
    run(1_500, (t) => {
      const h = 0.24 / (3 - (t - carStart) / 1000);
      return [det(ObjectCategory.CAR, BoxF.fromCenter(0.2, 0.6, h * 0.8, h), 0.9)];
    });
    expect(phrases()).toContain(Phrase.VEHICLE_MOVING);
  });

  test('a sensor gap without heading does not complete a crossing, but the explicit shortcut does', () => {
    engine.command(UserCommand.START_ASSIST, 0);
    engine.command(UserCommand.START_CROSSING, 0);
    collect(engine.onSensors(180_000, null, false));
    expect(engine.mode).toBe(AssistMode.CROSSING);
    expect(phrases()).not.toContain(Phrase.CROSSING_ENDED);
    collect(engine.command(UserCommand.TOGGLE_CROSSING, 180_001));
    expect(engine.mode).toBe(AssistMode.SEARCHING);
    expect(phrases()).toContain(Phrase.CROSSING_ENDED);
  });

  test('stop assistance cancels crossing without claiming completion and later ticks stay idle', () => {
    engine.command(UserCommand.START_ASSIST, now);
    run(1_000, () => []);
    engine.command(UserCommand.START_CROSSING, now);
    collect(engine.command(UserCommand.STOP_ASSIST, now));
    expect(engine.mode).toBe(AssistMode.IDLE);
    expect(engine.snapshot.veer).toBeNull();
    expect(engine.snapshot.crossingElapsedMs).toBeNull();
    collect(engine.onSensors(180_000, null, false));
    expect(engine.mode).toBe(AssistMode.IDLE);
    expect(phrases()).toEqual([Phrase.ASSIST_STOPPED]);
  });

  test('walking during dont walk is flagged once', () => {
    engine.command(UserCommand.START_ASSIST, now);
    run(3_000, () => [det(ObjectCategory.PED_DONT_WALK)]);
    walking = true;
    run(4_000, () => [det(ObjectCategory.PED_DONT_WALK)]);
    expect(phrases().filter((p) => p === Phrase.WALKING_ON_DONT_WALK)).toHaveLength(1);
    expect(engine.mode).toBe(AssistMode.WAITING);
  });

  test('image displacement without pixel evidence does not prove vehicle motion', () => {
    engine.command(UserCommand.START_ASSIST, now);
    const start = now;
    run(3_000, (t) => {
      const x = 0.1 + (0.25 * (t - start)) / 1000; // crosses the view at constant size
      return [det(ObjectCategory.CAR, BoxF.fromCenter(x, 0.5, 0.12, 0.1))];
    });
    expect(phrases()).not.toContain(Phrase.VEHICLE_DETECTED);
    expect(engine.snapshot.hazards).toHaveLength(0);
  });

  test('repeat status describes signal age', () => {
    engine.command(UserCommand.START_ASSIST, now);
    run(3_000, () => [det(ObjectCategory.PED_DONT_WALK)]);
    run(4_000, () => [det(ObjectCategory.PED_WALK)]);
    const status = engine.command(UserCommand.REPEAT_STATUS, now).cues.filter((c) => c.kind === 'speak');
    const elapsed = status[0];
    expect(elapsed.kind === 'speak' && elapsed.phrase).toBe(Phrase.STATUS_WALK_ELAPSED);
    const seconds = elapsed.kind === 'speak' ? elapsed.args![0] : -1;
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThanOrEqual(4);
    expect(status[1].kind === 'speak' && status[1].phrase).toBe(Phrase.TRAFFIC_UNAVAILABLE);
  });

  test('idle engine stays silent but tracks state', () => {
    run(3_000, () => [det(ObjectCategory.PED_DONT_WALK)]);
    expect(spoken).toHaveLength(0);
    const start = engine
      .command(UserCommand.START_ASSIST, now)
      .cues.flatMap((c) => (c.kind === 'speak' ? [c.phrase] : []));
    expect(start).toEqual([Phrase.ASSIST_STARTED]);
    expect(engine.mode).toBe(AssistMode.SEARCHING);
    expect(engine.snapshot.veer).toBeNull();
  });
});

// Mock the motion-estimation boundary here; optical-flow classification has its own pixel tests.
describe('speech evidence and scan delivery', () => {
  const geometry = { hfovDeg: 60, vfovDeg: 90 };
  const ready = () => {
    const engine = new CrossingEngine();
    engine.settings = { ...engine.settings, pedestrianSignals: false, autoDetectCrossing: false };
    const motion = (engine as any).vehicleMotion;
    engine.command(UserCommand.START_ASSIST, 0);
    motion.reliable = true;
    jest.spyOn(motion, 'update').mockReturnValue(new Map());
    return engine;
  };
  const tick = (e: CrossingEngine,t:number,heading=0,detections:Detection[]=[]) => {
    e.onSensors(t,{timestampMs:t,headingDeg:heading,pitchDeg:5},false);
    return e.onFrame({...frame(t,...detections),brightness:.5},geometry);
  };
  test('scan cannot advance until its instruction finishes, and a vehicle invalidates a pending summary',()=>{
    const e=ready();tick(e,100);
    const left=e.scanInstruction!;expect(left.phrase).toBe(Phrase.SCAN_LEFT);
    for(let t=200;t<=2600;t+=100)tick(e,t,320);
    expect(e.scanInstruction).toEqual(left);
    expect(e.canSpeakScan(left.token,3100)).toBe(false);
    e.acknowledgeScan(left.token);
    for(let t=2700;t<=4700;t+=100)tick(e,t,320);
    expect(e.scanInstruction?.phrase).toBe(Phrase.SCAN_RIGHT);
    e.acknowledgeScan(e.scanInstruction!.token);
    for(let t=4800;t<=6800;t+=100)tick(e,t,40);
    const complete=e.scanInstruction!;expect(complete.phrase).toBe(Phrase.SCAN_COMPLETE);
    tick(e,6900,40,[det(ObjectCategory.CAR)]);
    expect(e.canSpeakScan(complete.token,6900)).toBe(false);
    expect(e.scanInstruction).toBeNull();
  });
  test('repeat cannot report no vehicles when vehicle alerts are disabled or the frame is stale',()=>{
    const e=ready();tick(e,100);
    for(const [time,enabled] of [[100,false],[1000,true]] as const){
      e.settings.vehicleAlerts=enabled;
      const phrases=e.command(UserCommand.REPEAT_STATUS,time).cues.flatMap(c=>c.kind==='speak'?[c.phrase]:[]);
      expect(phrases).toContain(Phrase.TRAFFIC_UNAVAILABLE);
      expect(phrases).not.toContain(Phrase.STATUS_NO_VEHICLES);
    }
  });
  test('generic traffic-light green never produces pedestrian walk speech',()=>{
    const e=ready();e.settings.pedestrianSignals=true;const spoken:Phrase[]=[];
    for(let t=100;t<=3000;t+=100){
      const out=tick(e,t,0,[det(ObjectCategory.TRAFFIC_LIGHT,undefined,.95,'GREEN')]);
      spoken.push(...out.cues.flatMap(c=>c.kind==='speak'?[c.phrase]:[]));
    }
    for(let t=3100;t<=7000;t+=100)spoken.push(...tick(e,t).cues.flatMap(c=>c.kind==='speak'?[c.phrase]:[]));
    expect(spoken).not.toContain(Phrase.SIGNAL_LOST);
    expect(spoken).not.toContain(Phrase.WALK_STARTED);
    expect(spoken).not.toContain(Phrase.WALK_ALREADY_ON);
    expect(e.mode).not.toBe(AssistMode.CROSSING);
  });
});


test('disabling vehicle alerts invalidates a ready scan instruction immediately',()=>{
  const e=new CrossingEngine();e.command(UserCommand.START_ASSIST,0);
  const motion=(e as any).vehicleMotion;motion.reliable=true;
  jest.spyOn(motion,'update').mockReturnValue(new Map());
  e.onSensors(100,{timestampMs:100,headingDeg:0,pitchDeg:5},false);
  e.onFrame({...frame(100),brightness:.5},{hfovDeg:60,vfovDeg:90});
  const token=e.scanInstruction!.token;expect(e.canSpeakScan(token,100)).toBe(true);
  e.settings.vehicleAlerts=false;expect(e.canSpeakScan(token,100)).toBe(false);
});

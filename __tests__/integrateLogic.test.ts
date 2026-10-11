/**
 * Integration fixes, logic side (11 Oct 2026): D1 no Cross after a moving or unknown-motion car, late cars, the shared
 * Cross gate, welcomeDone, exact "allow camera", priority-aware stop, steer hint, Ready tone.
 */
import { AssistMode, CrossingEngine, DEFAULT_ENGINE_SETTINGS, UserCommand } from '../src/crossing/crossingEngine';
import { CrossingCheck, type CheckVehicle } from '../src/crossing/crossingCheck';
import { CheckSession } from '../src/crossing/checkSession';
import { createVeerCue } from '../src/crossing/veerMonitor';
import { Priority, ToneKind } from '../src/feedback/cue';
import { notesFor } from '../src/feedback/toneSynth';
import { CHECK_RESULT_TEXT, CHECK_TEXT } from '../src/text/checkText';
import { cameraAccess } from '../src/state/cameraAccess';
import { controller } from '../src/state/controller';
import { V } from '../src/voice/speechCatalog';

jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: null }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; }, Directory: class {}, Paths: {} }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('react-native-audio-api', () => ({ AudioContext: class {}, AudioManager: { setAudioSessionOptions: jest.fn(), setAudioSessionActivity: jest.fn(async () => undefined) } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));
jest.mock('../src/voice/nativeSpeech', () => ({ NativeSpeechInput: class { prepare = jest.fn(); listen = jest.fn(); stop = jest.fn(); cancel = jest.fn(); } }));
jest.mock('../src/sensors/motionSensors', () => ({ MotionSensors: class { latestOrientation = null; isWalking = false; start() {} stop() {} } }));
jest.mock('../src/perception/modelLoader', () => ({
  listModels: () => [], resolveSource: () => null, loadModel: jest.fn(), importModelFile: jest.fn(),
  displayNameOf: () => 'test', referenceOf: () => 'asset:test', fileOf: jest.fn(),
}));

const car = (o: Partial<CheckVehicle> = {}): CheckVehicle => ({ id: 1, moving: true, supported: true, approaching: false, bearingDeg: 90, heightFraction: 0.2, ...o });

/** Drives a CrossingCheck through both holds (0.5 s each) and the face-the-road frame. */
function runCheck(hold: { right?: CheckVehicle[]; left?: CheckVehicle[]; road?: CheckVehicle[] }) {
  const k = new CrossingCheck({ holdMs: 500 });
  let t = 0;
  k.start(0, 0);
  const step = (heading: number, vehicles: CheckVehicle[]) => { t += 100; return k.update({ t, heading, usable: true, walking: false, vehicles }); };
  step(90, []); // HOLD
  for (let i = 0; i < 8; i++) step(90, hold.right ?? []);
  step(-90, []); // HOLD
  for (let i = 0; i < 8; i++) step(-90, hold.left ?? []);
  step(0, hold.road ?? []);
  return k;
}

describe('D1 and the late-car evidence', () => {
  test('a car of unknown motion in a hold gives UNSURE with Cross off; only parked cars keep Cross on', () => {
    const unknown = runCheck({ right: [car({ moving: false, supported: false })] }).result()!;
    expect(unknown.summary).toBe('UNSURE');
    expect(unknown.unknownMotion).toBe(true);
    const parked = runCheck({ right: [car({ moving: false, supported: true })] }).result()!;
    expect(parked.summary).toBe('UNSURE');
    expect(parked.unknownMotion).toBe(false);
    expect(CHECK_RESULT_TEXT.UNSURE).toBe('Vehicle seen, motion unclear. Check again.');
  });

  test('a moving car seen only in the face-the-road frame is not NONE_SEEN', () => {
    expect(runCheck({}).result()!.summary).toBe('NONE_SEEN');
    expect(runCheck({ road: [car({ bearingDeg: 60 })] }).result()!.summary).toBe('MOVING_RIGHT');
    expect(runCheck({ road: [car({ bearingDeg: -60 })] }).result()!.summary).toBe('MOVING_LEFT');
    const late = runCheck({ road: [car({ moving: false, supported: false })] }).result()!;
    expect(late.summary).toBe('UNSURE');
    expect(late.unknownMotion).toBe(true);
  });

  const fresh = () => {
    const s = new CheckSession();
    s.begin(0);
    Object.assign(s, { stage: 'result', summary: 'NONE_SEEN', resultAt: 0 });
    return s;
  };
  const frame = (vehicles: CheckVehicle[]) => ({ heading: 0, pitch: 5, usable: true, walking: false, vehicles });

  test('after NONE_SEEN a car that appears withdraws Cross: moving gives MOVING_x, unknown gives UNSURE', () => {
    const quiet = fresh();
    expect(quiet.frame(1000, frame([])).urgent).toBeUndefined();
    expect(quiet.canCross(1000)).toBe(true);
    const moving = fresh();
    expect(moving.frame(1000, frame([car({ bearingDeg: 20 })])).urgent).toBe(CHECK_RESULT_TEXT.MOVING_RIGHT);
    expect(moving.canCross(1000)).toBe(false);
    const unknown = fresh();
    expect(unknown.frame(1000, frame([car({ moving: false, supported: false })])).urgent).toBe(CHECK_RESULT_TEXT.UNSURE);
    expect(unknown.summary).toBe('UNSURE');
    expect(unknown.canCross(1000)).toBe(false);
  });

  test('Cross is gated in the engine itself: START_CROSSING and TOGGLE_CROSSING need a fresh clear result', () => {
    const e = new CrossingEngine();
    e.command(UserCommand.START_ASSIST, 0);
    for (const command of [UserCommand.START_CROSSING, UserCommand.TOGGLE_CROSSING]) {
      const out = e.command(command, 100);
      expect(e.mode).toBe(AssistMode.SEARCHING);
      expect(out.cues.some(c => c.kind === 'speakText' && c.text === CHECK_TEXT.notYet)).toBe(true);
    }
    Object.assign((e as any).check, { stage: 'result', summary: 'NONE_SEEN', resultAt: 100 });
    // A clear result alone is not enough: there must be a usable camera frame in the last 1.5 s.
    const refused = e.command(UserCommand.START_CROSSING, 200);
    expect(e.mode).toBe(AssistMode.SEARCHING);
    expect(refused.cues.some(c => c.kind === 'speakText' && c.text === CHECK_TEXT.cantSee)).toBe(true);
    Object.assign(e as any, { trafficUsable: true, lastTrafficFrameMs: 100 });
    e.command(UserCommand.START_CROSSING, 200);
    expect(e.mode).toBe(AssistMode.CROSSING);
    // 2 s without a frame: refused again.
    const late = new CrossingEngine();
    late.command(UserCommand.START_ASSIST, 0);
    Object.assign((late as any).check, { stage: 'result', summary: 'NONE_SEEN', resultAt: 100 });
    Object.assign(late as any, { trafficUsable: true, lastTrafficFrameMs: 100 });
    late.command(UserCommand.START_CROSSING, 2_200);
    expect(late.mode).toBe(AssistMode.SEARCHING);
  });

  test('losing the camera or tracking expires a finished clear result; so does an unusable frame', () => {
    const lost = new CrossingEngine();
    lost.command(UserCommand.START_ASSIST, 0);
    Object.assign((lost as any).check, { stage: 'result', summary: 'NONE_SEEN', resultAt: 100 });
    expect(lost.canCross(200)).toBe(true);
    lost.invalidatePerception(); // what setCameraStatus, inferenceFailed and checkTrafficAvailability call
    expect(lost.canCross(300)).toBe(false);
    const dark = new CheckSession();
    dark.begin(0);
    Object.assign(dark, { stage: 'result', summary: 'NONE_SEEN', resultAt: 0 });
    dark.frame(500, { heading: 0, pitch: 5, usable: false, walking: false, vehicles: [] });
    expect(dark.canCross(600)).toBe(false);
  });
});

describe('steer hint and tones', () => {
  test('the engine default follows the setting default (off), and a missing heading gives no hint', () => {
    expect(DEFAULT_ENGINE_SETTINGS.veerGuidance).toBe(false);
    const cue = createVeerCue();
    for (let t = 0; t < 6000; t += 100) expect(cue(0, NaN, true, t)).toBeNull();
    for (let t = 0; t < 6000; t += 100) expect(cue(NaN, 40, true, t)).toBeNull();
    let said = null as string | null;
    for (let t = 0; t < 3000; t += 100) said = cue(0, 40, true, t) ?? said;
    expect(said).toBe('DRIFT_RIGHT');
  });

  test('the Ready tone is a low falling pair and nothing like the Walk chime', () => {
    const [ready] = notesFor(ToneKind.READY);
    const [walk] = notesFor(ToneKind.WALK_CHIME);
    const [lost] = notesFor(ToneKind.LOST);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ frequencyHz: 523, durationMs: 300 });
    // Not the Walk chime's rising three, not the Lost cue's falling two, and no pitch in common with either.
    expect(ready.length).not.toBe(walk.length);
    expect(ready.length).not.toBe(lost.length);
    expect(ready.some(n => [...walk, ...lost].some(w => w.frequencyHz === n.frequencyHz))).toBe(false);
  });
});

describe('controller and speaker', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = controller as any;
  afterEach(() => { jest.useRealTimers(); });

  test('start(): welcomeDone is the real welcome when settingsLoaded flips, and a stuck speaker cannot hold it past 12 s', async () => {
    jest.useFakeTimers();
    c.feedback.sayAndWait = jest.fn(() => new Promise<boolean>(() => undefined));
    const initial = c.welcomeDone;
    let atLoaded: Promise<void> | null = null;
    controller.settingsLoaded.subscribe(() => { if (c.settingsLoaded.value) atLoaded = c.welcomeDone; });
    controller.start();
    await jest.advanceTimersByTimeAsync(100);
    expect(atLoaded).not.toBeNull();
    expect(atLoaded).not.toBe(initial);
    let done = false;
    void c.welcomeDone.then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(11_000);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(done).toBe(true);
    clearInterval(c.sensorTimer);
  });

  test('"allow camera" is an exact command that acts only when the permission is missing; loose phrases are not commands', async () => {
    const ask = jest.fn();
    cameraAccess.ask = ask;
    cameraAccess.has = true;
    expect(await c.handleVoice('allow camera', () => true)).toBe(V.cameraAlready);
    expect(ask).not.toHaveBeenCalled();
    cameraAccess.has = false;
    expect(await c.handleVoice('Allow camera.', () => true)).toBe('Asking for the camera.');
    expect(ask).toHaveBeenCalledTimes(1);
    c.userTurn = true;
    expect(await c.handleVoice('please do not allow the camera', () => true)).toBe(V.unknown);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test('between prompts an unrecognised transcript is ignored silently; a turn the user started still answers', async () => {
    c.userTurn = false;
    expect(await c.handleVoice('mumble', () => true)).toBeNull();
    c.userTurn = true;
    c.unknownCommands = 0;
    expect(await c.handleVoice('mumble', () => true)).toBe(V.unknown);
  });

  test('a transcript arriving keeps an urgent line that is still pending, and drops a routine one', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Speaker } = require('../src/feedback/speaker');
    const urgent = new Speaker();
    urgent.speak('Vehicle close ahead', Priority.CRITICAL, true);
    await urgent.stopForInterruption();
    expect(urgent.busy).toBe(true);
    const routine = new Speaker();
    routine.speak('Turn right', Priority.NORMAL, false);
    await routine.stopForInterruption();
    expect(routine.busy).toBe(false);
  });
});

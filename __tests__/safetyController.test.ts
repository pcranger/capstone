/**
 * cw-safety: the REAL CrossWiseController and the real engine, with only the phone's native modules and the speaker faked.
 * Every test here is one blind-user safety rule; each fails on the code before cw-safety.
 */
import { AppState } from 'react-native';
import { AssistMode, UserCommand } from '../src/crossing/crossingEngine';
import { type Cue, HapticPattern, Priority, ToneKind } from '../src/feedback/cue';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { cameraAccess } from '../src/state/cameraAccess';
import { controller } from '../src/state/controller';
import { pressBack, pressStop, refreshConfirm } from '../src/state/safetyGuards';
import { P } from '../src/strings';
import { T } from '../src/text/safetyText';

let mockNow = 100_000;
jest.mock('../src/core/geometry', () => ({ ...jest.requireActual('../src/core/geometry'), nowMs: () => mockNow }));
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: null }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; }, Directory: class {}, Paths: {} }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('react-native-audio-api', () => ({ AudioContext: class {}, AudioManager: { setAudioSessionOptions: jest.fn(), setAudioSessionActivity: jest.fn(async () => undefined) } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined), isSpeakingAsync: jest.fn(async () => false) }));
jest.mock('../src/voice/nativeSpeech', () => ({ NativeSpeechInput: class { prepare = jest.fn(); listen = jest.fn(); stop = jest.fn(); cancel = jest.fn(); } }));
jest.mock('../src/sensors/motionSensors', () => ({ MotionSensors: class { latestOrientation = null; isWalking = false; start() {} stop() {} } }));
jest.mock('../src/perception/modelLoader', () => ({
  listModels: () => [], resolveSource: () => null, loadModel: jest.fn(), importModelFile: jest.fn(),
  displayNameOf: () => 'test', referenceOf: () => 'asset:test', fileOf: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const c = controller as any;
const fb = c.feedback;
const cues = (): Cue[] => (fb.dispatch as jest.Mock).mock.calls.flatMap((call: [Cue[]]) => call[0]);
const said = (text: string, priority?: Priority) => cues().some(q => q.kind === 'speakText' && q.text === text && (priority === undefined || q.priority === priority));
const buzzed = () => cues().some(q => q.kind === 'haptic' && q.pattern === HapticPattern.STOPPED);
const sayAndWait = () => fb.sayAndWait as jest.Mock;

beforeEach(() => {
  mockNow = 100_000;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.restoreAllMocks();
  fb.dispatch = jest.fn();
  fb.sayAndWait = jest.fn(async () => true);
  fb.silenceRoutine = jest.fn();
  c.engine.command(UserCommand.STOP_ASSIST, mockNow);
  c.ready.set(true);
  c.model.set({ kind: 'loading' });
  c.cameraStatus.set('running');
  c.trafficFailure = null; c.lastCantSeeMs = 0; c.wasBackgrounded = false;
  c.ui.update((u: object) => ({ ...u, snapshot: { ...c.engine.snapshot, mode: AssistMode.IDLE } }));
  cameraAccess.has = true; cameraAccess.ask = () => undefined;
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
});

describe('1 - camera help never stops silently', () => {
  test('Stop (quiet) says "Camera help off. Vehicle warnings stopped." urgently, with a long buzz', () => {
    controller.command(UserCommand.START_ASSIST, true);
    expect(controller.assistOn).toBe(true);
    (fb.dispatch as jest.Mock).mockClear();
    controller.command(UserCommand.STOP_ASSIST, true);
    expect(controller.assistOn).toBe(false);
    expect(said(T.assistStopped, Priority.CRITICAL)).toBe(true);
    expect(buzzed()).toBe(true);
  });

  test('going to the background says it before it stops, and coming back says how to restart', () => {
    controller.command(UserCommand.START_ASSIST, true);
    (fb.dispatch as jest.Mock).mockClear();
    c.onAppState('background');
    expect(controller.assistOn).toBe(false);
    expect(said(T.assistStopped, Priority.CRITICAL)).toBe(true);
    expect(buzzed()).toBe(true);
    c.onAppState('active');
    expect(said(T.backInApp)).toBe(true);
  });

  test('stopping when it was already off adds no noise', () => {
    controller.command(UserCommand.STOP_ASSIST, true);
    expect(said(T.assistStopped)).toBe(false);
  });

  test('the Stop button during a crossing asks first; a second press within 3 s confirms; a late second press asks again', () => {
    const command = jest.spyOn(controller, 'command').mockImplementation(() => undefined);
    const speak = jest.spyOn(controller, 'speakHigh').mockImplementation(() => undefined);
    const dateNow = jest.spyOn(Date, 'now');
    c.ui.update((u: { snapshot: object }) => ({ ...u, snapshot: { ...u.snapshot, mode: AssistMode.CROSSING } }));
    dateNow.mockReturnValue(1_000_000);
    pressStop();
    expect(speak).toHaveBeenCalledWith(T.stopConfirm, true);
    expect(command).not.toHaveBeenCalled();
    dateNow.mockReturnValue(1_002_000);
    pressStop();
    expect(command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
    command.mockClear(); speak.mockClear();
    dateNow.mockReturnValue(1_010_000); pressStop();
    dateNow.mockReturnValue(1_017_000); pressStop(); // 7 s later: too late even for the 6 s button window, asks again
    expect(command).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(2);
  });

  test('the Stop button outside a crossing stops at once', () => {
    const command = jest.spyOn(controller, 'command').mockImplementation(() => undefined);
    pressStop();
    expect(command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
  });

  test('Back at the home screen asks first; a second Back within 3 s closes the app', () => {
    const speak = jest.spyOn(controller, 'speakHigh').mockImplementation(() => undefined);
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(2_000_000);
    expect(pressBack()).toBe(true);
    expect(speak).toHaveBeenCalledWith(T.backConfirm, true);
    dateNow.mockReturnValue(2_002_500);
    expect(pressBack()).toBe(false);
    dateNow.mockReturnValue(2_100_000);
    expect(pressBack()).toBe(true); // a fresh ask, not a close
  });

  test('voice "pause" while on: command() speaks the safety words urgently; the reply is empty so they are said once', async () => {
    controller.command(UserCommand.START_ASSIST, true);
    (fb.dispatch as jest.Mock).mockClear();
    // "pause" asks first, like "stop"; the second one acts.
    expect(await c.handleVoice('pause', () => true)).toBe(T.stopConfirm);
    expect(controller.assistOn).toBe(true);
    expect(await c.handleVoice('pause', () => true)).toBeNull();
    expect(controller.assistOn).toBe(false);
    expect(said(T.assistStopped, Priority.CRITICAL)).toBe(true);
  });
});

describe('5 - the start-up wait is not silent', () => {
  test('Start before the first frame is analysed says "Not ready yet" and does not start', () => {
    c.ready.set(false);
    controller.command(UserCommand.START_ASSIST, true);
    expect(controller.assistOn).toBe(false);
    expect(said(T.notReady)).toBe(true);
  });

  test('voice Start before ready is refused the same way', async () => {
    c.ready.set(false);
    expect(await c.handleVoice('start', () => true)).toBe(T.notReady);
    expect(controller.assistOn).toBe(false);
  });

  test('the first analysed frame plays the ready tone and says "Ready", once; then Start works', () => {
    c.ready.set(false);
    c.loadedModel.set({ info: { labels: ['car'] }, categories: [0] });
    const frame = { detections: [], frameWidth: 640, frameHeight: 480, inferenceMs: 10, brightness: 0.5, mask: null, debug: null };
    controller.onFrame(frame);
    expect(c.ready.value).toBe(true);
    expect(cues().some(q => q.kind === 'tone' && q.tone === ToneKind.READY)).toBe(true);
    expect(said(T.ready)).toBe(true);
    (fb.dispatch as jest.Mock).mockClear();
    controller.onFrame(frame);
    expect(said(T.ready)).toBe(false);
    controller.command(UserCommand.START_ASSIST, true);
    expect(controller.assistOn).toBe(true);
  });

  test('a model that failed to load still lets Start speak its own reason instead of "wait"', () => {
    c.ready.set(false);
    c.model.set({ kind: 'failed', message: 'boom' });
    controller.command(UserCommand.START_ASSIST, true);
    expect(said(T.notReady)).toBe(false);
    expect(controller.assistOn).toBe(true);
  });

  test('every launch says "Getting ready, about ten seconds" once', async () => {
    c.ready.set(false);
    await c.welcome();
    expect(sayAndWait().mock.calls.map((x: string[]) => x[0])).toEqual([T.gettingReady]);
  });
});

describe('9 - no camera permission: a spoken way forward', () => {
  test('voice Start without the permission is refused and points to Allow camera', async () => {
    cameraAccess.has = false;
    expect(await c.handleVoice('start', () => true)).toBe(T.cameraOff);
    expect(controller.assistOn).toBe(false);
    expect(await c.handleVoice('resume', () => true)).toBe(T.cameraOff);
  });

  test('the button path (command) is refused the same way', () => {
    cameraAccess.has = false;
    controller.command(UserCommand.START_ASSIST, true);
    expect(controller.assistOn).toBe(false);
    expect(said(T.cameraOff)).toBe(true);
  });

  test('saying "Allow camera" asks for the permission', async () => {
    const ask = jest.fn();
    cameraAccess.has = false; cameraAccess.ask = ask;
    expect(await c.handleVoice('allow camera', () => true)).toBe(T.askingCamera);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('12 - welcome and safety note on first open', () => {
  test('first open speaks the safety note, then how to start, then "getting ready", and remembers it', async () => {
    controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: false });
    c.ready.set(false);
    const update = jest.spyOn(controller, 'updateSettings').mockImplementation(() => undefined);
    await c.welcome();
    expect(sayAndWait().mock.calls.map((x: string[]) => x[0])).toEqual([T.welcomeSafety, T.welcomeStart, T.gettingReady]);
    expect(T.welcomeSafety).toBe('CrossWise helps you check for cars, but it can miss them. Always use your cane and your own judgement.');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: false }).acceptedSafetyNotice).toBe(true);
  });

  test('it is not remembered when the note was cut off, so it is spoken again next time', async () => {
    controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: false });
    sayAndWait().mockResolvedValueOnce(false);
    const update = jest.spyOn(controller, 'updateSettings').mockImplementation(() => undefined);
    await c.welcome();
    expect(update).not.toHaveBeenCalled();
  });

  test('later opens do not repeat the note', async () => {
    c.ready.set(false);
    const update = jest.spyOn(controller, 'updateSettings').mockImplementation(() => undefined);
    await c.welcome();
    expect(sayAndWait()).not.toHaveBeenCalledWith(T.welcomeSafety);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('13 - silence never passes for "no cars"', () => {
  test('while the camera cannot see, "Still can’t see" repeats every 10 s, with Settings open', () => {
    expect(c.homeVisible).toBe(false); // Settings open: the home screen is not visible
    controller.command(UserCommand.START_ASSIST, true);
    mockNow += 4_000;
    c.checkTrafficAvailability();
    expect(said(P.detectionUnavailable)).toBe(true);
    const stills = () => cues().filter(q => q.kind === 'speakText' && q.text === T.stillCantSee).length;
    expect(stills()).toBe(0);
    mockNow += 5_000; c.checkTrafficAvailability(); expect(stills()).toBe(0);
    mockNow += 5_000; c.checkTrafficAvailability(); expect(stills()).toBe(1);
    mockNow += 5_000; c.checkTrafficAvailability(); expect(stills()).toBe(1);
    mockNow += 5_000; c.checkTrafficAvailability(); expect(stills()).toBe(2);
  });

  test('nothing repeats when the camera can see', () => {
    c.model.set({ kind: 'ready', info: {} });
    c.lastFrameMs = mockNow; c.brightness = 0.5;
    controller.command(UserCommand.START_ASSIST, true);
    mockNow += 4_000; c.lastFrameMs = mockNow;
    c.checkTrafficAvailability();
    mockNow += 12_000; c.lastFrameMs = mockNow;
    c.checkTrafficAvailability();
    expect(cues().some(q => q.kind === 'speakText' && q.text === T.stillCantSee)).toBe(false);
  });
});

describe('dock Stop confirm window and stale questions', () => {
  test('the button gets 6 s because the question takes about 3 s to read; an old question never confirms', () => {
    jest.spyOn(controller, 'speakHigh').mockImplementation(() => undefined);
    const command = jest.spyOn(controller, 'command').mockImplementation(() => undefined);
    const dateNow = jest.spyOn(Date, 'now');
    c.ui.update((u: { snapshot: object }) => ({ ...u, snapshot: { ...u.snapshot, mode: AssistMode.CROSSING } }));
    dateNow.mockReturnValue(5_000_000); pressStop();
    dateNow.mockReturnValue(5_005_000); pressStop(); // 5 s after the first press: inside 6 s
    expect(command).toHaveBeenCalledTimes(1);
    command.mockClear();
    dateNow.mockReturnValue(5_100_000); pressStop();
    dateNow.mockReturnValue(5_105_000); refreshConfirm('stop'); // the question was read out late, at 5 s
    dateNow.mockReturnValue(5_109_000); pressStop(); // 9 s after asking: past the 8 s ceiling, asks again
    expect(command).not.toHaveBeenCalled();
  });
});

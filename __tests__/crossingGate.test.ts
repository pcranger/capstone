import { AssistMode, UserCommand } from '../src/crossing/crossingEngine';
import { nowMs } from '../src/core/geometry';
import { CHECK_TEXT } from '../src/text/checkText';

// The real controller and the real engine. Only native services (sensors, speech, audio, files) are stubbed.
const stub = () => class {
  constructor() {
    return new Proxy(this, {
      get: (t: any, p) => (p in t ? t[p] : p === 'latestOrientation' ? null : p === 'isWalking' ? false : p === 'then' ? undefined : jest.fn(() => Promise.resolve(true))),
    });
  }
};
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Directory: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: null }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('../src/perception/modelProbe', () => ({ probeDetector: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../src/sensors/motionSensors', () => ({ MotionSensors: stub() }));
jest.mock('../src/feedback/feedbackEngine', () => ({ FeedbackEngine: stub() }));
jest.mock('../src/feedback/haptics', () => ({ Haptics: { play: jest.fn(), cancel: jest.fn() } }));
jest.mock('../src/voice/nativeSpeech', () => ({ NativeSpeechInput: stub() }));
jest.mock('../src/voice/audioCheck', () => ({ VoiceAudioCheck: stub() }));
jest.mock('../src/logging/sessionLogger', () => ({ SessionLogger: stub() }));
jest.mock('../src/voice/navigationVoice', () => ({ ...jest.requireActual('../src/voice/navigationVoice'), NavigationVoice: stub() }));

const { controller } = require('../src/state/controller');

/** Puts the real engine in curb mode with a finished check of the given kind, finished `ageMs` ago. */
function withResult(summary: string, ageMs: number) {
  const engine = (controller as any).engine;
  engine.mode = AssistMode.IDLE;
  engine.command(UserCommand.START_ASSIST, nowMs());
  engine.check.stage = 'result';
  engine.check.summary = summary;
  engine.check.resultAt = nowMs() - ageMs;
}

describe('Cross on the dock', () => {
  let command: jest.SpyInstance;
  let deliver: jest.SpyInstance;
  beforeEach(() => {
    command = jest.spyOn(controller, 'command').mockImplementation(() => undefined);
    deliver = jest.spyOn(controller as any, 'deliver').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const spoken = () => deliver.mock.calls.flatMap(([cues]: any) => cues.map((c: any) => c.text));

  test('refused on an expired result', () => {
    withResult('NONE_SEEN', 25_000);
    controller.crossingAction('start');
    expect(command).not.toHaveBeenCalled();
    expect(spoken()).toEqual([CHECK_TEXT.expired]);
  });

  test.each(['MOVING_RIGHT', 'MOVING_LEFT', 'MOVING_BOTH', 'NOT_CHECKED'])('refused on a fresh %s result', summary => {
    withResult(summary, 1_000);
    controller.crossingAction('start');
    expect(command).not.toHaveBeenCalled();
    expect(spoken()).toEqual([CHECK_TEXT.notYet]);
  });

  test.each(['NONE_SEEN', 'UNSURE'])('allowed on a fresh %s result', summary => {
    withResult(summary, 1_000);
    controller.crossingAction('start');
    expect(command).toHaveBeenCalledWith(UserCommand.START_CROSSING);
  });
});

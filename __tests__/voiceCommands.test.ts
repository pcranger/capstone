import { AppState } from 'react-native';
import { AssistMode, UserCommand } from '../src/crossing/crossingEngine';
import { V } from '../src/voice/speechCatalog';
import { VT } from '../src/text/voiceText';

// Items 10a, 10b and 10c: the real controller with the real command switch, the real turn loop and the real speaker.
// Only the phone's microphone and text-to-speech engine are replaced.
const mockListen: { resolvers: Array<(text: string) => void>; calls: number } = { resolvers: [], calls: 0 };
const mockSpoken: string[] = [];
jest.mock('expo-speech', () => ({
  speak: jest.fn((text: string, options: { onDone: () => void }) => { mockSpoken.push(text); setTimeout(options.onDone, 0); }),
  stop: jest.fn(async () => undefined),
}));
jest.mock('../src/voice/nativeSpeech', () => ({
  NativeSpeechInput: class {
    async prepare() {}
    listen(ready: () => void) {
      mockListen.calls++; ready();
      return new Promise<string>((resolve, reject) => { mockListen.resolvers.push(resolve); (this as any).reject = reject; });
    }
    cancel() { (this as any).reject?.(new Error('Voice off.')); }
  },
}));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Directory: class {}, Paths: {} }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: jest.fn(), importModelFile: jest.fn(), listModels: jest.fn(async () => []), loadModel: jest.fn(), referenceOf: jest.fn(), resolveSource: jest.fn(), fileOf: jest.fn() }));
jest.mock('../src/perception/modelProbe', () => ({ probeDetector: jest.fn() }));
jest.mock('react-native-audio-api', () => ({
  AudioManager: { setAudioSessionOptions: jest.fn(), setAudioSessionActivity: jest.fn(async () => undefined), disableSessionManagement: jest.fn() },
  AudioContext: class {},
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));

import { controller } from '../src/state/controller';
import * as geometry from '../src/core/geometry';
import { clearConfirm, refreshConfirm } from '../src/state/safetyGuards';
import { cameraAccess } from '../src/state/cameraAccess';
import { T } from '../src/text/safetyText';
import { CHECK_TEXT } from '../src/text/checkText';

const c = controller as any;
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const say = (text: string) => c.handleVoice(text, () => true) as Promise<string | null>;
const setMode = (mode: AssistMode) => { c.engine.mode = mode; };

beforeEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  mockListen.resolvers = []; mockListen.calls = 0; mockSpoken.length = 0;
  c.voiceMuted = false; c.voiceMode.set(true); clearConfirm(); c.unknownCommands = 0; c.userTurn = true;
  c.ready.set(true); cameraAccess.has = true;
  setMode(AssistMode.IDLE);
});
afterEach(async () => { c.voice.stop(); c.homeVisible = false; await flush(5); });

describe('10a the microphone re-opens by itself after the app has spoken', () => {
  test('a command reply is spoken, then listening resumes without saying "Listening." again', async () => {
    c.homeVisible = true;
    c.startVoice(true); await flush();
    expect(mockListen.calls).toBe(1);
    expect(mockSpoken.filter(t => t === 'Listening.')).toHaveLength(1);

    mockListen.resolvers.shift()!('help'); await flush();
    expect(mockSpoken.some(t => t.startsWith('Start. Pause.'))).toBe(true);
    expect(mockListen.calls).toBeGreaterThanOrEqual(2);
    expect(c.voice.active).toBe(true);
    expect(mockSpoken.filter(t => t === 'Listening.')).toHaveLength(1);
  });

  test('a routine line the app speaks stops the microphone, and it re-opens when the speech ends', async () => {
    c.homeVisible = true;
    c.startVoice(true); await flush();
    const before = mockListen.calls;
    c.speakNow('Crossing ahead.'); await flush();
    expect(mockSpoken).toContain('Crossing ahead.');
    expect(mockListen.calls).toBeGreaterThan(before);
    expect(c.voice.active).toBe(true);
  });

  test('"Stop listening" and the Voice commands button switch it off for good', async () => {
    c.homeVisible = true;
    c.startVoice(true); await flush();
    mockListen.resolvers.shift()!('stop listening'); await flush();
    const calls = mockListen.calls;
    expect(c.voice.active).toBe(false);
    expect(c.voiceMode.value).toBe(false);
    await flush(); expect(mockListen.calls).toBe(calls);
    c.toggleVoice(); await flush();
    expect(c.voiceMode.value).toBe(true);
    expect(mockListen.calls).toBeGreaterThan(calls);
  });
});

describe('10b the new commands', () => {
  test('"check again" is Retry: starts camera help when it is off, repeats the status when it is on', async () => {
    const command = jest.spyOn(c, 'command').mockImplementation(() => undefined);
    const repeat = jest.spyOn(c, 'repeatGuidance').mockImplementation(() => undefined);
    expect(await say('Check again')).toBe(V.started);
    expect(command).toHaveBeenCalledWith(UserCommand.START_ASSIST, true);
    // While on it starts a new guided check (the Check again button); it no longer repeats the status.
    setMode(AssistMode.SEARCHING);
    expect(await say('check again')).toBeNull();
    expect(command).toHaveBeenCalledWith(UserCommand.CHECK_AGAIN, true);
    expect(repeat).not.toHaveBeenCalled();
  });

  test('"cross" does what the Cross button does, and says why when it cannot', async () => {
    const action = jest.spyOn(c, 'crossingAction').mockImplementation(() => undefined);
    expect(await say('Cross')).toBe(VT.crossNeedsHelp);
    expect(action).not.toHaveBeenCalled();
    setMode(AssistMode.SEARCHING);
    // The same gate as the button: no fresh clear result, no Cross, and it says why.
    jest.spyOn(c.engine, 'canCross').mockReturnValue(false);
    expect(await say('cross')).toBe(CHECK_TEXT.notYet);
    expect(action).not.toHaveBeenCalled();
    jest.spyOn(c.engine, 'canCross').mockReturnValue(true);
    expect(await say('cross')).toBeNull();
    expect(action).toHaveBeenCalledWith('start');
    setMode(AssistMode.CROSSING);
    expect(await say('cross')).toBe(VT.crossAlready);
  });

  test('"stop" does what the Stop button does (camera help off), and is not confused with "stop listening"', async () => {
    const command = jest.spyOn(c, 'command').mockImplementation(() => undefined);
    setMode(AssistMode.SEARCHING);
    // Whenever camera help is on, a bare "stop" asks first (a misheard word must not silence the warnings).
    expect(await say('Stop')).toBe(T.stopConfirm);
    expect(command).not.toHaveBeenCalled();
    expect(await say('Stop')).toBeNull(); // command() says "Camera help off." urgently
    expect(command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
    expect(c.voiceMode.value).toBe(true);
  });
});

describe('10c a crossing needs "cancel" twice within 3 seconds', () => {
  let now = 1_000;
  beforeEach(() => { now = 1_000; jest.spyOn(geometry, 'nowMs').mockImplementation(() => now); jest.spyOn(Date, 'now').mockImplementation(() => now); setMode(AssistMode.CROSSING); });

  test('the first "cancel" only asks; the second inside the window ends the crossing', async () => {
    const command = jest.spyOn(c, 'command').mockImplementation(() => undefined);
    expect(await say('Cancel')).toBe('Say cancel again to stop crossing warnings.');
    expect(command).not.toHaveBeenCalled();
    now += 2_900;
    expect(await say('cancel')).toBe(V.crossingEnded);
    expect(command).toHaveBeenCalledWith(UserCommand.END_CROSSING);
  });

  test('a second "cancel" after 3 seconds, or after another command, asks again instead of acting', async () => {
    const command = jest.spyOn(c, 'command').mockImplementation(() => undefined);
    await say('cancel'); now += 3_100;
    expect(await say('cancel')).toBe(VT.confirmAgain('cancel'));
    await say('repeat'); now += 100;
    expect(await say('cancel')).toBe(VT.confirmAgain('cancel'));
    expect(command).not.toHaveBeenCalledWith(UserCommand.END_CROSSING);
  });

  test('the window starts when the question has been spoken, not when it was asked', async () => {
    jest.spyOn(c, 'command').mockImplementation(() => undefined);
    await say('cancel');
    now += 3_000; // the question takes this long to read aloud
    refreshConfirm(); // what the voice turn does once the question has been spoken
    now += 2_500;
    expect(await say('cancel')).toBe(V.crossingEnded);
  });

  test('outside a crossing, "cancel" still acts at once', async () => {
    setMode(AssistMode.IDLE);
    expect(await say('cancel')).toBe(V.cancelled);
  });

  test('"stop" during a crossing asks twice as well', async () => {
    const command = jest.spyOn(c, 'command').mockImplementation(() => undefined);
    expect(await say('stop')).toBe(T.stopConfirm);
    expect(command).not.toHaveBeenCalled();
    expect(await say('stop')).toBeNull();
    expect(command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
  });
});

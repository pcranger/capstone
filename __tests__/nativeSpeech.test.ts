import { Platform } from 'react-native';
import { NativeSpeechInput } from '../src/voice/nativeSpeech';
import CrossWiseNative from '../modules/crosswise-native';
import { ExpoSpeechRecognitionModule as native } from 'expo-speech-recognition';
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: { speechCapabilities: jest.fn((locales: string[]) => locales.map(locale => ({ locale, supported: true, available: true, onDevice: true }))) } }));
jest.mock('expo-speech-recognition', () => {
  const listeners: Record<string, Set<(e?: any) => void>> = {};
  return { ExpoSpeechRecognitionModule: {
    listeners, emit: (event: string, value?: any) => [...(listeners[event] || [])].forEach(fn => fn(value)),
    addListener: (event: string, fn: (e: any) => void) => { (listeners[event] ??= new Set()).add(fn); return { remove: () => listeners[event].delete(fn) }; },
    supportsOnDeviceRecognition: jest.fn(() => true), getSupportedLocales: jest.fn(async () => ({ locales: ['en-US'], installedLocales: ['en_US'] })),
    getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })), start: jest.fn(), abort: jest.fn(),
    getAudioSessionCategoryAndOptionsIOS: jest.fn(() => ({ category: 'playback', mode: 'default', categoryOptions: ['duckOthers'] })),
    setCategoryIOS: jest.fn(), setAudioSessionActiveIOS: jest.fn(),
  } };
});
const emit = (event: string, value?: any) => (native as any).emit(event, value);
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); (CrossWiseNative!.speechCapabilities as jest.Mock).mockImplementation((locales: string[]) => locales.map(locale => ({ locale, supported: true, available: true, onDevice: true }))); for (const set of Object.values((native as any).listeners)) (set as Set<any>).clear(); });
afterEach(() => jest.useRealTimers());
test('only a final result after native end is accepted, duplicate finals do not replace it, audio is restored', async () => {
  const input = new NativeSpeechInput(); await input.prepare(); const ready = jest.fn(); const done = jest.fn();
  const pending = input.listen(ready).then(done); emit('audiostart');
  emit('result', { isFinal: false, results: [{ transcript: 'start journey' }] }); expect(done).not.toHaveBeenCalled();
  emit('result', { isFinal: true, results: [{ transcript: 'search town hall' }] });
  emit('result', { isFinal: true, results: [{ transcript: 'confirm' }] }); expect(done).not.toHaveBeenCalled();
  emit('end'); await pending; expect(done).toHaveBeenCalledWith('search town hall'); expect(ready).toHaveBeenCalledTimes(1);
  expect(native.setCategoryIOS).toHaveBeenCalledWith({ category: 'playback', mode: 'default', categoryOptions: ['duckOthers'] });
  expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: true, recordingOptions: { persist: false } }));
});
test('cancel discards final results and waits for end before another turn', async () => {
  const input = new NativeSpeechInput(); await input.prepare(); const pending = input.listen(jest.fn()).catch(e => e.message);
  input.cancel(); await expect(input.listen(jest.fn())).rejects.toThrow('still stopping');
  emit('result', { isFinal: true, results: [{ transcript: 'confirm' }] }); emit('end');
  expect(await pending).toBe('Voice off.');
});
test('missing end after a final fails closed within bounded time and refuses another session', async () => {
  const input = new NativeSpeechInput(); await input.prepare(); const pending = input.listen(jest.fn()).catch(e => e.message);
  emit('result', { isFinal: true, results: [{ transcript: 'confirm' }] }); jest.advanceTimersByTime(4001);
  expect(await pending).toContain('did not stop'); await expect(input.listen(jest.fn())).rejects.toThrow('Reopen');
});
test('unavailable Australian recognition falls back to supported offline English', async () => {
  (CrossWiseNative!.speechCapabilities as jest.Mock).mockImplementation((locales: string[]) => locales.map(locale => ({ locale, supported: true, available: true, onDevice: locale === 'en-US' })));
  const input = new NativeSpeechInput(); await input.prepare(); const pending = input.listen(jest.fn()).catch(e => e.message);
  expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US', requiresOnDeviceRecognition: true }));
  input.cancel(); emit('end'); await pending;
});
test('no offline recognizer gives bounded recovery, never a cloud fallback', async () => {
  (CrossWiseNative!.speechCapabilities as jest.Mock).mockReturnValue([]);
  const input = new NativeSpeechInput(); const pending = input.prepare().catch(e => e.message);
  await jest.advanceTimersByTimeAsync(1600);
  expect(await pending).toContain('Voice help'); expect(native.start).not.toHaveBeenCalled();
});
test('transient recognizer initialization is retried before reporting unavailable', async () => {
  (CrossWiseNative!.speechCapabilities as jest.Mock).mockReturnValueOnce([]);
  const input = new NativeSpeechInput(); const pending = input.prepare(); await jest.advanceTimersByTimeAsync(800); await pending;
  expect(CrossWiseNative!.speechCapabilities).toHaveBeenCalledTimes(2);
});
test('permission denial does not start recognition or misreport a language failure', async () => {
  (native.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  await expect(new NativeSpeechInput().prepare()).rejects.toThrow('Allow microphone');
  expect(native.start).not.toHaveBeenCalled(); expect(CrossWiseNative!.speechCapabilities).not.toHaveBeenCalled();
});


test('Android uses installed offline English and never calls iOS audio-session APIs', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    const input = new NativeSpeechInput(); await input.prepare();
    const pending = input.listen(jest.fn());
    expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-US', requiresOnDeviceRecognition: true }));
    emit('result', { isFinal: true, results: [{ transcript: 'manual' }] }); emit('end');
    await expect(pending).resolves.toBe('manual');
    expect(native.getAudioSessionCategoryAndOptionsIOS).not.toHaveBeenCalled();
    expect(native.setAudioSessionActiveIOS).not.toHaveBeenCalled();
    expect(CrossWiseNative!.speechCapabilities).not.toHaveBeenCalled();
  } finally { platform.restore(); }
});

test('Android refuses supported but uninstalled locales instead of using network recognition', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  (native.getSupportedLocales as jest.Mock).mockResolvedValue({ locales: ['en-US'], installedLocales: [] });
  try {
    const pending = new NativeSpeechInput().prepare().catch(e => e.message);
    await jest.advanceTimersByTimeAsync(1600);
    expect(await pending).toContain('Voice help');
    expect(native.start).not.toHaveBeenCalled();
  } finally { platform.restore(); }
});

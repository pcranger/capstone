import { NavigationVoice, voiceIntent } from '../src/voice/navigationVoice';
import { expectsVoiceAnswer, V } from '../src/voice/speechCatalog';
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

test('unrecognised commands keep the microphone armed; other replies end the voice turn', async () => {
  let capture: ReturnType<typeof deferred<string>>;
  const input = { prepare: jest.fn(async () => {}), listen: jest.fn(ready => {
    capture = deferred<string>(); ready(); return capture.promise;
  }), cancel: jest.fn(() => capture?.reject(new Error('Voice off.'))) };
  const handle = jest.fn().mockResolvedValueOnce(V.unknown).mockResolvedValueOnce(V.unknownHelp).mockResolvedValueOnce(V.paused);
  const announceListening = jest.fn(async () => true);
  const voice = new NavigationVoice({ input, handle, say: async () => true, ready: () => {}, cancel: () => {}, announceListening });
  voice.start(null); await flush();
  for (const command of ['blah', 'maybe']) {
    capture!.resolve(command); await flush();
    expect(voice.active).toBe(true);
    expect(voice.state.value.phase).toBe('listening');
  }
  capture!.resolve('pause'); await flush(); await voice.whenStopped();
  expect(voice.active).toBe(false);
  expect(voice.state.value.phase).toBe('off');
  expect(handle).toHaveBeenCalledTimes(3);
});

test('follow-up policy re-arms the microphone only for unrecognised commands, never for results or fatal errors', () => {
  for (const text of [V.unknown, V.unknownHelp]) expect(expectsVoiceAnswer(text)).toBe(true);
  for (const text of [V.paused, V.started, V.crossingEnded, V.microphoneIOS, V.voiceRecovery, 'Vehicle ahead on the left.']) expect(expectsVoiceAnswer(text)).toBe(false);
});

test('microphone timeout during a follow-up waits for speech completion then listens for the answer', async () => {
  const speech = deferred<boolean>();
  const answer = deferred<string>();
  const input = { prepare: async () => {}, listen: jest.fn()
    .mockRejectedValueOnce(new Error('No speech heard.'))
    .mockImplementation(ready => { ready(); return answer.promise; }),
    cancel: jest.fn(() => { if (input.listen.mock.calls.length > 1) answer.reject(new Error('Voice off.')); }) };
  const voice = new NavigationVoice({ input, say: () => speech.promise, handle: jest.fn(), ready: () => {}, cancel: () => {} });
  voice.start(V.unknown); await flush();
  expect(voice.active).toBe(true);
  expect(input.listen).toHaveBeenCalledTimes(1);
  speech.resolve(true); await flush();
  expect(voice.state.value.phase).toBe('listening');
  voice.stop(); await voice.whenStopped();
});

test.each([
  ['Start', 'start'], ['start.', 'start'], ['Pause', 'pause'], ['Resume', 'resume'], ['Repeat', 'repeat'], ['Retry', 'retry'],
  ['Cancel', 'cancel'], ['Finish crossing', 'finishCrossing'], ['Stop listening', 'stopListening'],
])('%s is the explicit command %s', (text, kind) => {
  expect(voiceIntent(text)).toEqual({ kind });
});

test('removed navigation phrases and acknowledgements are never commands', () => {
  for (const text of ['Navigate to Central Library.', 'Search for Central Library', 'Central Library', 'Save as Home', 'second', 'Next instruction',
    'Arrived', 'Stop navigation', 'End journey', 'Confirm', 'Start journey', 'yes', 'no', 'okay', 'stop', 'cross now', 'I am across', 'Held',
    'And journey', 'where am I']) expect(voiceIntent(text)).toBeNull();
});

test('first-time flow waits for completed speech, gives readiness feedback and executes one final transcript', async () => {
  const speech = deferred<boolean>(); const transcript = deferred<string>(); const next = deferred<string>(); let rejectBarge!: (error: Error) => void;
  const barge = new Promise<string>((_, reject) => { rejectBarge = reject; });
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn().mockImplementationOnce(() => barge).mockImplementationOnce(ready => { ready(); return transcript.promise; }).mockImplementation(() => next.promise), cancel: jest.fn(() => { rejectBarge(new Error('Voice off.')); next.reject(new Error('Voice off.')); }) };
  const handle = jest.fn(async () => 'Navigating to Library. Head north.'); const ready = jest.fn();
  const announceListening = jest.fn(async () => true);
  const say = jest.fn().mockReturnValueOnce(speech.promise).mockResolvedValue(true);
  const voice = new NavigationVoice({ input, say, ready, handle, cancel: jest.fn(), announceListening });
  voice.start('Welcome. Say your destination.'); await flush(); expect(input.listen).toHaveBeenCalledTimes(1);
  speech.resolve(true); await flush(); expect(ready).toHaveBeenCalledTimes(1);
  transcript.resolve('Library'); await flush(); expect(handle).toHaveBeenCalledTimes(1);
  expect(announceListening).toHaveBeenCalledTimes(1);
  expect(say).toHaveBeenCalledWith('Navigating to Library. Head north.');
  voice.stop(); await flush(); expect(voice.active).toBe(false);
});

test('a command spoken during a list announcement interrupts speech and is handled immediately', async () => {
  const speech = deferred<boolean>();
  const transcript = deferred<string>();
  const input = {
    prepare: jest.fn(async () => undefined),
    listen: jest.fn().mockImplementationOnce(() => transcript.promise).mockImplementation(() => new Promise<string>(() => {})),
    cancel: jest.fn(),
  };
  const say = jest.fn().mockReturnValue(speech.promise);
  const handle = jest.fn(async (text: string) => text === 'first' ? 'Starting the first place.' : null);
  const stopSpeech = jest.fn(async () => undefined);
  const voice = new NavigationVoice({ input, say, handle, ready: jest.fn(), cancel: jest.fn(), stopSpeech });
  voice.start('1. Town Hall. 2. Library. Say one or two.');
  await flush();
  expect(input.listen).toHaveBeenCalledTimes(1);
  transcript.resolve('first');
  await flush();
  expect(stopSpeech).toHaveBeenCalledTimes(1);
  expect(handle).toHaveBeenCalledWith('first', expect.any(Function));
  expect(say).toHaveBeenCalledWith('Starting the first place.');
  speech.resolve(true);
  voice.stop();
  await flush();
});

test('interruption rejects a late transcript and restarting waits for native capture shutdown', async () => {
  const first = deferred<string>(); const second = deferred<string>();
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn().mockReturnValueOnce(first.promise).mockReturnValue(second.promise), cancel: jest.fn() };
  const handle = jest.fn(async () => null);
  const voice = new NavigationVoice({ input, handle, say: jest.fn(async () => true), ready: jest.fn(), cancel: jest.fn() });
  voice.start(null); await flush(); voice.stop(); voice.start(null); await flush();
  expect(input.listen).toHaveBeenCalledTimes(1);
  first.resolve('navigate to wrong destination'); await flush();
  expect(handle).not.toHaveBeenCalled(); expect(input.listen).toHaveBeenCalledTimes(2);
  voice.stop(); second.reject(new Error('Voice off.')); await flush();
});

test('a permission failure is spoken once and does not enter a retry or question loop', async () => {
  const input = { prepare: jest.fn(async () => { throw new Error('Enable microphone in Settings.'); }), listen: jest.fn(), cancel: jest.fn() };
  const say = jest.fn(async () => true);
  const voice = new NavigationVoice({ input, say, handle: jest.fn(), ready: jest.fn(), cancel: jest.fn() });
  voice.start('Welcome.'); await flush();
  expect(say).toHaveBeenCalledTimes(1); expect(input.listen).not.toHaveBeenCalled();
  expect(voice.state.value.phase).toBe('error'); expect(voice.active).toBe(false);
});

test('help phrases are explicit commands, ambient text never is', () => {
  expect(voiceIntent('Voice help')).toEqual({ kind: 'help' });
  expect(voiceIntent('Manual')).toEqual({ kind: 'help' });
  expect(voiceIntent('man')).toEqual({ kind: 'help' });
  expect(voiceIntent('What can I say?')).toBeNull();
  for (const text of ['Held', 'And journey', 'Hello there', 'Where am I', 'Sydney Town Hall']) expect(voiceIntent(text)).toBeNull();
});

test('silence re-arms without repeated readiness tones or executing a command', async () => {
  jest.useFakeTimers();
  const next = deferred<string>();
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn()
    .mockImplementationOnce(ready => { ready(); return Promise.reject(new Error('No speech heard.')); })
    .mockImplementation(ready => { ready(); return next.promise; }), cancel: jest.fn() };
  const ready = jest.fn(); const handle = jest.fn();
  const announceListening = jest.fn(async () => true);
  const voice = new NavigationVoice({ input, handle, say: jest.fn(async () => true), ready, cancel: jest.fn(), announceListening });
  voice.start(null); await flush(); await jest.advanceTimersByTimeAsync(400); await flush();
  expect(input.listen).toHaveBeenCalledTimes(2); expect(ready).toHaveBeenCalledTimes(1); expect(handle).not.toHaveBeenCalled();
  expect(announceListening).toHaveBeenCalledTimes(1);
  voice.stop(); next.reject(new Error('Voice off')); await flush(); jest.useRealTimers();
});

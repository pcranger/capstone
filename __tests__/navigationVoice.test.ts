import { NavigationVoice, voiceIntent } from '../src/voice/navigationVoice';
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

test('commands preserve explicit intent and never interpret acknowledgements as permission to move', () => {
  expect(voiceIntent('Navigate to Central Library.')).toEqual({ kind: 'destination', query: 'Central Library', navigate: true });
  expect(voiceIntent('Search for Central Library')).toEqual({ kind: 'destination', query: 'Central Library', navigate: false });
  expect(voiceIntent('Central Library')).toBeNull();
  expect(voiceIntent('Central Library')).toBeNull();
  expect(voiceIntent('Save as Home')).toEqual({ kind: 'save', alias: 'Home' });
  expect(voiceIntent('second')).toEqual({ kind: 'choose', index: 1 });
  expect(voiceIntent('Next instruction')).toEqual({kind:'next'});
  expect(voiceIntent('Arrived')).toEqual({kind:'arrived'});
  expect(voiceIntent('Finish crossing')).toEqual({kind:'finishCrossing'});
  for (const word of ['yes', 'no', 'okay', 'stop', 'cross now', 'I am across', 'Held', 'And journey', 'where am I', 'save as', 'navigate to']) expect(voiceIntent(word)).toBeNull();
});

test('first-time flow waits for completed speech, gives readiness feedback and executes one final transcript', async () => {
  const speech = deferred<boolean>(); const transcript = deferred<string>(); const next = deferred<string>();
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn().mockImplementationOnce(ready => { ready(); return transcript.promise; }).mockImplementation(() => next.promise), cancel: jest.fn(() => next.reject(new Error('Voice off.'))) };
  const handle = jest.fn(async () => 'Navigating to Library. Head north.'); const ready = jest.fn();
  const say = jest.fn().mockReturnValueOnce(speech.promise).mockResolvedValue(true);
  const voice = new NavigationVoice({ input, say, ready, handle, cancel: jest.fn() });
  voice.start('Welcome. Say your destination.'); await flush(); expect(input.listen).not.toHaveBeenCalled();
  speech.resolve(true); await flush(); expect(ready).toHaveBeenCalledTimes(1);
  transcript.resolve('Library'); await flush(); expect(handle).toHaveBeenCalledTimes(1);
  expect(say).toHaveBeenLastCalledWith('Navigating to Library. Head north.');
  voice.stop(); await flush(); expect(voice.active).toBe(false);
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

test('long help/end phrases are explicit commands, misheard or ambient text never becomes a place', () => {
  expect(voiceIntent('Voice help')).toEqual({ kind: 'help' });
  expect(voiceIntent('Manual')).toEqual({ kind: 'help' });
  expect(voiceIntent('man')).toEqual({ kind: 'help' });
  expect(voiceIntent('What can I say?')).toBeNull();
  expect(voiceIntent('Stop navigation')).toEqual({ kind: 'end' });
  for (const text of ['Held', 'And journey', 'Hello there', 'Where am I', 'Sydney Town Hall']) expect(voiceIntent(text)).toBeNull();
});

test('silence re-arms without repeated readiness tones or executing a command', async () => {
  jest.useFakeTimers();
  const next = deferred<string>();
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn()
    .mockImplementationOnce(ready => { ready(); return Promise.reject(new Error('No speech heard.')); })
    .mockImplementation(ready => { ready(); return next.promise; }), cancel: jest.fn() };
  const ready = jest.fn(); const handle = jest.fn();
  const voice = new NavigationVoice({ input, handle, say: jest.fn(async () => true), ready, cancel: jest.fn() });
  voice.start(null); await flush(); await jest.advanceTimersByTimeAsync(400); await flush();
  expect(input.listen).toHaveBeenCalledTimes(2); expect(ready).toHaveBeenCalledTimes(1); expect(handle).not.toHaveBeenCalled();
  voice.stop(); next.reject(new Error('Voice off')); await flush(); jest.useRealTimers();
});

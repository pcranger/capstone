import { VoiceAudioCheck } from '../src/voice/audioCheck';
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
test('reads only completed input, and awaits real speech completion', async () => {
  const result = deferred<string>(), spoken = deferred<boolean>();
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn((ready: () => void) => { ready(); return result.promise; }), cancel: jest.fn() };
  const say = jest.fn(() => spoken.promise), tick = jest.fn();
  const check = new VoiceAudioCheck(input, say, jest.fn(), tick);
  const pending = check.start(); await Promise.resolve();
  expect(check.state.value.phase).toBe('listening'); expect(tick).toHaveBeenCalledTimes(1); expect(say).not.toHaveBeenCalled();
  result.resolve('Sydney Town Hall'); await Promise.resolve();
  expect(check.state.value.phase).toBe('speaking'); spoken.resolve(true); await pending;
  expect(check.state.value.phase).toBe('off'); expect(say).toHaveBeenCalledTimes(1);
});
test('cancel or urgent interruption cannot speak a late recognizer result', async () => {
  const result = deferred<string>(); const input = { prepare: async () => undefined, listen: () => result.promise, cancel: jest.fn() };
  const say = jest.fn(async () => true), check = new VoiceAudioCheck(input, say, jest.fn(), jest.fn());
  const pending = check.start(); await Promise.resolve(); check.stop(); result.resolve('Confirm'); await pending;
  expect(say).not.toHaveBeenCalled(); expect(check.state.value.phase).toBe('off');
});
test('permission denied and recognizer failure leave a retryable visual error', async () => {
  const check = new VoiceAudioCheck({ prepare: async () => { throw new Error('Permission denied'); }, listen: jest.fn(), cancel: jest.fn() }, jest.fn(), jest.fn(), jest.fn());
  await check.start(); expect(check.state.value).toEqual({ phase: 'error', text: 'Permission denied' });
});

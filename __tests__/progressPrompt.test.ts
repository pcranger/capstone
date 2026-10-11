import { ProgressPrompt } from '../src/voice/progressPrompt';
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test('repeats at five seconds, stops cleanly, and never queues overlapping reminders', async () => {
  let resolve!: () => void;
  const say = jest.fn(() => new Promise<void>(r => { resolve = r; })), silence = jest.fn();
  const p = new ProgressPrompt(say, silence); p.start('Finding route.');
  await jest.advanceTimersByTimeAsync(4999); expect(say).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1); expect(say).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(10000); expect(say).toHaveBeenCalledTimes(1);
  resolve(); await jest.advanceTimersByTimeAsync(5000); expect(say).toHaveBeenCalledTimes(2);
  p.stop(); expect(silence).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(15000); expect(say).toHaveBeenCalledTimes(2);
});
test('replacing requests drops old progress and rejected speech can retry', async () => {
  const say = jest.fn().mockRejectedValue(new Error('audio interrupted'));
  const p = new ProgressPrompt(say, jest.fn()); p.start('Searching.');
  await jest.advanceTimersByTimeAsync(4000); p.start('Finding route.');
  await jest.advanceTimersByTimeAsync(5000); expect(say).toHaveBeenCalledWith('Finding route.');
  expect(say).not.toHaveBeenCalledWith('Searching.');
  await jest.advanceTimersByTimeAsync(5000); expect(say).toHaveBeenCalledTimes(2); p.stop();
});

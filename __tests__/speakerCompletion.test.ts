import * as Speech from 'expo-speech';
import { Speaker } from '../src/feedback/speaker';
import { Priority } from '../src/feedback/cue';
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());
test('dialogue completion comes from the real TTS callback, not elapsed time', async () => {
  const speaker = new Speaker(); const done = jest.fn(); const pending = speaker.speakAndWait('Which place?').then(done);
  jest.advanceTimersByTime(1500); expect(done).not.toHaveBeenCalled();
  (Speech.speak as jest.Mock).mock.calls[0][1].onDone(); await pending; expect(done).toHaveBeenCalledWith(true);
});
test('urgent speech cancels routine dialogue; late completion cannot revive it', async () => {
  const speaker = new Speaker(); const pending = speaker.speakAndWait('Confirm place.');
  const old = (Speech.speak as jest.Mock).mock.calls[0][1];
  speaker.speak('Vehicle ahead.', Priority.HIGH, true); expect(await pending).toBe(false);
  old.onDone(); const dropped = speaker.speakAndWait('Next command.'); expect(await dropped).toBe(false);
  expect((Speech.speak as jest.Mock).mock.calls.map(c => c[0])).toEqual(['Confirm place.', 'Vehicle ahead.']);
});
test('stop and missing speech callbacks settle rather than hang a conversation', async () => {
  const speaker = new Speaker(); let pending = speaker.speakAndWait('Test'); speaker.stop(); expect(await pending).toBe(false);
  pending = speaker.speakAndWait('Test again'); jest.advanceTimersByTime(30000); expect(await pending).toBe(false);
});
test('recognition readiness waits for actual speech completion, including queued urgent speech', async () => {
  const speaker = new Speaker(); speaker.speak('Traffic ahead.', Priority.HIGH, true);
  const ready = jest.fn(); const pending = speaker.whenIdle().then(ready);
  await Promise.resolve(); expect(ready).not.toHaveBeenCalled();
  (Speech.speak as jest.Mock).mock.calls[0][1].onDone(); await pending;
  expect(ready).toHaveBeenCalledWith(true);
});
test('recognition also waits for native stop when speech is cancelled while waiting', async () => {
  let stopped!: () => void;
  (Speech.stop as jest.Mock).mockReturnValueOnce(new Promise<void>(resolve => { stopped = resolve; }));
  const speaker = new Speaker(); speaker.speak('Route instruction.', Priority.NORMAL, false);
  const ready = jest.fn(); const pending = speaker.whenIdle().then(ready);
  await Promise.resolve(); speaker.stop();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  stopped(); await pending; expect(ready).toHaveBeenCalledWith(true);
});

import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { Speaker } from '../src/feedback/speaker';
import { Priority } from '../src/feedback/cue';
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());
test('Android interrupts at the next word boundary and bounds engines without range events', async () => {
  const previous = Platform.OS;
  Platform.OS = 'android';
  try {
    const speaker = new Speaker();
    speaker.speak('Old direction.', Priority.NORMAL, false);
    const old = (Speech.speak as jest.Mock).mock.calls[0][1];
    speaker.speak('Vehicle ahead.', Priority.HIGH, true);
    expect(Speech.stop).not.toHaveBeenCalled();
    old.onBoundary();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(Speech.stop).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledTimes(2);
    speaker.stop();
    await jest.advanceTimersByTimeAsync(180);
    expect(Speech.stop).toHaveBeenCalledTimes(2);
  } finally { Platform.OS = previous; }
});
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
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect((Speech.speak as jest.Mock).mock.calls.map(c => c[0])).toEqual(['Confirm place.', 'Vehicle ahead.']);
});
test('replacement waits for native word-boundary stop; a cancelled replacement never starts late', async () => {
  let finish!: () => void;
  (Speech.stop as jest.Mock).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const speaker = new Speaker();
  speaker.speak('Old direction.', Priority.NORMAL, false);
  speaker.speak('Replacement.', Priority.NORMAL, false);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  speaker.stop(); finish();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  speaker.speak('New session.', Priority.NORMAL, false);
  expect(Speech.speak).toHaveBeenCalledTimes(2);
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

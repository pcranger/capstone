import { LocationCoordinator } from '../src/nav/locationCoordinator';
import type { LocationFix } from '../src/nav/navigation';
const fix = (accuracy = 5): LocationFix => ({ latitude: -33.87, longitude: 151.21, accuracy, timestamp: Date.now() });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let value: LocationCoordinator; let onFix: (f: LocationFix) => void; let onError: () => void;
let remove: jest.Mock; let deps: any;
beforeEach(() => {
  jest.useFakeTimers(); remove = jest.fn();
  deps = { now: Date.now, prepare: jest.fn(async () => undefined), cached: jest.fn(async () => null),
    watch: jest.fn(async (f, e) => { onFix = f; onError = e; return { remove }; }) };
  value = new LocationCoordinator(deps);
});
afterEach(() => { value.stop(); jest.useRealTimers(); });
test('foreground startup and simultaneous navigation clients share one native watcher', async () => {
  await Promise.all([value.start(), value.start()]);
  const first = value.fresh(new AbortController().signal); const second = value.fresh(new AbortController().signal);
  onFix(fix()); expect(await first).toEqual(await second);
  const listener = jest.fn(); const watch = await value.watch(listener, jest.fn()); watch.remove();
  expect(remove).not.toHaveBeenCalled(); expect(deps.watch).toHaveBeenCalledTimes(1);
  value.stop(); expect(remove).toHaveBeenCalledTimes(1);
});
test('cached and inaccurate positions cannot satisfy a navigation request', async () => {
  deps.cached.mockResolvedValue(fix()); await value.start(); await flush();
  expect(value.state.value.status).toBe('approximate');
  const done = jest.fn(); const pending = value.fresh(new AbortController().signal).then(done);
  onFix(fix(90)); await flush(); expect(done).not.toHaveBeenCalled();
  jest.advanceTimersByTime(10); onFix(fix()); await pending; expect(done).toHaveBeenCalledTimes(1);
});
test('silence expires navigation quality; foreground return acquires a new native session', async () => {
  await value.start(); onFix(fix()); jest.advanceTimersByTime(16_000);
  expect(value.state.value.status).toBe('finding');
  value.stop(); await value.start(); expect(value.state.value.status).not.toBe('ready');
  onFix(fix()); expect(value.state.value.status).toBe('ready'); expect(deps.watch).toHaveBeenCalledTimes(2);
});
test('late watcher creation and callbacks cannot revive a backgrounded session', async () => {
  let resolve!: (sub: { remove(): void }) => void;
  deps.watch.mockImplementation((f: typeof onFix) => { onFix = f; return new Promise(r => { resolve = r; }); });
  const start = value.start(); await flush(); value.stop(); resolve({ remove }); await start;
  onFix(fix()); expect(remove).toHaveBeenCalledTimes(1); expect(value.state.value.status).toBe('off');
});
test('denied permission returns an actionable failure without starting GPS', async () => {
  deps.prepare.mockRejectedValue(new Error('Enable location in Settings.'));
  await expect(value.fresh(new AbortController().signal)).rejects.toThrow('Enable location');
  expect(deps.watch).not.toHaveBeenCalled();
});
test('cancelled callers do not cancel shared acquisition', async () => {
  await value.start(); const abort = new AbortController(); const pending = value.fresh(abort.signal);
  abort.abort(); await expect(pending).rejects.toThrow('cancelled');
  onFix(fix()); expect(value.state.value.status).toBe('ready'); expect(remove).not.toHaveBeenCalled();
});
test('watch error retries automatically and old callbacks cannot replace the new fix', async () => {
  await value.start(); const oldFix = onFix; onError(); jest.advanceTimersByTime(3_000); await flush();
  onFix(fix()); oldFix(fix(200)); expect(value.state.value.status).toBe('ready');
  expect(deps.watch).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledTimes(1);
});

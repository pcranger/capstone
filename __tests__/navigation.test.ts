import { P } from '../src/strings';
import { Journey, type NavigationDependencies } from '../src/nav/journey';
import { decodePolyline, type LocationFix, type PlaceCandidate, type WalkingRoute, parseWalkingRoute, searchPlaces, walkingRoute, usableFix } from '../src/nav/navigation';
import { bounded } from '../src/nav/location';
import { walkingCue } from '../src/nav/feedbackPolicy';
import { Cues, HapticPattern, Phrase, Priority, ToneKind } from '../src/feedback/cue';

jest.mock('expo-location', () => ({}));
const p = (east: number, north: number) => ({ latitude: -33.87 + north / 111195, longitude: 151.21 + east / (111195 * Math.cos(-33.87 * Math.PI / 180)) });
const to: PlaceCandidate = { id: 'library-id', name: 'Library', address: 'Test suburb', point: p(12, 40) };
const route: WalkingRoute = { destination: to.name, destinationAddress: to.address, points: [p(0, -40), p(0, 0), p(12, 0), p(12, 40)],
  distanceMeters: 92, durationSeconds: 90, warnings: [], steps: [
    { instruction: 'Head north on Test Street', distanceMeters: 40, points: [p(0, -40), p(0, 0)], maneuver: 'DEPART' },
    { instruction: 'Cross Test Road', distanceMeters: 12, points: [p(0, 0), p(12, 0)], maneuver: 'STRAIGHT' },
    { instruction: 'Continue to the library', distanceMeters: 40, points: [p(12, 0), p(12, 40)], maneuver: 'TURN_LEFT' },
  ] };
const deferred = <T,>() => { let resolve!: (x: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let time: number;
let deps: NavigationDependencies;
let journey: Journey;
let remove: jest.Mock;
const fix = (east = 0, north = -40, accuracy: number | null = 5): LocationFix => ({ ...p(east, north), accuracy, timestamp: time });
beforeEach(() => {
  jest.useFakeTimers(); time = 1_000_000; remove = jest.fn();
  deps = { now: () => time, locate: jest.fn(async () => fix()), search: jest.fn(async () => [to]), route: jest.fn(async () => route),
    watch: jest.fn(async () => ({ remove })), say: jest.fn(), silence: jest.fn() };
  journey = new Journey(deps);
});
afterEach(() => { journey.end(); jest.useRealTimers(); jest.restoreAllMocks(); });
async function preview() { await journey.search('Library'); await journey.select(to); }
async function start() { await preview(); expect(await journey.start()).toBe(true); (deps.say as jest.Mock).mockClear(); }
function move(east: number, north: number, accuracy: number | null = 5) { time += 5_000; journey.onFix(fix(east, north, accuracy)); }

test('place search and confirmed route preview never start a journey or location watch', async () => {
  await journey.search('Library'); expect(journey.state.value.candidates).toEqual([to]); expect(deps.route).not.toHaveBeenCalled();
  await journey.select(to); expect(journey.state.value.route).toBe(route); expect(journey.running).toBe(false); expect(deps.watch).not.toHaveBeenCalled();
});
test('15 metre GPS drift across a kerb cannot skip a crossing, even after repeated updates', async () => {
  await start(); move(0, -8); move(13, 0); move(13, 0); move(0, -8);
  expect(journey.state.value.stepIndex).toBe(0); expect(journey.state.value.phase).toBe('walking');
  expect((deps.say as jest.Mock).mock.calls.filter(([s]) => s === P.stepEnd)).toHaveLength(1);
});
test('explicit instruction confirmation is idempotent for the rendered step', async () => {
  await start(); journey.next(0); journey.next(0); expect(journey.state.value.stepIndex).toBe(1);
  journey.next(1); journey.next(2); expect(journey.state.value.stepIndex).toBe(2); expect(journey.state.value.phase).toBe('walking');
  journey.arrive(1); expect(journey.running).toBe(true); journey.arrive(2); expect(journey.state.value.phase).toBe('arrived'); expect(remove).toHaveBeenCalledTimes(1);
});
test('crossing mutes all GPS/route speech and blocks advancing or arrival until footpath confirmation', async () => {
  await start(); journey.enterCrossing(); (deps.say as jest.Mock).mockClear();
  move(0, -2); move(300, 300); journey.repeat(); journey.next(0); journey.arrive(2);
  expect(deps.say).not.toHaveBeenCalled(); expect(journey.state.value.stepIndex).toBe(0);
  journey.leaveCrossing(); expect(journey.state.value.crossing).toBe(false); expect(deps.say).toHaveBeenLastCalledWith(expect.stringContaining('Head north on Test Street'));
  expect(journey.state.value.stepIndex).toBe(0);
});
test('background pause preserves an unfinished crossing and prevents resume until explicit footpath confirmation', async () => {
  await start(); journey.enterCrossing(); journey.pause(); expect(journey.state.value.phase).toBe('paused'); expect(journey.state.value.crossing).toBe(true);
  expect(await journey.start()).toBe(false); journey.leaveCrossing(); expect(journey.state.value.phase).toBe('paused');
  expect(await journey.start()).toBe(true); expect(journey.state.value.stepIndex).toBe(0);
});
test.each([null, 26, 100, -1, NaN])('poor accuracy %s suspends distances without advancing', async accuracy => {
  await start(); move(0, 0, accuracy); expect(journey.state.value.remaining).toBeNull(); expect(journey.state.value.locationStatus).toBe('poor'); expect(journey.state.value.stepIndex).toBe(0);
});
test('stale fixes, out of order fixes, and GPS jumps do not update progress', async () => {
  await start(); time += 20_000; journey.onFix({ ...fix(), timestamp: time - 16_000 }); expect(journey.state.value.locationStatus).toBe('poor');
  move(0, -20); journey.onFix({ ...fix(), timestamp: time - 1 }); expect(journey.state.value.remaining).toBeNull();
  move(400, 500); expect(journey.state.value.locationStatus).toBe('poor'); move(400, 500); expect(journey.state.value.locationStatus).toBe('off-route');
  expect(journey.state.value.stepIndex).toBe(0); expect((deps.say as jest.Mock).mock.calls.some(([s]) => /o'clock|turn around/i.test(s))).toBe(false);
});
test('location silence expires the displayed distance and alerts only once', async () => {
  await start(); time += 20_000; jest.advanceTimersByTime(20_000);
  expect(journey.state.value.remaining).toBeNull(); expect(journey.state.value.locationStatus).toBe('poor'); expect(deps.say).toHaveBeenCalledTimes(1);
});
test('fresh fix is required to search and to start, and a moved origin needs a new route', async () => {
  (deps.locate as jest.Mock).mockResolvedValueOnce(fix(0, 0, 100)); await journey.search('Library'); expect(deps.search).not.toHaveBeenCalled(); expect(journey.state.value.error).toContain('accurate enough');
  await preview(); (deps.locate as jest.Mock).mockResolvedValueOnce(fix(100, 100)); expect(await journey.start()).toBe(false); expect(journey.state.value.error).toContain('moved away'); expect(deps.watch).not.toHaveBeenCalled();
});
test('cancelled or superseded searches cannot replace newer results or speak stale errors', async () => {
  const first = deferred<PlaceCandidate[]>(); (deps.search as jest.Mock).mockReturnValueOnce(first.promise);
  const old = journey.search('old'); await Promise.resolve(); await Promise.resolve();
  await journey.search('new'); first.resolve([{ ...to, name: 'Wrong place' }]); await old;
  expect(journey.state.value.candidates).toEqual([to]);
  const pending = deferred<PlaceCandidate[]>(); (deps.search as jest.Mock).mockReturnValueOnce(pending.promise);
  const request = journey.search('cancel'); await Promise.resolve(); await Promise.resolve(); journey.end(); (deps.say as jest.Mock).mockClear(); pending.reject(new Error('Old failure')); await request;
  expect(journey.state.value.candidates).toEqual([]); expect(deps.say).not.toHaveBeenCalled();
});
test('stopping while location watch is pending removes the late subscription and never restarts', async () => {
  await preview(); const watch = deferred<{ remove: () => void }>(); (deps.watch as jest.Mock).mockReturnValueOnce(watch.promise);
  const starting = journey.start(); await Promise.resolve(); await Promise.resolve(); journey.end(); watch.resolve({ remove });
  expect(await starting).toBe(false); expect(remove).toHaveBeenCalledTimes(1); expect(journey.running).toBe(false);
});
test('late route and old watcher callbacks cannot change an ended journey', async () => {
  await start(); const callback = (deps.watch as jest.Mock).mock.calls[0][0]; journey.end(); callback(fix()); expect(journey.state.value.route).toBeNull();
  const pending = deferred<WalkingRoute>(); (deps.route as jest.Mock).mockReturnValueOnce(pending.promise); const selecting = journey.select(to);
  await Promise.resolve(); await Promise.resolve(); journey.end(); pending.resolve(route); await selecting; expect(journey.state.value.route).toBeNull();
});
test('watch failure keeps preview available and reports an actionable error', async () => {
  await preview(); (deps.watch as jest.Mock).mockRejectedValueOnce(new Error('Location services unavailable'));
  expect(await journey.start()).toBe(false); expect(journey.state.value.route).toBe(route); expect(journey.state.value.busy).toBeNull(); expect(journey.state.value.error).toContain('Location services');
});
test('location deadlines dispose a native subscription that arrives after timeout', async () => {
  const native = deferred<{ remove: () => void }>(); const result = bounded(native.promise, undefined, v => v.remove());
  const assertion = expect(result).rejects.toThrow('timed out'); jest.advanceTimersByTime(25_000); await assertion;
  native.resolve({ remove }); await Promise.resolve(); expect(remove).toHaveBeenCalledTimes(1);
});
test('cancelled native location promises are ignored, including already-aborted callers', async () => {
  const native = deferred<number>(); const controller = new AbortController(); controller.abort();
  await expect(bounded(native.promise, controller.signal)).rejects.toThrow('cancelled'); native.resolve(1);
});
test('route mode preserves vehicle speech, tones and haptics but suppresses signal-search cues', () => {
  expect(walkingCue(Cues.speak(Phrase.VEHICLE_CLOSE_LEFT, Priority.CRITICAL))).toBe(true);
  expect(walkingCue(Cues.tone(ToneKind.ALERT))).toBe(true); expect(walkingCue(Cues.haptic(HapticPattern.CRITICAL))).toBe(true);
  expect(walkingCue(Cues.speak(Phrase.WALK_STARTED, Priority.HIGH))).toBe(false); expect(walkingCue(Cues.tone(ToneKind.SONAR))).toBe(false);
});
test.each(['?', '~', '~~~~~~~?', '!!', '_p~iF'])('rejects malformed polyline %s', encoded => { expect(() => decodePolyline(encoded)).toThrow(); });
test('rejects invalid location coordinates, timestamps, and absent accuracy', () => {
  expect(usableFix({ ...fix(), latitude: NaN }, time)).toBe(false); expect(usableFix({ ...fix(), timestamp: time + 2000 }, time)).toBe(false);
});

const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const response = () => ({ routes: [{ polyline: { encodedPolyline: encoded }, distanceMeters: 900, duration: '120s', warnings: ['Test warning'],
  legs: [{ steps: [{ polyline: { encodedPolyline: encoded }, distanceMeters: 900, navigationInstruction: { instructions: 'Head north', maneuver: 'DEPART' } }] }] }] });
test('provider parses step geometry, instructions, destination identity and warnings; rejects missing step geometry', () => {
  const parsed = parseWalkingRoute(response(), to); expect(parsed.steps[0].points).toHaveLength(3); expect(parsed.destinationAddress).toBe(to.address); expect(parsed.warnings).toEqual(['Test warning']);
  const broken = response(); broken.routes[0].legs[0].steps[0].polyline.encodedPolyline = ''; expect(() => parseWalkingRoute(broken, to)).toThrow('incomplete');
});
test('Google requests use confirmed place ID, WALK travel mode, step geometry, and a limited Places field mask', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ places: [
    { id: to.id, displayName: { text: to.name }, formattedAddress: to.address, location: to.point },
    { id: 'bad', displayName: { text: 'Bad coordinates' }, location: { latitude: 500, longitude: 0 } },
  ] }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => response() } as Response);
  expect(await searchPlaces('Library', fix(), 'test-key')).toEqual([to]); await walkingRoute(fix(), to, 'test-key');
  const request = JSON.parse(fetcher.mock.calls[1][1]?.body as string); expect(request.destination).toEqual({ placeId: to.id }); expect(request.travelMode).toBe('WALK');
  expect(Object.keys(request.origin.location.latLng).sort()).toEqual(['latitude', 'longitude']);
  expect(Object.keys(JSON.parse(fetcher.mock.calls[0][1]?.body as string).locationBias.circle.center).sort()).toEqual(['latitude', 'longitude']);
  expect((fetcher.mock.calls[1][1]?.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('steps.polyline.encodedPolyline');
});
test('Google permission errors never echo provider bodies or API keys', async () => {
  const body = jest.fn(async () => ({ error: 'sensitive-key and location' })); jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 403, json: body } as unknown as Response);
  await expect(searchPlaces('Library', fix(), 'sensitive-key')).rejects.toThrow('route service is unavailable'); expect(body).not.toHaveBeenCalled();
});

test('recenter updates map location without restarting the watch or advancing instructions', async () => {
  await start(); journey.next(0); time += 5_000;
  await journey.refreshLocation(new AbortController().signal);
  expect(journey.location.value).toEqual(fix()); expect(journey.state.value.stepIndex).toBe(1);
  expect(deps.watch).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
  move(0, 0, 100); expect(journey.location.value).toBeNull();
});
test.each(['abort', 'pause', 'end'])('a late location request after %s cannot publish a current position', async action => {
  await start(); const pending = deferred<LocationFix>(); (deps.locate as jest.Mock).mockReturnValueOnce(pending.promise);
  const cancel = new AbortController(); const request = journey.refreshLocation(cancel.signal);
  if (action === 'abort') cancel.abort(); else if (action === 'pause') journey.pause(); else journey.end();
  const previous = journey.location.value;
  time += 5_000; pending.resolve(fix(0, -30));
  await expect(request).rejects.toThrow('cancelled'); expect(journey.location.value).toBe(previous);
});

test('Android DNS failures show a concise connection message without native exception details', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed: java.net.UnknownHostException: places.googleapis.com'));
  await expect(searchPlaces('Library', null, 'test-key')).rejects.toThrow('Cannot connect to Google Maps. Check your internet connection and try again.');
});

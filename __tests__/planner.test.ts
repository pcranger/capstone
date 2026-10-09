import { DestinationPlanner } from '../src/nav/planner';
import type { PlaceCandidate, WalkingRoute } from '../src/nav/navigation';
const place: PlaceCandidate = { id: 'a', name: 'Library', address: 'North suburb', point: { latitude: 1, longitude: 2 } };
const route = { destination: 'Library', points: [place.point], steps: [] } as unknown as WalkingRoute;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const deps = { search: jest.fn(async () => [place]), details: jest.fn(async () => place), route: jest.fn(async () => route),
    start: jest.fn(async () => true), cancelStart: jest.fn() };
  return { deps, p: new DestinationPlanner(deps) };
}
test('search needs no GPS; selection and confirmation cannot themselves start a journey', async () => {
  const { p, deps } = fixture(); await p.search('Library'); p.select(place);
  expect(deps.route).not.toHaveBeenCalled(); await p.confirm('wrong'); expect(deps.route).not.toHaveBeenCalled();
  await p.confirm('a'); expect(p.state.value.page).toBe('route'); expect(deps.start).not.toHaveBeenCalled();
  const revision = p.state.value.revision; expect(await p.start(revision - 1)).toBe(false);
  expect(await p.start(revision)).toBe(true); expect(await p.start(revision)).toBe(false); expect(deps.start).toHaveBeenCalledTimes(1);
  expect(deps.cancelStart).not.toHaveBeenCalled();
});
test('late searches and place details cannot replace newer selection or cancelled work', async () => {
  const { p, deps } = fixture(); const pending = deferred<PlaceCandidate[]>(); deps.search.mockReturnValueOnce(pending.promise);
  const old = p.search('old'); await p.search('new'); pending.resolve([{ ...place, id: 'old' }]); await old;
  expect(p.state.value.candidates[0].id).toBe('a');
  const details = deferred<PlaceCandidate>(); deps.details.mockReturnValueOnce(details.promise);
  const checking = p.resolve('other'); p.cancel(); details.resolve({ ...place, id: 'other' }); await checking;
  expect(p.state.value.selected).toBeNull(); expect(p.state.value.busy).toBeNull();
});
test('duplicate confirmations make one route request and cancelled route results stay discarded', async () => {
  const { p, deps } = fixture(); const pending = deferred<WalkingRoute>(); deps.route.mockReturnValueOnce(pending.promise);
  p.select(place); const routing = p.confirm('a'); await p.confirm('a'); expect(deps.route).toHaveBeenCalledTimes(1);
  p.edit('Another place'); pending.resolve(route); await routing; expect(p.state.value.route).toBeNull();
});
test('moved or closed saved places never silently route to replacement coordinates', async () => {
  const { p, deps } = fixture(); deps.details.mockResolvedValue({ ...place, unavailableReason: 'Place moved.' });
  await p.resolve('a'); await p.confirm('a'); expect(deps.route).not.toHaveBeenCalled(); expect(p.state.value.error).toBe('Place moved.');
});
test('cancelling replacement does not have an end-journey dependency; cancelling start stops the pending start', async () => {
  const { p, deps } = fixture(); p.replace(); await p.search('new'); p.reset(); expect(deps.cancelStart).not.toHaveBeenCalled();
  p.select(place); await p.confirm('a'); const pending = deferred<boolean>(); deps.start.mockReturnValueOnce(pending.promise);
  const starting = p.start(p.state.value.revision); p.cancel(); pending.resolve(false);
  expect(await starting).toBe(false); expect(deps.cancelStart).toHaveBeenCalledTimes(1);
});

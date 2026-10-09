import { SavedPlacesRepository, SAVED_PLACES_KEY } from '../src/nav/savedPlaces';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
function fixture(raw: string | null = null) {
  const storage = { getItem: jest.fn(async () => raw), setItem: jest.fn(async (_: string, value: string) => { raw = value; }) };
  return { storage, repo: new SavedPlacesRepository(storage, () => 100) };
}
test('keeps all bookmarks, orders by actual save, deduplicates concurrent saves and survives restart', async () => {
  const { repo, storage } = fixture(); await repo.load(); expect(repo.state.value.items).toEqual([]);
  await Promise.all(['a', 'b', 'c', 'd', 'd'].map(id => repo.save(id)));
  expect(repo.state.value.items.map(p => p.placeId)).toEqual(['d', 'c', 'b', 'a']);
  expect(repo.state.value.items.slice(0, 3).map(p => p.placeId)).toEqual(['d', 'c', 'b']);
  await repo.save('a', undefined, 'Home'); expect(repo.state.value.items[3].alias).toBe('Home');
  const reloaded = new SavedPlacesRepository(storage); await reloaded.load(); expect(reloaded.state.value.items).toEqual(repo.state.value.items);
});
test('removal and undo preserve unrelated concurrent saves; re-saving a removed place is newest', async () => {
  const { repo } = fixture(); await repo.load(); await repo.save('a'); await repo.save('b');
  await repo.remove('a'); await repo.save('c'); await repo.undo();
  expect(repo.state.value.items.map(p => p.placeId)).toEqual(['c', 'b', 'a']);
  await repo.remove('a'); await repo.save('a', undefined, 'New name'); await repo.undo();
  expect(repo.state.value.items.map(p => p.placeId)).toEqual(['a', 'c', 'b']); expect(repo.state.value.items[0].alias).toBe('New name');
});
test('duplicate alias cannot redirect a bookmark and failure never claims saved', async () => {
  const { repo, storage } = fixture(); await repo.load(); await repo.save('a', 'user query', 'Home');
  await expect(repo.save('b', undefined, ' home ')).rejects.toThrow('already saved'); expect(repo.state.value.items).toHaveLength(1);
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(repo.save('b')).rejects.toThrow('Couldn’t save'); expect(repo.state.value.items).toHaveLength(1);
  await repo.save('b'); expect(repo.state.value.items).toHaveLength(2);
  expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).items.every((p: any) => !p.address && !p.point && !p.name)).toBe(true);
});
test.each(['{broken', '{"version":2,"items":[]}', '{"version":1,"items":[{"placeId":"a","savedAt":null}]}'])('preserves unreadable storage %s', async raw => {
  const { repo, storage } = fixture(raw); await repo.load(); expect(repo.state.value.status).toBe('error');
  await expect(repo.save('new')).rejects.toThrow('unavailable'); expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.getItem).toHaveBeenCalledWith(SAVED_PLACES_KEY);
});

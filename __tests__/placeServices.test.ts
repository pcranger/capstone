import { placeDetails, searchPlaces } from '../src/nav/navigation';
jest.mock('../src/config/services', () => ({ googleApplicationHeaders: () => ({ 'X-Ios-Bundle-Identifier': 'test.app' }) }));
const place = { id: 'test-id', displayName: { text: 'Library' }, formattedAddress: 'Test suburb', location: { latitude: -33, longitude: 151 } };
const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => place })) as jest.Mock; });
afterEach(() => { globalThis.fetch = originalFetch; });
test('saved lookup uses GET, app headers and minimal fields without storing provider content', async () => {
  expect(await placeDetails('test-id', 'test-key')).toMatchObject({ id: 'test-id', name: 'Library' });
  expect(globalThis.fetch).toHaveBeenCalledWith('https://places.googleapis.com/v1/places/test-id', expect.objectContaining({ method: 'GET', body: undefined,
    headers: expect.objectContaining({ 'X-Ios-Bundle-Identifier': 'test.app', 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,businessStatus,movedPlaceId' }) }));
});
test('search without GPS omits bias rather than fabricating an origin', async () => {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ places: [place] }) });
  await searchPlaces('Library Sydney', null, 'test-key');
  const body = JSON.parse((globalThis.fetch as jest.Mock).mock.calls[0][1].body); expect(body.locationBias).toBeUndefined(); expect(body.textQuery).toBe('Library Sydney');
});
test.each([{ movedPlaceId: 'replacement' }, { businessStatus: 'CLOSED_PERMANENTLY' }])('moved/closed details require review, not automatic routing: %p', async extra => {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ...place, ...extra }) });
  expect((await placeDetails('test-id', 'test-key')).unavailableReason).toBeTruthy(); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
test('incomplete coordinates get a useful error, not a runtime null dereference', async () => {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ...place, location: null }) });
  await expect(placeDetails('test-id', 'test-key')).rejects.toThrow('Place details unavailable');
});
test('cancel propagates through the actual details fetch', async () => {
  (globalThis.fetch as jest.Mock).mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Abort')))));
  const abort = new AbortController(); const request = placeDetails('test-id', 'test-key', abort.signal); abort.abort();
  await expect(request).rejects.toThrow('Request cancelled');
});

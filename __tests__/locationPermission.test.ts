const mockPermission = jest.fn();
const mockRequest = jest.fn();
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: () => mockPermission(), requestForegroundPermissionsAsync: () => mockRequest() }));

beforeEach(() => { jest.resetModules(); mockPermission.mockReset(); mockRequest.mockReset(); });
test('foreground resume with permission already granted never opens a permission activity', async () => {
  mockPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  const { ensureLocationPermission } = require('../src/nav/location');
  await ensureLocationPermission(); await ensureLocationPermission();
  expect(mockRequest).not.toHaveBeenCalled();
});
test('concurrent startup checks share one request and denial does not trigger a resume loop', async () => {
  mockPermission.mockResolvedValue({ granted: false, canAskAgain: true });
  let resolve!: (value: unknown) => void;
  mockRequest.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { ensureLocationPermission } = require('../src/nav/location');
  const first = ensureLocationPermission(); const second = ensureLocationPermission();
  await Promise.resolve(); await Promise.resolve();
  resolve({ granted: false, canAskAgain: true });
  const outcomes = await Promise.allSettled([first, second]);
  expect(outcomes.every(result => result.status === 'rejected')).toBe(true);
  await expect(ensureLocationPermission()).rejects.toThrow('app settings');
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  await expect(ensureLocationPermission()).resolves.toBeUndefined();
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import configure from '../app.config';
import { SettingsRepository } from '../src/settings/settings';
import { googleApplicationHeaders, parseServices } from '../src/config/services';

jest.mock('expo-constants', () => ({ __esModule: true, default: {
  expoConfig: { extra: { services: { iosBundleIdentifier: 'fixture.crosswise' } } },
} }));

let mockFile = '';
jest.mock('expo-file-system', () => ({ File: class {
  exists = true;
  textSync() { return mockFile; }
  write(value: string) { mockFile = value; }
}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(async () => undefined),
}));

test('startup removes legacy credentials and shortcuts from BOTH stores, preserving ordinary preferences', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({
    geminiApiKey: 'old-private-ai', mapsApiKey: 'old-private-map', volumeKeys: true,
    navigationEnabled: true, speechRate: 1.4, acceptedSafetyNotice: true,
  }));
  mockFile = JSON.stringify({ mapsApiKey: '', geminiApiKey: 'file-private-ai', volumeKeys: true, haptics: false });
  const s = await new SettingsRepository().load();
  expect(s.speechRate).toBe(1.4);
  expect(s.haptics).toBe(false);
  expect(s.acceptedSafetyNotice).toBe(true);
  const stored = (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1];
  for (const output of [mockFile, stored, JSON.stringify(s)]) {
    expect(output).not.toMatch(/private|ApiKey|volumeKeys|navigationEnabled/);
  }
  expect(JSON.parse(mockFile).acceptedSafetyNotice).toBeUndefined();
});

test('build configuration maps existing env names and supports separately restricted credentials', () => {
  const old = process.env;
  process.env = { ...old, GOOGLE_MAP_API_KEY: 'common-fixture', GEMINI_API_KEY: 'ai-fixture',
    GOOGLE_MAPS_IOS_API_KEY: 'ios-fixture', GOOGLE_MAPS_ANDROID_API_KEY: '', GOOGLE_MAPS_REST_API_KEY: '' };
  try {
    const config = configure({ config: { name: 'Test', slug: 'test', ios: { bundleIdentifier: 'test.app' } } } as any);
    expect(config.plugins).toContainEqual(['react-native-maps', { iosGoogleMapsApiKey: 'ios-fixture', androidGoogleMapsApiKey: '${googleMapsApiKey}' }]);
    expect(JSON.stringify(config.plugins)).not.toContain('common-fixture');
    expect(config.extra?.services.mapsRestApiKey).toBe('common-fixture');
    expect(config.extra?.services.geminiApiKey).toBe('ai-fixture');
    process.env.GOOGLE_MAPS_REST_API_KEY = 'rest-fixture';
    expect(configure({ config: { name: 'Test', slug: 'test' } } as any).extra?.services.mapsRestApiKey).toBe('rest-fixture');
  } finally { process.env = old; }
});

test('absent or malformed service config is unavailable, never interpreted as a key', () => {
  expect(parseServices(undefined).mapsRestApiKey).toBe('');
  expect(parseServices({ mapsRestApiKey: 123, googleMapsIosConfigured: 'true' }).googleMapsIosConfigured).toBe(false);
});

test('iOS REST requests include the configured application identifier without a credential', () => {
  expect(googleApplicationHeaders()).toEqual({ 'X-Ios-Bundle-Identifier': 'fixture.crosswise' });
});

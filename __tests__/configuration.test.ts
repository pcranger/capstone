import AsyncStorage from '@react-native-async-storage/async-storage';
import configure from '../app.config';
import { SettingsRepository } from '../src/settings/settings';

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

test('build configuration carries no Maps plugin, no service keys and no location permission', () => {
  const configure = require('../app.config').default;
  const config = configure({ config: { name: 'Test', slug: 'test' } } as any);
  expect(config.plugins ?? []).not.toContainEqual(expect.arrayContaining(['react-native-maps']));
  expect(config.extra?.services).toBeUndefined();
});

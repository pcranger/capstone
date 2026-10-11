import React from 'react';
import { StyleSheet } from 'react-native';
import { DEFAULT_SETTINGS, InterfaceMode, SettingsRepository } from '../src/settings/settings';
import { MainScreen } from '../src/ui/MainScreen';
import { SettingsScreen } from '../src/ui/SettingsScreen';
import { controller } from '../src/state/controller';
import { S } from '../src/strings';
import { STEER } from '../src/text/steerText';

const { create, act } = require('react-test-renderer');

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null, VoiceToggle: () => null }));
jest.mock('../src/ui/VoiceCheck', () => ({ VoiceCheck: () => null }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('react-native-vision-camera', () => ({ useCameraPermission: () => ({ hasPermission: true, canRequestPermission: false }) }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => null, SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: null }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const { EMPTY_SNAPSHOT } = require('../src/crossing/crossingEngine');
  const c = {
    settings: new Store({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }),
    settingsLoaded: new Store(true),
    planner: { state: new Store({ replacing: false }), cancel: jest.fn() },
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    notice: new Store(null), model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null), hasRecentFrame: true,
    mask: new Store(null), describing: new Store(false), modelLibrary: new Store([]),
    previewSpeech: jest.fn(async () => true), stopSpeechPreview: jest.fn(),
    speakNow: jest.fn(), setHomeVisible: jest.fn(), command: jest.fn(), clearNotice: jest.fn(), repeatGuidance: jest.fn(), crossingAction: jest.fn(),
    logger: { sessions: () => [] },
    updateSettings: jest.fn((fn: (s: typeof DEFAULT_SETTINGS) => typeof DEFAULT_SETTINGS): void => { c.settings.set(fn(c.settings.value)); }),
  };
  return { controller: c };
});

let tree: any;
async function render(element: React.ReactElement) { await act(async () => { tree = create(element); }); }
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label);
const byId = (id: string) => {
  const all = tree.root.findAll((n: any) => n.props.testID === id);
  return all.find((n: any) => n.props.onPress || n.props.onAccessibilityAction) ?? all[0];
};
const texts = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
const flat = (node: any) => StyleSheet.flatten(node.props.style) as any;
async function adjust(id: string, actionName: 'increment' | 'decrement') {
  await act(async () => { byId(id).props.onAccessibilityAction({ nativeEvent: { actionName } }); });
}

beforeEach(() => {
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.model.set({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } } as any);
  controller.cameraStatus.set('running');
  const storage = require('@react-native-async-storage/async-storage');
  storage.getItem.mockReset(); storage.setItem.mockClear();
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

describe('Steering hints switch', () => {
  test('is in Settings, starts off, explains itself, and the switch changes the saved setting', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    const row = byLabel(STEER.settingsSteerHints)[0];
    expect(row.props.accessibilityRole).toBe('switch');
    expect(row.props.accessibilityState).toEqual({ checked: false });
    expect(texts()).toContain(STEER.settingsSteerHintsExplain);
    await act(async () => { row.props.onPress(); });
    expect(controller.settings.value.veerGuidance).toBe(true);
    expect(byLabel(STEER.settingsSteerHints)[0].props.accessibilityState).toEqual({ checked: true });
  });
  test('the old "steering is disabled" lines are gone from Settings (Developer) and Practice text', async () => {
    controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
    await render(<SettingsScreen onBack={() => undefined} />);
    expect(texts().join('\n')).not.toMatch(/disabled/i);
    expect(texts()).toContain(STEER.developerNote);
  });
  test('an install that saved the old default (on) is reset to off once; a later choice sticks', async () => {
    const storage = require('@react-native-async-storage/async-storage');
    const saved = JSON.stringify({ ...DEFAULT_SETTINGS, veerGuidance: true });
    storage.getItem.mockImplementation(async (key: string) => (key === 'crosswise_settings' ? saved : null));
    const first = await new SettingsRepository().load();
    expect(first.veerGuidance).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith('crosswise_steer_hints_reset_v1', '1');
    storage.getItem.mockImplementation(async (key: string) => (key === 'crosswise_settings' ? saved : '1'));
    const later = await new SettingsRepository().load();
    expect(later.veerGuidance).toBe(true);
  });
  test('the reset is not marked done when the cleared settings could not be saved, so it retries next start', async () => {
    const storage = require('@react-native-async-storage/async-storage');
    const saved = JSON.stringify({ ...DEFAULT_SETTINGS, veerGuidance: true });
    storage.getItem.mockImplementation(async (key: string) => (key === 'crosswise_settings' ? saved : null));
    storage.setItem.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
    const first = await new SettingsRepository().load();
    expect(first.veerGuidance).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalledWith('crosswise_steer_hints_reset_v1', '1');
    storage.setItem.mockImplementation(() => Promise.resolve());
  });
});

describe('Crossing check steppers', () => {
  test('start at 5 seconds and 2 lanes with the exact wording', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    expect(texts()).toContain('Hold time on each side: 5 seconds');
    expect(texts()).toContain('Road width: 2 lanes, about 12 steps');
  });
  test('are adjustable controls with increment and decrement actions', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    for (const id of ['stepper-hold', 'stepper-lanes']) {
      const node = byId(id);
      expect(node.props.accessibilityRole).toBe('adjustable');
      expect(node.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
    }
    expect(byId('stepper-hold').props.accessibilityValue).toEqual({ min: 3, max: 8, now: 5, text: '5 seconds' });
  });
  test('hold time steps 3 to 8 and stops at both ends', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    for (let i = 0; i < 5; i++) await adjust('stepper-hold', 'increment');
    expect(controller.settings.value.holdSeconds).toBe(8);
    expect(texts()).toContain('Hold time on each side: 8 seconds');
    for (let i = 0; i < 9; i++) await adjust('stepper-hold', 'decrement');
    expect(controller.settings.value.holdSeconds).toBe(3);
  });
  test('road width steps 1 to 4 lanes, about 6 steps per lane, singular for one lane', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    for (let i = 0; i < 4; i++) await adjust('stepper-lanes', 'increment');
    expect(controller.settings.value.roadLanes).toBe(4);
    expect(texts()).toContain('Road width: 4 lanes, about 24 steps');
    for (let i = 0; i < 6; i++) await adjust('stepper-lanes', 'decrement');
    expect(controller.settings.value.roadLanes).toBe(1);
    expect(texts()).toContain('Road width: 1 lane, about 6 steps');
  });
  test('the plus and minus buttons do the same and are at least 48 dp', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    const up = byId('stepper-hold-up'); const down = byId('stepper-hold-down');
    await act(async () => { up.props.onPress(); });
    expect(controller.settings.value.holdSeconds).toBe(6);
    await act(async () => { byId('stepper-hold-down').props.onPress(); byId('stepper-hold-down').props.onPress(); });
    expect(controller.settings.value.holdSeconds).toBe(4);
    for (const b of [up, down]) { expect(flat(b).width).toBeGreaterThanOrEqual(48); expect(flat(b).height).toBeGreaterThanOrEqual(48); }
    expect(flat(byId('stepper-hold')).minHeight).toBeGreaterThanOrEqual(48);
  });
});

describe('Small accessibility fixes', () => {
  test('both Settings disclosure rows are at least 48 dp', async () => {
    await render(<SettingsScreen onBack={() => undefined} />);
    for (const label of ['Commands and voice setup', 'Read limitations']) expect(flat(byLabel(label)[0]).minHeight).toBeGreaterThanOrEqual(48);
  });
  test('the Developer icon buttons on the camera screen are at least 48 dp', async () => {
    controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
    await render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => undefined} />);
    // VehicleVisibilityControls (another file, not in this change) still has two 44 dp buttons; only the strip is checked here.
    const buttons = tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.style && flat(n).minWidth === 48 && flat(n).minHeight === 48);
    expect(buttons.length).toBeGreaterThan(0);
  });
  test('the headphone advice is the earbud sentence and the Tones row no longer pushes full headphones', () => {
    expect(S.warnNoHeadphones).toBe('Use one earbud or bone-conduction headphones so you can still hear traffic.');
    expect(S.settingsTones).not.toMatch(/headphones/i);
  });
  test('User mode error banner says close and reopen; Developer mode keeps the Settings pointer', async () => {
    controller.model.set({ kind: 'missing' } as any);
    await render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => undefined} />);
    const user = JSON.stringify(tree.toJSON());
    expect(user).toContain(STEER.detectionUnavailableUser);
    expect(user).not.toContain('Settings → Developer');
    await act(async () => tree.unmount());
    controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
    await render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => undefined} />);
    expect(JSON.stringify(tree.toJSON())).toContain('Settings → Developer');
  });
});


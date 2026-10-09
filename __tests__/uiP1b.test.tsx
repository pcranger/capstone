import React from 'react';
import { StyleSheet } from 'react-native';
import { AssistMode, EMPTY_SNAPSHOT } from '../src/crossing/crossingEngine';
import { Side } from '../src/crossing/hazardMonitor';
import { AppFont, DEFAULT_SETTINGS } from '../src/settings/settings';
import { CrossWiseApp } from '../src/ui/CrossWiseApp';
import { GuideScreen } from '../src/ui/GuideScreen';
import { MainScreen } from '../src/ui/MainScreen';
import { SettingsScreen } from '../src/ui/SettingsScreen';
import { Colors, familyOf } from '../src/ui/theme';
import { controller } from '../src/state/controller';
import { S } from '../src/strings';

// UI Package 1, part B: render tests that assert accessibility props and sizes on the real components.
const { create, act } = require('react-test-renderer');

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null }));
jest.mock('../src/ui/VoiceCheck', () => ({ VoiceCheck: () => null }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/config/services', () => ({ nativeMapConfigured: true, services: { mapsRestApiKey: 'fixture', geminiApiKey: 'fixture' } }));
jest.mock('react-native-vision-camera', () => ({ useCameraPermission: () => ({ hasPermission: true, canRequestPermission: false }) }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => null, SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../src/ui/MapPanel', () => ({ MapPanel: () => null }));
jest.mock('../src/ui/DestinationSheet', () => ({ DestinationSheet: () => null }));
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
    presentation: new Store({ mapOpen: false, expanded: false }),
    planner: { state: new Store({ replacing: false }), cancel: jest.fn() },
    openMap: () => c.presentation.update((s: any) => ({ ...s, mapOpen: true })),
    closeMap: () => c.presentation.update((s: any) => ({ ...s, mapOpen: false })),
    journey: { state: new Store({ phase: 'idle', crossing: false }), running: false },
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    notice: new Store(null),
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null),
    hasRecentFrame: true, repeatGuidance: jest.fn(), crossingAction: jest.fn(),
    mask: new Store(null), describing: new Store(false), modelLibrary: new Store([]),
    previewSpeech: jest.fn(async () => true), stopSpeechPreview: jest.fn(),
    sayNavigation: jest.fn(), setHomeVisible: jest.fn(), command: jest.fn(), clearNotice: jest.fn(), stopVoice: jest.fn(),
    logger: { sessions: () => [] },
    updateSettings: jest.fn((fn: (s: typeof DEFAULT_SETTINGS) => typeof DEFAULT_SETTINGS): void => { c.settings.set(fn(c.settings.value)); }),
  };
  return { controller: c };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const flat = (n: any) => StyleSheet.flatten(n.props.style) ?? {};
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label);
const textOf = (value: string) => tree.root.findAll((n: any) => n.type === 'Text' && n.props.children === value)[0];
const press = async (label: string) => { const t = byLabel(label)[0]; expect(t).toBeDefined(); await act(async () => { t.props.onPress(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.ui.set({ ...controller.ui.value, snapshot: EMPTY_SNAPSHOT, frameBrightness: 0.5 });
  controller.presentation.set({ mapOpen: false, expanded: false });
  controller.notice.set(null);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; jest.useRealTimers(); });

const mainScreen = () => render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} />);
const hazardSnapshot = () => ({ ...EMPTY_SNAPSHOT, mode: AssistMode.CROSSING, hazards: [{ side: Side.LEFT }] as any });

describe('J1/J6 journey status row', () => {
  test('a vehicle warning fills the row with the hazard colour: black 20 sp bold text', async () => {
    controller.ui.set({ ...controller.ui.value, snapshot: hazardSnapshot() });
    await mainScreen();
    const message = S.hazardBanner(S.sideLeft);
    const row = byLabel(message).find((n: any) => n.props.accessibilityLiveRegion);
    expect(row.props.accessibilityLiveRegion).toBe('polite');
    expect(flat(row).backgroundColor).toBe(Colors.Hazard);
    expect(flat(textOf(message))).toMatchObject({ color: Colors.OnHazard, fontSize: 20 });
    expect(flat(textOf(message)).fontFamily).toMatch(/Bold$/);
  });
  test('without a hazard the row takes its state colour and is still a polite live region', async () => {
    await mainScreen();
    const row = byLabel(S.cameraHelpOff).find((n: any) => n.props.accessibilityLiveRegion);
    expect(row.props.accessibilityLiveRegion).toBe('polite');
    expect(flat(row).backgroundColor).toBe(Colors.Unknown);
  });
  test('Large status text makes the status line 26 sp', async () => {
    controller.settings.set({ ...controller.settings.value, largeStatus: true });
    await mainScreen();
    expect(flat(textOf(S.cameraHelpOff)).fontSize).toBe(26);
  });
});

describe('J4/J5 journey and map targets', () => {
  test('Show map is at least 96 x 56 dp, the sheet handle 56 dp high, and the map pills are 12 dp apart', async () => {
    await render(<CrossWiseApp />);
    expect(flat(byLabel('Show map')[0])).toMatchObject({ minWidth: 96, height: 56 });
    await act(async () => controller.openMap());
    expect(flat(byLabel('Expand destination panel')[0]).minHeight).toBe(56);
    const stack = tree.root.findAll((n: any) => { const s = flat(n); return s.right === 12 && s.gap === 12 && s.position === 'absolute'; });
    expect(stack.length).toBeGreaterThan(0);
  });
});

describe('J7 notice banner', () => {
  test('floats above the dock as an alert and polite live region, stays 8 s, and clears when tapped', async () => {
    jest.useFakeTimers();
    controller.notice.set('Place saved');
    await render(<CrossWiseApp />);
    const alert = tree.root.findAll((n: any) => n.props.accessibilityRole === 'alert')[0];
    expect(alert.props.accessibilityLiveRegion).toBe('polite');
    expect(alert.props.accessibilityLabel).toBe('Place saved');
    expect(flat(alert)).toMatchObject({ position: 'absolute', minHeight: 56 });
    expect(flat(alert).bottom).toBeGreaterThan(0);
    await act(async () => { jest.advanceTimersByTime(7_999); });
    expect(controller.clearNotice).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(controller.clearNotice).toHaveBeenCalledTimes(1);
    await act(async () => { alert.props.onPress(); });
    expect(controller.clearNotice).toHaveBeenCalledTimes(2);
  });
});

describe('S1/S3/S7 settings and guide', () => {
  test('Display card: each typeface is drawn in its own face, in a radio group, and choosing one saves it', async () => {
    const onBack = jest.fn();
    await render(<SettingsScreen onBack={onBack} />);
    expect(tree.root.findAll((n: any) => n.type === 'Text' && /^display$/i.test(String(n.props.children))).length).toBeGreaterThan(0);
    for (const [label, font] of [[S.fontModern, AppFont.MODERN], [S.fontClassic, AppFont.CLASSIC], [S.fontHyperlegible, AppFont.HYPERLEGIBLE]] as const) {
      expect(byLabel(label)[0].props.accessibilityRole).toBe('radio');
      expect(flat(textOf(label)).fontFamily).toBe(familyOf(font));
    }
    expect(tree.root.findAll((n: any) => n.props.accessibilityRole === 'radiogroup').length).toBeGreaterThanOrEqual(2);
    await press(S.fontHyperlegible);
    expect(controller.settings.value.appFont).toBe(AppFont.HYPERLEGIBLE);
    expect(byLabel(S.fontHyperlegible)[0].props.accessibilityState).toMatchObject({ checked: true });
  });
  test('Large status text is a switch that saves the setting', async () => {
    await render(<SettingsScreen onBack={() => {}} />);
    expect(byLabel(S.settingsLargeStatus)[0].props.accessibilityRole).toBe('switch');
    await press(S.settingsLargeStatus);
    expect(controller.settings.value.largeStatus).toBe(true);
  });
  test('Back is a 56 dp button with an arrow and the word Back, top left, and calls the close handler', async () => {
    const onBack = jest.fn();
    await render(<SettingsScreen onBack={onBack} />);
    const back = byLabel('Back').find((n: any) => n.props.accessibilityRole === 'button');
    expect(flat(back)).toMatchObject({ minHeight: 56, minWidth: 56 });
    expect(textOf('Back')).toBeDefined();
    await act(async () => { back.props.onPress(); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
  test('Guide has the same 56 dp Back button, named as it reads on screen', async () => {
    const onBack = jest.fn();
    await render(<GuideScreen onBack={onBack} />);
    const back = byLabel(S.actionBackToSettings).find((n: any) => n.props.accessibilityRole === 'button');
    expect(flat(back).minHeight).toBe(56);
    expect(textOf(S.actionBackToSettings)).toBeDefined();
    await act(async () => { back.props.onPress(); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
  test('rows are named by the words on screen', async () => {
    await render(<SettingsScreen onBack={() => {}} />);
    for (const visible of ['Commands and voice setup', 'Read limitations']) {
      expect(byLabel(visible)[0].props.accessibilityRole).toBe('button');
      expect(textOf(visible)).toBeDefined();
    }
    expect(byLabel('Voice manual')).toHaveLength(0);
    expect(byLabel('Precautions')).toHaveLength(0);
  });
});

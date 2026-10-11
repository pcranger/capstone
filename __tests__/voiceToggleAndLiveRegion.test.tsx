import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { AssistMode, EMPTY_SNAPSHOT } from '../src/crossing/crossingEngine';
import { Side } from '../src/crossing/hazardMonitor';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { MainScreen } from '../src/ui/MainScreen';
import { VoiceStatus, VoiceToggle } from '../src/ui/VoiceControl';
import { controller } from '../src/state/controller';

// Items 10d and 11 of the blind-user review: the large Voice commands button, and no double announcements under a screen reader.
const { create, act } = require('react-test-renderer');

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => null, SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: { headphonesConnected: () => false, batteryPercent: () => Promise.resolve(100) } }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const { EMPTY_SNAPSHOT } = require('../src/crossing/crossingEngine');
  return { controller: {
    settings: new Store({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }),
    voice: { state: new Store({ phase: 'listening', text: 'Listening' }) },
    voiceMode: new Store(true), toggleVoice: jest.fn(), toggleVoiceFromGesture: jest.fn(),
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null),
    hasRecentFrame: true, mask: new Store(null),
  } };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const screenReader = (on: boolean) => jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(on);
const toggle = () => tree.root.findAll((n: any) => n.props.accessibilityRole === 'switch' && n.props.accessibilityLabel === 'Voice commands')[0];
const withHazard = () => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING, hazards: [{ side: Side.LEFT }] } as any });

beforeEach(() => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  controller.voiceMode.set(true);
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.voice.state.set({ phase: 'listening', text: 'Listening' });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });

describe('10d the large Voice commands button', () => {
  test('is a button named for its state, at least 56 dp, and flips with the chosen mode', async () => {
    await render(<VoiceToggle bottom={120} />);
    expect(toggle().props.accessibilityState).toEqual({ checked: true });
    const style = StyleSheet.flatten(toggle().props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(56);
    expect(style.minHeight).toBeGreaterThanOrEqual(56);
    await act(async () => controller.voiceMode.set(false));
    expect(toggle().props.accessibilityState).toEqual({ checked: false });
    await act(async () => toggle().props.onPress());
    expect(controller.toggleVoice).toHaveBeenCalledTimes(1);
  });

  test('sits above the dock inside the main screen, and is not drawn without speech or camera permission', async () => {
    await render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} bottomInset={120} />);
    const slot = toggle().parent.parent;
    expect(StyleSheet.flatten(slot.props.style).bottom).toBe(128);
    await act(async () => tree.unmount());
    await render(<MainScreen hasPermission={false} canRequestPermission requestPermission={() => {}} bottomInset={120} />);
    expect(toggle()).toBeUndefined();
    await act(async () => tree.unmount());
    controller.settings.set({ ...controller.settings.value, speech: false });
    await render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} bottomInset={120} />);
    expect(toggle()).toBeUndefined();
  });
});

describe('11 one event, one voice', () => {
  const live = (label?: string) => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLiveRegion !== undefined && (!label || n.props.accessibilityLabel === label || n.props.children === label));

  test('screen reader off: the hazard banner and the Listening text are polite live regions', async () => {
    screenReader(false); withHazard();
    await render(<><MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} /><VoiceStatus onHelp={() => {}} /></>);
    const regions = live();
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const n of regions) expect(n.props.accessibilityLiveRegion).toBe('polite');
    expect(live('Listening…')).toHaveLength(1);
  });

  test('screen reader on: those regions are off but the text is still there to swipe to', async () => {
    screenReader(true); withHazard();
    await render(<><MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} /><VoiceStatus onHelp={() => {}} /></>);
    const regions = live();
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const n of regions) expect(n.props.accessibilityLiveRegion).toBe('none');
    const banner = tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessible === true && /vehicle/i.test(n.props.accessibilityLabel ?? ''));
    expect(banner.length).toBeGreaterThan(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Listening…');
  });

  const bannerRegion = (label: RegExp) => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessible === true && label.test(n.props.accessibilityLabel ?? ''))[0]?.props.accessibilityLiveRegion;
  const mainScreen = () => render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} />);
  const assist = () => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING } as any });

  test('states the app does NOT speak stay polite even with a screen reader and speech on (Too dark, loading)', async () => {
    screenReader(true); assist();
    controller.ui.set({ ...controller.ui.value, frameBrightness: 0.1 });
    await mainScreen();
    expect(bannerRegion(/Too dark/)).toBe('polite');
    await act(async () => tree.unmount());
    controller.ui.set({ ...controller.ui.value, frameBrightness: 0.5 });
    controller.model.set({ kind: 'loading' } as any);
    await mainScreen();
    expect(bannerRegion(/Loading detection/)).toBe('polite');
    controller.model.set({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } } as any);
  });

  test('spoken states: camera blocked is none with a screen reader and speech on, polite once speech is off', async () => {
    screenReader(true); assist();
    controller.ui.set({ ...controller.ui.value, frameBrightness: 0.01 });
    await mainScreen();
    expect(bannerRegion(/Camera blocked/)).toBe('none');
    await act(async () => controller.settings.set({ ...controller.settings.value, speech: false }));
    expect(bannerRegion(/Camera blocked/)).toBe('polite');
    controller.ui.set({ ...controller.ui.value, frameBrightness: 0.5 });
  });

  test('hazard banner is polite when speech is off, even with a screen reader on', async () => {
    screenReader(true); withHazard();
    controller.settings.set({ ...controller.settings.value, speech: false });
    await mainScreen();
    expect(bannerRegion(/vehicle/i)).toBe('polite');
  });

  test('"Voice commands are off" stays polite with a screen reader on', async () => {
    screenReader(true);
    controller.settings.set({ ...controller.settings.value, speech: false });
    await render(<VoiceStatus onHelp={() => {}} />);
    expect(live()[0].props.accessibilityLiveRegion).toBe('polite');
  });

  test('turning the screen reader on while the screen is open switches the regions off', async () => {
    const spy = screenReader(false);
    let listener: (v: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((name: string, fn: any) => { if (name === 'screenReaderChanged') listener = fn; return { remove: () => {} }; }) as any);
    await render(<VoiceStatus onHelp={() => {}} />);
    expect(live()[0].props.accessibilityLiveRegion).toBe('polite');
    await act(async () => listener(true));
    expect(live()[0].props.accessibilityLiveRegion).toBe('none');
    expect(spy).toHaveBeenCalled();
  });
});

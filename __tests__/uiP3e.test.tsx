import React from 'react';
import { AccessibilityInfo, Animated, ScrollView, StyleSheet } from 'react-native';
import { AssistMode, EMPTY_SNAPSHOT } from '../src/crossing/crossingEngine';
import { AppFont, DEFAULT_SETTINGS } from '../src/settings/settings';
import { S } from '../src/strings';
import { BigButton } from '../src/ui/components';
import { JourneyControls, JourneyScreen } from '../src/ui/JourneyScreen';
import { MainScreen } from '../src/ui/MainScreen';
import { Colors, Dimens, typographyFor } from '../src/ui/theme';
import { controller } from '../src/state/controller';

// UI Package 3, part E: motion (X1 J17 X2), the dock and More controls sheet (J12), slim warnings (J16), tokens (J18 X3).
const { create, act } = require('react-test-renderer');
const fs = require('fs');

let mockHeadphones = true;
let mockBattery = 100;
jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null }));
jest.mock('../src/ui/MapPanel', () => ({ MapPanel: () => null }));
jest.mock('../src/ui/DestinationSheet', () => ({ DestinationSheet: () => null }));
jest.mock('../src/config/services', () => ({ nativeMapConfigured: true, services: { mapsRestApiKey: 'fixture', geminiApiKey: 'fixture' } }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => null, SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../modules/crosswise-native', () => ({
  __esModule: true,
  default: { headphonesConnected: () => mockHeadphones, batteryPercent: () => Promise.resolve(mockBattery) },
}));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const { EMPTY_SNAPSHOT } = require('../src/crossing/crossingEngine');
  const c = {
    settings: new Store({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }),
    presentation: new Store({ mapOpen: false, expanded: false }),
    openMap: () => c.presentation.update((s: any) => ({ ...s, mapOpen: true })),
    closeMap: () => c.presentation.update((s: any) => ({ ...s, mapOpen: false })),
    journey: { state: new Store({ phase: 'idle', crossing: false }), running: false },
    planner: { state: new Store({ replacing: false }) },
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null),
    hasRecentFrame: true, mask: new Store(null),
    repeatGuidance: jest.fn(), crossingAction: jest.fn(), command: jest.fn(), startJourney: jest.fn(), pauseJourney: jest.fn(), stopNavigation: jest.fn(),
    changeDestination: jest.fn(), finishJourney: jest.fn(), stopVoice: jest.fn(),
  };
  return { controller: c };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const flat = (n: any) => StyleSheet.flatten(n.props.style) ?? {};
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label);
const button = (label: string) => byLabel(label).find((n: any) => n.props.accessibilityRole === 'button');
const press = async (label: string) => { const t = button(label); expect(t).toBeDefined(); await act(async () => { t.props.onPress(); }); };
const labels = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityRole === 'button').map((n: any) => n.props.accessibilityLabel);
const setReduce = (value: boolean) => jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(value);
const setMode = (mode: AssistMode) => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode } as any });
const mainScreen = () => render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} />);
const timingCalls = (spy: jest.SpyInstance, duration: number) => spy.mock.calls.filter(([, config]) => config.duration === duration);

beforeEach(() => {
  jest.clearAllMocks();
  mockHeadphones = true; mockBattery = 100;
  setReduce(false);
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.ui.set({ ...controller.ui.value, snapshot: EMPTY_SNAPSHOT, frameBrightness: 0.5 });
  controller.presentation.set({ mapOpen: false, expanded: false });
  controller.journey.state.set({ phase: 'idle', crossing: false } as any);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; jest.restoreAllMocks(); });

describe('X1 and J17 press feedback', () => {
  test('a BigButton press scales over 120 ms; with Reduce Motion there is no scale and no animation', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await render(<BigButton text="Go" color={Colors.Crossing} onPress={() => {}} />);
    const outer = byLabel('Go')[0];
    expect((flat(byLabel('Go').find((n: any) => typeof n.type === 'string')).transform ?? []).length).toBe(1);
    await act(async () => outer.props.onPressIn());
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 120, useNativeDriver: true }));
    await act(async () => tree.unmount()); tree = undefined; timing.mockClear();

    setReduce(true);
    await render(<BigButton text="Go" color={Colors.Crossing} onPress={() => {}} />);
    await act(async () => {});
    await act(async () => byLabel('Go')[0].props.onPressIn());
    expect(timingCalls(timing, 120)).toHaveLength(0);
    expect((flat(byLabel('Go').find((n: any) => typeof n.type === 'string')).transform ?? []).length).toBe(0);
  });
});

describe('J12 the dock shows at most three actions, never scrolls, and More controls opens a sheet', () => {
  test('every state shows 3 or fewer buttons in the dock', async () => {
    const states: [AssistMode, object][] = [
      [AssistMode.IDLE, { phase: 'idle' }], [AssistMode.SEARCHING, { phase: 'idle' }], [AssistMode.SEARCHING, { phase: 'walking' }],
      [AssistMode.IDLE, { phase: 'paused' }], [AssistMode.CROSSING, { phase: 'paused', crossing: true }],
    ];
    for (const [mode, journey] of states) {
      setMode(mode); controller.journey.state.set({ crossing: false, ...journey } as any);
      for (const compact of [false, true]) {
        await render(<JourneyControls stacked={false} compact={compact} />);
        expect(labels().length).toBeLessThanOrEqual(3);
        await act(async () => tree.unmount()); tree = undefined;
      }
    }
  });
  test('the dock has no ScrollView around its buttons', async () => {
    await render(<JourneyScreen onSettings={() => {}} hidden={false} hasPermission canRequestPermission={false} requestPermission={() => {}} />);
    const scrolls = tree.root.findAllByType(ScrollView);
    expect(scrolls.filter((s: any) => s.findAll((n: any) => n.props.accessibilityLabel === 'Start camera help').length > 0)).toHaveLength(0);
    expect(button('Start camera help')).toBeDefined();
  });
  test('More controls opens a sheet with the extra buttons; Close, a button press and hardware back all dismiss it', async () => {
    setMode(AssistMode.SEARCHING);
    await render(<JourneyControls stacked={false} compact />);
    const modal = () => tree.root.findAll((n: any) => typeof n.props.onRequestClose === 'function')[0];
    expect(modal().props.visible).toBe(false);
    expect(labels()).toEqual(['I’m crossing', 'More controls']);
    await press('More controls');
    expect(modal().props.visible).toBe(true);
    expect(labels()).toEqual(['I’m crossing', 'More controls', 'Repeat', 'Stop camera help', 'Close']);
    expect(tree.root.findAll((n: any) => n.props.accessibilityViewIsModal === true).length).toBeGreaterThan(0);
    await press('Close'); expect(modal().props.visible).toBe(false);
    await press('More controls'); await act(async () => modal().props.onRequestClose()); expect(modal().props.visible).toBe(false);
    await press('More controls'); await press('Stop camera help');
    expect(controller.command).toHaveBeenCalledTimes(1); expect(modal().props.visible).toBe(false);
  });
});

describe('X2 the destination sheet slides 200 ms on transform', () => {
  const journey = () => render(<JourneyScreen onSettings={() => {}} hidden={false} hasPermission canRequestPermission={false} requestPermission={() => {}} />);
  test('expanding animates once, 200 ms, on the native driver', async () => {
    await journey(); await act(async () => {});
    const timing = jest.spyOn(Animated, 'timing');
    await act(async () => controller.presentation.update((s: any) => ({ ...s, expanded: true })));
    expect(timingCalls(timing, 200)).toHaveLength(1);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, duration: 200, useNativeDriver: true }));
  });
  test('with Reduce Motion the height change is instant', async () => {
    setReduce(true);
    await journey(); await act(async () => {});
    const timing = jest.spyOn(Animated, 'timing');
    await act(async () => controller.presentation.update((s: any) => ({ ...s, expanded: true })));
    expect(timingCalls(timing, 200)).toHaveLength(0);
  });
});

describe('J16 slim warnings line', () => {
  test('no warning, no line', async () => {
    await mainScreen(); await act(async () => {});
    expect(byLabel(S.warnNoHeadphones)).toHaveLength(0);
  });
  test('no headphones and a low battery become one polite line that speaks both', async () => {
    mockHeadphones = false; mockBattery = 15;
    await mainScreen(); await act(async () => {}); await act(async () => {});
    const line = byLabel(`${S.warnNoHeadphones} ${S.warnBattery(15)}`).find((n: any) => typeof n.type === 'string');
    expect(line).toBeDefined();
    expect(line.props.accessibilityLiveRegion).toBe('polite');
    expect(tree.root.findAll((n: any) => n.type === 'Text' && String(n.props.children).includes(S.warnNoHeadphones)).length).toBeGreaterThan(0);
  });
});

describe('J18 and X3 tokens', () => {
  test('the new colour tokens hold the values the screens used before', () => {
    expect([Colors.Warn, Colors.Info, Colors.RouteLine, Colors.VehicleMoving, Colors.VehicleStationary, Colors.VehicleOff])
      .toEqual(['#FFD87A', '#80DEEA', '#1464C0', '#FF7777', '#69DB92', '#89959B']);
  });
  test('those screens no longer carry the literals', () => {
    for (const file of ['MainScreen', 'JourneyScreen', 'DestinationSheet', 'VehicleVisibilityControls', 'MapPanel']) {
      const source = fs.readFileSync(`${process.cwd()}/src/ui/${file}.tsx`, 'utf8');
      expect(source).not.toMatch(/#FFD87A|#80DEEA|#FF7777|#69DB92|#89959B|#1464C0|rgba\(20,100,192/i);
    }
  });
  test('the type scale is 15 / 17 / 20 / 26 / 34 and the radii are 12 / 18 / pill', () => {
    const sizes = new Set(Object.values(typographyFor(AppFont.MODERN)).map(style => style.fontSize));
    expect([...sizes].sort((a, b) => (a as number) - (b as number))).toEqual([15, 17, 20, 26, 34]);
    expect([Dimens.radiusRow, Dimens.radiusCard, Dimens.radiusPill]).toEqual([12, 18, 28]);
  });
});

import React from 'react';
import { Linking } from 'react-native';
import { AssistMode, EMPTY_SNAPSHOT } from '../src/crossing/crossingEngine';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { JourneyControls, JourneyScreen } from '../src/ui/JourneyScreen';
import { MainScreen } from '../src/ui/MainScreen';
import { controller } from '../src/state/controller';

// CW-19: the three HIGH bugs from the emulator user test (SIM-1, SIM-2, SIM-3), on the real components and real buttons.
const { create, act } = require('react-test-renderer');

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null, VoiceToggle: () => null }));
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
    planner: { state: new Store({ replacing: false }) },
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null),
    hasRecentFrame: true, mask: new Store(null),
    repeatGuidance: jest.fn(), crossingAction: jest.fn(), command: jest.fn(),
    changeDestination: jest.fn(), finishJourney: jest.fn(), stopVoice: jest.fn(),
  };
  return { controller: c };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label);
const button = (label: string) => byLabel(label).find((n: any) => n.props.accessibilityRole === 'button');
const press = async (label: string) => { const t = button(label); expect(t).toBeDefined(); await act(async () => { t.props.onPress(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.ui.set({ ...controller.ui.value, snapshot: EMPTY_SNAPSHOT, frameBrightness: 0.5 });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });

describe('SIM-1 no camera permission: the dock does not start camera help', () => {
  test('Start camera help becomes Allow camera; pressing it asks for the camera and never starts help', async () => {
    const request = jest.fn(() => Promise.resolve(true));
    await render(<JourneyControls stacked={false} compact permission={{ hasPermission: false, canRequestPermission: true, requestPermission: request }} />);
    expect(button('Start camera help')).toBeUndefined();
    await press('Allow camera');
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.command).not.toHaveBeenCalled();
  });
  test('when Android will not ask again the dock button is Open app settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<JourneyControls stacked={false} compact permission={{ hasPermission: false, canRequestPermission: false, requestPermission: jest.fn() }} />);
    expect(button('Start camera help')).toBeUndefined();
    await press('Open app settings');
    expect(open).toHaveBeenCalledTimes(1); expect(controller.command).not.toHaveBeenCalled();
    open.mockRestore();
  });
  test('with the camera allowed the dock still starts camera help', async () => {
    await render(<JourneyControls stacked={false} compact permission={{ hasPermission: true, canRequestPermission: false, requestPermission: jest.fn() }} />);
    await press('Start camera help');
    expect(controller.command).toHaveBeenCalledTimes(1);
  });
});

describe('SIM-2 Allow camera always does something visible', () => {
  test('Android refuses at once without a dialog (request returns false): open app settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<MainScreen hasPermission={false} canRequestPermission requestPermission={() => Promise.resolve(false)} />);
    await press('Allow camera');
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
  test('the request itself fails: open app settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<MainScreen hasPermission={false} canRequestPermission requestPermission={() => Promise.reject(new Error('No Activity!'))} />);
    await press('Allow camera');
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
  test('the user saw the dialog and tapped Don’t allow (slow false): no extra jump to settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const now = jest.spyOn(Date, 'now');
    let t = 1000; now.mockImplementation(() => t);
    await render(<MainScreen hasPermission={false} canRequestPermission requestPermission={() => { t += 4000; return Promise.resolve(false); }} />);
    await press('Allow camera');
    expect(open).not.toHaveBeenCalled();
    now.mockRestore(); open.mockRestore();
  });
});

describe('SIM-3 a panel over the journey hides everything behind it from accessibility', () => {
  const props = (hidden: boolean) => ({ onSettings: () => {}, hidden, hasPermission: true, canRequestPermission: false, requestPermission: () => {} });
  const rootView = () => tree.root.findByType(JourneyScreen).findAll((n: any) => typeof n.type === 'string')[0];
  test('panel open: the journey root hides its descendants (Android and iOS flags); panel closed: it does not', async () => {
    await render(<JourneyScreen {...props(true)} />);
    expect(rootView().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(rootView().props.accessibilityElementsHidden).toBe(true);
    await act(async () => tree.update(<JourneyScreen {...props(false)} />));
    expect(rootView().props.importantForAccessibility).toBe('auto');
    expect(rootView().props.accessibilityElementsHidden).toBe(false);
  });
});

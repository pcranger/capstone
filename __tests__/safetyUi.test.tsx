/** cw-safety: the real screens (CrossWiseApp, JourneyControls) pressed through react-test-renderer; the controller is a recorder. */
import React from 'react';
import { AssistMode } from '../src/crossing/crossingEngine';
import { EMPTY_SNAPSHOT, UserCommand } from '../src/crossing/crossingEngine';
import { cameraAccess } from '../src/state/cameraAccess';
import { controller } from '../src/state/controller';
import { CrossWiseApp } from '../src/ui/CrossWiseApp';
import { JourneyControls } from '../src/ui/JourneyScreen';
import { S } from '../src/strings';
import { T } from '../src/text/safetyText';

const { create, act } = require('react-test-renderer');
jest.setTimeout(30_000); // the first CrossWiseApp render in a file loads every screen and can be slow on a busy machine

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
let mockPermission: { hasPermission: boolean; canRequestPermission: boolean; requestPermission: jest.Mock };
jest.mock('react-native-vision-camera', () => ({ useCameraPermission: () => mockPermission }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => null, SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: null }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const { EMPTY_SNAPSHOT } = require('../src/crossing/crossingEngine');
  return { controller: {
    settings: new Store({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }), settingsLoaded: new Store(true),
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    notice: new Store(null), model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null),
    hasRecentFrame: true, repeatGuidance: jest.fn(), crossingAction: jest.fn(), mask: new Store(null), modelLibrary: new Store([]),
    speakNow: jest.fn(), setHomeVisible: jest.fn(), command: jest.fn(), clearNotice: jest.fn(), welcomeDone: Promise.resolve(),
  } };
});

let tree: any;
async function render(element: React.ReactElement) { await act(async () => { tree = create(element); }); }
const button = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label)[0];
async function press(label: string) { const target = button(label); expect(target).toBeDefined(); await act(async () => { target.props.onPress(); }); }
const setMode = (mode: AssistMode) => act(async () => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode } }));

beforeEach(() => {
  jest.restoreAllMocks();
  mockPermission = { hasPermission: true, canRequestPermission: false, requestPermission: jest.fn(async () => true) };
  (controller as any).welcomeDone = Promise.resolve();
  controller.ui.set({ ...controller.ui.value, snapshot: EMPTY_SNAPSHOT });
  for (const f of ['command', 'speakNow', 'crossingAction']) ((controller as any)[f] as jest.Mock).mockClear();
  cameraAccess.has = true;
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

describe('4 - the big button changes meaning under the finger', () => {
  test('after its label changes it announces the new meaning and ignores presses for 1.5 s', async () => {
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(5_000_000);
    await render(<JourneyControls stacked={false} />);
    expect(button('Start camera help')).toBeDefined();
    expect(controller.speakNow).not.toHaveBeenCalled(); // nothing is announced for the first label
    await setMode(AssistMode.SEARCHING);
    expect(controller.speakNow).toHaveBeenCalledWith('Camera help on. Next button: I’m crossing');
    dateNow.mockReturnValue(5_000_900);
    await press('I’m crossing');
    expect(controller.crossingAction).not.toHaveBeenCalled(); // 0.9 s after the change: a late tap meant for "Start"
    dateNow.mockReturnValue(5_001_600);
    await press('I’m crossing');
    expect(controller.crossingAction).toHaveBeenCalledWith('start');
  });

  test('the next change is announced too (crossing -> End crossing)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(6_000_000);
    await render(<JourneyControls stacked={false} />);
    await setMode(AssistMode.SEARCHING);
    await setMode(AssistMode.CROSSING);
    expect(controller.speakNow).toHaveBeenLastCalledWith(T.nextButton('I’m on the footpath'));
  });
});

describe('1 - the Stop button during a crossing', () => {
  test('first press asks "Stop warnings while crossing?"; a second press within 3 s stops', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(7_000_000);
    await render(<JourneyControls stacked={false} />);
    await setMode(AssistMode.CROSSING);
    await press('Stop camera help');
    expect(controller.speakNow).toHaveBeenCalledWith(T.stopConfirm);
    expect(controller.command).not.toHaveBeenCalled();
    await press('Stop camera help');
    expect(controller.command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
  });

  test('outside a crossing, one press stops', async () => {
    await render(<JourneyControls stacked={false} />);
    await setMode(AssistMode.SEARCHING);
    await press('Stop camera help');
    expect(controller.command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
  });
});

describe('9 - camera permission follows the app', () => {
  test('the controller learns when the permission is lost and when it returns, and the dock follows', async () => {
    mockPermission = { ...mockPermission, hasPermission: false };
    await render(<CrossWiseApp />);
    expect(cameraAccess.has).toBe(false);
    expect(button(S.actionOpenSettings)).toBeDefined();
    mockPermission = { ...mockPermission, hasPermission: true };
    await act(async () => tree.update(<CrossWiseApp />));
    expect(cameraAccess.has).toBe(true);
    expect(button('Start camera help')).toBeDefined();
  });
});

describe('12 - the welcome comes before the camera permission dialog', () => {
  test('the permission is requested only after the spoken welcome has finished', async () => {
    let finish: () => void = () => undefined;
    (controller as any).welcomeDone = new Promise<void>(resolve => { finish = resolve; });
    mockPermission = { hasPermission: false, canRequestPermission: true, requestPermission: jest.fn(async () => true) };
    await render(<CrossWiseApp />);
    expect(mockPermission.requestPermission).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(mockPermission.requestPermission).toHaveBeenCalledTimes(1);
  });
});

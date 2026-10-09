import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { AssistMode, EMPTY_SNAPSHOT, UserCommand } from '../src/crossing/crossingEngine';
import { SignalPhase } from '../src/signal/signalPhaseTracker';
import { DEFAULT_SETTINGS, InterfaceMode } from '../src/settings/settings';
import { JourneyControls, RouteSummary } from '../src/ui/JourneyScreen';
import { MainScreen } from '../src/ui/MainScreen';
import { Colors } from '../src/ui/theme';
import { controller } from '../src/state/controller';
import { WALKING_WARNING } from '../src/nav/navigation';
import { S } from '../src/strings';

// UI Package 2, part C: the dock, the state banner, the camera-off card and the one glossary, on the real components.
const { create, act } = require('react-test-renderer');

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null }));
jest.mock('../src/ui/MapPanel', () => ({ MapPanel: () => null }));
jest.mock('../src/ui/DestinationSheet', () => ({ DestinationSheet: () => null }));
jest.mock('../src/config/services', () => ({ nativeMapConfigured: true, services: { mapsRestApiKey: 'fixture', geminiApiKey: 'fixture' } }));
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
    presentation: new Store({ mapOpen: false, expanded: false }),
    openMap: () => c.presentation.update((s: any) => ({ ...s, mapOpen: true })),
    journey: { state: new Store({ phase: 'idle', crossing: false }), running: false },
    ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline: new Store({ receivedAt: 0, latencyMs: 0, slowFrames: 0, error: null }), cameraDetail: new Store(null),
    hasRecentFrame: true, mask: new Store(null),
    repeatGuidance: jest.fn(), crossingAction: jest.fn(), command: jest.fn(), startJourney: jest.fn(), pauseJourney: jest.fn(), stopNavigation: jest.fn(),
    changeDestination: jest.fn(), finishJourney: jest.fn(),
    journeyNext: jest.fn(),
  };
  return { controller: c };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const flat = (n: any) => StyleSheet.flatten(n.props.style) ?? {};
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label);
const button = (label: string) => byLabel(label).find((n: any) => n.props.accessibilityRole === 'button');
const press = async (label: string) => { const t = button(label); expect(t).toBeDefined(); await act(async () => { t.props.onPress(); }); };
const textOf = (value: string) => tree.root.findAll((n: any) => n.type === 'Text' && n.props.children === value)[0];
const host = (label: string) => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLabel === label)[0];
const labels = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityRole === 'button').map((n: any) => n.props.accessibilityLabel);
const setMode = (mode: AssistMode, extra: object = {}) => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode, ...extra } as any });
const setJourney = (state: object) => controller.journey.state.set(state as any);
const route = { destination: 'Town Hall', steps: [{ instruction: 'Turn left on George Street' }, { instruction: 'Cross the road' }] } as any;

beforeEach(() => {
  jest.clearAllMocks();
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.ui.set({ ...controller.ui.value, snapshot: EMPTY_SNAPSHOT, frameBrightness: 0.5 });
  controller.presentation.set({ mapOpen: false, expanded: false });
  controller.cameraStatus.set('running');
  setJourney({ phase: 'idle', crossing: false });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });

describe('J2 the dock keeps one 56 dp primary button that follows the state', () => {
  test('camera help off: Start camera help, 56 dp, 20 sp, alone in the dock', async () => {
    await render(<JourneyControls stacked={false} compact />);
    expect(labels()).toEqual(['Start camera help']);
    expect(flat(host('Start camera help')).minHeight).toBe(56);
    expect(flat(textOf('Start camera help')).fontSize).toBe(20);
    await press('Start camera help');
    expect(controller.command).toHaveBeenCalledWith(UserCommand.START_ASSIST, true);
  });
  test('camera help on: I’m crossing, and Repeat and Stop camera help wait behind More controls', async () => {
    setMode(AssistMode.SEARCHING);
    await render(<JourneyControls stacked={false} compact />);
    expect(labels()).toEqual(['I’m crossing', 'More controls']);
    expect(flat(host('More controls')).minHeight).toBe(56);
    await press('I’m crossing');
    expect(controller.crossingAction).toHaveBeenCalledWith('start');
    await press('More controls');
    // UI P3e J12: More controls opens a sheet (Repeat, Stop camera help, Close) after the dock's own two buttons.
    expect(labels()).toEqual(['I’m crossing', 'More controls', 'Repeat', 'Stop camera help', 'Close']);
    await press('Stop camera help');
    expect(controller.command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
  });
  test('crossing: I’m on the footpath', async () => {
    setMode(AssistMode.CROSSING);
    await render(<JourneyControls stacked={false} compact />);
    expect(labels()).toEqual(['I’m on the footpath', 'More controls']);
    await press('I’m on the footpath');
    expect(controller.crossingAction).toHaveBeenCalledWith('finish');
  });
  test('walking a route: I’m crossing asks for crossing help; Pause is behind More controls', async () => {
    setMode(AssistMode.SEARCHING); setJourney({ phase: 'walking', crossing: false });
    await render(<JourneyControls stacked={false} compact />);
    await press('I’m crossing');
    expect(controller.crossingAction).toHaveBeenCalledWith('help');
    expect(button('Pause')).toBeUndefined();
    await press('More controls'); await press('Pause');
    expect(controller.pauseJourney).toHaveBeenCalledTimes(1);
  });
  test('paused route: Resume takes the primary place and End journey is behind More controls', async () => {
    setJourney({ phase: 'paused', crossing: false });
    await render(<JourneyControls stacked={false} compact />);
    expect(flat(host('Resume')).minHeight).toBe(56);
    expect(button('End journey')).toBeUndefined();
    await press('More controls'); expect(button('End journey')).toBeDefined();
  });
});

describe('J11 at most two buttons per row', () => {
  const rowSizes = () => tree.root.findAll((n: any) => n.type === 'View' && flat(n).flexDirection === 'row' && flat(n).gap === 8).map((n: any) => n.children.length);
  test('a paused crossing in Developer layout puts Repeat and End journey in one row of two, the primary above full width', async () => {
    setMode(AssistMode.CROSSING); setJourney({ phase: 'paused', crossing: true });
    await render(<JourneyControls stacked={false} />);
    expect(rowSizes()).toEqual([2]);
    expect(flat(host('I’m on the footpath')).flex).toBeUndefined();
  });
  test('three secondary buttons wrap to a row of two and a row of one; stacked text sizes give one per row', async () => {
    setMode(AssistMode.SEARCHING);
    await render(<JourneyControls stacked={false} />);
    expect(rowSizes()).toEqual([2]);
    await act(async () => tree.update(<JourneyControls stacked />));
    expect(rowSizes()).toEqual([1, 1]);
  });
});

describe('J8 state banner', () => {
  const mainScreen = (props: object = {}) => render(<MainScreen hasPermission canRequestPermission={false} requestPermission={() => {}} {...props} />);
  const banner = (label: string) => byLabel(label).find((n: any) => n.props.accessibilityLiveRegion);
  test('off: Unknown colour, a 20 sp word, a 15 sp hint, spoken as label plus hint', async () => {
    await mainScreen();
    const row = banner(S.cameraHelpOff);
    expect(flat(row).backgroundColor).toBe(Colors.Unknown);
    expect(row.props.accessibilityHint).toBe(S.cameraHelpOffHint);
    expect(flat(textOf(S.cameraHelpOff)).fontSize).toBe(20);
    expect(flat(textOf(S.cameraHelpOffHint)).fontSize).toBe(15);
  });
  test('walk, don’t walk and crossing each take their own state colour', async () => {
    controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.WAITING, signal: { ...EMPTY_SNAPSHOT.signal, phase: SignalPhase.WALK, trusted: true } } as any });
    await mainScreen();
    expect(flat(banner('Walk signal observed; start time unknown.')).backgroundColor).toBe(Colors.Walk);
    await act(async () => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.WAITING, signal: { ...EMPTY_SNAPSHOT.signal, phase: SignalPhase.DONT_WALK, trusted: true } } as any }));
    expect(flat(banner('Don’t-walk signal observed.')).backgroundColor).toBe(Colors.DontWalk);
    await act(async () => setMode(AssistMode.CROSSING));
    expect(flat(banner('No pedestrian signal verified.')).backgroundColor).toBe(Colors.Crossing);
    expect(textOf(S.crossingFinishHint)).toBeDefined();
  });
  test('a problem with the camera view uses the Caution colour', async () => {
    controller.ui.set({ ...controller.ui.value, frameBrightness: 0.01, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING } });
    await mainScreen();
    expect(flat(banner('Camera blocked or too dark. Check the lens.')).backgroundColor).toBe(Colors.Caution);
  });
});

describe('J15 camera permission denied', () => {
  const denied = (props: object) => render(<MainScreen hasPermission={false} canRequestPermission requestPermission={() => {}} {...props} />);
  test('a centered card: Camera is off, one reason, a 56 dp Allow camera button, Choose destination one tap away', async () => {
    const request = jest.fn();
    await denied({ requestPermission: request });
    expect(textOf(S.cameraOffTitle)).toBeDefined(); expect(textOf(S.cameraOffReason)).toBeDefined();
    expect(flat(host('Allow camera')).minHeight).toBe(56);
    await press('Allow camera'); expect(request).toHaveBeenCalledTimes(1);
    await press('Choose destination'); expect(controller.presentation.value.mapOpen).toBe(true);
  });
  test('when asking again is not possible the button opens app settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await denied({ canRequestPermission: false });
    expect(button('Allow camera')).toBeUndefined();
    await press('Open app settings'); expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});

describe('M4 and J9', () => {
  test('the walking-routes warning is not repeated while a journey is under way', async () => {
    setJourney({ phase: 'walking', crossing: false, stepIndex: 0, route, remaining: 40 });
    await render(<RouteSummary onDestination={() => {}} />);
    expect(textOf(WALKING_WARNING)).toBeUndefined();
    await act(async () => setJourney({ phase: 'idle', crossing: false, stepIndex: 0, route }));
    await act(async () => tree.update(<RouteSummary onDestination={() => {}} />));
    expect(textOf(WALKING_WARNING)).toBeDefined();
  });
  test('one glossary: Camera help is the camera feature, Crossing is the mode', () => {
    expect([S.actionStartAssist, S.actionStopAssist, S.actionStartCrossing, S.actionEndCrossing, S.modeIdle, S.tabAssist])
      .toEqual(['Start camera help', 'Stop camera help', 'I’m crossing', 'I’m on the footpath', 'Camera help off', 'Camera help']);
    expect(JSON.stringify(S)).not.toMatch(/Crossing help|assistance|Start assist|Crossing guidance|Stop assist/i);
  });
  test('Developer layout keeps every control visible, with the same single primary', async () => {
    controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
    setMode(AssistMode.SEARCHING);
    await render(<JourneyControls stacked={false} />);
    expect(labels()).toEqual(['Repeat', 'Stop camera help', 'I’m crossing']);
  });
});

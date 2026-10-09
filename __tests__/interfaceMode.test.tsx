import React from 'react';
import { BackHandler } from 'react-native';
import { InterfaceMode, DEFAULT_SETTINGS, mergeSettings, SettingsRepository, engineSettingsOf, feedbackConfigOf } from '../src/settings/settings';
import { AssistMode, EMPTY_SNAPSHOT, UserCommand } from '../src/crossing/crossingEngine';
import { CrossWiseApp } from '../src/ui/CrossWiseApp';
import { JourneyControls } from '../src/ui/JourneyScreen';
import { MainScreen } from '../src/ui/MainScreen';
import { SettingsScreen } from '../src/ui/SettingsScreen';
import { InterfaceModeSelector } from '../src/ui/InterfaceModeSelector';
import { controller } from '../src/state/controller';
import { P, S } from '../src/strings';

const { create, act } = require('react-test-renderer');
const mockCameraMount = jest.fn();
const mockCameraUnmount = jest.fn();

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => {
  const React = require('react');
  React.useEffect(() => { mockCameraMount(); return mockCameraUnmount; }, []);
  return React.createElement('CameraSurface');
} }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null }));
jest.mock('../src/ui/VoiceCheck', () => ({ VoiceCheck: () => null }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/config/services', () => ({ nativeMapConfigured: true, services: {
  mapsRestApiKey: 'private-map-fixture', geminiApiKey: 'private-ai-fixture',
} }));
jest.mock('react-native-vision-camera', () => ({ useCameraPermission: () => ({ hasPermission: true, canRequestPermission: false }) }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => 'DetectionOverlay', SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../src/ui/MapPanel', () => ({ MapPanel: (props: any) => require('react').createElement('MapPanel', props) }));
jest.mock('../src/ui/DestinationSheet', () => ({ DestinationSheet: () => 'DestinationSheet' }));
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
    notice: new Store(null), model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, backend: 'CPU' } }),
    cameraStatus: new Store('running'), pipeline:new Store({receivedAt:0,latencyMs:0,slowFrames:0,error:null}),cameraDetail:new Store(null), hasRecentFrame: true, repeatGuidance: jest.fn(), crossingAction: jest.fn(),
    mask: new Store(null), describing: new Store(false), modelLibrary: new Store([]),
    previewSpeech: jest.fn(async()=>true), stopSpeechPreview: jest.fn(),
    sayNavigation: jest.fn(), setHomeVisible: jest.fn(), command: jest.fn(), clearNotice: jest.fn(),
    logger: { sessions: () => [] },
    updateSettings: jest.fn((fn: (s: typeof DEFAULT_SETTINGS) => typeof DEFAULT_SETTINGS): void => { c.settings.set(fn(c.settings.value)); }),
  };
  return { controller: c };
});

let tree: any;
async function render(element: React.ReactElement) { await act(async () => { tree = create(element); }); }
function button(label: string) {
  return tree.root.findAll((n: any) => n.props.accessibilityLabel === label)[0];
}
async function press(label: string) {
  const target = button(label);
  expect(target).toBeDefined();
  await act(async () => { target.props.onPress(); });
}
function renderedText() { return JSON.stringify(tree.toJSON()); }

beforeEach(() => {
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true });
  controller.ui.set({ ...controller.ui.value, snapshot: EMPTY_SNAPSHOT, frameBrightness: 0.5 });
  controller.presentation.set({ mapOpen: false, expanded: false });
  mockCameraMount.mockClear(); mockCameraUnmount.mockClear();
  (controller.command as jest.Mock).mockClear();
  (controller.repeatGuidance as jest.Mock).mockClear(); (controller.crossingAction as jest.Mock).mockClear();
  controller.cameraStatus.set('running');
  controller.journey.state.set({ phase: 'idle', crossing: false } as any);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test('old settings default to User; invalid modes do not override a valid preference', () => {
  expect(mergeSettings(DEFAULT_SETTINGS, { showOverlay: true }).interfaceMode).toBe(InterfaceMode.USER);
  const developer = { ...DEFAULT_SETTINGS, interfaceMode: InterfaceMode.DEVELOPER };
  for (const value of ['ADMIN', '', null, 0, false]) {
    expect(mergeSettings(developer, { interfaceMode: value }).interfaceMode).toBe(InterfaceMode.DEVELOPER);
  }
});

test('mode survives saving and loading without changing detection or feedback settings', async () => {
  const storage = require('@react-native-async-storage/async-storage');
  const repo = new SettingsRepository();
  await repo.update((s) => ({ ...s, interfaceMode: InterfaceMode.DEVELOPER }));
  const saved = storage.setItem.mock.calls.at(-1)[1];
  storage.getItem.mockResolvedValueOnce(saved);
  const restored = await new SettingsRepository().load();
  expect(restored.interfaceMode).toBe(InterfaceMode.DEVELOPER);
  expect(engineSettingsOf(restored)).toEqual(engineSettingsOf(DEFAULT_SETTINGS));
  expect(feedbackConfigOf(restored)).toEqual(feedbackConfigOf(DEFAULT_SETTINGS));
});

test('selected mode is accessible and pressing the selected tab does not save again', async () => {
  const change = jest.fn();
  await render(<InterfaceModeSelector value={InterfaceMode.USER} onChange={change} />);
  expect(button('User mode').props.accessibilityState).toEqual({ selected: true });
  await press('User mode'); expect(change).not.toHaveBeenCalled();
  await press('Developer mode'); expect(change).toHaveBeenCalledWith(InterfaceMode.DEVELOPER);
});

test('switching both ways during crossing retains the session and single camera instance', async () => {
  const snapshot = { ...EMPTY_SNAPSHOT, mode: AssistMode.CROSSING };
  controller.ui.set({ ...controller.ui.value, snapshot });
  await render(<CrossWiseApp />);
  expect(renderedText()).not.toContain('DetectionOverlay');
  await press('Settings');
  await press('Developer mode'); await press('Turn on');
  expect(renderedText()).toContain('DetectionOverlay');
  expect(button('Developer mode').props.accessibilityState.selected).toBe(true);
  await press('User mode');
  expect(renderedText()).not.toContain('DetectionOverlay');
  expect(controller.ui.value.snapshot).toBe(snapshot);
  expect(controller.command).not.toHaveBeenCalled();
  expect(mockCameraMount).toHaveBeenCalledTimes(1);
  expect(mockCameraUnmount).not.toHaveBeenCalled();
  expect(controller.settings.value.showOverlay).toBe(true);
});

test('changing mode on Settings keeps that tab and the camera mounted', async () => {
  await render(<CrossWiseApp />);
  await press(S.tabSettings);
  expect(tree.root.findAllByType(SettingsScreen)).toHaveLength(1);
  await press('Developer mode'); await press('Turn on');
  expect(tree.root.findAllByType(SettingsScreen)).toHaveLength(1);
  expect(renderedText()).toContain(S.settingsSectionDetection);
  await press('User mode');
  expect(renderedText()).not.toContain(S.settingsSectionDetection);
  expect(renderedText()).toContain(S.settingsSpeech);
  expect(mockCameraMount).toHaveBeenCalledTimes(1);
  expect(mockCameraUnmount).not.toHaveBeenCalled();
});

test('Developer settings shows service readiness without any key editor or credential value', async () => {
  controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
  await render(<SettingsScreen onBack={() => undefined} />);
  expect(renderedText()).toContain('configured');
  expect(renderedText()).not.toContain('private-map-fixture');
  expect(renderedText()).not.toContain('private-ai-fixture');
  expect(tree.root.findAllByType(require('react-native').TextInput)).toHaveLength(0);
});

test.each([S.settingsOpenGuide, S.practiceTitle])('help page %s and settings preserve the running camera', async link => {
  const snapshot = { ...EMPTY_SNAPSHOT, mode: AssistMode.CROSSING };
  controller.ui.set({ ...controller.ui.value, snapshot });
  await render(<CrossWiseApp />);
  expect(button('Show map')).toBeDefined();
  await press('Settings'); await press(link);
  await press(S.actionBackToSettings);
  expect(tree.root.findAllByType(SettingsScreen)).toHaveLength(1);
  await press('Developer mode'); await press('Turn on'); await press('User mode'); await press(S.actionBack);
  expect(button('Show map')).toBeDefined();
  expect(controller.ui.value.snapshot).toBe(snapshot);
  expect(controller.command).not.toHaveBeenCalled();
  expect(mockCameraMount).toHaveBeenCalledTimes(1);
  expect(mockCameraUnmount).not.toHaveBeenCalled();
});

test('camera is the default view; destination planning does not restart it', async () => {
  await render(<CrossWiseApp />);
  expect(button('Show map').props.accessibilityState.expanded).toBe(false);
  expect(tree.root.findAll((n: any) => n.props.testID === 'full-map')[0].props.accessibilityElementsHidden).toBe(true);
  expect(button(S.tabNavigate)).toBeUndefined();
  await press('Show map');
  expect(renderedText()).toContain('DestinationSheet');
  expect(mockCameraMount).toHaveBeenCalledTimes(1);
  expect(mockCameraUnmount).not.toHaveBeenCalled();
});

test('User mode keeps warnings even when developer presentation hides them', async () => {
  controller.settings.set({ ...controller.settings.value, showWarnings: false });
  controller.ui.set({ ...controller.ui.value, frameBrightness: 0.01, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING } });
  await render(<MainScreen height={200} hasPermission canRequestPermission={false} requestPermission={() => undefined} />);
  expect(renderedText()).toContain('Camera blocked or too dark. Check the lens.');
  expect(button('Camera blocked or too dark. Check the lens.').props.onPress).toBeUndefined();
});

test('shared controls have a single crossing action, Repeat and Stop', async () => {
  controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING } });
  await render(<JourneyControls stacked={false} />);
  await press('I’m crossing'); await press('Repeat'); await press('Stop camera help');
  expect(controller.crossingAction).toHaveBeenCalledWith('start');
  expect(controller.repeatGuidance).toHaveBeenCalledTimes(1);
  expect(controller.command).toHaveBeenCalledWith(UserCommand.STOP_ASSIST, true);
});

test('camera interruption suppresses old observations and provides recovery', async () => {
  controller.cameraStatus.set('unavailable');
  await render(<MainScreen height={200} hasPermission canRequestPermission={false} requestPermission={() => undefined} />);
  expect(renderedText()).toContain(P.cameraUnavailable);
  await press('Retry camera');
  expect(mockCameraMount).toHaveBeenCalledTimes(2);
});

test('camera denial leaves destination planning and permission recovery available', async () => {
  const request = jest.fn();
  await render(<MainScreen height={200} hasPermission={false} canRequestPermission requestPermission={request} />);
  expect(mockCameraMount).not.toHaveBeenCalled();
  expect(renderedText()).toContain('Camera is off');
  expect(renderedText()).toContain('Routes still work without it');
  await press('Allow camera'); expect(request).toHaveBeenCalledTimes(1);
});

test('rapid queued mode changes persist the final choice', async () => {
  const repo = new SettingsRepository();
  const first = repo.update((s) => ({ ...s, interfaceMode: InterfaceMode.DEVELOPER }));
  const second = repo.update((s) => ({ ...s, interfaceMode: InterfaceMode.USER }));
  await Promise.all([first, second]);
  expect(repo.value.interfaceMode).toBe(InterfaceMode.USER);
  const storage = require('@react-native-async-storage/async-storage');
  expect(JSON.parse(storage.setItem.mock.calls.at(-1)[1]).interfaceMode).toBe(InterfaceMode.USER);
});

test('idle controls have one full, wrapping start label', async () => {
  await render(<JourneyControls stacked={false} />);
  expect(button(S.actionDetails)).toBeUndefined();
  const label = tree.root.findAll((n: any) => n.props.children === 'Start camera help' && n.props.style)[0];
  expect(label.props.numberOfLines).toBeUndefined();
  expect(button('I’m crossing')).toBeUndefined();
});

test('a slider follows external settings changes after a local drag', async () => {
  const { SliderRow } = require('../src/ui/components');
  const onCommit = jest.fn();
  const props = { label: 'Speech rate', min: 0.6, max: 2, format: (v: number) => String(v), onCommit };
  await render(<SliderRow {...props} value={1} />);
  let slider = tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Speech rate')[0];
  await act(async () => slider.props.onValueChange(1.5));
  expect(renderedText()).toContain('Speech rate: 1.5');
  await act(async () => tree.update(<SliderRow {...props} value={0.8} />));
  slider = tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Speech rate')[0];
  expect(slider.props.accessibilityValue.text).toBe('0.8');
  expect(onCommit).not.toHaveBeenCalled();
});

test('paused unfinished crossing exposes only explicit footpath recovery and End, with Resume after confirmation', async () => {
  controller.journey.state.set({ phase: 'paused', crossing: true } as any);
  await render(<JourneyControls stacked />);
  expect(button('I’m on the footpath')).toBeDefined(); expect(button('Resume')).toBeUndefined(); expect(button('End journey')).toBeDefined();
  await act(async () => controller.journey.state.set({ phase: 'paused', crossing: false } as any));
  expect(button('I’m on the footpath')).toBeUndefined(); expect(button('Resume')).toBeDefined();
});

test('30 full map transitions preserve the native camera, map and crossing', async () => {
  const snapshot = { ...EMPTY_SNAPSHOT, mode: AssistMode.CROSSING };
  controller.ui.set({ ...controller.ui.value, snapshot });
  await render(<CrossWiseApp />);
  const map = tree.root.findByType('MapPanel');
  for (let i = 0; i < 30; i++) {
    await press('Show map');
    expect(tree.root.findByType(MainScreen).props.hidden).toBe(true);
    expect(tree.root.findByType('MapPanel').props.fullScreen).toBe(true);
    await press('Close full-screen map');
    expect(tree.root.findByType(MainScreen).props.hidden).toBe(false);
  }
  expect(tree.root.findByType('MapPanel')).toBe(map);
  expect(mockCameraMount).toHaveBeenCalledTimes(1); expect(mockCameraUnmount).not.toHaveBeenCalled();
  expect(controller.ui.value.snapshot).toBe(snapshot); expect(controller.command).not.toHaveBeenCalled();
});

test('first launch goes straight to the journey; general precautions are in Settings', async () => {
  controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: false });
  await render(<CrossWiseApp />);
  expect(button('Show map')).toBeDefined();
  expect(button(S.safetyAccept)).toBeUndefined();
  expect(renderedText()).not.toContain(S.safetyBody);
  await press('Settings');
  expect(renderedText()).toContain('Precautions and limitations');
  expect(renderedText()).not.toContain(S.safetyBody);
  await press('Read limitations');
  expect(renderedText()).toContain(S.safetyBody);
});

test('User camera keeps one primary button in view and the routine buttons behind More controls', async () => {
  await render(<CrossWiseApp />);
  expect(button('Start camera help')).toBeDefined(); expect(button('More controls')).toBeUndefined();
  await act(async () => controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING } }));
  expect(button('I’m crossing')).toBeDefined(); expect(button('Stop camera help')).toBeUndefined();
  await press('More controls'); expect(button('Stop camera help')).toBeDefined(); expect(button('I’m crossing')).toBeDefined();
  await press('Close'); expect(button('Stop camera help')).toBeUndefined(); // UI P3e J12: the sheet's Close button
});
test('compact crossing controls never hide unfinished-crossing recovery', async () => {
  controller.journey.state.set({ phase: 'paused', crossing: true } as any);
  await render(<JourneyControls compact stacked />);
  expect(button('I’m on the footpath')).toBeDefined(); expect(button('Resume')).toBeUndefined();
});
test('in-app help teaches exact voice turns, search versus start, fallback and recovery', async () => {
  await render(<SettingsScreen onBack={() => {}} />);
  expect(renderedText()).not.toContain('Navigate to Sydney Town Hall');
  await press('Commands and voice setup');
  await press('If voice fails');
  const text = renderedText();
  for (const phrase of ['Manual', 'Navigate to Sydney Town Hall', 'Save as Home', 'cannot hear commands', 'Finish crossing', 'Enable Dictation']) expect(text).toContain(phrase);
  expect(button('Read voice instructions')).toBeDefined(); expect(button('Open app settings')).toBeDefined();
  await press('Read voice instructions'); expect(controller.sayNavigation).toHaveBeenCalledWith(expect.stringContaining('Navigate to Town Hall'));
});

test('voice help enables spoken guidance when speech was disabled', async () => {
  controller.settings.set({ ...DEFAULT_SETTINGS, speech: false });
  await render(<SettingsScreen onBack={() => {}} />);
  expect(button('Read voice instructions')).toBeUndefined();
  await press('Commands and voice setup');
  await press('Enable spoken guidance');
  expect(controller.settings.value.speech).toBe(true);
  expect(button('Read voice instructions')).toBeDefined();
});

test('Developer shows live diagnostics that User mode omits', async () => {
  await render(<CrossWiseApp />);
  expect(renderedText()).not.toContain('LIVE DIAGNOSTICS');
  await act(async () => controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER }));
  expect(renderedText()).not.toContain('LIVE DIAGNOSTICS');
  await press('Open diagnostics');
  expect(renderedText()).toContain('LIVE DIAGNOSTICS');
  expect(renderedText()).toContain('Motorbikes');
  expect(renderedText()).toContain('TRACKS');
  await press('Close diagnostics');
  expect(renderedText()).not.toContain('LIVE DIAGNOSTICS');
  expect(mockCameraMount).toHaveBeenCalledTimes(1);
  await act(async () => controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.USER }));
  expect(renderedText()).not.toContain('LIVE DIAGNOSTICS');
});

test('User status gives actionable posture guidance without developer measurements', async () => {
  controller.ui.set({ ...controller.ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode: AssistMode.SEARCHING, pitchDeg: -50 } });
  await render(<CrossWiseApp />);
  expect(renderedText()).toContain('Raise phone.');
  expect(renderedText()).not.toContain('Pitch');
  await act(async () => controller.cameraStatus.set('unavailable'));
  expect(renderedText()).not.toContain('Raise phone.');
  expect(renderedText()).toContain('Camera unavailable');
});


test('Android Back closes settings and the map without unmounting the camera', async () => {
  let back = () => false;
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    back = handler as () => boolean;
    return { remove: jest.fn() };
  });
  try {
    await render(<CrossWiseApp />);
    await press('Show map');
    await act(async () => { expect(back()).toBe(true); });
    expect(controller.presentation.value.mapOpen).toBe(false);
    await press('Settings');
    await act(async () => { expect(back()).toBe(true); });
    expect(button('Show map')).toBeDefined();
    expect(back()).toBe(false);
    expect(mockCameraMount).toHaveBeenCalledTimes(1);
    expect(mockCameraUnmount).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});


test('Developer speech preview renders samples and disables playback during live guidance',async()=>{
  controller.settings.set({...controller.settings.value,interfaceMode:InterfaceMode.DEVELOPER});
  await render(<SettingsScreen onBack={()=>undefined} />);
  await press('Open speech preview');
  expect(renderedText()).toContain('Scan complete. No moving vehicles detected.');
  expect(button('Play all').props.accessibilityState.disabled).toBe(false);
  await press('Listening cue');
  expect(controller.previewSpeech).toHaveBeenCalled();
  await act(async()=>controller.ui.set({...controller.ui.value,snapshot:{...EMPTY_SNAPSHOT,mode:AssistMode.SEARCHING}}));
  expect(button('Play all').props.accessibilityState.disabled).toBe(true);
  expect(controller.stopSpeechPreview).toHaveBeenCalled();
});

test('Developer motion icons toggle only their boxes and expose selected state',async()=>{
  controller.settings.set({...controller.settings.value,interfaceMode:InterfaceMode.DEVELOPER});
  await render(<MainScreen hasPermission canRequestPermission={false} requestPermission={()=>undefined}/>);
  expect(button('Stationary vehicle boxes').props.accessibilityState.selected).toBe(false);
  await press('Stationary vehicle boxes');
  expect(controller.settings.value.showStationaryVehicles).toBe(true);
  expect(button('Stationary vehicle boxes').props.accessibilityState.selected).toBe(true);
  await press('Moving vehicle boxes');
  expect(controller.settings.value.showMovingVehicles).toBe(false);
  expect(controller.settings.value.vehicleAlerts).toBe(true);
});

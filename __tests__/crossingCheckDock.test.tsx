import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { AssistMode, EMPTY_SNAPSHOT, UserCommand } from '../src/crossing/crossingEngine';
import { JourneyControls } from '../src/ui/JourneyScreen';
import { PRACTICE_CHECK_SCRIPT } from '../src/ui/PracticeCheck';
import { CHECK_TEXT } from '../src/text/checkText';
import { controller } from '../src/state/controller';

// The dock after a guided-check result: "Check again" first, "Cross" second, both 56 dp, focus on the result text.
const { create, act } = require('react-test-renderer');

jest.mock('../src/camera/CameraSurface', () => ({ CameraSurface: () => null }));
jest.mock('../src/ui/Overlays', () => ({ DetectionOverlay: () => null, SegmentationOverlay: () => null, SegmentationLegend: () => null }));
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: { headphonesConnected: () => true, batteryPercent: () => Promise.resolve(100) } }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({ ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'), findNodeHandle: () => 1 }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/ui/VoiceControl', () => ({ VoiceControl: () => null, VoiceStatus: () => null }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const { EMPTY_SNAPSHOT } = require('../src/crossing/crossingEngine');
  return {
    controller: {
      settings: new Store({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }),
      ui: new Store({ snapshot: EMPTY_SNAPSHOT, fps: 30, inferenceMs: 20, frameBrightness: 0.5, frameAspect: 0.56, caption: null }),
      repeatGuidance: jest.fn(), crossingAction: jest.fn(), command: jest.fn(), practice: jest.fn(),
    },
  };
});

let tree: any;
const show = async (check: any, mode = AssistMode.SEARCHING) => {
  await act(async () => { (controller as any).ui.set({ ...(controller as any).ui.value, snapshot: { ...EMPTY_SNAPSHOT, mode, check } }); });
  await act(async () => { tree = create(<JourneyControls stacked={false} />); });
};
const buttons = () => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel);
const labelled = (label: string) => buttons().filter((n: any) => n.props.accessibilityLabel === label);
/** Host (native) nodes only, so each button counts once. */
const hosts = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLabel);
const heightOf = (n: any) => (StyleSheet.flatten(n.props.style) ?? {}).minHeight ?? 0;
const RESULT = { stage: 'result', summary: 'NONE_SEEN', text: 'No vehicles seen on either side. Cross if you judge it clear.', canCross: true };

beforeEach(() => { jest.clearAllMocks(); });

test('after a result the dock shows Check again first and Cross second, both at least 56 dp', async () => {
  await show(RESULT);
  const order = hosts().filter((n: any) => n.props.accessibilityLabel === 'Check again' || n.props.accessibilityLabel === 'Cross');
  expect(order.map((n: any) => n.props.accessibilityLabel)).toEqual(['Check again', 'Cross']);
  for (const n of order) expect(heightOf(n)).toBeGreaterThanOrEqual(56);
});

test('Check again sends CHECK_AGAIN; Cross asks to start the crossing on a fresh result', async () => {
  await show(RESULT);
  await act(async () => { labelled('Check again')[0].props.onPress(); });
  expect((controller as any).command).toHaveBeenCalledWith(UserCommand.CHECK_AGAIN);
  await act(async () => { labelled('Cross')[0].props.onPress(); });
  expect((controller as any).crossingAction).toHaveBeenCalledWith('start');
});

test.each([
  ['expired', { stage: 'expired', summary: 'NONE_SEEN', text: CHECK_TEXT.expired, canCross: false }],
  ['MOVING_RIGHT', { stage: 'result', summary: 'MOVING_RIGHT', text: 'Vehicle on your right, moving. Wait.', canCross: false }],
])('Cross is disabled on a %s result', async (_name, check) => {
  await show(check);
  expect(labelled('Cross')[0].props.accessibilityState).toEqual({ disabled: true });
  expect(labelled('Check again')[0].props.accessibilityState).toEqual({ disabled: false });
});

test('screen-reader focus moves to the result text', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  await show(RESULT);
  expect(focus).toHaveBeenCalledWith(1); // findNodeHandle is mocked to return 1 above
  const live = tree.root.findAll((n: any) => n.props.accessibilityLiveRegion === 'assertive');
  expect(live.length).toBeGreaterThan(0);
  expect(live[0].findAll((n: any) => n.props.children === RESULT.text).length).toBeGreaterThan(0);
});

test('no result yet: the existing crossing button stays; stopped shows Start', async () => {
  await show({ stage: 'running', summary: null, text: null, canCross: false });
  expect(labelled('Check again')).toHaveLength(0);
  expect(hosts().filter((n: any) => n.props.accessibilityLabel === 'I’m crossing')).toHaveLength(1);
  await show({ stage: 'stopped', summary: null, text: CHECK_TEXT.stopped, canCross: false });
  await act(async () => { labelled('Start')[0].props.onPress(); });
  expect((controller as any).command).toHaveBeenCalledWith(UserCommand.CHECK_AGAIN);
});

test('practice script: says "Practice only" first and last and never claims a check', () => {
  const texts = PRACTICE_CHECK_SCRIPT.flatMap(s => s.cues.flatMap((c: any) => (c.kind === 'speakText' ? [c.text] : [])));
  expect(texts[0]).toBe(CHECK_TEXT.practiceOnly);
  expect(texts[texts.length - 1]).toBe(CHECK_TEXT.practiceOnly);
  expect(PRACTICE_CHECK_SCRIPT.length).toBeGreaterThanOrEqual(3);
  for (const t of texts) expect(t.toLowerCase()).not.toMatch(/\bsafe|no vehicles seen/);
});

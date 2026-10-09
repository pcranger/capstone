import React from 'react';
import { Linking } from 'react-native';
import { DEFAULT_SETTINGS, InterfaceMode } from '../src/settings/settings';
import { GuideScreen } from '../src/ui/GuideScreen';
import { SettingsScreen } from '../src/ui/SettingsScreen';
import { controller } from '../src/state/controller';
import { S } from '../src/strings';

// UI Package 2, part D: Settings order and Developer confirm (S2, S4), Guide names and About links (G2, M3).
const { create, act } = require('react-test-renderer');

jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/config/services', () => ({ nativeMapConfigured: true, services: { mapsRestApiKey: 'fixture', geminiApiKey: 'fixture' } }));
jest.mock('../src/perception/modelLoader', () => ({ displayNameOf: () => 'test.tflite', referenceOf: () => 'asset:test.tflite' }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const { EMPTY_SNAPSHOT } = require('../src/crossing/crossingEngine');
  const c = {
    settings: new Store({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }),
    ui: new Store({ snapshot: EMPTY_SNAPSHOT }),
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, inputHeight: 640, backend: 'CPU' } }),
    modelLibrary: new Store([]),
    logger: { sessions: () => [] },
    sayNavigation: jest.fn(), stopVoice: jest.fn(), previewSpeech: jest.fn(), stopSpeechPreview: jest.fn(),
    updateSettings: jest.fn((fn: (s: typeof DEFAULT_SETTINGS) => typeof DEFAULT_SETTINGS): void => { c.settings.set(fn(c.settings.value)); }),
  };
  return { controller: c };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label);
const press = async (label: string) => { const t = byLabel(label).find((n: any) => n.props.onPress); expect(t).toBeDefined(); await act(async () => { t.props.onPress(); }); };
const allText = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => ([] as unknown[]).concat(n.props.children).join('')).join(' | ');
const expandAll = async () => {
  for (const t of tree.root.findAll((n: any) => n.props.accessibilityState?.expanded === false && n.props.onPress)) await act(async () => { t.props.onPress(); });
};
const headers = (): string[] => tree.root.findAll((n: any) => n.type === 'Text' && n.props.accessibilityRole === 'header').map((n: any) => n.props.children);

beforeEach(() => { jest.clearAllMocks(); controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });

describe('S4 settings card order', () => {
  test('User mode: Feedback, Display, Help, Manual, Precautions, Advanced, in that order', async () => {
    await render(<SettingsScreen onBack={() => {}} onOpenGuide={() => {}} onOpenPractice={() => {}} />);
    const wanted = [S.settingsSectionFeedback, S.settingsSectionDisplay, S.settingsSectionHelp, 'Manual', 'Precautions and limitations', S.settingsSectionAdvanced];
    expect(headers().filter(h => wanted.includes(h))).toEqual(wanted);
    expect(headers()).not.toContain('Interface');
    expect(headers().at(-1)).toBe(S.settingsSectionAdvanced);
  });
  test('Developer mode keeps Advanced above its test-tool cards', async () => {
    controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
    await render(<SettingsScreen onBack={() => {}} />);
    const h = headers();
    expect(h.indexOf(S.settingsSectionAdvanced)).toBeGreaterThan(h.indexOf('Precautions and limitations'));
    expect(h.indexOf('Services')).toBeGreaterThan(h.indexOf(S.settingsSectionAdvanced));
  });
});

describe('S2 Developer mode asks first', () => {
  test('turning it on shows an in-page prompt; Cancel leaves User mode, Turn on switches', async () => {
    await render(<SettingsScreen onBack={() => {}} />);
    expect(allText()).not.toContain(S.developerConfirm);
    await press('Developer mode');
    expect(controller.settings.value.interfaceMode).toBe(InterfaceMode.USER);
    const prompt = tree.root.findAll((n: any) => n.type === 'Text' && n.props.children === S.developerConfirm)[0];
    expect(prompt.props.accessibilityLiveRegion).toBe('polite');
    await press(S.developerCancel);
    expect(allText()).not.toContain(S.developerConfirm);
    expect(controller.settings.value.interfaceMode).toBe(InterfaceMode.USER);
    await press('Developer mode'); await press(S.developerTurnOn);
    expect(controller.settings.value.interfaceMode).toBe(InterfaceMode.DEVELOPER);
    expect(allText()).not.toContain(S.developerConfirm);
  });
  test('going back to User needs no question', async () => {
    controller.settings.set({ ...controller.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
    await render(<SettingsScreen onBack={() => {}} />);
    await press('User mode');
    expect(controller.settings.value.interfaceMode).toBe(InterfaceMode.USER);
    expect(allText()).not.toContain(S.developerConfirm);
  });
});

describe('G2/M3 Guide', () => {
  test('uses the exact button names and none of the old ones', async () => {
    await render(<GuideScreen onBack={() => {}} />);
    await expandAll();
    const text = allText();
    for (const name of ['Start camera help', 'Stop camera help', 'I’m crossing', 'I’m on the footpath', 'More controls', 'Start voice commands', 'Choose destination',
      'Show map', 'Close full-screen map', 'Expand destination panel', 'Collapse destination panel']) expect(text).toContain(name);
    for (const old of ['inward arrows', 'Expand and Collapse', 'Start camera assistance', 'Stop assistance', 'Crossing help', 'Hide map', 'Open full-screen map']) expect(text).not.toContain(old);
  });
  test('About holds the Google Maps note and the terms and privacy links', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    await render(<GuideScreen onBack={() => {}} />);
    await press(S.guideSectionAbout);
    expect(allText()).toContain(S.guideAboutMaps);
    await press(S.guideLinkMapsTerms);
    expect(open).toHaveBeenLastCalledWith('https://maps.google.com/help/terms_maps/');
    await press(S.guideLinkPrivacy);
    expect(open).toHaveBeenLastCalledWith('https://policies.google.com/privacy');
    open.mockRestore();
  });
});

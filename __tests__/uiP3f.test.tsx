import React from 'react';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { GuideScreen } from '../src/ui/GuideScreen';
import { VoiceHelp } from '../src/ui/VoiceHelp';
import { SpeechPreview } from '../src/ui/SpeechPreview';
import { SPEECH_SAMPLES } from '../src/voice/speechPreview';
import { controller } from '../src/state/controller';
import { S } from '../src/strings';

// UI Package 3, part F: S10 voice help, G3 collapsible Guide, D3 preview button names.
const { create, act } = require('react-test-renderer');

jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
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
    journey: { state: new Store({ phase: 'idle' }) },
    model: new Store({ kind: 'ready', info: { format: 'END_TO_END', labels: ['car'], hasPedestrianSignalClasses: true, displayName: 'test', inputWidth: 640, inputHeight: 640, backend: 'CPU' } }),
    logger: { sessions: () => [] },
    sayNavigation: jest.fn(), previewSpeech: jest.fn(), stopSpeechPreview: jest.fn(), updateSettings: jest.fn(),
  };
  return { controller: c };
});

let tree: any;
const render = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
const byLabel = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label && n.props.onPress);
const texts = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => ([] as unknown[]).concat(n.props.children).join(''));
const expanded = (label: string) => byLabel(label)[0].props.accessibilityState.expanded;

beforeEach(() => { controller.settings.set({ ...DEFAULT_SETTINGS, acceptedSafetyNotice: true }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });

test('S10 Voice help: heading Say, one command per line, recovery folded under If voice fails', async () => {
  await render(<VoiceHelp />);
  const headers = tree.root.findAll((n: any) => n.type === 'Text' && n.props.accessibilityRole === 'header').map((n: any) => n.props.children);
  expect(headers).toContain('Say');
  for (const line of S.voiceSayLines) expect(texts()).toContain(line);
  expect(texts().join('|')).not.toContain('Enable Dictation');
  expect(expanded('If voice fails')).toBe(false);
  await act(async () => { byLabel('If voice fails')[0].props.onPress(); });
  expect(expanded('If voice fails')).toBe(true);
  expect(texts().join('|')).toMatch(/llow Microphone/);
});

test('G3 Guide: sections collapse under their headings, first open, About kept', async () => {
  await render(<GuideScreen onBack={() => {}} />);
  expect(expanded('Voice help')).toBe(true);
  for (const t of [S.guideSectionSafety, S.guideSectionHolding, S.guideSectionSounds, S.guideSectionAbout]) expect(expanded(t)).toBe(false);
  expect(texts()).not.toContain(S.safetyBody);
  await act(async () => { byLabel(S.guideSectionSafety)[0].props.onPress(); });
  expect(texts()).toContain(S.safetyBody);
  await act(async () => { byLabel('Voice help')[0].props.onPress(); });
  expect(texts()).not.toContain(S.guideVoiceButton);
});

test('D3 each preview button is named by its sample text', async () => {
  await render(<SpeechPreview />);
  for (const s of SPEECH_SAMPLES) {
    expect(byLabel(s.text).length).toBeGreaterThan(0);
    expect(byLabel(`Play ${s.id}`)).toHaveLength(0);
  }
});

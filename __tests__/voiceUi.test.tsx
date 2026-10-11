import React from 'react';
import { View } from 'react-native';
import { VoiceControl, VoiceStatus } from '../src/ui/VoiceControl';
import { controller } from '../src/state/controller';
const { create, act } = require('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  return { controller: { voice: { state: new Store({ phase: 'off', text: '' }) }, settings: new Store({ speech: true }), voiceMode: new Store(true),
    startVoice: jest.fn(), stopVoice: jest.fn(), toggleVoice: jest.fn() } };
});
let tree: any;
const help = jest.fn();
const button = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
beforeEach(() => { jest.clearAllMocks(); controller.voice.state.set({ phase: 'off', text: '' }); controller.settings.set({ speech: true } as any); controller.voiceMode.set(true); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
const render = async () => { await act(async () => { tree = create(<View><VoiceControl onHelp={help} /><VoiceStatus onHelp={help} /></View>); }); };
test('recognition failure stays visible with working retry and help actions', async () => {
  controller.voice.state.set({ phase: 'error', text: 'Microphone permission is off.' }); await render();
  expect(JSON.stringify(tree.toJSON())).toContain('Microphone permission is off.');
  await act(async () => button('Stop listening').props.onPress()); expect(controller.toggleVoice).toHaveBeenCalledTimes(1);
  await act(async () => button('Voice help').props.onPress()); expect(help).toHaveBeenCalled();
});
test('disabled speech opens Settings instead of a silent nonworking microphone control', async () => {
  controller.settings.set({ speech: false } as any); await render();
  expect(JSON.stringify(tree.toJSON())).toContain('Enable Speech in Settings');
  await act(async () => button('Voice settings').props.onPress()); expect(help).toHaveBeenCalled(); expect(controller.toggleVoice).not.toHaveBeenCalled();
});
test('the header pill follows the chosen mode and calls toggleVoice', async () => {
  controller.voice.state.set({ phase: 'listening', text: 'Listening' }); await render();
  await act(async () => button('Stop listening').props.onPress()); expect(controller.toggleVoice).toHaveBeenCalledTimes(1);
  await act(async () => controller.voiceMode.set(false));
  await act(async () => button('Start voice commands').props.onPress()); expect(controller.toggleVoice).toHaveBeenCalledTimes(2);
});

test('J14 the voice line shows only when listening, working or in error', async () => {
  await render();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Voice off');
  expect(tree.root.findAll((n: any) => n.props.accessibilityLiveRegion)).toHaveLength(0);
  await act(async () => controller.voice.state.set({ phase: 'listening', text: 'Listening' }));
  expect(JSON.stringify(tree.toJSON())).toContain('Listening…');
  await act(async () => controller.voice.state.set({ phase: 'working', text: 'Working' }));
  expect(JSON.stringify(tree.toJSON())).toContain('Working…');
  await act(async () => controller.voice.state.set({ phase: 'error', text: 'Microphone permission is off.' }));
  expect(JSON.stringify(tree.toJSON())).toContain('Microphone permission is off.');
  await act(async () => controller.voice.state.set({ phase: 'off', text: '' }));
  expect(tree.root.findAll((n: any) => n.props.accessibilityLiveRegion)).toHaveLength(0);
});

test('J6/J13 the mic names say what they do, and the voice status is a polite live region', async () => {
  controller.voice.state.set({ phase: 'listening', text: 'Listening' }); await render();
  const status = tree.root.findAll((n: any) => n.type === 'Text' && n.props.children === 'Listening…')[0];
  expect(status.props.accessibilityLiveRegion).toBe('polite');
  expect(button('Stop listening')).toBeDefined(); expect(button('Voice')).toBeUndefined();
  // The pill must not flicker with the microphone's momentary state: only the chosen mode changes it.
  for (const phase of ['off', 'working', 'error', 'listening'] as const) {
    await act(async () => controller.voice.state.set({ phase, text: '' }));
    expect(button('Stop listening')).toBeDefined(); expect(button('Start voice commands')).toBeUndefined();
  }
  await act(async () => controller.voiceMode.set(false));
  expect(button('Start voice commands')).toBeDefined();
  for (const n of tree.root.findAll((n: any) => n.props.accessibilityLiveRegion)) expect(n.props.accessibilityLiveRegion).toBe('polite');
});

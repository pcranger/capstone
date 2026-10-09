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
  return { controller: { voice: { state: new Store({ phase: 'off', text: '' }) }, settings: new Store({ speech: true }),
    startVoice: jest.fn(), stopVoice: jest.fn() } };
});
let tree: any;
const help = jest.fn();
const button = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
beforeEach(() => { jest.clearAllMocks(); controller.voice.state.set({ phase: 'off', text: '' }); controller.settings.set({ speech: true } as any); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
const render = async () => { await act(async () => { tree = create(<View><VoiceControl onHelp={help} /><VoiceStatus onHelp={help} /></View>); }); };
test('recognition failure stays visible with working retry and help actions', async () => {
  controller.voice.state.set({ phase: 'error', text: 'Microphone permission is off.' }); await render();
  expect(JSON.stringify(tree.toJSON())).toContain('Microphone permission is off.');
  await act(async () => button('Retry voice').props.onPress()); expect(controller.startVoice).toHaveBeenCalledWith(true);
  await act(async () => button('Voice help').props.onPress()); expect(help).toHaveBeenCalled();
});
test('disabled speech opens Settings instead of a silent nonworking microphone control', async () => {
  controller.settings.set({ speech: false } as any); await render();
  expect(JSON.stringify(tree.toJSON())).toContain('Enable Speech in Settings');
  await act(async () => button('Voice settings').props.onPress()); expect(help).toHaveBeenCalled(); expect(controller.startVoice).not.toHaveBeenCalled();
});
test('listening state exposes stop and stop state exposes restart', async () => {
  controller.voice.state.set({ phase: 'listening', text: 'Listening' }); await render();
  await act(async () => button('Stop listening').props.onPress()); expect(controller.stopVoice).toHaveBeenCalled();
  await act(async () => controller.voice.state.set({ phase: 'off', text: '' }));
  await act(async () => button('Voice').props.onPress()); expect(controller.startVoice).toHaveBeenCalledWith(true);
});

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BackButton, BigButton, RadioGroup, RadioRow, SectionCard, SliderRow, SwitchRow, TextButton, TextField } from '../src/ui/components';
import { PracticeScreen } from '../src/ui/PracticeScreen';
import { Colors } from '../src/ui/theme';
import { controller } from '../src/state/controller';
const { create, act } = require('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('../src/ui/VoiceCheck', () => ({ VoiceCheck: () => null }));
jest.mock('../src/state/controller', () => ({ controller: { practice: jest.fn() } }));

let tree: any;
const render = async (el: React.ReactElement) => { await act(async () => { tree = create(el); }); };
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });

/** The native node (View / Text / TextInput) that carries the label; its style is what the phone draws. */
const host = (label: string) => tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLabel === label)[0];
const style = (node: any) => StyleSheet.flatten(node.props.style);
const textStyle = (node: any) => style(node.findAll((n: any) => n.type === 'Text')[0]);
const allText = () => JSON.stringify(tree.toJSON());

test('TextButton is 17 sp with no letter-spacing, 48 dp by default and 56 dp when asked', async () => {
  await render(<View><TextButton label="Plain" onPress={() => undefined} /><TextButton label="Tall" size="large" onPress={() => undefined} /></View>);
  expect(style(host('Plain')).minHeight).toBe(48);
  expect(style(host('Tall')).minHeight).toBe(56);
  const t = textStyle(host('Plain'));
  expect(t.fontSize).toBe(17);
  expect(t.letterSpacing ?? 0).toBe(0);
});

test('secondary button has a 2 dp muted outline; a disabled one is unfilled, dashed and half strength', async () => {
  const noop = () => undefined;
  await render(<View>
    <BigButton text="Repeat" color={Colors.SurfaceVariant} onPress={noop} />
    <BigButton text="Pause" color={Colors.SurfaceVariant} enabled={false} onPress={noop} />
    <BigButton text="Go" color={Colors.Crossing} onPress={noop} />
  </View>);
  const on = style(host('Repeat'));
  expect(on).toMatchObject({ borderWidth: 2, borderColor: Colors.OnSurfaceMuted, backgroundColor: Colors.SurfaceVariant, opacity: 1 });
  expect(on.borderStyle).toBe('solid');
  const off = style(host('Pause'));
  expect(off).toMatchObject({ borderWidth: 2, borderColor: Colors.OnSurfaceMuted, borderStyle: 'dashed', backgroundColor: 'transparent', opacity: 0.5 });
  expect(style(host('Go')).borderColor).toBe(Colors.Crossing); // a filled button keeps its own edge: layout is identical
});

test('BigButton passes its hint to accessibilityHint', async () => {
  await render(<BigButton text="Play" color={Colors.Walk} hint="Not a live signal." onPress={() => undefined} />);
  expect(host('Play').props.accessibilityHint).toBe('Not a live signal.');
});

test('card heading is sentence case, 20 sp, in the accent colour', async () => {
  await render(<SectionCard title="Voice check"><View /></SectionCard>);
  expect(allText()).toContain('Voice check');
  expect(allText()).not.toContain('VOICE CHECK');
  const heading = tree.root.findAll((n: any) => n.type === 'Text' && n.props.accessibilityRole === 'header')[0];
  expect(style(heading)).toMatchObject({ fontSize: 20, color: Colors.Accent });
});

test('switch row shows the word On or Off and an off-track a muted colour can see', async () => {
  const noop = () => undefined;
  await render(<View><SwitchRow label="Speech" value onChange={noop} /><SwitchRow label="Haptics" value={false} onChange={noop} /></View>);
  const words = tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => n.props.children).flat();
  expect(words).toEqual(expect.arrayContaining(['On', 'Off']));
  const sw = tree.root.findAll((n: any) => n.props.trackColor)[0];
  expect(sw.props.trackColor.false).toBe(Colors.OnSurfaceMuted);
});

test('radio sets can be wrapped in a radiogroup and slider is 56 dp tall', async () => {
  await render(<View><RadioGroup label="Typeface"><RadioRow label="A" selected onPress={() => undefined} /></RadioGroup>
    <SliderRow label="Rate" value={1} min={0} max={2} format={v => `${v}`} onCommit={() => undefined} /></View>);
  expect(tree.root.findAll((n: any) => n.props.accessibilityRole === 'radiogroup').length).toBeGreaterThan(0);
  // the Slider's own native default (40) is overridden by the prop we pass, so read the prop
  expect(tree.root.findAll((n: any) => typeof n.type !== 'string' && n.props.accessibilityLabel === 'Rate')[0].props.style.height).toBe(56);
});

test('BackButton is 56 dp, named by its label and calls onPress', async () => {
  const back = jest.fn();
  await render(<View><BackButton onPress={back} /><BackButton label="Back to Settings" onPress={back} /></View>);
  expect(style(host('Back')).minHeight).toBe(56);
  await act(async () => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Back to Settings')[0].props.onPress());
  expect(back).toHaveBeenCalled();
});

test('TextField shows its name above, is 56 dp and 20 sp, and its accessibility name starts with the visible word', async () => {
  await render(<TextField label="Destination" accessibilityLabel="Destination name and suburb" value="" onChangeText={() => undefined} />);
  expect(allText()).toContain('Destination');
  const input = tree.root.findAll((n: any) => n.type === 'TextInput')[0];
  expect(input.props.accessibilityLabel.startsWith('Destination')).toBe(true);
  expect(style(input)).toMatchObject({ minHeight: 56, fontSize: 20 });
});

test('Practice page: Practice only line, 56 dp Back button wired to onBack, hint on every practice button', async () => {
  const back = jest.fn();
  await render(<PracticeScreen onBack={back} />);
  expect(allText()).toContain('Practice only');
  const backBtn = tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Back to Settings')[0];
  expect(style(host('Back to Settings')).minHeight).toBe(56);
  await act(async () => backBtn.props.onPress());
  expect(back).toHaveBeenCalledTimes(1);
  const walk = tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Walk sign just came on')[0];
  expect(walk.props.accessibilityHint).toBe('Plays a practice sound. Not a live signal.');
  await act(async () => walk.props.onPress());
  expect(controller.practice).toHaveBeenCalled();
  const buttons = tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityRole === 'button' && n.props.accessibilityLabel !== 'Back to Settings');
  expect(buttons.length).toBeGreaterThan(5);
  for (const b of buttons) expect(b.props.accessibilityHint).toBe('Plays a practice sound. Not a live signal.');
});

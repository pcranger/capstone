import React from 'react';
import { MapPanel } from '../src/ui/MapPanel';
import { controller } from '../src/state/controller';
const { create, act } = require('react-test-renderer');
const mockAnimate = jest.fn(); const mockFit = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../src/config/services', () => ({ nativeMapConfigured: true }));
jest.mock('react-native-maps', () => {
  const React = require('react');
  return { __esModule: true, default: React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ animateToRegion: mockAnimate, fitToCoordinates: mockFit }));
    return React.createElement('MapView', props);
  }), Marker: 'Marker', Circle: 'Circle', Polyline: 'Polyline', PROVIDER_GOOGLE: 'google' };
});
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  return { controller: { settings: new Store({}), journey: { state: new Store({ phase: 'idle', route: null, destination: null }),
    location: new Store(null), refreshLocation: jest.fn(async () => undefined) } } };
});
let tree: any;
const button = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const map = () => tree.root.findByType('MapView');
beforeEach(async () => {
  jest.useFakeTimers(); mockAnimate.mockClear(); mockFit.mockClear();
  controller.journey.location.set(null);
  controller.journey.state.set({ phase: 'idle', route: null, destination: null } as any);
  (controller.journey.refreshLocation as jest.Mock).mockReset().mockResolvedValue(undefined);
  await act(async () => { tree = create(<MapPanel height={200} />); });
  await act(async () => { map().props.onMapReady(); map().props.onMapLoaded(); });
});
afterEach(async () => { await act(async () => tree.unmount()); jest.useRealTimers(); });
test('does not claim a current position before a fix; expired positions disappear from the map', async () => {
  expect(tree.root.findAllByType('Marker')).toHaveLength(0);
  expect(button('Locate me')).toBeDefined();
  const fix = { latitude: -33.87, longitude: 151.21, accuracy: 6, timestamp: Date.now() };
  await act(async () => controller.journey.location.set(fix));
  expect(tree.root.findAllByType('Marker')).toHaveLength(1);
  expect(tree.root.findByType('Circle').props.radius).toBe(6);
  expect(mockAnimate).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(20_000));
  expect(tree.root.findAllByType('Marker')).toHaveLength(0);
  expect(button('Locate me')).toBeDefined();
});
test('panning stops follow; explicit recenter reacquires location without replacing the map', async () => {
  const original = map(); await act(async () => map().props.onPanDrag());
  await act(async () => controller.journey.location.set({ latitude: -33.87, longitude: 151.21, accuracy: 5, timestamp: Date.now() }));
  expect(mockAnimate).not.toHaveBeenCalled();
  await act(async () => button('Recenter').props.onPress());
  expect(controller.journey.refreshLocation).toHaveBeenCalledTimes(1);
  expect(mockAnimate).toHaveBeenCalledTimes(1); expect(map()).toBe(original);
});
test('map reload remounts only the map after missing native tile completion', async () => {
  await act(async () => tree.unmount());
  await act(async () => { tree = create(<MapPanel height={200} />); });
  await act(async () => jest.advanceTimersByTime(15_000));
  const old = map(); expect(button('Retry map')).toBeDefined();
  await act(async () => button('Retry map').props.onPress());
  expect(map()).not.toBe(old); expect(button('Retry map')).toBeUndefined();
});

test('tapping the preview expands the same native map, with native gestures enabled only when full', async () => {
  const expand = jest.fn();
  await act(async () => tree.update(<MapPanel height={180} onExpand={expand} />));
  const original = map(); expect(map().props.scrollEnabled).toBe(false);
  await act(async () => button('Open full-screen map').props.onPress());
  expect(expand).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<MapPanel height={750} fullScreen onExpand={expand} />));
  expect(map()).toBe(original); expect(map().props.scrollEnabled).toBe(true); expect(button('Open full-screen map')).toBeUndefined();
  expect(map().props.mapPadding.bottom).toBeLessThan(80); // below the route card
  expect(map().props.mapPadding.right).toBeGreaterThanOrEqual(72); // clear of the collapse control
});

test('defers native padding until Google Maps is ready on first mount and retry', async () => {
  await act(async () => tree.unmount());
  await act(async () => { tree = create(<MapPanel height={750} fullScreen />); });
  expect(map().props.mapPadding).toBeUndefined();
  await act(async () => map().props.onMapReady());
  expect(map().props.mapPadding.right).toBe(72);
  await act(async () => jest.advanceTimersByTime(15_000));
  await act(async () => button('Retry map').props.onPress());
  expect(map().props.mapPadding).toBeUndefined();
});

test('M2 the accuracy line is 15 sp in the muted colour and the tool pills are 12 dp apart', async () => {
  const { Colors } = require('../src/ui/theme');
  const { StyleSheet } = require('react-native');
  const line = tree.root.findAll((n: any) => n.type === 'Text' && n.props.children === 'Current location unavailable')[0];
  expect(StyleSheet.flatten(line.props.style)).toMatchObject({ fontSize: 15, color: Colors.OnSurfaceMuted });
  const row = tree.root.findAll((n: any) => { const s = StyleSheet.flatten(n.props.style); return s?.gap === 12 && s?.paddingHorizontal === 12; });
  expect(row.length).toBeGreaterThan(0);
});

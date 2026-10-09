import React from 'react';
import { NavigateScreen } from '../src/ui/NavigateScreen';
import { controller } from '../src/state/controller';
import { services } from '../src/config/services';
jest.mock('../src/config/services', () => ({ services: { mapsRestApiKey: 'test-key' }, googleApplicationHeaders: () => ({}) }));
import { WALKING_WARNING } from '../src/nav/navigation';
const { create, act } = require('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  const { Journey } = require('../src/nav/journey');
  const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const point = { latitude: -33.87, longitude: 151.21 };
  const c: any = { settings: new Store(DEFAULT_SETTINGS), command: jest.fn(), stopNavigation: jest.fn(), finishJourney: jest.fn() };
  c.journey = new Journey({ now: Date.now, locate: async () => ({ ...point, timestamp: Date.now(), accuracy: 5 }),
    search: async () => ['North suburb', 'South suburb'].map((address, i) => ({ id: `place-${i}`, name: 'Library', address, point })),
    route: async (_: unknown, place: any) => ({ destination: place.name, destinationAddress: place.address, distanceMeters: 200, durationSeconds: 150, warnings: [],
      points: [point, { ...point, latitude: -33.869 }], steps: [
        { instruction: 'Head north on Test Street', points: [point, { ...point, latitude: -33.869 }], distanceMeters: 100, maneuver: 'DEPART' },
        { instruction: 'Turn left onto Library Street', points: [{ ...point, latitude: -33.869 }, { latitude: -33.869, longitude: 151.209 }], distanceMeters: 100, maneuver: 'TURN_LEFT' },
      ] }), watch: async () => ({ remove() {} }), say() {}, silence() {},
  });
  c.startJourney = () => c.journey.start(); c.crossingForJourney = () => c.journey.enterCrossing(); c.pauseJourney = () => c.journey.pause();
  return { controller: c };
});
let tree: any;
const openAssist = jest.fn(); const openSettings = jest.fn();
const text = () => JSON.stringify(tree.toJSON());
const button = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { expect(button(label)).toBeDefined(); await act(async () => { await button(label).props.onPress(); }); };
beforeEach(async () => {
  jest.useFakeTimers(); services.mapsRestApiKey = 'test-key'; controller.journey.end(); openAssist.mockClear();
  await act(async () => { tree = create(<NavigateScreen onStarted={openAssist} onBack={openSettings} />); });
});
afterEach(async () => { await act(async () => { controller.journey.end(); tree.unmount(); }); jest.useRealTimers(); });

test('missing configuration disables requests without presenting a key editor', async () => {
  await act(async () => { services.mapsRestApiKey = ''; tree.update(<NavigateScreen onStarted={openAssist} onBack={openSettings} />); });
  expect(text()).toContain('Walking routes unavailable'.toUpperCase()); expect(button('Search places').props.accessibilityState.disabled).toBe(true);
  expect(button('Open settings')).toBeUndefined(); await press('Back to journey'); expect(openSettings).toHaveBeenCalled();
});
test('same-name places remain distinct, require a route review, and start only on explicit confirmation', async () => {
  const input = tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Destination name and suburb')[0];
  await act(async () => input.props.onChangeText('Library')); await press('Search places');
  expect(button('Library\nNorth suburb')).toBeDefined(); expect(button('Library\nSouth suburb')).toBeDefined(); expect(controller.journey.running).toBe(false);
  await press('Library\nSouth suburb'); expect(text()).toContain('South suburb'); expect(text()).toContain(WALKING_WARNING); expect(controller.journey.running).toBe(false);
  await press('Review all instructions'); expect(text()).toContain('Turn left onto Library Street');
  await press('Start journey'); expect(controller.journey.running).toBe(true); expect(button('Search places')).toBeUndefined();
  expect(openAssist).toHaveBeenCalledTimes(1);
  expect(button('I completed this instruction')).toBeUndefined(); // Shared journey now owns active controls.
});

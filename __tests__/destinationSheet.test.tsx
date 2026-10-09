import React from 'react';
import { DestinationSheet } from '../src/ui/DestinationSheet';
import { controller } from '../src/state/controller';
const { create, act } = require('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store'); const { DestinationPlanner } = require('../src/nav/planner');
  const { SavedPlacesRepository } = require('../src/nav/savedPlaces'); const { DEFAULT_SETTINGS } = require('../src/settings/settings');
  const point = { latitude: -33.87, longitude: 151.21 };
  const places = ['North suburb', 'South suburb'].map((address, i) => ({ id: `place-${i}`, name: 'Library', address, point }));
  const c: any = { settings: new Store(DEFAULT_SETTINGS), presentation: new Store({ mapOpen: true, expanded: false }),
    savedPlaces: new SavedPlacesRepository(), savedDetails: new Store({}), loadSavedDetails: jest.fn(async () => undefined), sayNavigation: jest.fn(), stopVoice: jest.fn() };
  c.planner = new DestinationPlanner({ search: async () => places, details: async (id: string) => places.find(p => p.id === id),
    route: async (place: any) => ({ destination: place.name, destinationAddress: place.address, points: [point], distanceMeters: 200, durationSeconds: 90, warnings: [], steps: [] }),
    start: jest.fn(async () => true), cancelStart: jest.fn() });
  c.savePlace = async (place: any, alias?: string) => { await c.savedPlaces.save(place.id, c.planner.state.value.query, alias); return 'Saved.'; };
  c.removeSaved = async (id: string) => { await c.savedPlaces.remove(id); return 'Removed.'; };
  c.startPlannedJourney = jest.fn(() => c.planner.start(c.planner.state.value.revision));
  return { controller: c };
});
let tree: any;
const button = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { expect(button(label)).toBeDefined(); await act(async () => { await button(label).props.onPress(); }); };
const text = () => JSON.stringify(tree.toJSON());
beforeEach(async () => { controller.planner.reset(); await controller.savedPlaces.load(); await act(async () => { tree = create(<DestinationSheet visible />); }); });
afterEach(async () => { await act(async () => tree.unmount()); });
test('empty saved list renders no placeholder suggestions; search stars do not select or route', async () => {
  expect(text()).not.toContain('Recently saved');
  expect(button('Search places')).toBeUndefined();
  const input = tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Destination name and suburb')[0];
  await act(async () => input.props.onChangeText('Library')); await press('Search places');
  expect(button('1. Library. North suburb')).toBeDefined(); expect(button('2. Library. South suburb')).toBeDefined();
  await press('Save Library'); expect(controller.planner.state.value.page).toBe('results'); expect(controller.planner.state.value.selected).toBeNull();
  expect(controller.savedPlaces.state.value.items[0].placeId).toBe('place-0');
  await press('2. Library. South suburb'); expect(controller.planner.state.value.page).toBe('place');
  expect(button('Library. South suburb')).toBeUndefined();
  expect(controller.planner.state.value.route).toBeNull(); await press('Confirm place'); expect(text()).toContain('South suburb');
  expect(button('Start journey')).toBeDefined(); expect(controller.startPlannedJourney).not.toHaveBeenCalled();
});
test('exactly three newest saved suggestions appear on field focus, with access to all', async () => {
  await act(async () => { for (let i = 0; i < 4; i++) await controller.savedPlaces.save(`saved-${i}`, undefined, `Home ${i}`); });
  expect(button('1. Home 3. Open to check place details.')).toBeDefined();
  expect(button('3. Home 1. Open to check place details.')).toBeDefined();
  expect(button('4. Home 0. Open to check place details.')).toBeUndefined();
  expect(text()).toContain('Recently saved'); expect(text()).not.toContain('RECENTLY SAVED');
  await press('All saved places'); expect(button('4. Home 0. Open to check place details.')).toBeDefined();
});

test('accessibility activation stops voice before destination mutation without requiring a touch event', async () => {
  await act(async () => controller.planner.search('Library'));
  (controller.stopVoice as jest.Mock).mockClear();
  await press('2. Library. South suburb'); expect(controller.stopVoice).toHaveBeenCalled();
  expect(controller.planner.state.value.selected?.id).toBe('place-1');
});

const hostStyle = (node: any) => require('react-native').StyleSheet.flatten(node.props.style);
test('destination box has a visible label, is 56 dp and 18 sp, and its spoken name starts with the visible word', async () => {
  expect(text()).toContain('Destination');
  const input = tree.root.findAll((n: any) => n.type === 'TextInput' && n.props.accessibilityLabel === 'Destination name and suburb')[0];
  expect(input.props.accessibilityLabel.startsWith('Destination')).toBe(true);
  expect(hostStyle(input)).toMatchObject({ minHeight: 56, fontSize: 18 });
});

test('Confirm place and Start journey are primary (56 dp); busy text is a polite live region', async () => {
  await act(async () => controller.planner.search('Library'));
  await press('2. Library. South suburb');
  const minHeight = (label: string) => hostStyle(tree.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLabel === label)[0]).minHeight;
  expect(minHeight('Confirm place')).toBe(56);
  await press('Confirm place');
  expect(minHeight('Start journey')).toBe(56);
  expect(minHeight('New search')).toBe(48);
  controller.planner.state.set({ ...controller.planner.state.value, busy: 'routing' } as any);
  await act(async () => undefined);
  const busy = tree.root.findAll((n: any) => n.type === 'Text' && n.props.children === 'Finding route…')[0];
  expect(busy.props.accessibilityLiveRegion).toBe('polite');
});

test('M3/M4 route review: Start journey is pinned outside the scroll area with the warning once under it; terms and privacy links are gone', async () => {
  const { WALKING_WARNING } = require('../src/nav/navigation');
  await act(async () => controller.planner.search('Library'));
  await press('2. Library. South suburb'); await press('Confirm place');
  const scroll = tree.root.findAll((n: any) => n.type === 'RCTScrollView' || n.type === 'ScrollView')[0];
  const labelled = (root: any) => root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Start journey');
  expect(labelled(tree.root).length).toBeGreaterThan(0);
  expect(labelled(scroll)).toHaveLength(0);
  const warning = JSON.stringify(WALKING_WARNING).slice(1, -1);
  expect(text().split(warning).length - 1).toBe(1);
  expect(text().indexOf('Start journey')).toBeLessThan(text().indexOf(warning));
  expect(button('Google Maps terms')).toBeUndefined(); expect(button('Google privacy policy')).toBeUndefined();
  expect(text()).toContain('Google Maps');
  expect(text()).not.toContain('Saved place IDs');
});

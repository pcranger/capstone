import React from 'react';
import { ActivityIndicator } from 'react-native';
import { CrossWiseApp } from '../src/ui/CrossWiseApp';
import { controller } from '../src/state/controller';
import { S } from '../src/strings';

// J19: the start-up screen is a spinner plus words, announced politely as one progress element.
const { create, act } = require('react-test-renderer');

jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('react-native-vision-camera', () => ({ useCameraPermission: () => ({ hasPermission: true, canRequestPermission: false, requestPermission: jest.fn() }) }));
jest.mock('../src/ui/JourneyScreen', () => ({ JourneyScreen: () => null }));
jest.mock('../src/ui/SettingsScreen', () => ({ SettingsScreen: () => null }));
jest.mock('../src/ui/GuideScreen', () => ({ GuideScreen: () => null }));
jest.mock('../src/ui/PracticeScreen', () => ({ PracticeScreen: () => null }));
jest.mock('../src/state/controller', () => {
  const { Store } = require('../src/state/store');
  return {
    controller: {
      settingsLoaded: new Store(false), notice: new Store(null), presentation: new Store({ mapOpen: false, expanded: false }),
      setHomeVisible: jest.fn(), clearNotice: jest.fn(), closeMap: jest.fn(),
    },
  };
});

test('while settings load: a spinner, the words, and one polite progress live region; then the app', async () => {
  let tree: any;
  await act(async () => { tree = create(<CrossWiseApp />); });
  const progress = tree.root.findAll((n: any) => n.props.accessibilityRole === 'progressbar');
  expect(progress.length).toBeGreaterThan(0);
  expect(progress[0].props.accessibilityLabel).toBe(S.startingApp);
  expect(progress[0].props.accessibilityLiveRegion).toBe('polite');
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => controller.settingsLoaded.set(true));
  expect(tree.root.findAll((n: any) => n.props.accessibilityRole === 'progressbar')).toHaveLength(0);
  await act(async () => tree.unmount());
});

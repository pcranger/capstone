import React from 'react';
import { DeveloperTelemetry } from '../src/ui/DeveloperTelemetry';
import { EMPTY_SNAPSHOT } from '../src/crossing/crossingEngine';
import { BoxF } from '../src/core/geometry';
import { ObjectCategory } from '../src/perception/detection';
import { HazardLevel, Side } from '../src/crossing/hazardMonitor';
const { create, act } = require('react-test-renderer');
jest.mock('../src/ui/theme', () => ({ useType: () => ({}) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
test('counts tracked classes, labels optical estimates and clears stale measurements', async () => {
  const snapshot = { ...EMPTY_SNAPSHOT, tracks: [
    { id: 7, box: new BoxF(0.1, 0.2, 0.3, 0.5), category: ObjectCategory.CAR, confidence: 0.9, isPrimarySignal: false },
    { id: 8, box: new BoxF(0.6, 0.2, 0.8, 0.5), category: ObjectCategory.MOTORCYCLE, confidence: 0.8, isPrimarySignal: false },
  ], hazards: [{ trackId: 7, category: ObjectCategory.CAR, level: HazardLevel.WARNING, side: Side.LEFT, ttcSeconds: 2.1, heightFraction: 0.3 }] };
  const props = { snapshot, fps: 20, inferenceMs: 35, brightness: 0.5, model: 'YOLO test' };
  let tree: any;
  await act(async () => { tree = create(<DeveloperTelemetry {...props} fresh />); });
  expect(tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Cars: 1').length).toBeGreaterThan(0);
  expect(JSON.stringify(tree.toJSON())).toContain('optical TTC 2.1 s');
  expect(JSON.stringify(tree.toJSON())).toContain('Motion / approach unconfirmed');
  await act(async () => tree.update(<DeveloperTelemetry {...props} fresh={false} />));
  expect(JSON.stringify(tree.toJSON())).toContain('STALE FRAME');
  expect(JSON.stringify(tree.toJSON())).not.toContain('optical TTC 2.1 s');
  expect(tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Cars: —').length).toBeGreaterThan(0);
  await act(async () => tree.unmount());
});

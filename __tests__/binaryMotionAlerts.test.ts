import { CrossingEngine, UserCommand } from '../src/crossing/crossingEngine';
import { VehicleMotion, type MotionDirection, type MotionState } from '../src/tracking/vehicleMotion';
import { ObjectCategory } from '../src/perception/detection';
import { BoxF } from '../src/core/geometry';
import { Phrase } from '../src/feedback/cue';
import { det, frame } from './fixtures';

afterEach(() => jest.restoreAllMocks());

function scenario(state: MotionState, direction: MotionDirection, supported: boolean) {
  jest.spyOn(VehicleMotion.prototype, 'update').mockImplementation(function (this: VehicleMotion, tracks) {
    this.reliable = true;
    return new Map(tracks.map(t => [t.id, { state, direction, supported }]));
  });
  const engine = new CrossingEngine();
  engine.command(UserCommand.START_ASSIST, 0);
  const phrases: Phrase[] = [];
  let haptic = false;
  for (let t = 0; t < 4000; t += 100) {
    engine.onSensors(t, { timestampMs: t, headingDeg: 0, pitchDeg: 0 }, false);
    const f = { ...frame(t, det(ObjectCategory.CAR, new BoxF(.3, .3, .6, .7))), brightness: .7 };
    const out = engine.onFrame(f, { hfovDeg: 60, vfovDeg: 90 });
    for (const c of out.cues) {
      if (c.kind === 'speak') phrases.push(c.phrase);
      if (c.kind === 'haptic') haptic = true;
    }
  }
  return { phrases, haptic, engine };
}

test.each([
  ['LEFT_TO_RIGHT', Phrase.VEHICLE_LEFT],
  ['RIGHT_TO_LEFT', Phrase.VEHICLE_RIGHT],
  ['UNKNOWN', Phrase.VEHICLE_MOVING],
] as const)('moving %s produces the corresponding warning and vibration', (direction, phrase) => {
  const result = scenario('MOVING', direction, true);
  expect(result.phrases).toContain(phrase);
  expect(result.haptic).toBe(true);
});

test('supported stationary car suppresses its vehicle warning', () => {
  const result = scenario('STATIONARY', 'UNKNOWN', true);
  expect(result.engine.snapshot.hazards).toHaveLength(0);
  expect(result.phrases).not.toContain(Phrase.VEHICLE_DETECTED);
});

test('binary stationary fallback without evidence neither hides the vehicle nor clears the scan', () => {
  const result = scenario('STATIONARY', 'UNKNOWN', false);
  expect(result.phrases).toContain(Phrase.VEHICLE_DETECTED);
  expect(result.engine.snapshot.hazards).toHaveLength(1);
  expect(result.phrases).not.toContain(Phrase.SCAN_COMPLETE);
});

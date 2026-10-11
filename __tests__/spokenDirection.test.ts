import { approximateSteps, compassDirection, spokenWalkingDirection, upcomingDirection } from '../src/nav/spokenDirection';
import type { RouteStep } from '../src/nav/navigation';
const southwest: RouteStep = { instruction: 'Continue on Test Street', maneuver: 'TURN_RIGHT', distanceMeters: 10,
  points: [{ latitude: 0, longitude: 0 }, { latitude: -0.001, longitude: -0.001 }] };

test('eight compass sectors wrap correctly around north', () => {
  expect([0, 45, 90, 135, 180, 225, 270, 315].map(compassDirection)).toEqual([
    'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);
  expect(compassDirection(359)).toBe('north');
  expect(compassDirection(-45)).toBe('northwest');
});
test('current and upcoming instructions distinguish walking distance from distance to a turn', () => {
  expect(spokenWalkingDirection(southwest, 10)).toContain('Head southwest for about 10 metres, roughly 15 steps.');
  expect(upcomingDirection(southwest, 10)).toBe('In about 10 metres, head southwest. Roughly 15 steps to the turn.');
  expect(approximateSteps(100)).toBe(145);
});
test('missing distance, step boundary and crossings never produce a misleading step countdown', () => {
  expect(spokenWalkingDirection(southwest, null)).not.toContain('steps');
  expect(spokenWalkingDirection(southwest, 0)).not.toContain('steps');
  expect(upcomingDirection(southwest, 0)).toBeNull();
  const crossing = { ...southwest, instruction: 'Cross Test Road' };
  expect(spokenWalkingDirection(crossing, 10)).toBe('Cross Test Road.');
  expect(upcomingDirection(crossing, 10)).toBeNull();
});

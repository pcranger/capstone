import { bearing, distanceMeters, distanceToSegmentMeters, type LocationFix, type RouteStep } from './navigation';

const DIRECTIONS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compassDirection = (degrees: number): string => DIRECTIONS[Math.round(((degrees % 360 + 360) % 360) / 45) % 8];
/** Approximation only: not pedometer measurements or a crossing completion signal. */
export const approximateSteps = (metres: number): number => Math.max(1, Math.round(metres / 0.7 / 5) * 5);

function routeHeading(step: RouteStep, fix?: LocationFix | null): string | null {
  let selected = -1, nearest = Infinity;
  for (let i = 0; i < step.points.length - 1; i++) {
    if (distanceMeters(step.points[i], step.points[i + 1]) < 1) continue;
    const away = fix ? distanceToSegmentMeters(fix, step.points[i], step.points[i + 1]) : i;
    if (away < nearest) { nearest = away; selected = i; }
  }
  return selected < 0 || (fix && nearest > 25) ? null : compassDirection(bearing(step.points[selected], step.points[selected + 1]));
}

export function spokenWalkingDirection(step: RouteStep, remaining: number | null, fix?: LocationFix | null): string {
  const instruction = `${step.instruction}${/[.!?]$/.test(step.instruction) ? '' : '.'}`;
  if (/\bcross(?:ing)?\b/i.test(step.instruction)) return instruction;
  const heading = routeHeading(step, fix);
  const direction = heading ? ` Head ${heading}.` : '';
  if (remaining === null || !Number.isFinite(remaining) || remaining < 5) return instruction + direction;
  const metres = Math.round(remaining / 5) * 5;
  return instruction + (heading ? ` Head ${heading} for about ${metres} metres` : ` About ${metres} metres remaining`)
    + `, roughly ${approximateSteps(metres)} steps.`;
}

export function upcomingDirection(next: RouteStep, remaining: number): string | null {
  if (/\bcross(?:ing)?\b/i.test(next.instruction) || remaining < 5 || !Number.isFinite(remaining)) return null;
  const heading = routeHeading(next);
  const metres = Math.round(remaining / 5) * 5;
  return heading ? `In about ${metres} metres, head ${heading}. Roughly ${approximateSteps(metres)} steps to the turn.` : null;
}

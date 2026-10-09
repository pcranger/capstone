import type { EngineSnapshot } from '../crossing/crossingEngine';
import { ObjectCategory } from '../perception/detection';

/**
 * Turns the engine snapshot into the short facts the Assist screen shows and VoiceOver reads.
 *
 * Directions are given on a **clock face**. Orientation and mobility training uses it ("entrance at 2 o'clock"),
 * every other navigation app for blind travelers uses it, and it carries far more than "left / right": 11 and 1
 * o'clock are both nearly ahead, and the difference matters when a car is coming.
 */

/** 9 o'clock at the left edge of the frame, 12 straight ahead, 3 at the right edge. */
export function clockOf(centerX: number): number {
  const clamped = Math.min(Math.max(centerX, 0), 1);
  const hour = Math.min(Math.max(Math.round(9 + clamped * 6), 9), 15);
  return hour > 12 ? hour - 12 : hour;
}

export interface Nearby {
  category: ObjectCategory;
  count: number;
  nearestClock: number;
}

const TRAFFIC = new Set([
  ObjectCategory.PERSON,
  ObjectCategory.BICYCLE,
  ObjectCategory.CAR,
  ObjectCategory.MOTORCYCLE,
  ObjectCategory.BUS,
  ObjectCategory.TRUCK,
]);

/** Vehicles and people currently tracked, biggest first — "biggest" is the best proxy we have for closest. */
export function nearby(snapshot: EngineSnapshot): Nearby[] {
  const groups = new Map<ObjectCategory, EngineSnapshot['tracks']>();
  for (const t of snapshot.tracks) {
    if (!TRAFFIC.has(t.category)) continue;
    const list = groups.get(t.category) ?? [];
    list.push(t);
    groups.set(t.category, list);
  }
  return [...groups.entries()]
    .map(([category, tracks]) => {
      const nearest = tracks.reduce((a, b) => (b.box.area > a.box.area ? b : a));
      return { category, count: tracks.length, nearestClock: clockOf(nearest.box.centerX) };
    })
    .sort((a, b) => b.count - a.count);
}

export function signalClock(snapshot: EngineSnapshot): number | null {
  const box = snapshot.signal.primaryBox;
  return box ? clockOf(box.centerX) : null;
}

export function crosswalkSeen(snapshot: EngineSnapshot): boolean {
  return snapshot.tracks.some((t) => t.category === ObjectCategory.CROSSWALK);
}

/** Seconds since the signal was last actually seen, for "signal out of view" wording. */
export function signalAgeSeconds(snapshot: EngineSnapshot, nowMs: number): number | null {
  const last = snapshot.signal.lastSeenMs;
  return last !== null ? Math.trunc((nowMs - last) / 1000) : null;
}

/** 0 = no idea, 1 = certain. The larger of the two evidence pools, which is what drove the phase. */
export function confidence(snapshot: EngineSnapshot): number {
  return Math.min(Math.max(Math.max(snapshot.signal.walkEvidence, snapshot.signal.dontWalkEvidence), 0), 1);
}

export function compassPoint(bearingDeg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = (((Math.round(bearingDeg / 45) % 8) + 8) % 8);
  return points[index];
}

export function categoryName(category: ObjectCategory, count: number): string {
  const one = count === 1;
  switch (category) {
    case ObjectCategory.PERSON:
      return one ? 'Person' : 'people';
    case ObjectCategory.BICYCLE:
      return one ? 'Bicycle' : 'bicycles';
    case ObjectCategory.MOTORCYCLE:
      return one ? 'Motorcycle' : 'motorcycles';
    case ObjectCategory.CAR:
      return one ? 'Car' : 'cars';
    case ObjectCategory.BUS:
      return one ? 'Bus' : 'buses';
    case ObjectCategory.TRUCK:
      return one ? 'Truck' : 'trucks';
    default:
      return one ? 'Object' : 'objects';
  }
}

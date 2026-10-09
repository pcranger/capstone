import { ObjectCategory } from './detection';

/**
 * Maps a model's class names to [ObjectCategory].
 *
 * The CrossWise training pipeline (ml/) emits the canonical names in CANONICAL; COCO names are
 * supported so an off-the-shelf COCO model can be used as a baseline; the token rules make most
 * community datasets (Roboflow etc.) work without code changes. Matching is done on whole tokens
 * so that e.g. COCO "handbag" is not mistaken for a "hand" (don't walk) signal.
 */
export const CANONICAL: Record<string, ObjectCategory> = {
  ped_red: ObjectCategory.PED_DONT_WALK,
  ped_green: ObjectCategory.PED_WALK,
  ped_countdown: ObjectCategory.PED_COUNTDOWN,
  crosswalk: ObjectCategory.CROSSWALK,
  person: ObjectCategory.PERSON,
  rider: ObjectCategory.PERSON,
  pedestrian: ObjectCategory.PERSON,
  pedestrians: ObjectCategory.PERSON,
  people: ObjectCategory.PERSON,
  bicycle: ObjectCategory.BICYCLE,
  bike: ObjectCategory.BICYCLE,
  car: ObjectCategory.CAR,
  van: ObjectCategory.CAR,
  taxi: ObjectCategory.CAR,
  motorcycle: ObjectCategory.MOTORCYCLE,
  motorbike: ObjectCategory.MOTORCYCLE,
  scooter: ObjectCategory.MOTORCYCLE,
  bus: ObjectCategory.BUS,
  truck: ObjectCategory.TRUCK,
  lorry: ObjectCategory.TRUCK,
  traffic_light: ObjectCategory.TRAFFIC_LIGHT,
};

export function normalize(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function categoryFor(rawName: string): ObjectCategory {
  const n = normalize(rawName);
  const canonical = CANONICAL[n];
  if (canonical !== undefined) return canonical;

  const tokens = n.split('_').filter((t) => t.length > 0);
  const tok = (...words: string[]) => tokens.some((t) => words.includes(t));
  const prefix = (...words: string[]) => tokens.some((t) => words.some((w) => t.startsWith(w)));

  const lightWord = prefix('light', 'signal', 'lamp');
  const colorWord = tok('red', 'green');
  if (prefix('zebra', 'crosswalk', 'crossing') && !lightWord && !colorWord) return ObjectCategory.CROSSWALK;
  if (prefix('countdown', 'timer', 'digit')) return ObjectCategory.PED_COUNTDOWN;

  const pedestrianHint =
    prefix('ped', 'cross') || tok('walk', 'walking', 'man', 'hand', 'person', 'dontwalk', 'nowalk');
  if (lightWord || pedestrianHint) {
    const stop = tok('red', 'stop', 'dont', 'donot', 'no', 'wait', 'hand', 'dontwalk', 'nowalk');
    const go = tok('green', 'go', 'walk', 'walking', 'white');
    if (stop && pedestrianHint) return ObjectCategory.PED_DONT_WALK;
    if (go && pedestrianHint) return ObjectCategory.PED_WALK;
    // A red/green light without a pedestrian hint may be a vehicle signal: never trust its phase.
    if (lightWord) return ObjectCategory.TRAFFIC_LIGHT;
    return ObjectCategory.OTHER;
  }
  return ObjectCategory.OTHER;
}

export const LabelMapper = { CANONICAL, normalize, categoryFor };

import { BoxF } from '../src/core/geometry';
import { type Detection, type FrameDetections, ObjectCategory, type SignalColor } from '../src/perception/detection';

export const SIGNAL_BOX = new BoxF(0.48, 0.2, 0.52, 0.28);

export function det(
  category: ObjectCategory,
  box: BoxF = SIGNAL_BOX,
  score = 0.8,
  colorHint: SignalColor | null = null,
): Detection {
  return {
    box,
    classIndex: Object.values(ObjectCategory).indexOf(category),
    label: category.toLowerCase(),
    score,
    category,
    colorHint,
  };
}

export function frame(t: number, ...detections: Detection[]): FrameDetections {
  return { timestampMs: t, detections, frameWidth: 720, frameHeight: 1280, inferenceMs: 30 };
}

/** Small seeded PRNG (mulberry32) so randomized tests are repeatable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

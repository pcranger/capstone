import { ObjectCategory } from './detection';
import { CANONICAL, normalize } from './labelMapper';
import type { Candidate } from './yoloDecoder';

/**
 * The sixteen sidewalk classes and the palette from the AN-S3 project (UOW research), kept byte-identical so a
 * model trained there is read here exactly as its authors intended — same order, same colours, same legend.
 *
 * These are surfaces and regions. Broad labels must not imply a specific crossing or pedestrian signal state.
 */
export const SEG_LABELS = [
  'Road', 'Paved', 'Markings', 'Steps', 'Structures', 'Entrances', 'Obstacles', 'Signals',
  'Signs', 'Vegetation', 'Natural', 'Hazards', 'Water', 'Sky', 'People/Animals', 'Vehicles',
];

export const SEG_COLORS = [
  '#9013fe', // Road
  '#24ca19', // Paved
  '#ffffff', // Markings
  '#f8e71c', // Steps
  '#9b9b9b', // Structures
  '#4a4a4a', // Entrances
  '#fd66dc', // Obstacles
  '#d6b673', // Signals
  '#50e3c2', // Signs
  '#417505', // Vegetation
  '#ff9f00', // Natural
  '#8b572a', // Hazards
  '#2f64c6', // Water
  '#75b5ff', // Sky
  '#ff0a28', // People/Animals
  '#293092', // Vehicles
];

/** The palette as [r, g, b] triples, which is what the mask painter needs inside the worklet. */
export const SEG_RGB: number[][] = SEG_COLORS.map((hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]);

/**
 * Map explicit labels, never class positions. Road markings include parking bays and lane paint;
 * People/Animals does not establish that a person is present. Neither may drive a more specific claim.
 */
export function segCategoryFor(label: string): ObjectCategory {
  const name = normalize(label);
  switch (name) {
    case 'vehicles':
      return ObjectCategory.CAR;
    case 'signals':
      return ObjectCategory.TRAFFIC_LIGHT;
    default:
      return CANONICAL[name] ?? ObjectCategory.OTHER;
  }
}

/** Missing metadata cannot establish a class taxonomy, even when the class count matches AN-S3. */
export function segmentationLabels(classes: number, names?: readonly string[]): string[] {
  if (!Number.isInteger(classes) || classes <= 0) throw new Error('Invalid segmentation class count.');
  if (names && names.length !== classes) throw new Error('Segmentation labels do not match the model output.');
  return names ? [...names] : Array.from({ length: classes }, (_, i) => `class_${i}`);
}

const BOX_FEATURES = 4;
const MASK_COEFFS = 32;
const MAX_ITEMS = 30;
const MASK_THRESHOLD = 0.5;
const SOFT_EDGE = 0.18;
const MAX_ALPHA = 120;

export interface SegCandidate extends Candidate {
  coeffs: number[];
}

/**
 * Ported from `TrueSightSegmenter` in the AN-S3 project: boxes from a [1, 4 + nc + 32, anchors] head (normalized,
 * plain resize — no letterbox), per-class NMS, top 30.
 */
export function segPostProcess(
  feature: Float32Array,
  featureCount: number,
  anchorCount: number,
  scoreThreshold: number,
  iouThreshold: number,
): SegCandidate[] {
  'worklet';
  const classes = featureCount - BOX_FEATURES - MASK_COEFFS;
  const at = (f: number, a: number) => feature[f * anchorCount + a];
  const candidates: SegCandidate[] = [];
  for (let anchor = 0; anchor < anchorCount; anchor++) {
    let best = 0;
    let bestClass = 0;
    for (let c = 0; c < classes; c++) {
      const score = at(BOX_FEATURES + c, anchor);
      if (score > best) {
        best = score;
        bestClass = c;
      }
    }
    if (best < scoreThreshold) continue;
    const cx = at(0, anchor);
    const cy = at(1, anchor);
    const w = at(2, anchor);
    const h = at(3, anchor);
    const coeffs = new Array<number>(MASK_COEFFS);
    for (let i = 0; i < MASK_COEFFS; i++) coeffs[i] = at(BOX_FEATURES + classes + i, anchor);
    candidates.push({
      left: cx - w / 2,
      top: cy - h / 2,
      right: cx + w / 2,
      bottom: cy + h / 2,
      classIndex: bestClass,
      score: best,
      coeffs,
    });
  }

  // Per-class NMS, exactly as the source project does it.
  const kept: SegCandidate[] = [];
  for (let cls = 0; cls < classes; cls++) {
    const same = candidates.filter((c) => c.classIndex === cls).sort((a, b) => b.score - a.score);
    const used = new Array<boolean>(same.length).fill(false);
    for (let i = 0; i < same.length; i++) {
      if (used[i]) continue;
      kept.push(same[i]);
      for (let j = i + 1; j < same.length; j++) {
        if (used[j]) continue;
        const a = same[i];
        const b = same[j];
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix <= 0 || iy <= 0) continue;
        const inter = ix * iy;
        const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
        if (union > 0 && inter / union > iouThreshold) used[j] = true;
      }
    }
  }
  return kept.sort((a, b) => b.score - a.score).slice(0, MAX_ITEMS);
}

/**
 * One RGBA image (premultiplied alpha) at prototype resolution; the overlay scales it onto the preview.
 * `protos` is [1, maskHeight, maskWidth, 32].
 */
export function paintSegMask(
  detections: SegCandidate[],
  protos: Float32Array,
  maskWidth: number,
  maskHeight: number,
  palette: number[][],
): Uint8Array {
  'worklet';
  const out = new Uint8Array(maskWidth * maskHeight * 4);
  for (let d = 0; d < detections.length; d++) {
    const det = detections[d];
    const color = palette[det.classIndex] ?? [255, 255, 255];
    const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const left = Math.floor(c01(det.left) * maskWidth);
    const top = Math.floor(c01(det.top) * maskHeight);
    const right = Math.floor(c01(det.right) * maskWidth);
    const bottom = Math.floor(c01(det.bottom) * maskHeight);
    for (let y = Math.max(0, top); y < Math.min(maskHeight, bottom); y++) {
      for (let x = Math.max(0, left); x < Math.min(maskWidth, right); x++) {
        const cell = (y * maskWidth + x) * MASK_COEFFS;
        let value = 0;
        for (let c = 0; c < MASK_COEFFS; c++) value += det.coeffs[c] * protos[cell + c];
        const probability = 1 / (1 + Math.exp(-value));
        const ramp = c01((probability - MASK_THRESHOLD + SOFT_EDGE) / (2 * SOFT_EDGE));
        const alpha = Math.round(ramp * MAX_ALPHA);
        if (alpha > 0) {
          // Premultiplied, which is what the image view expects for RGBA.
          const o = (y * maskWidth + x) * 4;
          out[o] = Math.round((color[0] * alpha) / 255);
          out[o + 1] = Math.round((color[1] * alpha) / 255);
          out[o + 2] = Math.round((color[2] * alpha) / 255);
          out[o + 3] = alpha;
        }
      }
    }
  }
  return out;
}

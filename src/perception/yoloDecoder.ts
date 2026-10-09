import { BoxF } from '../core/geometry';
import type { Detection, ObjectCategory } from './detection';

/*
 * Everything here up to `decode()` runs inside the camera's worklet runtime, so it is written with plain
 * objects and numbers only (no classes, no closures over module state) and every function is a worklet.
 */

/**
 * Letterbox geometry used when resizing an upright camera frame into the square model input
 * (same convention as Ultralytics: keep aspect ratio, pad evenly with gray).
 */
export interface Letterbox {
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
  scale: number;
  scaledWidth: number;
  scaledHeight: number;
  padX: number;
  padY: number;
}

export function letterboxOf(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Letterbox {
  'worklet';
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight);
  const scaledWidth = Math.round(srcWidth * scale);
  const scaledHeight = Math.round(srcHeight * scale);
  return {
    srcWidth,
    srcHeight,
    dstWidth,
    dstHeight,
    scale,
    scaledWidth,
    scaledHeight,
    padX: (dstWidth - scaledWidth) / 2,
    padY: (dstHeight - scaledHeight) / 2,
  };
}

/** Model-input pixel x -> normalized source x. */
export function toSourceX(lb: Letterbox, x: number): number {
  'worklet';
  return (x - lb.padX) / lb.scale / lb.srcWidth;
}

export function toSourceY(lb: Letterbox, y: number): number {
  'worklet';
  return (y - lb.padY) / lb.scale / lb.srcHeight;
}

/** How the detection head of a LiteRT YOLO export is laid out. */
export type YoloOutputFormat =
  /** [1, 4 + nc, anchors]: cx, cy, w, h then class scores (Ultralytics raw export, channels first). */
  | 'RAW_CHANNELS_FIRST'
  /** [1, anchors, 4 + nc]: same content, channels last (some third-party exports). */
  | 'RAW_CHANNELS_LAST'
  /** [1, maxDet, 6]: x1, y1, x2, y2, score, class (YOLO26 / YOLOv10 NMS-free export). */
  | 'END_TO_END'
  /** [1, 4 + nc + 32, anchors] plus a prototype tensor: handled by the segmentation path, not this decoder. */
  | 'SEGMENTATION';

/** Number of anchor points a YOLO head with strides 8/16/32 produces for this input size. */
export function expectedAnchors(inputWidth: number, inputHeight: number): number {
  'worklet';
  let sum = 0;
  const strides = [8, 16, 32];
  for (let i = 0; i < strides.length; i++) {
    const s = strides[i];
    sum += Math.floor(inputWidth / s) * Math.floor(inputHeight / s);
  }
  return sum;
}

export function inferFormat(
  outputShape: number[],
  inputWidth: number,
  inputHeight: number,
  numClasses: number | null,
  end2endHint: boolean | null,
): YoloOutputFormat {
  if (outputShape.length !== 3) {
    throw new Error(`Expected a 3D detection output, got [${outputShape.join(', ')}]`);
  }
  const a = outputShape[1];
  const b = outputShape[2];
  if (end2endHint === true && b === 6) return 'END_TO_END';
  const anchors = expectedAnchors(inputWidth, inputHeight);
  if (end2endHint === null && b === 6 && a !== anchors) return 'END_TO_END';
  if (numClasses !== null) {
    if (a === 4 + numClasses) return 'RAW_CHANNELS_FIRST';
    if (b === 4 + numClasses) return 'RAW_CHANNELS_LAST';
  }
  return a < b ? 'RAW_CHANNELS_FIRST' : 'RAW_CHANNELS_LAST';
}

/** A decoded box in normalized source coordinates, before labels are attached. */
export interface Candidate {
  left: number;
  top: number;
  right: number;
  bottom: number;
  classIndex: number;
  score: number;
}

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function candidateOf(
  lb: Letterbox,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  classIndex: number,
  score: number,
): Candidate | null {
  'worklet';
  const left = clamp01(toSourceX(lb, x1));
  const top = clamp01(toSourceY(lb, y1));
  const right = clamp01(toSourceX(lb, x2));
  const bottom = clamp01(toSourceY(lb, y2));
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  if (area <= 0) return null;
  return { left, top, right, bottom, classIndex, score };
}

function decodeRaw(
  out: Float32Array,
  shape: number[],
  format: YoloOutputFormat,
  lb: Letterbox,
  threshold: number,
): Candidate[] {
  'worklet';
  const channelsFirst = format === 'RAW_CHANNELS_FIRST';
  const channels = channelsFirst ? shape[1] : shape[2];
  const anchors = channelsFirst ? shape[2] : shape[1];
  const numClasses = channels - 4;
  const result: Candidate[] = [];
  if (numClasses <= 0) return result;
  // Stride of one step along the channel axis and along the anchor axis.
  const cStride = channelsFirst ? anchors : 1;
  const aStride = channelsFirst ? 1 : channels;

  // Decide units once: normalized exports never exceed ~1.5 in any coordinate.
  let maxCoord = 0;
  const probe = Math.min(anchors, 512);
  for (let i = 0; i < probe; i++) {
    const x = out[i * aStride];
    const y = out[cStride + i * aStride];
    if (x > maxCoord) maxCoord = x;
    if (y > maxCoord) maxCoord = y;
  }
  const unitScaleX = maxCoord <= 2 ? lb.dstWidth : 1;
  const unitScaleY = maxCoord <= 2 ? lb.dstHeight : 1;

  for (let i = 0; i < anchors; i++) {
    const base = i * aStride;
    let best = -1;
    let bestScore = threshold;
    for (let c = 0; c < numClasses; c++) {
      const s = out[base + (4 + c) * cStride];
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best < 0) continue;
    const cx = out[base] * unitScaleX;
    const cy = out[base + cStride] * unitScaleY;
    const w = out[base + 2 * cStride] * unitScaleX;
    const h = out[base + 3 * cStride] * unitScaleY;
    const cand = candidateOf(lb, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, best, bestScore);
    if (cand !== null) result.push(cand);
  }
  return result;
}

function decodeEndToEnd(out: Float32Array, shape: number[], lb: Letterbox, threshold: number): Candidate[] {
  'worklet';
  const rows = shape[1];
  const cols = shape[2];
  const result: Candidate[] = [];
  if (cols < 6) return result;
  let maxCoord = 0;
  for (let r = 0; r < rows; r++) {
    if (out[r * cols + 4] <= 0) continue;
    for (let k = 0; k < 4; k++) if (out[r * cols + k] > maxCoord) maxCoord = out[r * cols + k];
  }
  const sx = maxCoord <= 2 ? lb.dstWidth : 1;
  const sy = maxCoord <= 2 ? lb.dstHeight : 1;
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const score = out[base + 4];
    if (score < threshold) continue;
    const cand = candidateOf(
      lb,
      out[base] * sx,
      out[base + 1] * sy,
      out[base + 2] * sx,
      out[base + 3] * sy,
      Math.round(out[base + 5]),
      score,
    );
    if (cand !== null) result.push(cand);
  }
  return result;
}

export function candidateIou(a: Candidate, b: Candidate): number {
  'worklet';
  const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const areaA = Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top);
  const areaB = Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Per-class greedy non-maximum suppression. */
export function nms(candidates: Candidate[], iouThreshold: number): Candidate[] {
  'worklet';
  const groups: Record<number, Candidate[]> = {};
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (groups[c.classIndex] === undefined) groups[c.classIndex] = [];
    groups[c.classIndex].push(c);
  }
  const kept: Candidate[] = [];
  const keys = Object.keys(groups);
  for (let k = 0; k < keys.length; k++) {
    const sorted = groups[Number(keys[k])].sort((a, b) => b.score - a.score);
    const removed = new Array<boolean>(sorted.length).fill(false);
    for (let i = 0; i < sorted.length; i++) {
      if (removed[i]) continue;
      kept.push(sorted[i]);
      for (let j = i + 1; j < sorted.length; j++) {
        if (!removed[j] && candidateIou(sorted[j], sorted[i]) > iouThreshold) removed[j] = true;
      }
    }
  }
  return kept;
}

/**
 * Decodes one output tensor into candidates with boxes in normalized *source frame* coordinates.
 *
 * Coordinate units are auto-detected: Ultralytics LiteRT raw exports are normalized to the input
 * size (0..1) while litert-torch end-to-end exports are in input pixels.
 */
export function decodeCandidates(
  output: Float32Array,
  outputShape: number[],
  format: YoloOutputFormat,
  letterbox: Letterbox,
  scoreThreshold: number,
  iouThreshold = 0.5,
  maxDetections = 100,
): Candidate[] {
  'worklet';
  const candidates =
    format === 'END_TO_END'
      ? decodeEndToEnd(output, outputShape, letterbox, scoreThreshold)
      : decodeRaw(output, outputShape, format, letterbox, scoreThreshold);
  const kept = format === 'END_TO_END' ? candidates : nms(candidates, iouThreshold);
  return kept.sort((a, b) => b.score - a.score).slice(0, maxDetections);
}

/** Attaches labels and categories on the JS side. */
export function toDetection(c: Candidate, labels: string[], categories: ObjectCategory[]): Detection {
  return {
    box: new BoxF(c.left, c.top, c.right, c.bottom),
    classIndex: c.classIndex,
    label: labels[c.classIndex] ?? `class_${c.classIndex}`,
    score: c.score,
    category: categories[c.classIndex] ?? ('OTHER' as ObjectCategory),
  };
}

export function decode(
  output: Float32Array,
  outputShape: number[],
  format: YoloOutputFormat,
  letterbox: Letterbox,
  labels: string[],
  categories: ObjectCategory[],
  scoreThreshold: number,
  iouThreshold = 0.5,
  maxDetections = 100,
): Detection[] {
  return decodeCandidates(output, outputShape, format, letterbox, scoreThreshold, iouThreshold, maxDetections).map(
    (c) => toDetection(c, labels, categories),
  );
}

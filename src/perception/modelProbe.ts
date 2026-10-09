import type { LoadedModel } from './modelLoader';
import { decode, letterboxOf } from './yoloDecoder';

/** Offline diagnostics only. Results never enter the live tracker or speech engine. */
export async function probeDetector(loaded: LoadedModel, bytes: Uint8Array, width: number, height: number, threshold: number) {
  const { info, model } = loaded;
  try {
    if (![width, height].every((v) => Number.isSafeInteger(v) && v > 0 && v <= 32768)) {
      throw new Error('Probe source dimensions must be positive integers <= 32768');
    }
    if (info.format === 'SEGMENTATION') throw new Error('Probe supports box detectors only');
    const expected = info.inputWidth * info.inputHeight * 3 * 4;
    if (bytes.byteLength !== expected) throw new Error(`Expected ${expected} input bytes, got ${bytes.byteLength}`);
    // Copy: a file read may return a view with a nonzero offset or an unaligned buffer.
    const input = new Uint8Array(bytes).buffer;
    const pixels = new Float32Array(input);
    for (const v of pixels) {
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('Probe input must contain finite RGB floats in [0, 1]');
    }
    const start = performance.now();
    const outputs = await model.run([input]);
    const inferenceMs = performance.now() - start;
    const head = new Float32Array(outputs[loaded.headIndex]);
    if (head.length !== info.outputShape.reduce((a, b) => a * b, 1) || head.some((v) => !Number.isFinite(v))) {
      throw new Error('Probe output has an invalid size or nonfinite values');
    }
    const letterbox = letterboxOf(width, height, info.inputWidth, info.inputHeight);
    const detections = decode(head, info.outputShape, info.format, letterbox, info.labels, loaded.categories, threshold);
    return { info, threshold, inferenceMs, letterbox, detections, head: Array.from(head) };
  } finally {
    // Caller creates a dedicated interpreter; never dispose the live camera's model.
    model.dispose?.();
  }
}

import { decodeCandidates, letterboxOf } from '../src/perception/yoloDecoder';
import { coverRect, containRect } from '../src/ui/previewGeometry';
import { probeDetector } from '../src/perception/modelProbe';
import type { LoadedModel } from '../src/perception/modelLoader';
import { ObjectCategory } from '../src/perception/detection';

describe('upright model coordinates to preview', () => {
  test.each([[720, 1280, 393, 615], [720, 1280, 393, 759], [1280, 720, 759, 393], [1280, 720, 615, 393], [640, 640, 393, 615]])(
    '%i × %i frame maps into %i × %i preview without reflection', (w, h, vw, vh) => {
      const lb = letterboxOf(w, h, 640, 640);
      // Asymmetric vehicle location: a reflected or double-rotated box cannot pass.
      const box = [0.65, 0.2, 0.9, 0.35];
      const head = new Float32Array([
        lb.padX + box[0] * w * lb.scale, lb.padY + box[1] * h * lb.scale,
        lb.padX + box[2] * w * lb.scale, lb.padY + box[3] * h * lb.scale, 0.9, 0,
      ]);
      const [decoded] = decodeCandidates(head, [1, 1, 6], 'END_TO_END', lb, 0.35);
      expect(decoded.left).toBeCloseTo(box[0], 5);
      expect(decoded.top).toBeCloseTo(box[1], 5);
      expect(decoded.right).toBeCloseTo(box[2], 5);
      expect(decoded.bottom).toBeCloseTo(box[3], 5);
      const rect = coverRect(vw, vh, w / h);
      const scale = Math.max(vw / w, vh / h);
      expect(rect.x + decoded.left * rect.width).toBeCloseTo((vw - w * scale) / 2 + box[0] * w * scale, 3);
      expect(rect.y + decoded.top * rect.height).toBeCloseTo((vh - h * scale) / 2 + box[1] * h * scale, 3);
    },
  );
});

function fixture(output = new Float32Array([1, 0, 2, 1, 0.9, 0])) {
  const run = jest.fn(async (_inputs: ArrayBuffer[]) => [output.buffer]);
  const dispose = jest.fn();
  const loaded = {
    info: { inputWidth: 2, inputHeight: 2, format: 'END_TO_END', outputShape: [1, 1, 6], labels: ['car'] },
    model: { run, dispose }, headIndex: 0, categories: [ObjectCategory.CAR],
  } as unknown as LoadedModel;
  return { loaded, run, dispose };
}

describe('isolated phone model probe', () => {
  test('accepts unaligned file bytes, decodes output, and releases its interpreter', async () => {
    const { loaded, run, dispose } = fixture(new Float32Array([0.5, 0, 1, 0.5, 0.9, 0]));
    const storage = new Uint8Array(49);
    storage.set(new Uint8Array(new Float32Array(12).fill(0.5).buffer), 1);
    const result = await probeDetector(loaded, storage.subarray(1), 2, 2, 0.35);
    expect(new Float32Array(run.mock.calls[0]![0]![0])).toEqual(new Float32Array(12).fill(0.5));
    expect(result.detections[0]).toMatchObject({ category: 'CAR', box: { left: 0.5, top: 0, right: 1, bottom: 0.5 } });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  test.each(['size', 'nan', 'range', 'dimensions'])('rejects invalid %s before inference', async (kind) => {
    const { loaded, run, dispose } = fixture();
    const input = new Float32Array(kind === 'size' ? 1 : 12);
    if (kind === 'nan') input[0] = NaN;
    if (kind === 'range') input[0] = 255;
    await expect(probeDetector(loaded, new Uint8Array(input.buffer), kind === 'dimensions' ? 0 : 2, 2, 0.35)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  test('rejects invalid outputs and releases interpreter', async () => {
    const { loaded, dispose } = fixture(new Float32Array([NaN, 0, 1, 1, 0.9, 0]));
    await expect(probeDetector(loaded, new Uint8Array(48), 2, 2, 0.35)).rejects.toThrow('nonfinite');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

test.each([[720, 1280, 393, 200], [1280, 720, 393, 200], [720, 1280, 300, 175]])(
  'split panel fits the entire %i × %i frame within %i × %i and preserves asymmetric box alignment', (w, h, vw, vh) => {
    const rect = containRect(vw, vh, w / h);
    const scale = Math.min(vw / w, vh / h);
    expect(rect.width).toBeCloseTo(w * scale); expect(rect.height).toBeCloseTo(h * scale);
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(vw); expect(rect.y + rect.height).toBeLessThanOrEqual(vh);
    const lb = letterboxOf(w, h, 640, 640);
    const head = new Float32Array([lb.padX + 0.7 * w * lb.scale, lb.padY + 0.2 * h * lb.scale,
      lb.padX + 0.9 * w * lb.scale, lb.padY + 0.5 * h * lb.scale, 0.9, 0]);
    const [box] = decodeCandidates(head, [1, 1, 6], 'END_TO_END', lb, 0.35);
    expect(rect.x + box.left * rect.width).toBeCloseTo((vw - w * scale) / 2 + 0.7 * w * scale, 3);
    expect(rect.y + box.top * rect.height).toBeCloseTo((vh - h * scale) / 2 + 0.2 * h * scale, 3);
  },
);

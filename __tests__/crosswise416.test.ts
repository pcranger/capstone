import { ObjectCategory } from '../src/perception/detection';
import { categoryFor } from '../src/perception/labelMapper';
import { parseModelMetadata } from '../src/perception/modelMetadata';
import { decode, expectedAnchors, inferFormat, letterboxOf } from '../src/perception/yoloDecoder';

/**
 * CW-23: crosswise-416.tflite is the trained CrossWise detector re-exported at 416 px with a raw head
 * [1, 4 + 9, 3549] (no TopK / NMS ops, so the whole graph runs on the Android GPU).
 */
const fs = require('fs');
const MODEL = `${process.cwd()}/assets/models/crosswise-416.tflite`;
const CLASSES = ['ped_red', 'ped_green', 'crosswalk', 'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck'];

describe('crosswise-416 raw head', () => {
  const meta = parseModelMetadata(new Uint8Array(fs.readFileSync(MODEL)));
  const anchors = 3549;
  const channels = 4 + CLASSES.length;
  const categories = CLASSES.map(categoryFor);
  const letterbox = letterboxOf(1280, 720, 416, 416);

  test('the shipped file carries the 9 crosswise class names, 416 input and a raw (not end-to-end) head', () => {
    expect(meta).not.toBeNull();
    expect(meta!.names).toEqual(CLASSES);
    expect(meta!.imageSize).toEqual([416, 416]);
    expect(meta!.endToEnd).toBe(false);
  });

  test('anchor count and format for [1, 13, 3549]', () => {
    expect(expectedAnchors(416, 416)).toBe(anchors);
    expect(inferFormat([1, channels, anchors], 416, 416, CLASSES.length, false)).toBe('RAW_CHANNELS_FIRST');
    expect(inferFormat([1, channels, anchors], 416, 416, null, null)).toBe('RAW_CHANNELS_FIRST');
  });

  test('labels map to the right categories', () => {
    expect(categories).toEqual([
      ObjectCategory.PED_DONT_WALK,
      ObjectCategory.PED_WALK,
      ObjectCategory.CROSSWALK,
      ObjectCategory.PERSON,
      ObjectCategory.BICYCLE,
      ObjectCategory.CAR,
      ObjectCategory.MOTORCYCLE,
      ObjectCategory.BUS,
      ObjectCategory.TRUCK,
    ]);
  });

  test('decodes normalized boxes with the right labels and source coordinates', () => {
    const out = new Float32Array(channels * anchors);
    const put = (anchor: number, cx: number, cy: number, w: number, h: number, cls: number, score: number) => {
      out[0 * anchors + anchor] = cx;
      out[1 * anchors + anchor] = cy;
      out[2 * anchors + anchor] = w;
      out[3 * anchors + anchor] = h;
      out[(4 + cls) * anchors + anchor] = score;
    };
    put(1432, 0.5, 0.5, 0.1, 0.2, 5, 0.9); // car
    put(1433, 0.505, 0.5, 0.1, 0.2, 5, 0.5); // duplicate car, suppressed
    put(3000, 0.2, 0.5, 0.05, 0.05, 0, 0.7); // ped_red
    put(3100, 0.8, 0.5, 0.05, 0.05, 8, 0.6); // truck
    put(3200, 0.9, 0.9, 0.05, 0.05, 1, 0.1); // below the threshold

    const dets = decode(out, [1, channels, anchors], 'RAW_CHANNELS_FIRST', letterbox, meta!.names, categories, 0.35, 0.45);
    expect(dets.map((d) => d.label)).toEqual(['car', 'ped_red', 'truck']);
    expect(dets.map((d) => d.category)).toEqual([ObjectCategory.CAR, ObjectCategory.PED_DONT_WALK, ObjectCategory.TRUCK]);
    // Model box (187.2, 166.4)-(228.8, 249.6) px; the 1280x720 frame sits at scale 0.325 with padY 91.
    expect(dets[0].box.left).toBeCloseTo(0.45, 3);
    expect(dets[0].box.right).toBeCloseTo(0.55, 3);
    expect(dets[0].box.top).toBeCloseTo((166.4 - 91) / 0.325 / 720, 3);
    expect(dets[0].box.bottom).toBeCloseTo((249.6 - 91) / 0.325 / 720, 3);
  });
});

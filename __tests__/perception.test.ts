import { strToU8, zipSync } from 'fflate';
import { Angles, BoxF } from '../src/core/geometry';
import { ObjectCategory } from '../src/perception/detection';
import { categoryFor } from '../src/perception/labelMapper';
import { parseModelMetadata } from '../src/perception/modelMetadata';
import { classifySignalColor, paintLetterboxBars } from '../src/perception/pixels';
import { decode, inferFormat, letterboxOf } from '../src/perception/yoloDecoder';

describe('Geometry', () => {
  test('iou of identical and disjoint boxes', () => {
    const a = new BoxF(0.1, 0.1, 0.3, 0.3);
    expect(a.iou(a)).toBeCloseTo(1, 6);
    expect(a.iou(new BoxF(0.5, 0.5, 0.6, 0.6))).toBeCloseTo(0, 6);
  });

  test('iou of half overlap', () => {
    const a = new BoxF(0, 0, 0.2, 0.2);
    const b = new BoxF(0.1, 0, 0.3, 0.2);
    // intersection 0.02, union 0.06
    expect(a.iou(b)).toBeCloseTo(1 / 3, 5);
  });

  test('wrap angles', () => {
    expect(Angles.wrap180(370)).toBeCloseTo(10, 4);
    expect(Angles.wrap180(190)).toBeCloseTo(-170, 4);
    expect(Angles.wrap180(-180)).toBeCloseTo(180, 4);
    expect(Angles.wrap360(-10)).toBeCloseTo(350, 4);
  });

  test('bearing from image position', () => {
    expect(Angles.bearingFromImageX(0.5, 60)).toBeCloseTo(0, 4);
    expect(Angles.bearingFromImageX(1, 60)).toBeCloseTo(30, 3);
    expect(Angles.bearingFromImageX(0, 60)).toBeCloseTo(-30, 3);
    expect(Angles.elevationFromImageY(0, 45)).toBeCloseTo(22.5, 3);
  });
});

describe('LabelMapper', () => {
  const assertMaps = (expected: ObjectCategory, ...names: string[]) => {
    for (const n of names) expect([n, categoryFor(n)]).toEqual([n, expected]);
  };

  test('canonical names', () => {
    assertMaps(ObjectCategory.PED_DONT_WALK, 'ped_red');
    assertMaps(ObjectCategory.PED_WALK, 'ped_green');
    assertMaps(ObjectCategory.CROSSWALK, 'crosswalk');
    assertMaps(ObjectCategory.MOTORCYCLE, 'motorcycle', 'motorbike');
  });

  test('COCO names', () => {
    assertMaps(ObjectCategory.TRAFFIC_LIGHT, 'traffic light');
    assertMaps(ObjectCategory.PERSON, 'person');
    assertMaps(ObjectCategory.CAR, 'car');
    assertMaps(ObjectCategory.OTHER, 'handbag', 'stop sign', 'fire hydrant');
  });

  test('community dataset names', () => {
    assertMaps(
      ObjectCategory.PED_DONT_WALK,
      'red-pedestrian-light',
      'Red Pedestrian Traffic Light',
      'dont_walk',
      'red man',
    );
    assertMaps(ObjectCategory.PED_WALK, 'green-pedestrian-light', 'Green Pedestrian Traffic Light', 'walk', 'green man');
    assertMaps(ObjectCategory.CROSSWALK, 'zebra_crossing', 'Pedestrian Crossing', 'Zebra Cross');
    assertMaps(ObjectCategory.PERSON, 'pedestrian');
  });

  test('color without pedestrian hint is not trusted', () => {
    assertMaps(ObjectCategory.TRAFFIC_LIGHT, 'red light', 'green-light', 'traffic_signal');
  });
});

describe('ModelMetadata', () => {
  const json = JSON.stringify({
    description: 'Ultralytics YOLO26n model trained on crosswise.yaml',
    author: 'Ultralytics',
    names: { 0: 'ped_red', 1: 'ped_green', 2: 'crosswalk' },
    imgsz: [640, 640],
    end2end: true,
    task: 'detect',
    stride: 32,
  });

  function fakeModelWithZip(entries: Record<string, Uint8Array>, stored = false): Uint8Array {
    const prefix = new Uint8Array(4096).map((_, i) => (i * 31) & 0xff); // stands in for the flatbuffer
    const zip = zipSync(entries, { level: stored ? 0 : 6 });
    const out = new Uint8Array(prefix.length + zip.length);
    out.set(prefix, 0);
    out.set(zip, prefix.length);
    return out;
  }

  test('reads deflated Ultralytics metadata', () => {
    const meta = parseModelMetadata(fakeModelWithZip({ 'metadata.json': strToU8(json) }));
    expect(meta).not.toBeNull();
    expect(meta!.names).toEqual(['ped_red', 'ped_green', 'crosswalk']);
    expect(meta!.imageSize).toEqual([640, 640]);
    expect(meta!.endToEnd).toBe(true);
    expect(meta!.task).toBe('detect');
  });

  test('reads stored labels.txt', () => {
    const meta = parseModelMetadata(fakeModelWithZip({ 'labels.txt': strToU8('person\nbicycle\ncar\n') }, true));
    expect(meta!.names).toEqual(['person', 'bicycle', 'car']);
  });

  test('missing zip returns null', () => {
    expect(parseModelMetadata(new Uint8Array(1000).fill(7))).toBeNull();
  });
});

describe('YoloDecoder', () => {
  const labels = ['ped_red', 'ped_green', 'car'];
  const categories = labels.map(categoryFor);
  const letterbox = letterboxOf(1280, 720, 640, 640);

  test('letterbox geometry', () => {
    expect(letterbox.scale).toBeCloseTo(0.5, 6);
    expect(letterbox.padY).toBeCloseTo(140, 6);
    expect(letterbox.padX).toBeCloseTo(0, 6);
  });

  test('infer formats', () => {
    expect(inferFormat([1, 7, 8400], 640, 640, 3, null)).toBe('RAW_CHANNELS_FIRST');
    expect(inferFormat([1, 8400, 7], 640, 640, 3, null)).toBe('RAW_CHANNELS_LAST');
    expect(inferFormat([1, 300, 6], 640, 640, 3, null)).toBe('END_TO_END');
    expect(inferFormat([1, 300, 6], 640, 640, null, true)).toBe('END_TO_END');
    // Two classes -> 6 channels, but anchors match a raw head.
    expect(inferFormat([1, 8400, 6], 640, 640, 2, false)).toBe('RAW_CHANNELS_LAST');
    expect(inferFormat([1, 6, 2100], 320, 320, null, null)).toBe('RAW_CHANNELS_FIRST');
  });

  test('decodes normalized raw channels-first with NMS', () => {
    const anchors = 8400;
    const channels = 4 + labels.length;
    const out = new Float32Array(channels * anchors);
    const put = (anchor: number, cx: number, cy: number, w: number, h: number, cls: number, score: number) => {
      out[0 * anchors + anchor] = cx;
      out[1 * anchors + anchor] = cy;
      out[2 * anchors + anchor] = w;
      out[3 * anchors + anchor] = h;
      out[(4 + cls) * anchors + anchor] = score;
    };
    put(100, 0.5, 0.5, 0.1, 0.2, 1, 0.9);
    put(101, 0.505, 0.5, 0.1, 0.2, 1, 0.6); // duplicate, suppressed
    put(200, 0.2, 0.5, 0.1, 0.1, 2, 0.5);
    put(300, 0.8, 0.5, 0.1, 0.1, 0, 0.1); // below threshold

    const dets = decode(out, [1, channels, anchors], 'RAW_CHANNELS_FIRST', letterbox, labels, categories, 0.3);
    expect(dets).toHaveLength(2);
    const walk = dets[0];
    expect(walk.category).toBe(ObjectCategory.PED_WALK);
    expect(walk.score).toBeCloseTo(0.9, 6);
    // Model box (288,256)-(352,384) px -> source normalized.
    expect(walk.box.left).toBeCloseTo(0.45, 3);
    expect(walk.box.right).toBeCloseTo(0.55, 3);
    expect(walk.box.top).toBeCloseTo((256 - 140) / 0.5 / 720, 3);
    expect(walk.box.bottom).toBeCloseTo((384 - 140) / 0.5 / 720, 3);
    expect(dets[1].category).toBe(ObjectCategory.CAR);
  });

  test('decodes raw channels-last the same way', () => {
    const anchors = 8400;
    const channels = 4 + labels.length;
    const out = new Float32Array(channels * anchors);
    const base = 100 * channels;
    out.set([0.5, 0.5, 0.1, 0.2, 0, 0.9, 0], base);
    const dets = decode(out, [1, anchors, channels], 'RAW_CHANNELS_LAST', letterbox, labels, categories, 0.3);
    expect(dets).toHaveLength(1);
    expect(dets[0].category).toBe(ObjectCategory.PED_WALK);
    expect(dets[0].box.left).toBeCloseTo(0.45, 3);
  });

  test('decodes pixel end-to-end', () => {
    const rows = 300;
    const out = new Float32Array(rows * 6);
    out.set([288, 256, 352, 384, 0.9, 1], 0);
    out.set([10, 10, 20, 20, 0.2, 0], 6);
    const dets = decode(out, [1, rows, 6], 'END_TO_END', letterbox, labels, categories, 0.3);
    expect(dets).toHaveLength(1);
    expect(dets[0].category).toBe(ObjectCategory.PED_WALK);
    expect(dets[0].box.left).toBeCloseTo(0.45, 3);
  });

  test('decodes normalized end-to-end', () => {
    const out = new Float32Array(300 * 6);
    out.set([288 / 640, 256 / 640, 352 / 640, 384 / 640, 0.8, 2], 0);
    const dets = decode(out, [1, 300, 6], 'END_TO_END', letterbox, labels, categories, 0.3);
    expect(dets).toHaveLength(1);
    expect(dets[0].category).toBe(ObjectCategory.CAR);
    expect(dets[0].box.right).toBeCloseTo(0.55, 3);
  });
});

describe('Pixels', () => {
  test('color heuristic decision rule', () => {
    expect(classifySignalColor(20, 1, 100)).toBe('RED');
    expect(classifySignalColor(0, 12, 100)).toBe('GREEN');
    expect(classifySignalColor(10, 8, 100)).toBeNull();
    expect(classifySignalColor(2, 0, 100)).toBeNull();
  });

  test('letterbox bars are repainted gray, content untouched (planar, portrait frame)', () => {
    const w = 64;
    const h = 64;
    const input = new Float32Array(3 * w * h); // black bars + black content
    input.fill(0.5, 0, w * h); // pretend R is 0.5 everywhere
    const lb = letterboxOf(36, 64, w, h); // 9:16 upright frame -> content 36 px wide, bars of 14 px
    paintLetterboxBars(input, w, h, true, lb);
    const gray = 114 / 255;
    expect(input[0]).toBeCloseTo(gray, 5); // top-left, left bar, R plane
    expect(input[13]).toBeCloseTo(gray, 5);
    expect(input[14]).toBeCloseTo(0.5, 5); // first content column
    expect(input[49]).toBeCloseTo(0.5, 5); // last content column
    expect(input[50]).toBeCloseTo(gray, 5);
    expect(input[w * h + 14]).toBeCloseTo(0, 5); // G plane content stays black
    expect(input[w * h + 2]).toBeCloseTo(gray, 5); // G plane bar
  });
});

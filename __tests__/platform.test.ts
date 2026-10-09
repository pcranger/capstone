import { Priority, ToneKind, Verbosity } from '../src/feedback/cue';
import { renderTone } from '../src/feedback/toneSynth';
import { decodePolyline } from '../src/nav/navigation';
import { paintSegMask, segPostProcess } from '../src/perception/segmentation';
import { AppFont, DEFAULT_SETTINGS, mergeSettings } from '../src/settings/settings';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));

describe('Tone synthesis', () => {
  test('earcons have the Android lengths and pan with equal power', () => {
    const [l, r] = renderTone(ToneKind.SONAR, 0, 44_100);
    // 35 ms note + 25 ms gap
    expect(l.length).toBe(Math.trunc((60 * 44_100) / 1000));
    expect(r.length).toBe(l.length);
    const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(l)).toBeCloseTo(peak(r), 5);

    const [left, right] = renderTone(ToneKind.ALERT, 1, 44_100);
    expect(peak(left)).toBeLessThan(1e-6); // fully right: nothing in the left ear
    expect(peak(right)).toBeGreaterThan(0.8);
    expect(peak(right)).toBeLessThanOrEqual(0.85 + 1e-6);
  });
});

describe('Settings file merge', () => {
  test('legacy API keys cannot override build configuration', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { geminiApiKey: 'abc123' });
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });

  test('wrong types and unknown enum values are ignored', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      speech: 'yes',
      speechRate: 1.4,
      verbosity: 'LOUD',
      appFont: 'HYPERLEGIBLE',
      acceptedSafetyNotice: true,
    });
    expect(merged.speech).toBe(true);
    expect(merged.speechRate).toBe(1.4);
    expect(merged.verbosity).toBe(Verbosity.NORMAL);
    expect(merged.appFont).toBe(AppFont.HYPERLEGIBLE);
    // The safety notice is never taken from the file.
    expect(merged.acceptedSafetyNotice).toBe(false);
  });

  test('a blank or null model path means the bundled model', () => {
    expect(mergeSettings({ ...DEFAULT_SETTINGS, customModelPath: 'documents:x.tflite' }, { customModelPath: null })
      .customModelPath).toBeNull();
    expect(mergeSettings(DEFAULT_SETTINGS, { customModelPath: '  ' }).customModelPath).toBeNull();
  });
});

describe('Navigation', () => {
  test('decodes Google polylines', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0].latitude).toBeCloseTo(38.5, 5);
    expect(points[0].longitude).toBeCloseTo(-120.2, 5);
    expect(points[2].latitude).toBeCloseTo(43.252, 5);
    expect(points[2].longitude).toBeCloseTo(-126.453, 5);
  });


});

describe('Segmentation', () => {
  test('post-processes a [1, 4+nc+32, anchors] head and paints a premultiplied mask', () => {
    const classes = 16;
    const features = 4 + classes + 32;
    const anchors = 10;
    const head = new Float32Array(features * anchors);
    const put = (f: number, a: number, v: number) => {
      head[f * anchors + a] = v;
    };
    // One "Road" region covering the lower half, with a strongly positive first mask coefficient.
    put(0, 3, 0.5);
    put(1, 3, 0.75);
    put(2, 3, 1.0);
    put(3, 3, 0.5);
    put(4 + 0, 3, 0.9);
    put(4 + classes + 0, 3, 5);
    const found = segPostProcess(head, features, anchors, 0.35, 0.5);
    expect(found).toHaveLength(1);
    expect(found[0].classIndex).toBe(0);

    const w = 4;
    const h = 4;
    const protos = new Float32Array(w * h * 32);
    for (let i = 0; i < w * h; i++) protos[i * 32] = 1; // coefficient 0 lights every cell
    const mask = paintSegMask(found, protos, w, h, [[144, 19, 254]]);
    // Top half is outside the box, bottom half is painted.
    expect(mask[3]).toBe(0);
    const o = (3 * w + 1) * 4;
    expect(mask[o + 3]).toBe(120);
    expect(mask[o]).toBe(Math.round((144 * 120) / 255));
  });
});

describe('Speaker policy', () => {
  // Imported after the mock above is in place.
  const Speech = require('expo-speech') as { speak: jest.Mock; stop: jest.Mock };
  const { Speaker } = require('../src/feedback/speaker') as typeof import('../src/feedback/speaker');

  beforeEach(() => {
    Speech.speak.mockClear();
    Speech.stop.mockClear();
  });

  test('route handoffs clear routine narration but cannot cut off a vehicle warning', () => {
    const s = new Speaker();
    s.speak('Head north.', Priority.NORMAL, false);
    s.stopRoutine(); expect(Speech.stop).toHaveBeenCalledTimes(1);
    s.speak('Vehicle very close.', Priority.CRITICAL, true);
    s.stopRoutine(); expect(Speech.stop).toHaveBeenCalledTimes(1);
    s.speak('Next instruction.', Priority.NORMAL, false);
    expect(Speech.speak).toHaveBeenCalledTimes(2);
  });

  test('urgent speech interrupts, stale low-priority speech is dropped', () => {
    const s = new Speaker();
    s.speak('Signal lost.', Priority.NORMAL, false);
    expect(Speech.speak).toHaveBeenCalledTimes(1);
    expect(Speech.stop).not.toHaveBeenCalled();

    // LOW while busy: dropped.
    s.speak('Scan slowly.', Priority.LOW, false);
    expect(Speech.speak).toHaveBeenCalledTimes(1);

    // HIGH with interrupt: flushes what is playing.
    s.speak('Vehicle approaching, left.', Priority.HIGH, true);
    expect(Speech.stop).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenCalledTimes(2);

    // NORMAL behind urgent speech: dropped, it would be stale.
    s.speak('Bear left.', Priority.NORMAL, false);
    expect(Speech.speak).toHaveBeenCalledTimes(2);

    // Once the urgent message finishes, NORMAL speech plays again.
    const options = Speech.speak.mock.calls[1][1] as { onDone: () => void };
    options.onDone();
    s.speak('Bear left.', Priority.NORMAL, false);
    expect(Speech.speak).toHaveBeenCalledTimes(3);
  });
});

import { CrossingEngine, UserCommand } from '../src/crossing/crossingEngine';
import type { GrayFrame } from '../src/tracking/vehicleMotion';
import { BoxF } from '../src/core/geometry';
import { ObjectCategory, type Detection } from '../src/perception/detection';
import { Phrase } from '../src/feedback/cue';
import { det, frame } from './fixtures';

// CW-14: two false alarms. Real VehicleMotion + real CrossingEngine + real optical flow; nothing is mocked.
const W = 192, H = 108;
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function smooth(w: number, h: number, seed: number): Float32Array {
  const r = rng(seed); const a = new Float32Array(w * h).map(() => r() * 255);
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += a[yy * w + xx]; n++; } }
    b[y * w + x] = s / n;
  }
  return b;
}
const bg = smooth(W, H, 11), tex = smooth(120, 80, 5);
const bil = (t: Float32Array, tw: number, th: number, u: number, v: number) => {
  u = Math.min(tw - 1.001, Math.max(0, u)); v = Math.min(th - 1.001, Math.max(0, v));
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  return t[y0 * tw + x0] * (1 - fx) * (1 - fy) + t[y0 * tw + x0 + 1] * fx * (1 - fy) + t[(y0 + 1) * tw + x0] * (1 - fx) * fy + t[(y0 + 1) * tw + x0 + 1] * fx * fy;
};
interface Car { cx: number; cy: number; s: number; flat?: boolean; /** scale of the detection box only (the picture stays put) */ boxS?: number }
function scene(cars: Car[]): { img: GrayFrame; boxes: BoxF[] } {
  const px = new Array<number>(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = Math.round(bil(bg, W, H, x, y));
  const boxes: BoxF[] = [];
  for (const { cx, cy, s, flat, boxS } of cars) {
    const hw = 30 * s, hh = 20 * s;
    for (let y = Math.floor(cy - hh); y < cy + hh; y++) for (let x = Math.floor(cx - hw); x < cx + hw; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      px[y * W + x] = flat ? 128 : Math.round(bil(tex, 120, 80, (x - cx) / s + 60, (y - cy) / s + 40));
    }
    const bw = 30 * (boxS ?? s), bh = 20 * (boxS ?? s);
    boxes.push(new BoxF((cx - bw) / W, (cy - bh) / H, (cx + bw) / W, (cy + bh) / H));
  }
  return { img: { width: W, height: H, pixels: px }, boxes };
}

type Spoken = { frame: number; phrase: Phrase };
/** Run frames of 100 ms; makeCars(i) gives the cars of frame i. Returns every phrase spoken. */
function run(n: number, walking: boolean, makeCars: (i: number) => Car[]): Spoken[] {
  const engine = new CrossingEngine();
  engine.command(UserCommand.START_ASSIST, 0);
  const spoken: Spoken[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 100, { img, boxes } = scene(makeCars(i));
    engine.onSensors(t, { timestampMs: t, headingDeg: 0, pitchDeg: 0 }, walking);
    const dets: Detection[] = boxes.map(b => det(ObjectCategory.CAR, b));
    const out = engine.onFrame({ ...frame(t, ...dets), motionImage: img, brightness: 0.7 }, { hfovDeg: 60, vfovDeg: 90 });
    for (const c of out.cues) if (c.kind === 'speak') spoken.push({ frame: i, phrase: c.phrase });
    if (process.env.CW14_DEBUG) console.info(i, JSON.stringify(out.snapshot.hazards.map(h => [h.level, h.approaching, h.uncertain, h.ttcSeconds])), JSON.stringify(out.snapshot.tracks.map(x => [x.id, x.motion, x.motionSupported, +x.box.height.toFixed(3)])));
  }
  return spoken;
}
const dump = (label: string, s: Spoken[]) => console.info(label, JSON.stringify(s.map(x => `${x.frame}:${x.phrase}`)));
const detected = (s: Spoken[]) => s.filter(x => x.phrase === Phrase.VEHICLE_DETECTED);
const urgentPhrases = (s: Spoken[]) => s.filter(x => x.phrase !== Phrase.VEHICLE_DETECTED);

describe('bug 1: a car standing at the line is not announced again and again', () => {
  // A flat (feature-less) car stays "unsure": fewer than 3 usable feature points, as the red car in clip 04.
  const standing: Car = { cx: 60, cy: 60, s: 1, flat: true };

  test('standing unsure car: "Vehicle detected" at most once in 8 s, nothing else', () => {
    const spoken = run(80, false, () => [standing]);
    dump('standing', spoken);
    expect(detected(spoken).length).toBeLessThanOrEqual(1);
    expect(urgentPhrases(spoken)).toEqual([]);
  });

  test('a moving car that arrives after 5 s is still announced within 0.5 s', () => {
    const spoken = run(80, false, i => {
      const cars = [standing];
      if (i >= 50) cars.push({ cx: 100 + (i - 50) * 2, cy: 85, s: 0.8 });
      return cars;
    });
    dump('standing+arrival', spoken);
    expect(spoken.some(x => x.frame >= 50 && x.frame <= 55)).toBe(true);
  });
});

describe('bug 2: box growth that lasts a fraction of a second is not an approaching car', () => {
  // Static car; only the detection box jumps bigger for two frames (handheld sway / walking jolt), then returns.
  const spike = (i: number): Car[] => [{ cx: 96, cy: 55, s: 1, boxS: i === 4 ? 1.25 : i === 5 ? 1.55 : 1 }];

  test('standing phone: a 2-frame spike gives no approaching or "Caution" phrase', () => {
    const spoken = run(24, false, spike);
    dump('spike standing', spoken);
    expect(urgentPhrases(spoken)).toEqual([]);
  });

  test('walking phone: a 2-frame spike gives no approaching or "Caution" phrase', () => {
    const spoken = run(24, true, spike);
    dump('spike walking', spoken);
    expect(urgentPhrases(spoken)).toEqual([]);
  });
});

describe('guard: a car that really closes in is still warned', () => {
  // Constant closing speed: size ~ 1/(time to contact), contact at 1.67 s (same as approachingVehicle.test.ts).
  const TTC0 = 1 / 0.6;
  const closing = (i: number): Car[] => [{ cx: 96, cy: 55, s: TTC0 / (TTC0 - i / 10) }];

  test('standing phone: closing car gets VEHICLE_AHEAD or CLOSE_AHEAD within 0.7 s of the first usable estimate', () => {
    const spoken = run(10, false, closing);
    dump('closing standing', spoken);
    const first = spoken.find(x => x.phrase === Phrase.VEHICLE_AHEAD || x.phrase === Phrase.VEHICLE_CLOSE_AHEAD);
    expect(first).toBeDefined();
    expect(first!.frame).toBeLessThanOrEqual(7);
  });

  test('walking phone: closing car gets "Caution" within 0.7 s of the first usable estimate', () => {
    const spoken = run(10, true, closing);
    dump('closing walking', spoken);
    const first = spoken.find(x => x.phrase === Phrase.VEHICLE_CLOSE_AHEAD);
    expect(first).toBeDefined();
    expect(first!.frame).toBeLessThanOrEqual(7);
  });

  test('steady 6% growth for 3.8 s keeps getting a warning at the 3 s repeat, walking or not', () => {
    for (const walking of [false, true]) {
      const spoken = run(40, walking, i => [{ cx: 96, cy: 55, s: 0.3 * Math.pow(1.06, i) }]);
      dump(`steady growth walking=${walking}`, spoken);
      expect(spoken.filter(x => x.frame >= 5).length).toBeGreaterThan(0);
    }
  });
});

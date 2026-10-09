import { CrossingEngine, UserCommand } from '../src/crossing/crossingEngine';
import type { GrayFrame } from '../src/tracking/vehicleMotion';
import { BoxF } from '../src/core/geometry';
import { ObjectCategory } from '../src/perception/detection';
import { Phrase } from '../src/feedback/cue';
import { det, frame } from './fixtures';

// Real VehicleMotion + real CrossingEngine + real optical flow: nothing is mocked in this file.
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
/** Textured car box centred (cx,cy), texture scaled by s about the centre, over a static textured background. */
function scene(cx: number, cy: number, s: number): { img: GrayFrame; box: BoxF } {
  const px = new Array<number>(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = Math.round(bil(bg, W, H, x, y));
  const hw = 30 * s, hh = 20 * s;
  for (let y = Math.floor(cy - hh); y < cy + hh; y++) for (let x = Math.floor(cx - hw); x < cx + hw; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    px[y * W + x] = Math.round(bil(tex, 120, 80, (x - cx) / s + 60, (y - cy) / s + 40));
  }
  return { img: { width: W, height: H, pixels: px }, box: new BoxF((cx - hw) / W, (cy - hh) / H, (cx + hw) / W, (cy + hh) / H) };
}

// Constant closing speed: size ~ 1/(time to contact), so growth starts at ~6% per 100 ms and speeds up (contact at 1.67 s).
const TTC0 = 1 / 0.6;
test('a car driving straight at the phone keeps its hazard and gets an ahead warning', () => {
  const engine = new CrossingEngine();
  engine.command(UserCommand.START_ASSIST, 0);
  const perFrame: string[] = [];
  const phrases: Phrase[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i * 100, { img, box } = scene(96, 55, TTC0 / (TTC0 - i / 10));
    engine.onSensors(t, { timestampMs: t, headingDeg: 0, pitchDeg: 0 }, false);
    const out = engine.onFrame({ ...frame(t, det(ObjectCategory.CAR, box)), motionImage: img, brightness: 0.7 }, { hfovDeg: 60, vfovDeg: 90 });
    const id = out.snapshot.tracks[0]?.id;
    const hazards = out.snapshot.hazards.filter(h => h.trackId === id).length;
    perFrame.push(`f${i}:hazards=${hazards}`);
    if (i >= 4) {
      expect({ frame: i, hazards: hazards > 0 }).toEqual({ frame: i, hazards: true });
      for (const c of out.cues) if (c.kind === 'speak') phrases.push(c.phrase);
    }
  }
  console.info(perFrame.join(' '), 'spoken frames 4-9:', JSON.stringify(phrases));
  expect(phrases.some(p => p === Phrase.VEHICLE_AHEAD || p === Phrase.VEHICLE_CLOSE_AHEAD)).toBe(true);
});

/**
 * Video replay: feeds the frames written by scripts/replay/extract.py through the REAL engine
 * (tracker, VehicleMotion, crossing check, hazard cues) and writes <json>.timeline.txt.
 *
 *   REPLAY_JSON=<a>.json[,<b>.json...] (or a folder ending in /) npx jest -c scripts/replay/jest.config.js
 *
 * Optional: REPLAY_FIXED=1 keeps the heading fixed for the whole video (the check then never gets its left/right looks).
 * By default the heading is fixed at 0 (camera on the road) except during the scripted look turns of each check, and
 * the same video frames keep playing during those turns (the video cannot show what a real left or right look would).
 */
import { AssistMode, CrossingEngine, UserCommand } from '../../src/crossing/crossingEngine';
import { BoxF } from '../../src/core/geometry';
import type { Detection, FrameDetections } from '../../src/perception/detection';
import { isVehicle } from '../../src/perception/detection';
import { categoryFor } from '../../src/perception/labelMapper';
import { LowLightMonitor, TOO_DARK_BELOW } from '../../src/crossing/lowLightMonitor';
import { Priority } from '../../src/feedback/cue';
import { cueText } from '../../src/strings';
import { T } from '../../src/text/safetyText';
import { V } from '../../src/voice/speechCatalog';

// The project has no Node type definitions (and tsconfig stays as is), so describe the two calls we need.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync(p: string, enc: string): string; writeFileSync(p: string, data: string): void; readdirSync(p: string): string[] };

interface ReplayFrame {
  t_ms: number; frameWidth: number; frameHeight: number; brightness: number;
  motionWidth: number; motionHeight: number; flowFromMs: number | null;
  boxes: { cls: number; label: string; score: number; box: [number, number, number, number] }[];
  flow: { x: number; y: number; dx: number; dy: number }[];
}

const GEOMETRY = { hfovDeg: 65, vfovDeg: 50 }; // a landscape phone camera; only used for bearings
const SENSOR_STEP_MS = 100;
/** Same look sequence the engine tests use (__tests__/crossingCheckEngine.test.ts fullCheck): steady, right, back, left, back. */
const LOOKS: [number, number][] = [[1400, 0], [200, 90], [5200, 90], [300, 0], [200, -90], [5200, -90], [300, 0]];
const LOOK_TOTAL = LOOKS.reduce((s, [ms]) => s + ms, 0);
const CYCLE_GAP_MS = 2500;

function headingAt(sinceStartMs: number): number {
  let t = sinceStartMs;
  for (const [ms, deg] of LOOKS) {
    if (t < ms) return deg;
    t -= ms;
  }
  return 0;
}

const given = (process.env.REPLAY_JSON ?? '').split(',').filter(Boolean);
// a value ending in / means every .json in that folder
const jsonPaths = given.flatMap((p: string) => (p.endsWith('/') ? fs.readdirSync(p).filter((f: string) => f.endsWith('.json')).map((f: string) => p + f) : [p]));
(jsonPaths.length ? describe : describe.skip)('replay', () => jsonPaths.forEach((jsonPath: string) => test(`timeline ${jsonPath}`, () => {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { video: string; fps: number; frames: ReplayFrame[] };
  const fixed = process.env.REPLAY_FIXED === '1';
  const engine = new CrossingEngine();
  const lines: string[] = [
    `# replay of ${data.video}`,
    `# ${data.frames.length} frames at ${data.fps} fps; real tracker + VehicleMotion + crossing engine; heading ${fixed ? 'fixed at 0' : 'fixed at 0 except scripted check looks'}`,
    '# motion words: moving / stationary / unknown (unknown = VehicleMotion says not enough support to call it)',
    '',
  ];
  const fmt = (ms: number) => (ms / 1000).toFixed(1).padStart(5) + 's';
  const spoken: string[] = [];
  // The controller's 10 Hz availability check, replayed with the same classes and numbers (controller.ts checkTrafficAvailability):
  // smoothed brightness, 3 s start-up guard, "too dark" below TOO_DARK_BELOW, otherwise the low-light monitor.
  // "Busy" is approximated as: any other line was spoken in the last 2 s.
  const monitor = new LowLightMonitor();
  let ema = 0.5, nowT = 0, lastSpeechMs = -Infinity, wasDark = false;
  const fired: number[] = [];
  let firstDark: number | null = null;
  const availability = (t: number) => {
    nowT = t;
    if (t < 3000) return;
    const dark = ema < TOO_DARK_BELOW;
    if (dark !== wasDark) {
      wasDark = dark;
      if (dark) { firstDark ??= t; spoken.push(`[!] "${V.cameraBlocked}"  (too dark: the old message)`); }
    }
    if (dark) { monitor.due(t, 0); return; }
    if (!monitor.due(t, ema) || t - lastSpeechMs < 2000) return;
    monitor.spoke(t);
    fired.push(t);
    lastSpeechMs = t;
    spoken.push(`[LOW LIGHT] "${T.lowLight}"`);
  };
  const collect = (cues: Parameters<typeof cueText>[0][]) => {
    for (const c of cues) {
      const text = cueText(c);
      if (text) { lastSpeechMs = nowT; spoken.push(`${(c as { priority?: Priority }).priority === Priority.CRITICAL ? '[!] ' : ''}"${text}"`); }
    }
  };

  let sensorT = 0;
  let cycleStart: number | null = fixed ? null : 0;
  let nextCycleAt = Infinity;
  let lastToken = -1;
  const heading = (t: number) => (cycleStart === null ? 0 : headingAt(t - cycleStart));
  const sensors = (until: number) => {
    while (sensorT + SENSOR_STEP_MS <= until) {
      sensorT += SENSOR_STEP_MS;
      nowT = sensorT;
      collect(engine.onSensors(sensorT, { timestampMs: sensorT, headingDeg: heading(sensorT), pitchDeg: 5 }, false).cues);
      const s = engine.scanInstruction;
      availability(sensorT);
      if (s && s.token !== lastToken) { lastToken = s.token; spoken.push(`(prompt) "${s.text}"`); }
      if (cycleStart !== null && sensorT - cycleStart >= LOOK_TOTAL && nextCycleAt === Infinity) nextCycleAt = sensorT + CYCLE_GAP_MS;
    }
  };

  collect(engine.command(UserCommand.START_ASSIST, 0).cues);
  lines.push(`${fmt(0)}  START_ASSIST`, ...spoken.splice(0).map((s) => `        say ${s}`));
  let prevT = 0;
  for (const f of data.frames) {
    sensors(f.t_ms);
    if (nextCycleAt <= f.t_ms) { // result has been standing a while: ask for a fresh check
      const result = engine.snapshot.check;
      lines.push(`${fmt(f.t_ms)}  CHECK_AGAIN (previous check ended: ${result?.summary ?? result?.stage}; Cross allowed ${engine.canCross(f.t_ms) ? 'yes' : 'no'})`);
      collect(engine.command(UserCommand.CHECK_AGAIN, f.t_ms).cues);
      cycleStart = f.t_ms; nextCycleAt = Infinity;
    }
    const detections: Detection[] = f.boxes.map((b) => ({
      box: new BoxF(...b.box), classIndex: b.cls, label: b.label, score: b.score, category: categoryFor(b.label), colorHint: null,
    }));
    const frame: FrameDetections = {
      timestampMs: f.t_ms, detections, frameWidth: f.frameWidth, frameHeight: f.frameHeight, inferenceMs: 0, brightness: f.brightness,
      motionImage: { width: f.motionWidth, height: f.motionHeight, pixels: [], flow: f.flow, sourceWallMs: f.t_ms,
        flowFromWallMs: f.flowFromMs ?? undefined },
    };
    ema = 0.8 * ema + 0.2 * f.brightness;
    nowT = f.t_ms;
    const out = engine.onFrame(frame, GEOMETRY);
    collect(out.cues);
    const cars = out.snapshot.tracks.filter((t) => isVehicle(t.category)).map((t) => {
      const word = !t.motionSupported ? 'unknown' : t.motion === 'MOVING' ? 'moving' : 'stationary';
      const dir = word === 'moving' && t.direction && t.direction !== 'UNKNOWN' ? (t.direction === 'LEFT_TO_RIGHT' ? ' L>R' : ' R>L') : '';
      return `#${t.id} ${t.category.toLowerCase()}@${t.box.centerX.toFixed(2)},${t.box.centerY.toFixed(2)} ${word}${dir}`;
    });
    const check = out.snapshot.check;
    const mode = out.snapshot.mode === AssistMode.IDLE ? 'IDLE' : `${out.snapshot.mode}${check ? '/' + check.stage + (check.summary ? ':' + check.summary : '') : ''}`;
    lines.push(`${fmt(f.t_ms)}  ${mode.padEnd(28)} cross=${engine.canCross(f.t_ms) ? 'YES' : 'no '}  cars[${cars.length}]: ${cars.join(' | ') || '-'}`);
    for (const s of spoken.splice(0)) lines.push(`        say ${s}`);
    prevT = f.t_ms;
  }
  expect(prevT).toBeGreaterThan(0);
  const sorted = data.frames.map((f) => f.brightness).sort((a, b) => a - b);
  const q = (x: number) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))].toFixed(3);
  const name = jsonPath.replace(/\.json$/, '').split('/').pop();
  fs.writeFileSync(jsonPath.replace(/\.json$/, '.lowlight.txt'), [name, q(0.5), q(0.1), q(0.9),
    fired.length ? 'yes' : 'no', fired.length ? (fired[0] / 1000).toFixed(1) + 's' : '-', fired.length,
    firstDark === null ? '-' : (firstDark / 1000).toFixed(1) + 's'].join('\t') + '\n');
  fs.writeFileSync(jsonPath.replace(/\.json$/, '.timeline.txt'), lines.join('\n') + '\n');
})));

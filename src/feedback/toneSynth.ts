import { ToneKind } from './cue';
import { TONE_GAIN, URGENT_TONE_GAIN } from './audioPolicy';

interface Note {
  frequencyHz: number;
  durationMs: number;
  gapMs: number;
}

const note = (frequencyHz: number, durationMs: number, gapMs = 25): Note => ({ frequencyHz, durationMs, gapMs });
const repeat = (n: number, notes: Note[]): Note[] => Array.from({ length: n }, () => notes).flat();

/** The earcon vocabulary, note for note the same as the Android TonePlayer. Returns notes and gain. */
export function notesFor(kind: ToneKind): [Note[], number] {
  switch (kind) {
    case ToneKind.LISTENING:
      return [[note(1100, 45, 40), note(1100, 45)], TONE_GAIN];
    case ToneKind.SONAR:
      return [[note(1400, 35)], TONE_GAIN];
    case ToneKind.CENTERED:
      return [[note(1760, 60), note(2349, 90)], TONE_GAIN];
    case ToneKind.WALK_CHIME:
      return [[note(880, 90), note(1175, 90), note(1568, 160)], TONE_GAIN];
    case ToneKind.STOP:
      return [[note(440, 260)], TONE_GAIN];
    case ToneKind.ALERT:
      return [repeat(3, [note(2000, 70, 10), note(1500, 70, 10)]), URGENT_TONE_GAIN];
    case ToneKind.CRITICAL:
      return [repeat(5, [note(2500, 55, 5), note(1800, 55, 5)]), URGENT_TONE_GAIN];
    case ToneKind.VEER:
      return [[note(660, 120)], TONE_GAIN];
    case ToneKind.LOST:
      return [[note(700, 100), note(500, 140)], TONE_GAIN];
  }
}

/**
 * Synthesizes one stereo earcon: sine notes with 5 ms fades, equal-power panned, so with headphones the cue
 * appears to come from the side the user should attend to. Values are floats in -1..1.
 */
export function renderTone(
  kind: ToneKind,
  pan: number,
  sampleRate: number,
  volume = 1,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const [notes, gain] = notesFor(kind);
  const angle = ((Math.min(Math.max(pan, -1), 1) + 1) * Math.PI) / 4;
  const left = Math.cos(angle) * gain * volume;
  const right = Math.sin(angle) * gain * volume;
  const frames = (ms: number) => Math.trunc((ms * sampleRate) / 1000);
  const total = notes.reduce((acc, n) => acc + frames(n.durationMs + n.gapMs), 0);
  const l = new Float32Array(total);
  const r = new Float32Array(total);
  let frame = 0;
  for (const n of notes) {
    const count = frames(n.durationMs);
    const fade = Math.min(Math.trunc(count / 2), frames(5));
    for (let i = 0; i < count; i++) {
      const envelope = i < fade ? i / fade : i > count - fade ? (count - i) / fade : 1;
      const s = Math.sin((2 * Math.PI * n.frequencyHz * i) / sampleRate) * envelope;
      l[frame] = s * left;
      r[frame] = s * right;
      frame++;
    }
    frame += frames(n.gapMs);
  }
  return [l, r];
}

import { IOS_AUDIO_SESSION, TONE_GAIN } from '../src/feedback/audioPolicy';
import { notesFor, renderTone } from '../src/feedback/toneSynth';
import { ToneKind } from '../src/feedback/cue';

test('urgent sounds use the same level as ordinary sounds and panning preserves power', () => {
  for (const kind of Object.values(ToneKind)) {
    expect(notesFor(kind)[1]).toBe(TONE_GAIN);
    const power = (pan: number) => {
      const [l, r] = renderTone(kind, pan, 48000);
      return l.reduce((sum, value, i) => sum + value * value + r[i] * r[i], 0);
    };
    expect(power(-1)).toBeCloseTo(power(0), 3);
    expect(power(1)).toBeCloseTo(power(0), 3);
  }
});

test('speech and recognition policy avoids ducking and measurement-mode output changes', () => {
  expect(IOS_AUDIO_SESSION.category).toBe('playAndRecord');
  expect(IOS_AUDIO_SESSION.mode).toBe('default');
  expect(IOS_AUDIO_SESSION.categoryOptions).not.toContain('duckOthers');
});

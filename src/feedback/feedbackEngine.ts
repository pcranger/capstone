import { AudioManager } from 'react-native-audio-api';
import { type Cue, Priority } from './cue';
import { Haptics } from './haptics';
import { Speaker } from './speaker';
import { TonePlayer } from './tonePlayer';
import { cueText } from '../strings';

export interface FeedbackConfig {
  speech: boolean;
  tones: boolean;
  haptics: boolean;
  speechRate: number;
}

export const DEFAULT_FEEDBACK: FeedbackConfig = { speech: true, tones: true, haptics: true, speechRate: 1.0 };

/** Plays engine cues through speech, tones and vibration according to the user's preferences. */
export class FeedbackEngine {
  private readonly speaker = new Speaker();
  private readonly tones = new TonePlayer();
  private _config: FeedbackConfig = DEFAULT_FEEDBACK;

  constructor() {
    try {
      // Playback, not ambient: a blind traveler must hear the app even with the silent switch on. Other audio
      // (a podcast, music) keeps playing, ducked under the cues.
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playback',
        iosMode: 'default',
        iosOptions: ['mixWithOthers', 'duckOthers'],
        iosAllowHaptics: true,
      });
      AudioManager.setAudioSessionActivity(true).catch(() => undefined);
    } catch {
      // Not available outside a native build.
    }
  }

  get config(): FeedbackConfig {
    return this._config;
  }

  set config(value: FeedbackConfig) {
    this._config = value;
    this.speaker.speechRate = value.speechRate;
  }

  dispatch(cues: readonly Cue[]): void {
    if (cues.length === 0) return;
    const cfg = this._config;
    let interruptUsed = false;
    for (const cue of cues) {
      switch (cue.kind) {
        case 'speak':
        case 'speakText': {
          if (!cfg.speech) break;
          // Within one batch only the first urgent message may interrupt; the rest queue behind it.
          const interrupt = !interruptUsed && cue.priority >= Priority.HIGH;
          if (cue.priority >= Priority.HIGH) interruptUsed = true;
          this.speaker.speak(cueText(cue) ?? '', cue.priority, interrupt);
          break;
        }
        case 'tone':
          if (cfg.tones) this.tones.play(cue.tone, cue.pan);
          break;
        case 'haptic':
          if (cfg.haptics) Haptics.play(cue.pattern);
          break;
      }
    }
  }

  sayAndWait(text: string): Promise<boolean> {
    return this._config.speech ? this.speaker.speakAndWait(text) : Promise.resolve(true);
  }
  whenIdle(): Promise<boolean> { return this.speaker.whenIdle(); }

  silenceRoutine(): void {
    this.speaker.stopRoutine();
  }

  silence(): void {
    this.speaker.stop();
    Haptics.cancel();
  }

  release(): void {
    this.speaker.stop();
    this.tones.release();
    Haptics.cancel();
  }
}

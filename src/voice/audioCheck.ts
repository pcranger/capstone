import { V } from './speechCatalog';
import { Store } from '../state/store';
import type { SpeechInput } from './nativeSpeech';
export interface VoiceCheckState { phase: 'off' | 'preparing' | 'listening' | 'speaking' | 'error'; text: string }
/** Temporary release gate: exercises the actual mic/audio stack without changing a journey. */
export class VoiceAudioCheck {
  readonly state = new Store<VoiceCheckState>({ phase: 'off', text: '' });
  private generation = 0;
  constructor(private input: SpeechInput, private say: (text: string) => Promise<boolean>, private silence: () => void, private tick: () => void) {}
  get active(): boolean { return !['off', 'error'].includes(this.state.value.phase); }
  stop(): void {
    ++this.generation; this.input.cancel(); this.silence(); this.state.set({ phase: 'off', text: '' });
  }
  async start(): Promise<void> {
    this.stop(); const id = this.generation;
    this.state.set({ phase: 'preparing', text: 'Preparing microphone…' });
    try {
      await this.input.prepare(); if (id !== this.generation) return;
      const text = await this.input.listen(() => {
        if (id === this.generation) { this.state.set({ phase: 'listening', text: 'Listening…' }); this.tick(); }
      });
      if (id !== this.generation) return;
      this.state.set({ phase: 'speaking', text: `Heard: ${text}` });
      const spoken = await this.say(V.heard(text));
      if (!spoken) throw new Error('Speech interrupted. Tap Test microphone to retry.');
      if (id === this.generation) this.state.set({ phase: 'off', text: 'Voice check complete. No command executed.' });
    } catch (e) {
      if (id === this.generation) this.state.set({ phase: 'error', text: e instanceof Error ? e.message : 'Voice unavailable.' });
    }
  }
}

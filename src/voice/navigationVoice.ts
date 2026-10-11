import { spokenError } from './speechCatalog';
import { Store } from '../state/store';
import type { SpeechInput } from './nativeSpeech';

export type VoiceIntent = { kind: 'start' | 'retry' | 'repeat' | 'pause' | 'resume' | 'cancel' | 'help' | 'stopListening' | 'finishCrossing' };

/** Only explicit commands may start an action. */
export { VOICE_MANUAL as VOICE_QUICK_START } from './speechCatalog';

const COMMANDS: Record<string, VoiceIntent['kind']> = {
  start: 'start', retry: 'retry', repeat: 'repeat', pause: 'pause', resume: 'resume', cancel: 'cancel',
  'finish crossing': 'finishCrossing', help: 'help', 'voice help': 'help', manual: 'help', man: 'help',
  'show commands': 'help', 'stop listening': 'stopListening',
};

export function voiceIntent(text: string): VoiceIntent | null {
  const lower = text.trim().replace(/[.!?]+$/, '').trim().toLocaleLowerCase('en-AU');
  return Object.hasOwn(COMMANDS, lower) ? { kind: COMMANDS[lower] } : null;
}

export interface NavigationVoiceState { phase: 'off' | 'preparing' | 'speaking' | 'listening' | 'working' | 'error'; text: string }
interface Dependencies {
  input: SpeechInput;
  say: (text: string) => Promise<boolean>;
  ready: () => void;
  handle: (text: string, current: () => boolean) => Promise<string | null>;
  cancel: () => void;
}
/** Serial audio turns: no recognition while TTS plays, no command accepted after cancellation. */
export class NavigationVoice {
  readonly state = new Store<NavigationVoiceState>({ phase: 'off', text: '' });
  private generation = 0;
  private worker: Promise<void> = Promise.resolve();
  private enabled = false;
  constructor(private deps: Dependencies) {}
  get active(): boolean { return this.enabled; }
  get processing(): boolean { return this.state.value.phase === 'working'; }
  start(prompt: string | null): void {
    if (this.enabled) return;
    this.enabled = true;
    const id = ++this.generation;
    this.worker = this.worker.catch(() => undefined).then(() => this.run(id, prompt));
  }
  stop(): void {
    this.enabled = false; ++this.generation;
    this.deps.input.cancel(); this.deps.cancel();
    this.state.set({ phase: 'off', text: '' });
  }
  whenStopped(): Promise<void> { return this.worker; }
  private async run(id: number, prompt: string | null): Promise<void> {
    const current = () => this.enabled && id === this.generation;
    if (!current()) return;
    try {
      this.state.set({ phase: 'preparing', text: 'Preparing voice…' });
      await this.deps.input.prepare();
      let signalReady = true;
      while (current()) {
        if (prompt) {
          signalReady = true;
          this.state.set({ phase: 'speaking', text: prompt });
          if (!await this.deps.say(prompt) || !current()) return;
        }
        prompt = null;
        try {
          const text = await this.deps.input.listen(() => {
            if (!current()) return;
            this.state.set({ phase: 'listening', text: 'Listening' });
            if (signalReady) this.deps.ready();
            signalReady = false;
          });
          if (!current()) return;
          this.state.set({ phase: 'working', text: text });
          prompt = await this.deps.handle(text, current);
        } catch (e) {
          if (!current()) return;
          const message = e instanceof Error ? e.message : 'Voice unavailable. Use Retry voice.';
          // Normal end-of-speech timeouts re-arm silently, including during ordinary walking.
          if (!/No speech heard|Voice timed out/i.test(message)) throw e;
          await new Promise(resolve => setTimeout(resolve, 350));
        }
      }
    } catch (e) {
      if (!current()) return;
      const message = e instanceof Error ? e.message : 'Voice unavailable. Use Retry voice.';
      this.state.set({ phase: 'error', text: message });
      await this.deps.say(spokenError(message, 'voice'));
    } finally {
      if (id === this.generation) {
        this.enabled = false;
        if (this.state.value.phase !== 'error') this.state.set({ phase: 'off', text: '' });
      }
    }
  }
}

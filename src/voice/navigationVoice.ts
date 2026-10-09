import { spokenError } from './speechCatalog';
import { Store } from '../state/store';
import type { SpeechInput } from './nativeSpeech';

export type VoiceIntent =
  | { kind: 'destination'; query: string; navigate: boolean }
  | { kind: 'choose'; index: number }
  | { kind: 'save'; alias?: string }
  | { kind: 'confirm' | 'retry' | 'repeat' | 'pause' | 'resume' | 'cancel' | 'end' | 'help' | 'stopListening' | 'next' | 'arrived' | 'finishCrossing' };

/** Only explicit commands may start an action. */
export { VOICE_MANUAL as VOICE_QUICK_START } from './speechCatalog';

export function voiceIntent(text: string): VoiceIntent | null {
  const value = text.trim().replace(/[.!?]+$/, '').trim();
  const lower = value.toLocaleLowerCase('en-AU');
  const commands: Record<string, VoiceIntent['kind']> = {
    'next instruction': 'next', arrived: 'arrived', 'finish crossing': 'finishCrossing',
    confirm: 'confirm', 'start journey': 'confirm', start: 'confirm', retry: 'retry',
    repeat: 'repeat', pause: 'pause', 'pause navigation': 'pause', resume: 'resume',
    'resume navigation': 'resume', cancel: 'cancel', 'end journey': 'end', 'stop navigation': 'end',
    help: 'help', 'voice help': 'help', manual: 'help', man: 'help', 'show commands': 'help', 'stop listening': 'stopListening',
  };
  if (Object.hasOwn(commands, lower)) return { kind: commands[lower] } as VoiceIntent;
  const choice = /^(?:(?:choose|select|number|option) )?(first|second|third|one|two|three|1|2|3)$/.exec(lower);
  if (choice) return { kind: 'choose', index: ['first', 'one', '1'].includes(choice[1]) ? 0 : ['second', 'two', '2'].includes(choice[1]) ? 1 : 2 };
  if (/^save(?: (?:this|location))?$/.test(lower)) return { kind: 'save' };
  const alias = /^save(?: this)? as (.+)$/i.exec(value);
  if (alias) return { kind: 'save', alias: alias[1] };
  const destination = /^(navigate to|take me to|go to|search for|search|find) (.+)$/i.exec(value);
  if (destination) return { kind: 'destination', query: destination[2], navigate: !/^(search|find)/i.test(destination[1]) };
  // Yes/no and generic acknowledgements are never a destination or crossing command.
  if (!value || /^(yes|no|okay|ok|thanks|thank you|stop|cross|cross now|i am across|save as|navigate to|search for)$/.test(lower)
    || /^(where|what|when|why|how|can you|could you)\b/.test(lower)) return null;
  return null;
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

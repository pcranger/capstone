import * as Speech from 'expo-speech';
import { Priority } from './cue';

/**
 * Text-to-speech with priorities: urgent messages interrupt less important ones, stale low-priority
 * messages are dropped instead of piling up behind the traffic situation they describe.
 *
 * Same policy as the Android Speaker; AVSpeechSynthesizer queues utterances like TextToSpeech.QUEUE_ADD,
 * and a stop() before speaking is QUEUE_FLUSH.
 */
export class Speaker {
  private ids = 0;
  private stopping: Promise<void> = Promise.resolve();
  private readonly completions = new Map<string, (completed: boolean) => void>();
  private readonly pending = new Map<string, Priority>();
  private readonly idleListeners = new Set<() => void>();
  /** 1.0 is the system's normal speaking rate. */
  speechRate = 1.0;

  /**
   * @param interrupt allow this message to cut off what is being said (only honored if nothing more
   * urgent is playing).
   */
  speak(text: string, priority: Priority, interrupt: boolean, complete?: (completed: boolean) => void): void {
    const id = `u${++this.ids}`;
    let highestPending: Priority | null = null;
    for (const p of this.pending.values()) if (highestPending === null || p > highestPending) highestPending = p;

    let flush: boolean;
    if (highestPending === null) flush = false;
    else if (interrupt && priority >= highestPending) flush = true;
    else if (priority >= Priority.HIGH) flush = false;
    else if (priority === Priority.NORMAL && highestPending <= Priority.NORMAL) flush = true;
    else { complete?.(false); return; } // LOW while busy, or NORMAL behind urgent speech: drop, it would be stale

    if (flush) {
      this.cancelCompletions();
      this.pending.clear();
      this.stopping = Speech.stop().catch(() => undefined);
    }
    this.pending.set(id, priority);
    if (complete) this.completions.set(id, complete);
    const finished = (completed: boolean) => {
      this.pending.delete(id);
      this.completions.get(id)?.(completed); this.completions.delete(id);
      if (this.pending.size === 0) for (const listener of this.idleListeners) listener();
    };
    try { Speech.speak(text, {
      rate: this.speechRate,
      // Use the app's playback session, so speech is heard with the ring/silent switch on silent.
      useApplicationAudioSession: true,
      onDone: () => finished(true),
      onStopped: () => finished(false),
      onError: () => finished(false),
    }); } catch { finished(false); }
  }

  /** Clear route/search narration during a handoff without interrupting a vehicle warning. */
  stopRoutine(): void {
    if ([...this.pending.values()].some(priority => priority >= Priority.HIGH)) return;
    this.stop();
  }

  private cancelCompletions(): void {
    for (const callback of this.completions.values()) callback(false);
    this.completions.clear();
  }

  speakAndWait(text: string): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.stopRoutine(); resolve(false); }, 30_000);
      this.speak(text, Priority.NORMAL, false, completed => { clearTimeout(timer); resolve(completed); });
    });
  }

  stop(): void {
    this.cancelCompletions();
    this.pending.clear();
    this.stopping = Speech.stop().catch(() => undefined);
    for (const listener of this.idleListeners) listener();
  }

  async whenIdle(): Promise<boolean> {
    await this.stopping;
    if (!this.pending.size) return Promise.resolve(true);
    const completed = await new Promise<boolean>(resolve => {
      const finish = (completed: boolean) => { clearTimeout(timer); this.idleListeners.delete(idle); resolve(completed); };
      const idle = () => { if (!this.pending.size) finish(true); };
      const timer = setTimeout(() => finish(false), 30_000);
      this.idleListeners.add(idle);
    });
    if (!completed) return false;
    // stop() can clear pending before the native audio session has stopped.
    await this.stopping;
    return this.pending.size ? this.whenIdle() : true;
  }
}

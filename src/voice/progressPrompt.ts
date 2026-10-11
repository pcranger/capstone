/** One low-priority reminder per five seconds. Never accumulate queued speech. */
export class ProgressPrompt {
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private speaking = false;
  constructor(private say: (text: string) => Promise<unknown>, private silence: () => void) {}
  start(label: string): void {
    this.stop();
    const id = this.generation;
    this.timer = setInterval(() => {
      if (this.speaking) return;
      this.speaking = true;
      void Promise.resolve().then(() => id === this.generation ? this.say(label) : undefined)
        .catch(() => undefined).finally(() => { if (id === this.generation) this.speaking = false; });
    }, 5_000);
  }
  stop(): void {
    ++this.generation;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.speaking) this.silence();
    this.speaking = false;
  }
}

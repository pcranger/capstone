import { Store } from '../state/store';
import { usableFix, type LocationFix } from './navigation';

export interface LocationState {
  status: 'off' | 'finding' | 'approximate' | 'ready' | 'unavailable';
  fix: LocationFix | null;
  error: string | null;
}
interface Dependencies {
  now: () => number;
  prepare: () => Promise<void>;
  cached: () => Promise<LocationFix | null>;
  watch: (fix: (value: LocationFix) => void, error: () => void) => Promise<{ remove(): void }>;
}

/** One foreground GPS owner. Pausing a route removes a consumer, not the location service. */
export class LocationCoordinator {
  readonly state = new Store<LocationState>({ status: 'off', fix: null, error: null });
  private generation = 0;
  private active = false;
  private starting: Promise<void> | null = null;
  private subscription: { remove(): void } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private deps: Dependencies) {}

  start(): Promise<void> {
    if (this.active) return this.starting ?? Promise.resolve();
    this.active = true;
    const id = ++this.generation;
    this.state.update(s => ({ ...s, status: 'finding', error: null }));
    const run = async () => {
      try {
        await this.deps.prepare();
        if (!this.current(id)) return;
        // Cache is only for display. A fresh native callback must qualify navigation.
        void this.deps.cached().then(fix => {
          if (this.current(id) && fix && !this.state.value.fix) this.state.set({ status: 'approximate', fix, error: null });
        }).catch(() => undefined);
        const sub = await this.deps.watch(fix => {
          if (!this.current(id)) return;
          const previous = this.state.value.fix;
          if (previous && (fix.timestamp < previous.timestamp || (fix.timestamp === previous.timestamp && this.state.value.status === 'ready'))) return;
          this.state.set({ fix, status: usableFix(fix, this.deps.now()) ? 'ready' : 'approximate', error: null });
        }, () => {
          if (!this.current(id)) return;
          this.state.update(s => ({ ...s, status: 'unavailable', error: 'Location unavailable. Reconnecting.' }));
          if (!this.retryTimer) this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.current(id)) { this.stop(); void this.start(); }
          }, 3_000);
        });
        if (!this.current(id)) { sub.remove(); return; }
        this.subscription = sub;
        this.timer = setInterval(() => {
          const s = this.state.value;
          if (s.status === 'ready' && s.fix && !usableFix(s.fix, this.deps.now())) {
            this.state.set({ ...s, status: 'finding' });
          }
        }, 2_000);
      } catch (e) {
        if (this.current(id)) {
          this.active = false;
          this.state.update(s => ({ ...s, status: 'unavailable', error: e instanceof Error ? e.message : 'Location unavailable.' }));
        }
      }
    };
    const pending = run(); this.starting = pending;
    void pending.finally(() => { if (this.starting === pending) this.starting = null; });
    return pending;
  }
  private current(id: number): boolean { return this.active && this.generation === id; }
  stop(): void {
    this.active = false; ++this.generation; this.starting = null;
    this.subscription?.remove(); this.subscription = null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null;
    this.state.update(s => ({ ...s, status: 'off' }));
  }
  async fresh(signal: AbortSignal): Promise<LocationFix> {
    if (signal.aborted) throw new Error('Request cancelled.');
    void this.start();
    return new Promise((resolve, reject) => {
      let dispose = () => {}; let done = false;
      const finish = (fix?: LocationFix, error?: string) => {
        if (done) return; done = true;
        clearTimeout(timer); dispose(); signal.removeEventListener('abort', abort);
        if (fix) resolve(fix); else reject(new Error(error));
      };
      const abort = () => finish(undefined, 'Request cancelled.');
      const timer = setTimeout(() => finish(undefined, 'Location unavailable. Say retry.'), 25_000);
      const check = () => {
        const s = this.state.value;
        if (s.status === 'ready' && s.fix && usableFix(s.fix, this.deps.now())) finish(s.fix);
        else if (s.status === 'unavailable' || s.status === 'off') finish(undefined, s.error ?? 'Location paused.');
      };
      dispose = this.state.subscribe(check); signal.addEventListener('abort', abort); check();
      if (signal.aborted) abort();
    });
  }
  async watch(onFix: (fix: LocationFix) => void, onError: () => void): Promise<{ remove(): void }> {
    let last: LocationFix | null = null;
    const remove = this.state.subscribe(() => {
      const s = this.state.value;
      if (s.status === 'ready' && s.fix && s.fix !== last) { last = s.fix; onFix(s.fix); }
      else if (s.status !== 'ready') onError();
    });
    return { remove };
  }
}

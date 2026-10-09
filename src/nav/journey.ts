import { spokenError } from '../voice/speechCatalog';
import { P } from '../strings';
import { Store } from '../state/store';
import { distanceMeters, type LocationFix, type PlaceCandidate, type WalkingRoute, stepPosition, usableFix } from './navigation';

export interface JourneyState {
  phase: 'idle' | 'walking' | 'paused' | 'arrived';
  crossing: boolean;
  busy: 'searching' | 'routing' | 'starting' | null;
  candidates: PlaceCandidate[];
  destination: PlaceCandidate | null;
  route: WalkingRoute | null;
  stepIndex: number;
  remaining: number | null;
  locationStatus: 'waiting' | 'good' | 'poor' | 'off-route';
  error: string | null;
}
const initial = (): JourneyState => ({ phase: 'idle', crossing: false, busy: null, candidates: [], destination: null,
  route: null, stepIndex: 0, remaining: null, locationStatus: 'waiting', error: null });
export interface NavigationDependencies {
  now: () => number;
  locate: (signal: AbortSignal) => Promise<LocationFix>;
  search: (query: string, fix: LocationFix, signal: AbortSignal) => Promise<PlaceCandidate[]>;
  route: (fix: LocationFix, to: PlaceCandidate, signal: AbortSignal) => Promise<WalkingRoute>;
  watch: (onFix: (fix: LocationFix) => void, onError: () => void) => Promise<{ remove: () => void }>;
  say: (text: string) => void;
  silence: () => void;
}

/** Foreground journey. GPS estimates distance; only the traveler advances an instruction or finishes a crossing. */
export class Journey {
  readonly state = new Store<JourneyState>(initial());
  /** Separately subscribed: camera frames never cause map updates. Invalid fixes must not look precise. */
  readonly location = new Store<LocationFix | null>(null);
  private generation = 0;
  private request: AbortController | null = null;
  private watcher: { remove: () => void } | null = null;
  private lastFix: LocationFix | null = null;
  private boundaryAnnounced = false;
  private qualityAnnounced = false;
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: NavigationDependencies) {}

  get running(): boolean { return this.state.value.phase === 'walking'; }
  get hasJourney(): boolean { return this.running || this.state.value.phase === 'paused'; }
  get routeSpeechAllowed(): boolean { return !this.state.value.crossing; }

  private begin(busy: JourneyState['busy']): { id: number; signal: AbortSignal } {
    this.cancelWork();
    this.request = new AbortController();
    this.state.update(s => ({ ...s, busy, error: null }));
    return { id: this.generation, signal: this.request.signal };
  }
  private cancelWork(): void { ++this.generation; this.request?.abort(); this.request = null; }
  private current(id: number): boolean { return id === this.generation; }
  private fail(error: unknown, id: number): void {
    if (!this.current(id)) return;
    const message = error instanceof Error ? error.message : 'Navigation is unavailable. Try again.';
    this.state.update(s => ({ ...s, busy: null, error: message }));
    if (this.routeSpeechAllowed) this.deps.say(spokenError(message));
  }
  private async fresh(signal: AbortSignal): Promise<LocationFix> {
    const fix = await this.deps.locate(signal);
    if (!usableFix(fix, this.deps.now())) throw new Error('Location not accurate enough. Wait on the footpath and retry.');
    return fix;
  }

  /** A deliberate locate/recheck action; never cancels the route watcher or resets journey progress. */
  async refreshLocation(signal: AbortSignal): Promise<void> {
    const generation = this.generation;
    const fix = await this.fresh(signal);
    if (signal.aborted || generation !== this.generation) throw new Error('Request cancelled.');
    if (this.running) this.onFix(fix);
    else this.location.set(fix);
  }
  async search(query: string): Promise<void> {
    if (this.hasJourney || !query.trim()) return;
    const { id, signal } = this.begin('searching');
    this.state.update(s => ({ ...s, candidates: [], route: null, destination: null, phase: 'idle' }));
    try {
      const fix = await this.fresh(signal);
      if (!this.current(id)) return;
      this.location.set(fix);
      const candidates = await this.deps.search(query.trim(), fix, signal);
      if (!this.current(id)) return;
      this.state.update(s => ({ ...s, candidates, busy: null }));
      this.deps.say(P.places(candidates.length));
    } catch (e) { this.fail(e, id); }
  }
  async select(to: PlaceCandidate): Promise<void> {
    if (this.hasJourney) return;
    const { id, signal } = this.begin('routing');
    this.state.update(s => ({ ...s, route: null, destination: to }));
    try {
      const fix = await this.fresh(signal);
      if (!this.current(id)) return;
      this.location.set(fix);
      const route = await this.deps.route(fix, to, signal);
      if (!this.current(id)) return;
      this.state.update(s => ({ ...s, route, busy: null, stepIndex: 0, remaining: null }));
      this.deps.say(P.routeReady(route.destination, route.distanceMeters));
    } catch (e) { this.fail(e, id); }
  }

  async start(plan?: { destination: PlaceCandidate; route: WalkingRoute }): Promise<boolean> {
    const s = this.state.value;
    const route = plan?.route ?? s.route;
    if (!route || s.busy || s.crossing || !['idle', 'paused', ...(plan ? ['arrived'] : [])].includes(s.phase)) return false;
    const { id, signal } = this.begin('starting');
    try {
      const fix = await this.fresh(signal);
      if (!this.current(id)) return false;
      if ((plan || s.phase === 'idle') && distanceMeters(fix, route.points[0]) > 40) {
        throw new Error('You moved away from the start. Find a new route.');
      }
      // Subscription creation is asynchronous: a stopped journey must also remove a late subscription.
      const watcher = await this.deps.watch(f => { if (this.current(id) && this.running) this.onFix(f); },
        () => { if (this.current(id) && this.running) this.badLocation(); });
      if (!this.current(id)) { watcher.remove(); return false; }
      this.stopWatch(); this.watcher = watcher;
      this.lastFix = null;
      this.boundaryAnnounced = false; this.qualityAnnounced = false;
      this.state.update(v => ({ ...v, ...(plan ? { route: plan.route, destination: plan.destination, stepIndex: 0, candidates: [] } : {}), phase: 'walking', busy: null, error: null }));
      this.onFix(fix, false);
      this.freshnessTimer = setInterval(() => {
        if (!this.lastFix || !usableFix(this.lastFix, this.deps.now())) this.badLocation();
      }, 5_000);
      this.repeat();
      return true;
    } catch (e) { this.fail(e, id); return false; }
  }

  private badLocation(status: 'poor' | 'off-route' = 'poor', announce = true): void {
    if (status === 'poor') this.location.set(null);
    this.state.update(s => ({ ...s, locationStatus: status, remaining: null }));
    if (announce && !this.qualityAnnounced && !this.state.value.crossing) {
      this.deps.say(status === 'off-route'
        ? P.offRoute
        : P.locationPoor);
      this.qualityAnnounced = true;
    }
  }
  onFix(fix: LocationFix, announce = true): void {
    const s = this.state.value;
    if (!this.running || !s.route) return;
    if (!usableFix(fix, this.deps.now()) || (this.lastFix && fix.timestamp <= this.lastFix.timestamp)) {
      this.badLocation('poor', announce); return;
    }
    if (this.lastFix && distanceMeters(this.lastFix, fix) > Math.max(35, (fix.timestamp - this.lastFix.timestamp) / 1000 * 8)) {
      this.lastFix = null; this.badLocation('poor', announce); return;
    }
    this.lastFix = fix;
    this.location.set(fix);
    const position = stepPosition(s.route.steps[s.stepIndex].points, fix);
    if (position.away > Math.max(35, (fix.accuracy ?? 25) * 2)) { this.badLocation('off-route', announce); return; }
    const recovered = this.qualityAnnounced;
    this.qualityAnnounced = false;
    if (announce && recovered && !s.crossing) this.deps.say(P.locationRestored);
    this.state.update(v => ({ ...v, locationStatus: 'good', remaining: Math.round(position.remaining / 5) * 5 }));
    if (announce && !s.crossing && !this.boundaryAnnounced && position.remaining <= 20) {
      this.boundaryAnnounced = true;
      this.deps.say(s.stepIndex === s.route.steps.length - 1
        ? P.nearDestination
        : P.stepEnd);
    }
  }
  repeat(): void {
    const s = this.state.value;
    if (!this.running || s.crossing || !s.route) return;
    this.deps.say(P.instruction(s.stepIndex, s.route.steps[s.stepIndex].instruction, s.remaining));
  }
  next(expectedStep: number): void {
    const s = this.state.value;
    if (!this.running || s.crossing || !s.route || s.stepIndex !== expectedStep || s.stepIndex >= s.route.steps.length - 1) return;
    this.deps.silence();
    this.boundaryAnnounced = false; this.qualityAnnounced = false; this.lastFix = null;
    this.state.update(v => ({ ...v, stepIndex: v.stepIndex + 1, remaining: null, locationStatus: 'waiting' }));
    this.repeat();
  }
  enterCrossing(): void {
    if (!this.hasJourney || this.state.value.crossing) return;
    this.deps.silence();
    this.state.update(s => ({ ...s, crossing: true }));
  }
  leaveCrossing(): void {
    if (!this.hasJourney || !this.state.value.crossing) return;
    this.deps.silence();
    this.lastFix = null;
    this.state.update(s => ({ ...s, crossing: false, remaining: null, locationStatus: 'waiting' }));
    this.repeat(); // The route instruction remains unchanged: a crossing may be inside a longer step.
  }
  private stopWatch(): void {
    this.watcher?.remove(); this.watcher = null;
    if (this.freshnessTimer) clearInterval(this.freshnessTimer);
    this.freshnessTimer = null;
  }
  pause(): void {
    this.cancelWork(); this.stopWatch(); this.deps.silence();
    this.state.update(s => ({ ...s, busy: null, phase: this.hasJourney ? 'paused' : s.phase, remaining: null, locationStatus: 'waiting' }));
  }
  arrive(expectedStep: number): void {
    const s = this.state.value;
    if (!this.running || s.crossing || !s.route || s.stepIndex !== expectedStep || expectedStep !== s.route.steps.length - 1) return;
    this.cancelWork(); this.stopWatch(); this.deps.silence();
    this.state.update(v => ({ ...v, phase: 'arrived', remaining: null }));
    this.deps.say(P.arrived(s.route.destination));
  }
  end(): void {
    this.cancelWork(); this.stopWatch(); this.deps.silence(); this.lastFix = null;
    this.location.set(null);
    this.boundaryAnnounced = false; this.qualityAnnounced = false;
    this.state.set(initial());
  }
}

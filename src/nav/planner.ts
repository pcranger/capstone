import { Store } from '../state/store';
import type { PlaceCandidate, WalkingRoute } from './navigation';

export interface PlannerState {
  query: string; page: 'entry' | 'results' | 'place' | 'route' | 'saved';
  candidates: PlaceCandidate[]; selected: PlaceCandidate | null; route: WalkingRoute | null;
  busy: 'searching' | 'details' | 'routing' | 'starting' | null; error: string | null;
  revision: number; replacing: boolean; allSaved: boolean;
}
interface Dependencies {
  search: (query: string, signal: AbortSignal) => Promise<PlaceCandidate[]>;
  details: (id: string, signal: AbortSignal) => Promise<PlaceCandidate>;
  route: (place: PlaceCandidate, signal: AbortSignal) => Promise<WalkingRoute>;
  start: (plan: { destination: PlaceCandidate; route: WalkingRoute }) => Promise<boolean>;
  cancelStart: () => void;
}
const initial = (): PlannerState => ({ query: '', page: 'entry', candidates: [], selected: null, route: null, busy: null,
  error: null, revision: 0, replacing: false, allSaved: false });
/** Draft navigation never replaces a paused live journey until the new start succeeds. */
export class DestinationPlanner {
  readonly state = new Store<PlannerState>(initial());
  private request: AbortController | null = null;
  private generation = 0;
  constructor(private deps: Dependencies) {}
  private update(patch: Partial<PlannerState>): void { this.state.update(s => ({ ...s, ...patch, revision: s.revision + 1 })); }
  private abort(): void {
    ++this.generation; this.request?.abort(); this.request = null;
    if (this.state.value.busy === 'starting') this.deps.cancelStart();
  }
  cancel(): void {
    this.abort(); this.update({ busy: null, error: null });
  }
  reset(): void {
    this.abort(); const revision = this.state.value.revision + 1;
    this.state.set({ ...initial(), revision });
  }
  edit(query = this.state.value.query): void { this.abort(); this.update({ query, page: 'entry', busy: null, error: null, selected: null, route: null }); }
  saved(all = false): void { this.abort(); this.update({ page: 'saved', allSaved: all, busy: null, selected: null, route: null, error: null }); }
  replace(): void { this.reset(); this.update({ replacing: true }); }
  private begin(busy: PlannerState['busy']): { id: number; signal: AbortSignal } {
    this.abort(); this.request = new AbortController(); this.update({ busy, error: null });
    return { id: this.generation, signal: this.request.signal };
  }
  private fail(error: unknown, id: number): void {
    if (id === this.generation) this.update({ busy: null, error: error instanceof Error ? error.message : 'Request unavailable. Try again.' });
  }
  async search(query = this.state.value.query): Promise<void> {
    const text = query.trim().slice(0, 240); if (!text) { this.edit(); return; }
    const { id, signal } = this.begin('searching');
    this.update({ query: text, page: 'results', candidates: [], selected: null, route: null });
    try {
      const candidates = await this.deps.search(text, signal);
      if (id !== this.generation) return;
      this.update({ candidates, busy: null, error: candidates.length ? null : 'No matches. Try a name and suburb.' });
    } catch (e) { this.fail(e, id); }
  }
  select(place: PlaceCandidate): void {
    this.abort(); this.update({ selected: place, route: null, page: 'place', busy: null, error: null });
  }
  async resolve(placeId: string): Promise<void> {
    const { id, signal } = this.begin('details');
    this.update({ selected: null, route: null, page: 'place' });
    try {
      const place = await this.deps.details(placeId, signal);
      if (id === this.generation) this.update({ selected: place, busy: null });
    } catch (e) { this.fail(e, id); }
  }
  async confirm(expectedId: string): Promise<void> {
    const s = this.state.value;
    if (s.busy || s.page !== 'place' || !s.selected || s.selected.id !== expectedId) return;
    if (s.selected.unavailableReason) { this.update({ error: s.selected.unavailableReason }); return; }
    const { id, signal } = this.begin('routing');
    try {
      const route = await this.deps.route(s.selected, signal);
      if (id === this.generation) this.update({ route, page: 'route', busy: null });
    } catch (e) { this.fail(e, id); }
  }
  async start(expectedRevision: number): Promise<boolean> {
    const s = this.state.value;
    if (s.revision !== expectedRevision || s.busy || s.page !== 'route' || !s.selected || !s.route) return false;
    const { id } = this.begin('starting');
    try {
      const started = await this.deps.start({ destination: s.selected, route: s.route });
      if (id !== this.generation) return false;
      // Clear busy before reset, so a successful journey is not cancelled by abort().
      this.update({ busy: null, error: started ? null : 'Could not start. Check location and retry.' });
      if (started) this.reset();
      return started;
    } catch (e) { this.fail(e, id); return false; }
  }
}

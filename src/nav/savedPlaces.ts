import AsyncStorage from '@react-native-async-storage/async-storage';
import { Store } from '../state/store';

/** Only provider IDs and user-authored labels persist. Place details remain session data. */
export interface SavedPlace { placeId: string; savedAt: number; alias?: string; queryLabel?: string }
interface SavedState { status: 'loading' | 'ready' | 'error'; items: SavedPlace[]; busy: boolean; error: string | null; undo: SavedPlace | null }
export const SAVED_PLACES_KEY = 'crosswise_saved_places_v1';
export const normalizedName = (s: string) => s.trim().normalize('NFKC').toLocaleLowerCase('en-AU');
const order = (items: SavedPlace[]) => [...items].sort((a, b) => b.savedAt - a.savedAt || a.placeId.localeCompare(b.placeId));
const label = (value?: string) => value?.trim().slice(0, 160) || undefined;
export class SavedPlacesRepository {
  readonly state = new Store<SavedState>({ status: 'loading', items: [], busy: false, error: null, undo: null });
  private chain: Promise<unknown> = Promise.resolve();
  private loading: Promise<void> | null = null;
  constructor(private storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> = AsyncStorage, private now = Date.now) {}
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.state.update(s => ({ ...s, status: 'loading', error: null }));
    this.loading = (async () => {
      try {
        const raw = await this.storage.getItem(SAVED_PLACES_KEY);
        const data = raw ? JSON.parse(raw) : { version: 1, items: [] };
        if (data.version !== 1 || !Array.isArray(data.items)) throw new Error('Invalid saved data');
        const ids = new Set<string>();
        const items = data.items.map((p: SavedPlace) => {
          if (!p || typeof p.placeId !== 'string' || !p.placeId || p.placeId.length > 512 ||
              !Number.isFinite(p.savedAt) || p.savedAt < 0 || ids.has(p.placeId) ||
              (p.alias !== undefined && typeof p.alias !== 'string') || (p.queryLabel !== undefined && typeof p.queryLabel !== 'string')) throw new Error('Invalid saved data');
          ids.add(p.placeId);
          return { placeId: p.placeId, savedAt: p.savedAt, alias: label(p.alias), queryLabel: label(p.queryLabel) };
        });
        this.state.set({ status: 'ready', items: order(items), busy: false, error: null, undo: null });
      } catch {
        // Preserve unread/unsupported storage. Never overwrite it with an empty list.
        this.state.update(s => ({ ...s, status: 'error', error: 'Saved places unavailable. Retry loading.' }));
      } finally { this.loading = null; }
    })();
    return this.loading;
  }
  private mutate<T>(change: (s: SavedState) => { items: SavedPlace[]; undo: SavedPlace | null; result: T }): Promise<T> {
    const operation = this.chain.then(async () => {
      if (this.state.value.status !== 'ready') throw new Error('Saved places unavailable. Retry loading.');
      this.state.update(s => ({ ...s, busy: true, error: null }));
      try {
        const next = change(this.state.value);
        await this.storage.setItem(SAVED_PLACES_KEY, JSON.stringify({ version: 1, items: next.items }));
        this.state.update(s => ({ ...s, items: order(next.items), undo: next.undo, busy: false }));
        return next.result;
      } catch (e) {
        const message = e instanceof AliasError ? e.message : 'Couldn’t save changes. Try again.';
        this.state.update(s => ({ ...s, busy: false, error: message }));
        throw new Error(message);
      }
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }
  save(placeId: string, queryLabel?: string, alias?: string): Promise<'saved' | 'already'> {
    return this.mutate(s => {
      if (!placeId || placeId.length > 512) throw new Error('Invalid place');
      const cleanAlias = label(alias);
      if (cleanAlias && s.items.some(p => p.placeId !== placeId && p.alias && normalizedName(p.alias) === normalizedName(cleanAlias))) {
        throw new AliasError('That name is already saved. Choose another name.');
      }
      const existing = s.items.find(p => p.placeId === placeId);
      if (existing) return { items: s.items.map(p => p.placeId === placeId && cleanAlias ? { ...p, alias: cleanAlias } : p), undo: s.undo, result: 'already' };
      const savedAt = s.items.reduce((latest, p) => Math.max(latest, p.savedAt + 1), this.now());
      return { items: [{ placeId, savedAt, alias: cleanAlias, queryLabel: label(queryLabel) }, ...s.items], undo: s.undo, result: 'saved' };
    });
  }
  remove(placeId: string): Promise<void> {
    return this.mutate(s => ({ items: s.items.filter(p => p.placeId !== placeId), undo: s.items.find(p => p.placeId === placeId) ?? s.undo, result: undefined }));
  }
  undo(): Promise<void> {
    return this.mutate(s => ({ items: s.undo && !s.items.some(p => p.placeId === s.undo!.placeId) ? [...s.items, s.undo] : s.items, undo: null, result: undefined }));
  }
}
class AliasError extends Error {}

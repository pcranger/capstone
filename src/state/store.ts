import { useSyncExternalStore } from 'react';

/** A minimal observable value — the StateFlow of this port. */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(next: T): void {
    if (Object.is(next, this.current)) return;
    this.current = next;
    for (const l of this.listeners) l();
  }

  update(transform: (v: T) => T): void {
    this.set(transform(this.current));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, () => store.value);
}

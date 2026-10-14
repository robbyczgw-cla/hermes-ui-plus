/**
 * Tiny external store around indexReducer (works with useSyncExternalStore; synchronous reads for callbacks).
 */
import { indexReducer } from './indexReducer.ts';
import type { IndexAction } from './indexReducer.ts';
import type { IndexState } from './types.ts';

export type IndexStore = {
  get(): IndexState;
  dispatch(a: IndexAction): void;
  subscribe(fn: () => void): () => void;
};

export function createIndexStore(initial: IndexState = { items: [] }): IndexStore {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    dispatch(a) {
      const next = indexReducer(state, a);
      if (next === state) return;
      state = next;
      for (const f of Array.from(subs)) f();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

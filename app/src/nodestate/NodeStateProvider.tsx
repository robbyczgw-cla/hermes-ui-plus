import { createContext, createElement, useContext, useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getNodeStateStore } from './defaultStore';
import type { NodeStateStore } from './store.ts';

const StoreContext = createContext<NodeStateStore | null>(null);

/** The store in effect (provider's, else the process-wide default). */
export function useNodeStateStore(): NodeStateStore {
  return useContext(StoreContext) ?? getNodeStateStore();
}

/**
 * Mount once near the app root. Flushes pending writes when the app goes to the background /
 * becomes inactive and on unmount. `store` is injectable for tests.
 */
export function NodeStateProvider({ children, store }: { children?: ReactNode; store?: NodeStateStore }) {
  const s = store ?? getNodeStateStore();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') void s.flush();
    });
    return () => {
      sub.remove();
      void s.flush();
    };
  }, [s]);
  return createElement(StoreContext.Provider, { value: s }, children);
}

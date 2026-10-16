/**
 * App bindings of quick answers: the shared availability cache (expo fetch), re-checked when the app returns to the
 * foreground; `useQuickAvailability(profile)` for every place that shows ⚡ (composer, start screen, settings, shell).
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { availabilityKey, createAvailability, DEMO_KEY, quickOffered, type ConfigFetch } from './availability';
import { quickBackendFor, type ProfileLike, type QuickBackend, type QuickConfig } from './core';

// arrow wrapper: on web expo/fetch IS the browser fetch, which throws "Illegal invocation" unless called with a window `this`
export const availability = createAvailability({ fetch: ((url, init) => expoFetch(url, init)) as ConfigFetch });

let appStateHooked = false;
function hookAppState(): void {
  if (appStateHooked) return;
  appStateHooked = true;
  // back from the background: the plugin may have been switched on/off meanwhile
  AppState.addEventListener('change', (s) => {
    if (s === 'active') availability.refreshAll(true);
  });
}

export function quickKey(backend: QuickBackend | null): string | null {
  if (!backend) return null;
  return backend.kind === 'demo' ? DEMO_KEY : availabilityKey(backend.conn);
}

export type UseQuickAvailability = {
  /** ⚡ may be shown for this connection */
  available: boolean;
  config: QuickConfig | null;
  backend: QuickBackend | null;
  /** cache key (markOff after a 404 feature_off) */
  key: string | null;
};

const NONE: UseQuickAvailability = { available: false, config: null, backend: null, key: null };

/** `profile` null / not a bridge Hermes profile / not the demo → never available (nothing is fetched). */
export function useQuickAvailability(profile: ProfileLike | null | undefined): UseQuickAvailability {
  hookAppState();
  const kind = profile?.kind;
  const baseUrl = profile?.baseUrl;
  const apiKey = profile?.apiKey;
  const bridge = profile?.bridge;
  const backend = useMemo(
    () => (kind !== undefined && baseUrl !== undefined && apiKey !== undefined ? quickBackendFor({ kind, baseUrl, apiKey, bridge }) : null),
    [kind, baseUrl, apiKey, bridge],
  );
  const key = quickKey(backend);
  const entry = useSyncExternalStore(availability.subscribe, () => availability.get(key), () => availability.get(key));
  useEffect(() => {
    if (backend?.kind === 'bridge') void availability.refresh(backend.conn);
  }, [backend]);
  return useMemo(() => (backend && entry && quickOffered(entry) ? { available: true, config: entry.config, backend, key } : { ...NONE, backend, key }), [backend, entry, key]);
}

/** reconnect (health back online), settings opened: check again now */
export function refreshQuickAvailability(profile: ProfileLike | null | undefined, force = true): void {
  const b = quickBackendFor(profile);
  if (b?.kind === 'bridge') void availability.refresh(b.conn, force);
}

// React side of update.ts: module-level state persisted in AsyncStorage, read through useSyncExternalStore.
// The only network call is checkForUpdate(): an unauthenticated GET to api.github.com (no cookies, no referrer, no
// identifiers), at most once a day, never on iOS / store installs, never while the device reports being offline.
// Startup never waits for it (UpdateHost starts it after the first frame, failures are silent).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { BG_SERVICE_ENABLED } from '../background/bgService';
import { brand } from '../brand';
import { isDesktopApp } from '../desktop/bridge';
import { FLAVOR } from '../flavor';
import {
  DEFAULT_UPDATE_STATE,
  parseRelease,
  parseSemver,
  pendingUpdate,
  releasesApiUrl,
  sanitizeUpdateState,
  shouldCheck,
  updateTarget,
  type ReleaseInfo,
  type UpdateState,
  type UpdateTarget,
} from './update';

export const UPDATE_STORAGE_KEY = 'hui.update.v1';
const FETCH_TIMEOUT_MS = 10_000;

let state: UpdateState = { ...DEFAULT_UPDATE_STATE };
let loading: Promise<void> | null = null;
let checking = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of Array.from(listeners)) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function load(): Promise<void> {
  loading ??= AsyncStorage.getItem(UPDATE_STORAGE_KEY)
    .then((raw) => {
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        // broken value → defaults
      }
      state = sanitizeUpdateState(parsed);
      emit();
    })
    .catch(() => {});
  return loading;
}

function update(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  emit();
  void AsyncStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export function installedVersion(): string | undefined {
  return Constants.expoConfig?.version;
}

/** Where this install gets its updates (none: iOS, Google Play builds). */
export function currentUpdateTarget(): UpdateTarget {
  return updateTarget({ os: Platform.OS, desktop: isDesktopApp(), storeBuild: !BG_SERVICE_ENABLED, flavor: FLAVOR });
}

function deviceOnline(): boolean | undefined {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return undefined; // native: no bundled signal
  return navigator.onLine;
}

/** Ask GitHub for a newer release if the throttle allows it. Never throws. */
export async function checkForUpdate(now = Date.now()): Promise<void> {
  await load();
  if (checking || currentUpdateTarget() === 'none') return;
  if (!shouldCheck(state, now, { online: deviceOnline() })) return;
  const repo = brand('hermes').repoUrl;
  const installed = installedVersion();
  const url = releasesApiUrl(repo, installed);
  if (!repo || !url) return;
  checking = true;
  update({ lastCheckAt: now }); // a failed attempt counts too: at most one request a day
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctl?.signal,
    } as RequestInit);
    if (!res.ok) return;
    const latest = parseRelease(await res.json(), repo, !!parseSemver(installed)?.pre.length);
    if (latest) update({ latest });
  } catch {
    // offline, timeout, rate limit: try again tomorrow
  } finally {
    clearTimeout(timer);
    checking = false;
  }
}

/** "Check for updates" switch. Turning it on checks right away (still once a day at most). */
export function setUpdateChecks(enabled: boolean): void {
  void load().then(() => {
    update({ enabled });
    if (enabled) void checkForUpdate();
  });
}

export function markUpdateToastShown(version: string): void {
  update({ toastShownFor: version });
}

export function useUpdateState(): UpdateState {
  useEffect(() => void load(), []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The newer release this install should show, with its download target; null when there is none. */
export function usePendingUpdate(): { release: ReleaseInfo; target: UpdateTarget; toastShown: boolean } | null {
  const s = useUpdateState();
  const target = currentUpdateTarget();
  const release = pendingUpdate(s, installedVersion(), target);
  return release ? { release, target, toastShown: s.toastShownFor === release.version } : null;
}

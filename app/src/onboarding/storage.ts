// Persistence of the "onboarded" flag (AsyncStorage) + a small gate hook for the root layout.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { loadPairRecoverySecret, savePairRecoverySecret } from '../settings/storage';
import { spentCodeKey, usedLinkKeys } from './linkDedupe';
import {
  LEGACY_SETUP_KEYS,
  ONBOARDED_KEY,
  parseOnboardedFlag,
  serializeOnboardedFlag,
  shouldShowOnboarding,
  type OnboardedFlag,
  type OnboardingPath,
} from './model';
import type { PairData } from './pairLink';
import { parsePairRecovery, serializePairRecovery, type PairRecovery } from './pairRecovery';

const HAS_DEV_KEYS = !!(process.env.EXPO_PUBLIC_HERMES_API_KEY || process.env.EXPO_PUBLIC_BRIDGE_TOKEN);

export async function loadOnboardedFlag(): Promise<OnboardedFlag | null> {
  try {
    return parseOnboardedFlag(await AsyncStorage.getItem(ONBOARDED_KEY));
  } catch {
    return null;
  }
}

export async function setOnboarded(path: OnboardingPath): Promise<void> {
  await AsyncStorage.setItem(ONBOARDED_KEY, serializeOnboardedFlag(path));
}

/** For Settings → "Einrichtung erneut starten" and tests. */
export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDED_KEY);
}

export async function hasLegacySetup(): Promise<boolean> {
  try {
    const pairs = await AsyncStorage.multiGet([...LEGACY_SETUP_KEYS]);
    return pairs.some(([, v]) => v !== null);
  } catch {
    return false;
  }
}

export type OnboardingGate = {
  /** false until storage was read – render nothing / splash meanwhile */
  ready: boolean;
  /** show the onboarding flow */
  needed: boolean;
  /** mark done (persists) and hide the flow */
  complete(path: OnboardingPath): Promise<void>;
  /** show the flow again (does not touch profiles) */
  restart(): Promise<void>;
};

/** Decides once on mount whether to show onboarding. */
export function useOnboardingGate(opts: { ignoreDevKeys?: boolean } = {}): OnboardingGate {
  const [state, setState] = useState<{ ready: boolean; needed: boolean }>({ ready: false, needed: false });
  const ignoreDevKeys = !!opts.ignoreDevKeys;
  useEffect(() => {
    let alive = true;
    Promise.all([loadOnboardedFlag(), hasLegacySetup()])
      .then(([flag, legacy]) => {
        if (alive) setState({ ready: true, needed: shouldShowOnboarding({ flag, hasLegacySetup: legacy, hasDevKeys: HAS_DEV_KEYS && !ignoreDevKeys }) });
      })
      .catch(() => alive && setState({ ready: true, needed: true }));
    return () => {
      alive = false;
    };
  }, [ignoreDevKeys]);
  const complete = useCallback(async (path: OnboardingPath) => {
    setState({ ready: true, needed: false });
    await setOnboarded(path).catch(() => {});
  }, []);
  const restart = useCallback(async () => {
    await resetOnboarding().catch(() => {});
    setState({ ready: true, needed: true });
  }, []);
  return { ...state, complete, restart };
}

// ── pair links already used ─────────────────────────────────────────────────────────────────────
// On web the pair link lives in the page URL (`https://host/#pair?…`), and an iOS home-screen web app keeps
// the URL it was added with as its start URL – so the same link arrives on every launch. On Android the VIEW intent
// comes back after an activity recreation (configuration change) or a process restart. Remember a digest of links
// that were saved successfully and of one-time codes that were redeemed, and skip those links next time, on every
// platform (neither the token nor the code itself is stored here).
const APPLIED_PAIR_KEY = 'hermes.pairLinksApplied.v1';
const MAX_APPLIED = 20;

export function pairLinkDigest(link: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < link.length; i++) {
    const c = link.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

async function loadApplied(): Promise<string[]> {
  try {
    const v: unknown = JSON.parse((await AsyncStorage.getItem(APPLIED_PAIR_KEY)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function wasPairLinkApplied(link: string): Promise<boolean> {
  return (await loadApplied()).includes(pairLinkDigest(link));
}

export async function markPairLinkApplied(link: string): Promise<void> {
  await remember(link);
}

/** the one-time code was redeemed: every link carrying it is used up (called before the connection is saved) */
export async function markPairCodeSpent(code: string): Promise<void> {
  if (code) await remember(spentCodeKey(code));
}

/** this device redeemed the one-time code before (markPairCodeSpent) */
export async function wasPairCodeSpent(code: string): Promise<boolean> {
  return !!code && (await loadApplied()).includes(pairLinkDigest(spentCodeKey(code)));
}

/** the link was saved before, or its one-time code was redeemed → never offer it again */
export async function wasPairLinkUsed(link: string, code: string | undefined): Promise<boolean> {
  const list = await loadApplied();
  return usedLinkKeys(link, code).some((k) => list.includes(pairLinkDigest(k)));
}

async function remember(key: string): Promise<void> {
  const d = pairLinkDigest(key);
  const list = (await loadApplied()).filter((x) => x !== d);
  await AsyncStorage.setItem(APPLIED_PAIR_KEY, JSON.stringify([...list, d].slice(-MAX_APPLIED))).catch(() => {});
}

// ── pending recovery of a redeemed pair code (pairRecovery.ts) ─────────────────────────────────────────────────────
// The device token of a redeem whose profile save failed lives in the secure store (like the profile keys) until a
// save of that token succeeded. Never logged.

/** keep the redeemed pair (token, no code); rejects when the store failed (connectPairCode ignores that) */
export async function keepPairRecovery(pair: PairData): Promise<void> {
  const raw = serializePairRecovery(pair);
  if (raw) await savePairRecoverySecret(raw);
}

/** the kept connection, or null (nothing pending / unreadable) */
export async function loadPairRecovery(): Promise<PairRecovery | null> {
  return parsePairRecovery(await loadPairRecoverySecret().catch(() => ''));
}

/** a connection with `token` was saved: drop the pending recovery if it is that token (another one stays) */
export async function clearPairRecovery(token: string): Promise<void> {
  if (!token) return;
  const r = await loadPairRecovery();
  if (r && r.pair.token === token) await savePairRecoverySecret('');
}

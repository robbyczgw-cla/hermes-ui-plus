// Deep links `hermesui://pair?u=…&c=…&n=…` (one-time code; legacy links carry `t=…`).
// Two entry points, both feed the same in-memory queue:
//  1) `redirectPairSystemPath` – call from `src/app/+native-intent.tsx` so Expo Router does not try to open
//     a non-existent `/pair` route (it returns `/` and stashes the link);
//  2) `usePairDeepLink` – mount once in the root layout; also reads expo-linking's initial URL and `url`
//     events (covers setups without +native-intent and web).
// The handler gets the raw link; validate with `parsePairLink()` (OnboardingFlow does that itself).
// Web: the link is the page fragment (`#pair?…`). It is read and removed from the URL right when this module
// loads (history.replaceState – the code / token must not stay in the address bar / history) and on `hashchange`
// (pair link opened in an already-open tab). Native: `+native-intent` maps the link to `/`, so the token never
// enters the navigation state; it only lives in memory until the flow consumes it.
import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { createLinkDeduper } from './linkDedupe';
import { takeWebPairHash, toPairLink } from './pairLink';

type Listener = (link: string, initial: boolean) => void;
let pending: { link: string; initial: boolean } | null = null;
const listeners = new Set<Listener>();
/**
 * links delivered a moment ago (survives remounts of the hook); a later re-open of the same link is a deliberate retry.
 * The initial URL (VIEW intent) is delivered once per process – Android reports it again after an activity recreation.
 */
const seen = createLinkDeduper();
let initialUrlRead = false;

function emit(link: string, initial = false) {
  if (listeners.size === 0) {
    pending = { link, initial }; // nobody mounted yet (cold start) → keep the latest one
    return;
  }
  for (const l of listeners) l(link, initial);
}

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

/** Web: take a `#pair?…` fragment out of the page URL (replaceState) and emit it. */
function captureWebPairHash(): void {
  if (!isWeb) return;
  try {
    const r = takeWebPairHash(window.location.href);
    if (!r) return;
    window.history.replaceState(window.history.state, '', r.cleanUrl);
    if (r.link) emit(r.link);
  } catch {
    // never break app start over a URL
  }
}
captureWebPairHash();

/**
 * For `src/app/+native-intent.tsx`:
 * ```ts
 * import { redirectPairSystemPath } from '../onboarding';
 * export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
 *   return redirectPairSystemPath({ path, initial });
 * }
 * ```
 * Never throws (Expo requirement); non-pair paths pass through unchanged.
 */
export function redirectPairSystemPath({ path, initial }: { path: string; initial?: boolean }): string {
  try {
    const link = toPairLink(path);
    if (!link) return path;
    emit(link, !!initial);
    return '/';
  } catch {
    return '/';
  }
}

/**
 * Calls `onLink(rawPairLink)` for every pair link that opens the app (cold start + while running).
 * Duplicates delivered at the same moment (initial URL + native-intent may both report it) open the flow once; opening
 * the same link again later is delivered again (retry).
 */
export function usePairDeepLink(onLink: (link: string) => void): void {
  const cb = useRef(onLink);
  useEffect(() => {
    cb.current = onLink;
  });
  useEffect(() => {
    const deliver = (raw: string | null | undefined, initial = false) => {
      const link = toPairLink(raw ?? '');
      if (!link || !seen.accept(link, { initial })) return;
      cb.current(link);
    };
    listeners.add(deliver);
    if (pending) {
      const p = pending;
      pending = null;
      deliver(p.link, p.initial);
    }
    if (isWeb) {
      // already-open tab: a pair link only changes the fragment → hashchange, no reload
      captureWebPairHash();
      const onHash = () => {
        seen.clear(); // the user opened a link on purpose (the URL was cleaned, so no re-delivery loop)
        captureWebPairHash();
      };
      window.addEventListener('hashchange', onHash);
      return () => {
        listeners.delete(deliver);
        window.removeEventListener('hashchange', onHash);
      };
    }
    // the initial URL belongs to the cold start: read it once per process, not on every remount of the hook
    if (!initialUrlRead) {
      initialUrlRead = true;
      Linking.getInitialURL()
        .then((u) => deliver(u, true))
        .catch(() => {});
    }
    const sub = Linking.addEventListener('url', (e) => deliver(e.url));
    return () => {
      listeners.delete(deliver);
      sub.remove();
    };
  }, []);
}

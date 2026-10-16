// Expo Router native intent hook: rewrites hermesui://pair?… deep links to `/` and stashes the link for
// usePairDeepLink (OnboardingHost). Native only; must never throw (the helper catches everything).
// iOS share extension (expo-share-intent) opens `<scheme>://dataUrl=<key>`: not a route, the share itself is read by
// share/ShareHost → `/`.
import { redirectPairSystemPath } from '../onboarding/deepLink';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (typeof path === 'string' && path.includes('dataUrl=')) return '/';
  return redirectPairSystemPath({ path, initial });
}

// Expo Router native intent hook: rewrites hermesui://pair?… deep links to `/` and stashes the link for
// usePairDeepLink (OnboardingHost). Native only; must never throw (the helper catches everything).
import { redirectPairSystemPath } from '../onboarding/deepLink';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  return redirectPairSystemPath({ path, initial });
}

// Android hardware Back in the onboarding flows (classic OnboardingFlow + GuidedFlow). Pure → guidedSteps.test.ts.

/** pop: the flow goes one step back · swallow: handled, nothing happens · pass: the next listener (host / router) decides */
export type BackAction = 'pop' | 'swallow' | 'pass';

/**
 * While a pair code is redeemed / its connection saved (`busy`, connectLock.ts) nothing navigates. Once the connection
 * is saved the flow only has post-connect steps left (privacy, skill, done – none of them has a back button): Back is
 * swallowed there, it never reaches the connect step again (whose Connect would burn the spent code, E2E round 5, N1)
 * and is not passed on to the host / router (which would close the flow or leave the app before it finished).
 */
export function onboardingBack(s: { busy: boolean; saved: boolean; canPop: boolean }): BackAction {
  if (s.busy || s.saved) return 'swallow';
  return s.canPop ? 'pop' : 'pass';
}

/**
 * Classic flow, "Neuen Link verwenden" after a final redeem failure (link expired / already used): the scanner, with the
 * connection choice behind it (and Welcome, if it was there). Review: a link opened in the first-run onboarding that
 * goes straight to its confirmation has the history ['form'] – no Back – and the failure removed the only footer
 * action, leaving no way out.
 */
export function newLinkHistory<S extends string>(history: readonly S[]): (S | 'welcome' | 'choose' | 'scan')[] {
  return [...(history[0] === 'welcome' ? (['welcome'] as const) : []), 'choose', 'scan'];
}

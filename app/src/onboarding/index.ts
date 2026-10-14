/**
 * Hermes UI – first-run onboarding (owner: onboarding workstream). See INTEGRATION.md.
 *
 *   <OnboardingScreen onFinish initialPairLink? entry? finishAfterSave? />   wired to ConnectionProvider
 *   <OnboardingFlow …/>                       same, with explicit existingProfiles/onSaveConnection
 *   useOnboardingGate() → {ready, needed, complete(path), restart()}
 *   usePairDeepLink(onLink)                   hermesui://pair links (cold start + running)
 *   redirectPairSystemPath({path})            for src/app/+native-intent.tsx
 *   parsePairLink / buildPairLink / normalizeServerUrl / probeConnection / describeConnError   pure helpers
 */
export { OnboardingFlow } from './OnboardingFlow';
export type { OnboardingFinish, OnboardingFlowProps } from './OnboardingFlow';
export { OnboardingScreen } from './OnboardingScreen';
export type { OnboardingScreenProps } from './OnboardingScreen';
export { useOnboardingGate, loadOnboardedFlag, setOnboarded, resetOnboarding } from './storage';
export type { OnboardingGate } from './storage';
export { usePairDeepLink, redirectPairSystemPath } from './deepLink';
export { parsePairLink, buildPairLink, isPairLink, toPairLink, isHeaderSafeToken, sanitizeName } from './pairLink';
export type { PairData, PairResult, PairErrorCode } from './pairLink';
export { normalizeServerUrl, isPrivateHost } from './url';
export type { NormalizedUrl, UrlResult, UrlErrorCode, Cleartext } from './url';
export { probeConnection, parseModelIds, BRIDGE_HEADER } from './probe';
export type { ProbeResult, ProbeOptions, FetchLike } from './probe';
export { classifyFetchError, classifyStatus, describeConnError } from './errors';
export type { ConnError, ConnErrorKind } from './errors';
export { buildHermesProfile, shouldShowOnboarding, skillInstallCommand, ONBOARDED_KEY, PROJECT_REPO_URL, SKILL_DOCS_URL } from './model';
export type { OnboardingPath, OnboardedFlag } from './model';
export { STARTERS, DEMO_STARTERS } from './starters';
export type { StarterPrompt } from './starters';
// integration (root host, app-wide requests, starter prompt hand-off to the chat)
export { OnboardingHost } from './OnboardingHost';
export { openOnboarding, subscribeOnboardingRequests } from './hostEvents';
export type { OnboardingRequest } from './hostEvents';
export { queueStarterPrompt, takeStarterPrompt, subscribeStarterPrompt, useStarterPrompt } from './starterPrompt';

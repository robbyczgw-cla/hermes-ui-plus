// Tiny event bus between OnboardingHost (mounted once in the root layout) and the rest of the app,
// so Settings / the demo chat can open the flow without a React context.
//
//   openOnboarding('choose')   "Echte Verbindung einrichten" / "Verbindung hinzufügen"
//   openOnboarding('welcome', { restart: true })   Settings → "Einrichtung erneut starten" (clears the flag)

export type OnboardingRequest = { entry: 'welcome' | 'choose'; restart?: boolean };

const listeners = new Set<(r: OnboardingRequest) => void>();

export function openOnboarding(entry: OnboardingRequest['entry'] = 'choose', opts: { restart?: boolean } = {}): boolean {
  if (!listeners.size) return false;
  const req: OnboardingRequest = { entry, restart: opts.restart };
  for (const l of Array.from(listeners)) l(req);
  return true;
}

export function subscribeOnboardingRequests(fn: (r: OnboardingRequest) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── "an onboarding flow is on screen" (OnboardingScreen mounts count) ─────────────────────────
// ChatView keeps its AI-consent sheet from opening by itself meanwhile: the flow has its own consent step,
// and the sheet (a Modal) would otherwise pop up above it as soon as the new connection is active.
let visibleCount = 0;
const visibleListeners = new Set<() => void>();

export function markOnboardingVisible(): () => void {
  visibleCount++;
  for (const l of Array.from(visibleListeners)) l();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    visibleCount--;
    for (const l of Array.from(visibleListeners)) l();
  };
}

export function isOnboardingVisible(): boolean {
  return visibleCount > 0;
}

export function subscribeOnboardingVisible(fn: () => void): () => void {
  visibleListeners.add(fn);
  return () => {
    visibleListeners.delete(fn);
  };
}

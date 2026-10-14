// Onboarding v2 ("guided", official FLAVOR=hermes build): pure step machine. The screens live in guided/*.tsx,
// GuidedFlow.tsx feeds events in and renders `current(state)`. Tested in guidedSteps.test.ts.
//
//   welcome ─ Verbinden ─► setup "Wie ist dein Hermes eingerichtet?"
//      │                     ├─ QR / Link ───────────────► scan ─► check ─► (consent) ─► done
//      │                     ├─ Hermes ohne Bridge ─► noBridge ─┬─ Lass Hermes das machen ─► agentSetup ─ Ich habe den Link ─► scan
//      │                     │                                  ├─ Selbst einrichten ──────► selfSetup ─ Ich habe den Link ──► scan
//      │                     │                                  └─ Ohne Bridge (eingeschränkt) ─► manual ─► (consent) ─► done
//      │                     └─ Noch kein Hermes ─► noHermes ─ Demo ─► done (demo)
//      └─ Demo ─────────────────────────────────────────────────────────────────────────────────► done (demo)
//   deep link: ─► check (or scan with the error)                    finishAfterSave: saved ─► (consent) ─► finish
import { FLAVOR, type Flavor } from '../flavor.ts';

export type OnboardingVariant = 'guided' | 'classic';

/** The official build gets the guided flow; the personal flavor keeps its classic onboarding. */
export function onboardingVariant(flavor: Flavor = FLAVOR): OnboardingVariant {
  return flavor === 'hermes' ? 'guided' : 'classic';
}

export type GStep = 'welcome' | 'setup' | 'scan' | 'noBridge' | 'agentSetup' | 'selfSetup' | 'manual' | 'noHermes' | 'check' | 'consent' | 'done';

export type GState = {
  history: GStep[];
  demo: boolean;
  /** a connection was saved: no way back (would save again); the history then only holds the post-connect steps */
  saved: boolean;
  /** adding a connection later (Settings, deep link while onboarded): finish right after saving (+ consent) */
  finishAfterSave: boolean;
  /** the integrator should call onFinish now */
  finished: boolean;
};

export type GEvent =
  | { type: 'connect' }
  | { type: 'demo' }
  | { type: 'choose'; choice: 'link' | 'noBridge' | 'noHermes' }
  | { type: 'bridgeOption'; option: 'agent' | 'self' | 'manual' }
  | { type: 'haveLink' }
  | { type: 'paired' }
  | { type: 'deepLink'; ok: boolean }
  /** "Neuen Link verwenden" after a final redeem failure (link expired / used) */
  | { type: 'newLink' }
  | { type: 'saved'; consentNeeded: boolean }
  | { type: 'consented' }
  | { type: 'back' };

export function initialGuidedState(entry: 'welcome' | 'choose' = 'welcome', finishAfterSave = false): GState {
  return { history: [entry === 'choose' ? 'setup' : 'welcome'], demo: false, saved: false, finishAfterSave, finished: false };
}

export const current = (s: GState): GStep => s.history[s.history.length - 1];

export function canGoBack(s: GState): boolean {
  const step = current(s);
  if (s.history.length <= 1 || s.finished) return false;
  if (step === 'consent') return false;
  if (step === 'done') return s.demo;
  return true;
}

const push = (s: GState, step: GStep, patch: Partial<GState> = {}): GState => ({ ...s, ...patch, history: [...s.history, step] });

export function guidedReducer(s: GState, ev: GEvent): GState {
  if (s.finished) return s;
  const step = current(s);
  switch (ev.type) {
    case 'connect':
      return step === 'welcome' ? push(s, 'setup', { demo: false }) : s;
    case 'demo':
      return s.saved ? s : push(s, 'done', { demo: true });
    case 'choose':
      if (step !== 'setup') return s;
      return push(s, ev.choice === 'link' ? 'scan' : ev.choice, { demo: false });
    case 'bridgeOption':
      if (step !== 'noBridge') return s;
      return push(s, ev.option === 'agent' ? 'agentSetup' : ev.option === 'self' ? 'selfSetup' : 'manual');
    case 'haveLink':
      return step === 'agentSetup' || step === 'selfSetup' ? push(s, 'scan') : s;
    case 'paired':
      return step === 'scan' ? push(s, 'check') : s;
    case 'deepLink': {
      if (s.saved) return s;
      // keep the intro steps; drop whatever was in progress
      const keep = s.history.filter((x) => x === 'welcome' || x === 'setup');
      return { ...s, demo: false, history: [...keep, ev.ok ? 'check' : 'scan'] };
    }
    case 'newLink':
      // the scanner, with the setup choice behind it – also when the link came in on a cold start (no setup step)
      if (s.saved || step !== 'check') return s;
      return { ...s, demo: false, history: [...(s.history[0] === 'welcome' ? (['welcome'] as const) : []), 'setup', 'scan'] };
    case 'saved': {
      // the profile IS saved: follow it from whatever step is shown (a link may have changed the step meanwhile)
      if (s.saved) return s;
      // the connect step and everything before it leave the history: nothing walks back to "Verbinden" (E2E 5, N1)
      if (ev.consentNeeded) return { ...s, saved: true, history: ['consent'] };
      return s.finishAfterSave ? { ...s, saved: true, finished: true } : { ...s, saved: true, history: ['done'] };
    }
    case 'consented':
      if (step !== 'consent') return s;
      return s.finishAfterSave ? { ...s, finished: true } : push(s, 'done');
    case 'back': {
      if (!canGoBack(s)) return s;
      const history = s.history.slice(0, -1);
      return { ...s, history, demo: step === 'done' ? false : s.demo };
    }
  }
}

/** progress dots: setup 1 · connect 2 · consent 3 · done 4 (welcome and the demo have none) */
export const GUIDED_TOTAL = 4;
export function guidedProgress(s: GState): number | undefined {
  if (s.demo) return undefined;
  const step = current(s);
  if (step === 'welcome') return undefined;
  if (step === 'setup') return 1;
  if (step === 'consent') return 3;
  if (step === 'done') return 4;
  return 2;
}

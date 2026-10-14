// First-run onboarding (classic, personal flavor; the official build renders GuidedFlow): Welcome → choose connection → (scan QR | manual form) → AI data consent → skill hint → done.
// The consent step (compliance/, Apple 5.1.2(i)) is skipped for the demo and when the current version is accepted.
// Component, not a route: the integrator renders it (e.g. instead of the chat while the gate says so).
// It never touches storage itself except through the callbacks → easy to embed / test.
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import type { ConnectionProfile } from '../settings/profiles';
import { ChooseConnection, type ConnectionChoice } from './ChooseConnection';
import { ConnectionForm, type ConnectedInput } from './ConnectionForm';
import { Done } from './Done';
import { GuidedFlow } from './GuidedFlow';
import { onboardingVariant } from './guidedSteps';
import { buildHermesProfile, type OnboardingPath } from './model';
import { parsePairLink, type PairData } from './pairLink';
import { ScanPair } from './ScanPair';
import { newLinkHistory, onboardingBack } from './backNav';
import { pairConnectBusy } from './connectLock';
import { deepLinkRoute } from './pairConnect';
import { pageOrigin } from './webOrigin';
import { SkillHint } from './SkillHint';
import { Welcome } from './Welcome';
import { ConsentStep } from '../compliance/Consent';
import { acceptAiConsent, isAiConsentCurrent } from '../compliance/store';

export type OnboardingFinish = {
  path: OnboardingPath;
  /** saved + to be activated profile (bridge/direct) */
  profile?: ConnectionProfile;
  /** send this as first message of a new chat (starter tapped) */
  starterPrompt?: string;
};

export type OnboardingFlowProps = {
  /** current profiles – a re-pair with the same URL updates that profile instead of adding one */
  existingProfiles?: readonly ConnectionProfile[];
  /** persist + activate the profile (e.g. `upsertProfile(p).then(() => setActive(p.id))`). Reject → error shown. */
  onSaveConnection: (profile: ConnectionProfile) => Promise<void>;
  /** flow finished. Integrator: mark onboarded, then demo → demo chat, other → settings, else → chat. */
  onFinish: (result: OnboardingFinish) => void;
  /** pair link from a deep link / QR scanned with the system camera. Changing it jumps to verification. */
  initialPairLink?: string | null;
  /** 'choose' skips the welcome screen (e.g. "Verbindung hinzufügen" from settings) */
  entry?: 'welcome' | 'choose';
  /** skip skill + done screens, finish right after saving (adding a connection later) */
  finishAfterSave?: boolean;
};

type Step = 'welcome' | 'choose' | 'scan' | 'form' | 'consent' | 'skill' | 'done';
const PROGRESS: Partial<Record<Step, number>> = { choose: 1, scan: 2, form: 2, consent: 3, skill: 3, done: 4 };
const TOTAL = 4;

/**
 * The official build (FLAVOR=hermes) gets the guided v2 flow (GuidedFlow.tsx, guidedSteps.ts); the personal flavor
 * keeps the classic flow below unchanged. Both share props, pairing (pairLink.ts / deep links) and the finish contract.
 */
export function OnboardingFlow(props: OnboardingFlowProps) {
  return onboardingVariant() === 'guided' ? <GuidedFlow {...props} /> : <ClassicFlow {...props} />;
}

function ClassicFlow({ existingProfiles = [], onSaveConnection, onFinish, initialPairLink, entry = 'welcome', finishAfterSave }: OnboardingFlowProps) {
  const [history, setHistory] = useState<Step[]>([entry]);
  const [formMode, setFormMode] = useState<'direct' | 'pair'>('direct');
  const [pair, setPair] = useState<PairData | null>(null);
  const [badLink, setBadLink] = useState<string | null>(null);
  const [saved, setSaved] = useState<ConnectionProfile | null>(null);
  const [demo, setDemo] = useState(false);
  /** what follows the consent step (finish or the skill hint) */
  const [afterConsent, setAfterConsent] = useState<{ run: () => void } | null>(null);
  /** remounts the form for every new pair link (fresh state + auto test) */
  const [pairNonce, setPairNonce] = useState(0);
  const step = history[history.length - 1];

  const push = useCallback((s: Step) => setHistory((h) => [...h, s]), []);
  const back = useCallback(() => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  }, []);
  // the link is used up (final redeem failure): the scanner, the choice behind it – also without Back (backNav.ts)
  const toNewLink = useCallback(() => {
    setBadLink(null);
    setHistory((h) => newLinkHistory(h));
  }, []);

  // deep link → verification (or the scan screen with the error if the link is invalid). A one-time code is redeemed
  // only when the user taps "Verbinden" on the form (pairConnect.ts) – opening a link never POSTs.
  // Derived from the prop during render (React's "adjust state on prop change" pattern), once per link.
  const [handledLink, setHandledLink] = useState<string | null>(null);
  // (never after the connection was saved: the post-connect steps must not lead back to a connect screen)
  if (initialPairLink && initialPairLink !== handledLink && !saved) {
    setHandledLink(initialPairLink);
    const r = parsePairLink(initialPairLink, { origin: pageOrigin() });
    const keep = history.filter((x) => x === 'welcome' || x === 'choose');
    if (r.ok && deepLinkRoute(r) === 'form') {
      setPair(r.pair);
      setFormMode('pair');
      setPairNonce((n) => n + 1);
      setBadLink(null);
      setHistory([...keep, 'form']);
    } else {
      setBadLink(initialPairLink);
      setHistory([...keep, 'scan']);
    }
  }

  // Android back button walks back through the steps – never while a pair code is redeemed / saved (connectLock.ts),
  // never once the connection is saved (backNav.ts). Re-registered on every step change → asked before the host.
  const isSaved = !!saved;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const action = onboardingBack({ busy: pairConnectBusy(), saved: isSaved, canPop: history.length > 1 && step !== 'done' });
      if (action === 'pop') back();
      return action !== 'pass';
    });
    return () => sub.remove();
  }, [history.length, step, back, isSaved]);

  const choose = (c: ConnectionChoice) => {
    setDemo(false);
    if (c === 'pair') {
      setBadLink(null);
      push('scan');
    } else if (c === 'direct') {
      setPair(null);
      setFormMode('direct');
      push('form');
    } else if (c === 'demo') {
      setDemo(true);
      push('done');
    } else onFinish({ path: 'other' });
  };

  const onPaired = (p: PairData) => {
    setBadLink(null); // walking back to the scanner must not hand the same link on again
    setPair(p);
    setPairNonce((n) => n + 1);
    setFormMode('pair');
    push('form');
  };

  const onConnected = async (c: ConnectedInput) => {
    const viaPair = formMode === 'pair' ? pair : null;
    const profile = buildHermesProfile({ baseUrl: c.url.baseUrl, apiKey: c.apiKey, name: c.name, bridge: c.probe?.bridge ?? formMode === 'pair' }, existingProfiles);
    if (viaPair?.model) profile.model = viaPair.model;
    await onSaveConnection(profile);
    setSaved(profile);
    // from here on the history only holds post-connect steps: the connect step and everything before it are gone
    // (E2E round 5, N1: Back on the privacy step showed the connect screen again, whose Connect burned the spent code)
    const next = () => {
      if (finishAfterSave) onFinish({ path: profile.bridge ? 'bridge' : 'direct', profile });
      else setHistory(['skill']);
    };
    // before the first message can go out: the AI data-sharing consent (once per text version)
    if (await isAiConsentCurrent().catch(() => false)) next();
    else {
      setAfterConsent({ run: next });
      setHistory(['consent']);
    }
  };

  const canBack = history.length > 1;
  // the demo shortcut has no real progress → no dots
  const progress = demo ? {} : { step: PROGRESS[step], total: TOTAL };

  switch (step) {
    case 'welcome':
      return (
        <Welcome
          onStart={() => push('choose')}
          onDemo={() => {
            setDemo(true);
            push('done');
          }}
        />
      );
    case 'choose':
      return <ChooseConnection onChoose={choose} onBack={canBack ? back : undefined} {...progress} />;
    case 'scan':
      return <ScanPair key={badLink ?? 'scan'} onPair={onPaired} onBack={back} initialLink={badLink} {...progress} />;
    case 'form':
      return (
        <ConnectionForm
          key={`${formMode}:${pairNonce}`}
          mode={formMode}
          pair={formMode === 'pair' ? pair : null}
          onBack={back}
          onNewLink={toNewLink}
          onConnected={onConnected}
          savedProfiles={existingProfiles}
          {...progress}
        />
      );
    case 'consent':
      // no back: the connection is saved already
      return (
        <ConsentStep
          onAccept={() => {
            void acceptAiConsent();
            afterConsent?.run();
          }}
          {...progress}
        />
      );
    case 'skill':
      // no back: the connection is saved already; going back would re-save
      return <SkillHint bridge={!!saved?.bridge} onDone={() => push('done')} {...progress} />;
    case 'done':
      return (
        <Done
          demo={demo}
          connectionName={saved?.name}
          onBack={demo ? back : undefined}
          onStart={(prompt) =>
            onFinish(demo ? { path: 'demo', starterPrompt: prompt } : { path: saved?.bridge ? 'bridge' : 'direct', profile: saved ?? undefined, starterPrompt: prompt })
          }
          {...progress}
        />
      );
  }
}

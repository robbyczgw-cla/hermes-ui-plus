// Onboarding v2 ("guided") for the official FLAVOR=hermes build. Step logic: guidedSteps.ts (pure, tested);
// this component holds the data (pair link, saved profile) and renders the screens. Same props / finish
// contract as the classic flow (OnboardingFlow.tsx picks the variant), so OnboardingHost and Settings don't care.
//
//   welcome → setup → (scan → check | noBridge → agentSetup/selfSetup → scan → check | manual | noHermes → demo)
//           → consent (compliance/Consent, skipped when the current text version was accepted) → done
import { useEffect, useReducer, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { ConsentStep } from '../compliance/Consent';
import { acceptAiConsent, isAiConsentCurrent } from '../compliance/store';
import type { ConnectionProfile } from '../settings/profiles';
import type { ConnectedInput } from './ConnectionForm';
import { canGoBack, current, GUIDED_TOTAL, guidedProgress, guidedReducer, initialGuidedState } from './guidedSteps';
import { buildHermesProfile } from './model';
import type { OnboardingFlowProps } from './OnboardingFlow';
import { parsePairLink, type PairData } from './pairLink';
import { ScanPair } from './ScanPair';
import { onboardingBack } from './backNav';
import { pairConnectBusy } from './connectLock';
import { deepLinkRoute } from './pairConnect';
import { OnbFrame } from './ui';
import { pageOrigin } from './webOrigin';
import { ConnectCheck } from './guided/ConnectCheck';
import { AgentSetupScreen, DoneGuidedScreen, NoBridgeScreen, NoHermesScreen, SelfSetupScreen, SetupChoiceScreen } from './guided/screens';
import { WelcomeGuided } from './guided/WelcomeGuided';

export function GuidedFlow({ existingProfiles = [], onSaveConnection, onFinish, initialPairLink, entry = 'welcome', finishAfterSave }: OnboardingFlowProps) {
  const [state, dispatch] = useReducer(guidedReducer, undefined, () => initialGuidedState(entry, !!finishAfterSave));
  const [pair, setPair] = useState<PairData | null>(null);
  const [badLink, setBadLink] = useState<string | null>(null);
  const [saved, setSaved] = useState<ConnectionProfile | null>(null);
  /** remounts the check screen for every new pair link (fresh state + auto test) */
  const [pairNonce, setPairNonce] = useState(0);
  const step = current(state);

  // deep link / pasted web hash → verification (or the scanner with the error). Once per link, during render
  // (React's "adjust state when a prop changes" pattern).
  const [handledLink, setHandledLink] = useState<string | null>(null);
  if (initialPairLink && initialPairLink !== handledLink && !state.saved) {
    setHandledLink(initialPairLink);
    const r = parsePairLink(initialPairLink, { origin: pageOrigin() });
    // a one-time code is redeemed only on "Verbinden" in the check screen (pairConnect.ts): opening a link never POSTs
    const direct = r.ok && deepLinkRoute(r) === 'form';
    if (r.ok && direct) {
      setPair(r.pair);
      setPairNonce((n) => n + 1);
      setBadLink(null);
    } else setBadLink(initialPairLink);
    dispatch({ type: 'deepLink', ok: direct });
  }

  // finish (adding a connection later: right after saving / consent)
  useEffect(() => {
    if (state.finished && saved) onFinish({ path: saved.bridge ? 'bridge' : 'direct', profile: saved });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when finished flips
  }, [state.finished]);

  // Android back walks back through the steps – never while a pair code is redeemed / saved (connectLock.ts), never
  // once the connection is saved (backNav.ts; swallowed, not passed on). Re-registered when that changes → asked
  // before the host.
  const backable = canGoBack(state);
  const isSaved = state.saved;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const action = onboardingBack({ busy: pairConnectBusy(), saved: isSaved, canPop: backable });
      if (action === 'pop') dispatch({ type: 'back' });
      return action !== 'pass';
    });
    return () => sub.remove();
  }, [backable, isSaved]);

  const back = backable ? () => dispatch({ type: 'back' }) : undefined;
  const progress = { step: guidedProgress(state), total: GUIDED_TOTAL };

  const onConnected = async (c: ConnectedInput, viaPair: PairData | null) => {
    const profile = buildHermesProfile({ baseUrl: c.url.baseUrl, apiKey: c.apiKey, name: c.name, bridge: c.probe?.bridge ?? !!viaPair }, existingProfiles);
    if (viaPair?.model) profile.model = viaPair.model;
    await onSaveConnection(profile);
    setSaved(profile);
    const consentCurrent = await isAiConsentCurrent().catch(() => false);
    dispatch({ type: 'saved', consentNeeded: !consentCurrent });
  };

  let screen;
  switch (step) {
    case 'welcome':
      screen = <WelcomeGuided onConnect={() => dispatch({ type: 'connect' })} onDemo={() => dispatch({ type: 'demo' })} />;
      break;
    case 'setup':
      screen = <SetupChoiceScreen onChoose={(choice) => dispatch({ type: 'choose', choice })} onBack={back} {...progress} />;
      break;
    case 'scan':
      screen = (
        <ScanPair
          key={badLink ?? 'scan'}
          initialLink={badLink}
          onBack={back ?? (() => {})}
          onPair={(p) => {
            setPair(p);
            setPairNonce((n) => n + 1);
            setBadLink(null);
            dispatch({ type: 'paired' });
          }}
          {...progress}
        />
      );
      break;
    case 'noBridge':
      screen = <NoBridgeScreen onOption={(option) => dispatch({ type: 'bridgeOption', option })} onBack={back} {...progress} />;
      break;
    case 'agentSetup':
      screen = <AgentSetupScreen onHaveLink={() => dispatch({ type: 'haveLink' })} onBack={back} {...progress} />;
      break;
    case 'selfSetup':
      screen = <SelfSetupScreen onHaveLink={() => dispatch({ type: 'haveLink' })} onBack={back} {...progress} />;
      break;
    case 'manual':
      screen = <ConnectCheck key="manual" mode="manual" onBack={back} onConnected={(c) => onConnected(c, null)} savedProfiles={existingProfiles} {...progress} />;
      break;
    case 'noHermes':
      screen = <NoHermesScreen onDemo={() => dispatch({ type: 'demo' })} onBack={back} {...progress} />;
      break;
    case 'check':
      screen = (
        <ConnectCheck
          key={`pair:${pairNonce}`}
          mode="pair"
          pair={pair}
          onBack={back}
          onNewLink={() => {
            setBadLink(null);
            dispatch({ type: 'newLink' });
          }}
          onConnected={(c) => onConnected(c, pair)}
          savedProfiles={existingProfiles}
          {...progress}
        />
      );
      break;
    case 'consent':
      // no back: the connection is saved already
      screen = (
        <ConsentStep
          onAccept={() => {
            void acceptAiConsent();
            dispatch({ type: 'consented' });
          }}
          {...progress}
        />
      );
      break;
    case 'done':
      screen = (
        <DoneGuidedScreen
          demo={state.demo}
          connectionName={saved?.name}
          onBack={back}
          onStart={(prompt) =>
            onFinish(state.demo ? { path: 'demo', starterPrompt: prompt } : { path: saved?.bridge ? 'bridge' : 'direct', profile: saved ?? undefined, starterPrompt: prompt })
          }
          {...progress}
        />
      );
      break;
  }
  return <OnbFrame>{screen}</OnbFrame>;
}

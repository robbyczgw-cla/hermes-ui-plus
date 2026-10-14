// Root-level host for the onboarding flow (owner: integration-B). Wrap the router <Stack> with it,
// INSIDE <ConnectionProvider> and <ConversationsProvider> (and the theme / safe-area / i18n providers):
//
//   <ConnectionProvider><ConversationsProvider><OnboardingHost><Stack …/></OnboardingHost></ConversationsProvider></ConnectionProvider>
//
// - first start (gate) → full flow from "Willkommen"
// - hermesui://pair deep links (cold start or running) → flow at the verification step, done right after saving
// - openOnboarding('choose' | 'welcome') from anywhere (Settings, demo banner) – see hostEvents.ts
// The flow is rendered as an overlay above the (always mounted) navigator, so router calls keep working.
//
// On finish: other → /settings · demo → demo profile active + new demo chat · connection saved → new chat
// on that profile · starter prompt → queued for the new chat (starterPrompt.ts; the session sends it).
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConversations } from '../conversations';
import { useT } from '../i18n';
import { useConnection } from '../settings/ConnectionProvider';
import { PRESET_DEMO_ID, type ConnectionProfile } from '../settings/profiles';
import { useTheme } from '../ui';
import { pairConnectBusy, pairConnectLock, pairLinkArrival } from './connectLock';
import { usePairDeepLink } from './deepLink';
import { subscribeOnboardingRequests, type OnboardingRequest } from './hostEvents';
import type { OnboardingFinish } from './OnboardingFlow';
import { OnboardingScreen } from './OnboardingScreen';
import { usePairConnectBusy } from './useConnectLock';
import { queueStarterPrompt } from './starterPrompt';
import { parsePairLink } from './pairLink';
import { samePairTarget } from './pairRecovery';
import { clearPairRecovery, loadPairRecovery, markPairLinkApplied, useOnboardingGate, wasPairLinkUsed } from './storage';
import { pageOrigin } from './webOrigin';

type Shown = { entry: 'welcome' | 'choose'; pairLink: string | null; dismissable: boolean; nonce: number };

export function OnboardingHost({ children }: { children: ReactNode }) {
  const gate = useOnboardingGate();
  const { profiles, setActive, ready: connReady } = useConnection();
  const convs = useConversations();
  const [shown, setShown] = useState<Shown | null>(null);

  // first start
  useEffect(() => {
    if (gate.ready && gate.needed) setShown((s) => s ?? { entry: 'welcome', pairLink: null, dismissable: false, nonce: Date.now() });
  }, [gate.ready, gate.needed]);

  // pair links: also when already onboarded ("add connection")
  const showLink = useCallback((link: string) => {
    setShown((s) => ({ entry: s?.entry ?? 'choose', pairLink: link, dismissable: s ? s.dismissable : true, nonce: s?.nonce ?? Date.now() }));
  }, []);
  // the shown flow saved its connection (by nonce): its post-connect steps ignore new links, so those wait
  const [savedNonce, setSavedNonce] = useState<number | null>(null);
  const flowSaved = !!shown && savedNonce === shown.nonce;
  const flowSavedRef = useRef(flowSaved);
  useEffect(() => {
    flowSavedRef.current = flowSaved;
  }, [flowSaved]);
  const connecting = usePairConnectBusy();

  // Links are handled one after another, in order of arrival.
  // (the same link opened again – web hashchange – is a new delivery)
  const inbox = useRef<string[]>([]);
  const [inboxTick, setInboxTick] = useState(0);
  const deliver = useCallback((link: string) => {
    inbox.current.push(link);
    setInboxTick((n) => n + 1);
  }, []);
  usePairDeepLink(deliver);
  /** the latest link that arrived while a pair code was redeemed / after the flow saved: handled once that is over */
  const deferred = useRef<string | null>(null);
  const handleLink = useCallback(
    async (link: string) => {
      // A link that was saved or whose one-time code was redeemed is never offered again, on every platform: the web
      // app's start URL re-delivers its pair link on every launch, Android the VIEW intent after an activity
      // recreation (configuration change) or a process restart (E2E round 4, B3).
      const r = parsePairLink(link, { origin: pageOrigin() });
      const code = r.ok ? r.pair.code : undefined;
      let show = link;
      if (await wasPairLinkUsed(link, code).catch(() => false)) {
        // its code was redeemed here but the connection never saved (pending recovery, pairRecovery.ts): offer that
        // connection (token link) instead of suppressing the link
        const kept = r.ok && r.pair.code ? await loadPairRecovery().catch(() => null) : null;
        if (!kept || !r.ok || !samePairTarget(kept.pair, r.pair)) return;
        show = kept.link;
      }
      // never while "Verbinden" runs (connectLock.ts): the same code again is dropped, any other link waits
      const action = pairLinkArrival({ code, busy: pairConnectBusy(), running: pairConnectLock.codes(), flowSaved: flowSavedRef.current });
      if (action === 'drop') return;
      if (action === 'defer') {
        deferred.current = link;
        return;
      }
      showLink(show);
    },
    [showLink],
  );
  const draining = useRef(false);
  useEffect(() => {
    if (draining.current) return;
    draining.current = true;
    // the host lives at the app root (never unmounts) → no cancellation needed
    void (async () => {
      while (inbox.current.length) await handleLink(inbox.current.shift() as string).catch(() => {});
      draining.current = false;
    })();
  }, [inboxTick, handleLink]);
  // the connect run is over (failed: the link is shown now) / the flow that saved finished: handle the waiting link
  useEffect(() => {
    if (connecting || flowSaved || !deferred.current) return;
    const link = deferred.current;
    deferred.current = null;
    deliver(link);
  }, [connecting, flowSaved, deliver]);

  // A redeemed device token whose save failed (pending recovery, pairRecovery.ts) is offered again at app start and
  // whenever the flow is opened: it is the only way back into that bridge (the link is used up). Delivered like a
  // pair link (token link), so the same rules apply as for any other link.
  const profilesRef = useRef(profiles);
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);
  const offerRecovery = useCallback(() => {
    void (async () => {
      const kept = await loadPairRecovery().catch(() => null);
      if (!kept) return;
      // saved after all (only the clean-up failed): nothing to offer
      if (profilesRef.current.some((p) => !!p.apiKey && p.apiKey === kept.pair.token)) {
        await clearPairRecovery(kept.pair.token).catch(() => {});
        return;
      }
      deliver(kept.link);
    })();
  }, [deliver]);
  useEffect(() => {
    if (connReady) offerRecovery();
  }, [connReady, offerRecovery]);

  // requests from Settings / demo banner
  const { restart } = gate;
  useEffect(
    () =>
      subscribeOnboardingRequests((r: OnboardingRequest) => {
        if (r.restart) void restart();
        setShown({ entry: r.entry, pairLink: null, dismissable: !r.restart, nonce: Date.now() });
        offerRecovery();
      }),
    [restart, offerRecovery],
  );

  const close = useCallback(() => setShown(null), []);

  const startChat = useCallback(
    (profile: Pick<ConnectionProfile, 'id' | 'kind'>, starterPrompt?: string) => {
      // conversations' ProfileRef: {id, kind}
      const meta = convs.create(profile as Parameters<typeof convs.create>[0]);
      if (starterPrompt && meta?.id) queueStarterPrompt(meta.id, starterPrompt);
    },
    [convs],
  );

  const shownLink = shown?.pairLink ?? null;
  const onFinish = useCallback(
    (r: OnboardingFinish) => {
      void gate.complete(r.path);
      setShown(null);
      if (shownLink && r.profile) void markPairLinkApplied(shownLink);
      if (r.path === 'other') {
        router.push('/settings');
        return;
      }
      if (r.path === 'demo') {
        const demo = profiles.find((p) => p.id === PRESET_DEMO_ID);
        if (demo) {
          setActive(demo.id);
          startChat(demo, r.starterPrompt);
        }
        return;
      }
      // bridge / direct: OnboardingScreen already saved + activated the profile
      if (r.profile) startChat(r.profile, r.starterPrompt);
    },
    [gate, profiles, setActive, startChat, shownLink],
  );

  // Android back on the first step of a dismissable flow closes it (the flow handles deeper steps first) – never while
  // a pair code is redeemed / its connection saved (connectLock.ts): the token would be lost
  useEffect(() => {
    if (!shown?.dismissable || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pairConnectBusy()) return true;
      close();
      return true;
    });
    return () => sub.remove();
  }, [shown?.dismissable, close]);

  return (
    <View style={styles.flex}>
      {children}
      {shown && connReady ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <OnboardingScreen
            key={shown.nonce}
            entry={shown.entry}
            initialPairLink={shown.pairLink}
            finishAfterSave={shown.entry === 'choose'}
            onFinish={onFinish}
            onSaved={() => {
              flowSavedRef.current = true;
              setSavedNonce(shown.nonce);
            }}
          />
          {shown.dismissable && !connecting ? <CloseButton onPress={close} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function CloseButton({ onPress }: { onPress(): void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={tr('onboarding.common.close')}
      style={({ pressed }) => [styles.close, { top: insets.top + 11, backgroundColor: t.colors.surfaceAlt, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.closeText, { color: t.colors.text }]}>✕</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { zIndex: 100, elevation: 100 },
  close: { position: 'absolute', right: 14, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '600' },
});

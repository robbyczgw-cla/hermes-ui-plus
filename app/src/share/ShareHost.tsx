/**
 * "Share to HUI+" host (mounted once in the root layout, inside the toast / connection / conversation providers).
 *
 * Intake: Android / iOS shares via expo-share-intent (cold start, app in the background: both arrive here), the web
 * share target via sw.js (webIntake.ts). Every share goes into the inbox (inbox.ts) first and waits there until the
 * gate allows the sheet: stored profiles + chats are read, no onboarding is on screen, the app is unlocked. Without a
 * real connection the sheet explains that and offers pairing; the share stays in the inbox meanwhile.
 * Nothing is ever sent from here without the user tapping Send in the sheet (ShareSheet.tsx).
 */
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useShareIntent } from 'expo-share-intent';
import { useToast } from '../chat/Toast';
import { useConversations } from '../conversations';
import { isDesktopApp } from '../desktop/bridge';
import { isLocked } from '../desktop/lock';
import { useT } from '../i18n';
import { isOnboardingVisible, subscribeOnboardingVisible } from '../onboarding/hostEvents';
import { useOnboardingGate } from '../onboarding/storage';
import { useConnection } from '../settings/ConnectionProvider';
import { offerShare } from './inbox';
import { fromNativeShare, shareGate, shareProfiles } from './model';
import { useOfferedShare } from './useShare';
import { readWebShare, takeShareParam, type ShareParam } from './webIntake';

// the sheet (and expo-image for its thumbnails) loads only when something was shared
const ShareSheet = lazy(() => import('./ShareSheet'));

// web: take `#huiShare=…` out of the address bar right at start (like the pair link, deepLink.ts)
let webParam: ShareParam | null = null;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    webParam = takeShareParam(window.location.href);
    if (webParam) window.history.replaceState(window.history.state, '', webParam.cleanUrl);
  } catch {
    webParam = null;
  }
}

/**
 * The app lock in front of the sheet. Today only the desktop app has one (desktop/lock.ts; it receives no shares);
 * a mobile app lock plugs in here: while it is locked the share waits in the inbox, the sheet opens after the unlock.
 */
function useAppLocked(): boolean {
  return isDesktopApp() && isLocked();
}

function useNativeIntake(): void {
  const toast = useToast();
  const tr = useT();
  // resetOnBackground false: the share must survive the app going to the background (biometric prompt, pairing via
  // the camera, a look at the source app) – the inbox owns it as soon as it arrived
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({ resetOnBackground: false, disabled: Platform.OS === 'web' });
  useEffect(() => {
    if (!hasShareIntent) return;
    const payload = fromNativeShare(shareIntent);
    resetShareIntent();
    if (payload) offerShare(payload);
    else toast(tr('share.intake.failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent, shareIntent]);
  useEffect(() => {
    if (!error) return;
    console.warn('[share] intake failed');
    toast(tr('share.intake.failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
}

function useWebIntake(): void {
  const toast = useToast();
  const tr = useT();
  useEffect(() => {
    const p = webParam;
    webParam = null;
    if (!p) return;
    if (p.id === 'missed') return toast(tr('share.intake.missed'));
    if (p.id === 'failed' || typeof caches === 'undefined') return toast(tr('share.intake.failed'));
    void readWebShare(p.id, caches).then((r) => {
      // Expo Router restores the start URL (with the fragment) after the module-level clean-up: drop it again so a
      // reload does not come back here
      if (window.location.hash.startsWith('#huiShare=')) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      // nothing stored = this share was sent or cancelled already (reload, back navigation): nothing to say
      if (r) offerShare(r.payload, r.release);
    }).catch(() => toast(tr('share.intake.failed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function ShareHost() {
  useNativeIntake();
  useWebIntake();
  const share = useOfferedShare();
  const { ready: connReady, profiles } = useConnection();
  const { ready: convsReady } = useConversations();
  // the first-start flow is about to open (flag read here, flow not mounted yet): wait for it instead of flashing the
  // sheet. This hook instance only reads the stored flag once; the flow on screen is tracked via hostEvents.
  const firstRun = useOnboardingGate();
  const onboarding = useSyncExternalStore(subscribeOnboardingVisible, isOnboardingVisible, isOnboardingVisible);
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  if (onboarding && !onboardingSeen) setOnboardingSeen(true);
  const firstStart = !firstRun.ready || (firstRun.needed && !onboardingSeen);
  const locked = useAppLocked();
  const gate = shareGate({
    ready: connReady && convsReady,
    locked,
    onboarding: onboarding || firstStart,
    paired: shareProfiles(profiles).length > 0,
  });
  // the sheet chunk stays loaded once used (a second share opens instantly)
  const [used, setUsed] = useState(false);
  if (share && !used && gate !== 'wait' && gate !== 'locked') setUsed(true);
  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <ShareSheet share={gate === 'ready' || gate === 'pair' ? share : null} gate={gate} />
    </Suspense>
  );
}

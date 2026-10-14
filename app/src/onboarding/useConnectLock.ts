// React side of connectLock.ts: the busy state for rendering (hide back / close) and a hardware-Back guard.
import { useEffect, useSyncExternalStore } from 'react';
import { BackHandler, Platform } from 'react-native';
import { pairConnectBusy, pairConnectLock } from './connectLock';

/** true while a pair code is redeemed / its connection saved (any screen) */
export function usePairConnectBusy(): boolean {
  return useSyncExternalStore(pairConnectLock.subscribe, pairConnectBusy, pairConnectBusy);
}

/**
 * Android: swallow hardware Back while `active`. Registered when the run starts, so it is the newest listener and
 * BackHandler asks it first – before the flow, the onboarding host and the router (which would exit the activity).
 */
export function useSwallowBack(active: boolean): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [active]);
}

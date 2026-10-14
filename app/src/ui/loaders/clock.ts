// Shared clock for the loader library: one linear 0→1 shared value per loader, driven on the UI thread
// (withRepeat/withTiming – no per-frame JS / setState). Pauses while the app is in the background
// (RN-web: document hidden) and rests on a fixed pose when animation is off (reduced motion / Dezent).
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { cancelAnimation, Easing, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

let active = AppState.currentState !== 'background';
const listeners = new Set<() => void>();
let sub: { remove(): void } | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!sub) {
    active = AppState.currentState !== 'background';
    sub = AppState.addEventListener('change', (s) => {
      const next = s !== 'background';
      if (next === active) return;
      active = next;
      listeners.forEach((l) => l());
    });
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && sub) {
      sub.remove();
      sub = null;
    }
  };
}

/** App in foreground (one shared AppState listener for all loaders). */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, () => active, () => true);
}

/**
 * Linear loop 0→1 every `duration` ms while `animate` and the app is active; otherwise rests at `rest`.
 * Loaders derive every element's phase from this one value in worklets (sin/cos, offsets).
 */
export function useLoop(duration: number, animate: boolean, rest = 0.3): SharedValue<number> {
  const appActive = useAppActive();
  const running = animate && appActive;
  const v = useSharedValue(running ? 0 : rest);
  useEffect(() => {
    if (!running) {
      cancelAnimation(v);
      v.value = rest;
      return;
    }
    v.value = 0;
    v.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(v);
  }, [running, duration, rest, v]);
  return v;
}

export type LoaderProps = {
  /** box size in px (square; the chameleon uses size × 0.75 height). Default 28. */
  size?: number;
  /** false → static pose (reduced motion, Dezent). Default true. */
  animate?: boolean;
};

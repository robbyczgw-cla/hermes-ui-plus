/**
 * Did the app go to the background during a turn? One app-wide AppState listener counts background
 * transitions; a turn snapshots the counter when it starts (`watchBackground`) and asks at its end.
 * (iOS `inactive` = app switcher / control center: sockets survive it, so only `background` counts.)
 */
import { AppState, Platform } from 'react-native';
import type { CutPlatform } from './cut';

let transitions = 0;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', (s) => {
    if (s === 'background') transitions++;
  });
}

export function isAppBackground(): boolean {
  return AppState.currentState === 'background';
}

export function watchBackground(): { wasBackgrounded(): boolean } {
  install();
  const start = transitions;
  const startedInBackground = isAppBackground();
  return { wasBackgrounded: () => startedInBackground || transitions !== start || isAppBackground() };
}

export function cutPlatform(): CutPlatform {
  return Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'other';
}

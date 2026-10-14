/**
 * "Antworten" switches (docs/SPEC-modules-v4.md A2–A6) as seen by the ui/ layer, which does not import
 * settings/: PreferencesProvider pushes them with `setAnswerUiPrefs`, components read them with
 * `useAnswerUiPrefs()` (re-renders only when one of these switches changes).
 */
import { useSyncExternalStore } from 'react';

export type AnswerUiPrefs = { summary: boolean; footnotes: boolean; motion: boolean };

let current: AnswerUiPrefs = Object.freeze({ summary: true, footnotes: true, motion: true });
const listeners = new Set<() => void>();

export function setAnswerUiPrefs(next: AnswerUiPrefs): void {
  if (next.summary === current.summary && next.footnotes === current.footnotes && next.motion === current.motion) return;
  current = Object.freeze({ ...next });
  listeners.forEach((l) => l());
}

export function getAnswerUiPrefs(): AnswerUiPrefs {
  return current;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useAnswerUiPrefs(): AnswerUiPrefs {
  return useSyncExternalStore(subscribe, getAnswerUiPrefs, getAnswerUiPrefs);
}

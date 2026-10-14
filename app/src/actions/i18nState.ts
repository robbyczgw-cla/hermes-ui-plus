/**
 * Action text language for non-React singletons (the timer store's "timer finished" notification and
 * the Android notification channel). React code passes `i18n` explicitly; `ActionRunnerProvider` keeps
 * this current with the active language. Outside a provider it is German, like the i18n core.
 */
import { makeT } from '../i18n/core.ts';
import type { ActionI18n } from './types.ts';

let current: ActionI18n = { t: makeT('de', 'de-DE'), locale: 'de-DE' };

export function getActionI18n(): ActionI18n {
  return current;
}

export function setActionI18n(i18n: ActionI18n): void {
  current = i18n;
}

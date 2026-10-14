/**
 * App-bundle variant of `dicts.ts` (swapped in by metro.config.js): en/es are separate lazy
 * modules (own web chunks), loaded by I18nProvider when the language is needed.
 */
import type { de } from './de.ts';

type Dict = typeof de;

export const EAGER_DICTS: Partial<Record<'en' | 'es', Dict>> = {};

export function importDictionary(lang: 'en' | 'es'): Promise<Dict> {
  return lang === 'en' ? import('./en.ts').then((m) => m.en) : import('./es.ts').then((m) => m.es);
}

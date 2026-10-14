/**
 * Extra (non-German) dictionaries – Node / unit-test / tsc variant: everything is loaded eagerly,
 * so `makeT('en', …)` works synchronously in tests and scripts.
 *
 * The APP bundle swaps this module for `dicts.app.ts` (see metro.config.js), which loads en/es on
 * demand via `import()` → only German (source of truth + fallback) is in the startup bundle, the
 * active language is loaded by I18nProvider before it renders.
 */
import type { de } from './de.ts';
import { en } from './en.ts';
import { es } from './es.ts';

type Dict = typeof de;

export const EAGER_DICTS: Partial<Record<'en' | 'es', Dict>> = { en, es };

export function importDictionary(lang: 'en' | 'es'): Promise<Dict> {
  return Promise.resolve(lang === 'en' ? en : es);
}

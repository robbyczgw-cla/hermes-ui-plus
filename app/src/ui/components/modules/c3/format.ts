/** Small pure helpers shared by the c3 models (number formatting, reply tags). */

export type NumLang = 'de' | 'en' | 'es';

/** Collapse whitespace/newlines so a reply stays one readable line. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function tag(kind: string, id: string): string {
  return `[${kind}:${oneLine(id) || kind}]`;
}

/** Fixed 1 decimal with the language's decimal separator: 7,8 (de/es) · 7.8 (en). */
export function fixed1(n: number, lang: NumLang = 'de'): string {
  if (!Number.isFinite(n)) return '–';
  const s = (Math.round(n * 10 + (n < 0 ? -1e-9 : 1e-9)) / 10).toFixed(1);
  return lang === 'en' ? s : s.replace('.', ',');
}

/** Up to `max` decimals, trailing zeros trimmed: 4 · 3,5 · 0,25. */
export function trimNum(n: number, lang: NumLang = 'de', max = 2): string {
  if (!Number.isFinite(n)) return '–';
  const s = String(Number(n.toFixed(max)));
  return lang === 'en' ? s : s.replace('.', ',');
}

export function numLang(lang: string): NumLang {
  return lang === 'en' || lang === 'es' ? lang : 'de';
}

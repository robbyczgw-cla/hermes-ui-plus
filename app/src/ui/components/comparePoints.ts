/**
 * Marker kinds for `compare` column points (B4): a green check on every bullet claimed even
 * downsides were good. Only explicit `pros` / `cons` (schema, like `products`) get check / minus.
 * Legacy `items` are neutral facts (dot): the text is never guessed from wording (a cue-word
 * heuristic marked "Kein permanentes Einbrennen", a PRO, as a con). A neutral dot never lies,
 * a wrong check or minus does. The skill tells Hermes to sort judgements into pros/cons.
 * Pure TS for `node --test`.
 */
export type ComparePointKind = 'pro' | 'con' | 'neutral';
export type ComparePoint = { kind: ComparePointKind; text: string };

/** A model sometimes repeats the marker inside pros/cons ("+ Günstig", "Contra: Laut"): strip it. */
const PRO_PREFIX = /^(?:[+✓✔]\s+|(?:pro|plus|vorteil|ventaja)\s*:\s*)/i;
const CON_PREFIX = /^(?:[-−–✗✕×]\s+|(?:con|contra|minus|nachteil|desventaja)\s*:\s*)/i;

/** Display rows of one column: legacy `items` (neutral) in order, then explicit pros, then cons. */
export function compareRows(col: { items?: readonly string[]; pros?: readonly string[]; cons?: readonly string[] }): ComparePoint[] {
  const clean = (xs?: readonly string[]) => (xs ?? []).map((s) => s.trim()).filter(Boolean);
  return [
    ...clean(col.items).map((text) => ({ kind: 'neutral' as const, text })),
    ...clean(col.pros).map((text) => ({ kind: 'pro' as const, text: text.replace(PRO_PREFIX, '').trim() })),
    ...clean(col.cons).map((text) => ({ kind: 'con' as const, text: text.replace(CON_PREFIX, '').trim() })),
  ];
}

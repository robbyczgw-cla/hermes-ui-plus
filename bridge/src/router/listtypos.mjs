// Tolerant matching for the list words only (de / en / es): one swapped or missing letter ("Einkaufslsite") still
// reads as the list word. Everything else in a message is left alone, so unrelated words cannot start matching.

// Short words: only an adjacent swap counts ("lsit", "lsita"); one wrong letter would hit real words
// (list/last/lost, lista/listo/vista, liste/leiste).
const SHORT = ['liste', 'lista', 'list'];
// Long words: one edit (swap, missing, extra or wrong letter) is safe at this length.
const LONG = ['einkaufsliste', 'einkaufszettel', 'checkliste', 'checklist', 'watchlist', 'merkliste', 'aufgabenliste', 'packliste', 'todoliste'];

const swaps = (w) => {
  const out = [];
  for (let i = 0; i < w.length - 1; i++) if (w[i] !== w[i + 1]) out.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  return out;
};
const SHORT_TYPOS = new Map(SHORT.flatMap((w) => swaps(w).map((t) => [t, w])));
const TAIL_TYPOS = new Map(['liste', 'lista'].flatMap((w) => swaps(w).map((t) => [t, w])));

/** Damerau distance <= 1 (one substitution, insertion, deletion or adjacent swap). */
function withinOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ra = a.slice(i + 1), rb = b.slice(i + 1);
  if (a.length === b.length) return ra === rb || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? ra === b.slice(i) : a.slice(i) === rb;
}

function fixToken(tok) {
  const w = tok.toLowerCase();
  // a correctly spelt list word stays as it is ("checklist" is one edit from "checkliste")
  if (LONG.includes(w)) return tok;
  if (SHORT_TYPOS.has(w)) return SHORT_TYPOS.get(w);
  if (w.length >= 8) {
    // compound ending in a swapped "liste" / "lista": Einkaufslsite, Reiseplanliset
    const fixed = TAIL_TYPOS.get(w.slice(-5));
    if (fixed) return w.slice(0, -5) + fixed;
  }
  if (w.length >= 9) for (const k of LONG) if (w !== k && withinOne(w, k)) return k;
  return tok;
}

/** `text` with typo'd list words replaced by the correct word (other words untouched). */
export const fixListTypos = (text) => String(text ?? '').replace(/[\p{L}\p{N}]+/gu, fixToken);

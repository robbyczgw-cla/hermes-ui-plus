import type { ConversationMeta, SearchHit } from './types.ts';

/** Lowercase + strip diacritics so "uebersicht"/"Übersicht" and "cafe"/"café" both match. German ß/ä/ö/ü also match their base letters. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function tokenize(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

function matchesAll(haystack: string, tokens: string[]): boolean {
  for (const t of tokens) if (!haystack.includes(t)) return false;
  return true;
}

/**
 * Excerpt of ~`width` chars around the first token hit in `text` (original casing).
 * Works on the folded string for matching; folding can change length (ß -> ss, NFD) so we only
 * use the folded index as an approximation after mapping char-by-char.
 */
export function snippetAround(text: string, tokens: string[], width = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  // fold char by char so indices stay aligned with `flat`
  let folded = '';
  for (const ch of flat) {
    const f = fold(ch);
    folded += f.length === 1 ? f : f.charAt(0) || ' ';
  }
  let idx = -1;
  for (const t of tokens) {
    const i = folded.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return flat.slice(0, width);
  const start = Math.max(0, idx - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}

/**
 * Search conversations by title (first) and message text. All whitespace-separated tokens must occur
 * (AND). Title hits rank before message-only hits; each group keeps the incoming order (list is
 * already sorted by recency). Empty query -> [].
 */
export function searchConversations(
  items: ConversationMeta[],
  query: string,
  textOf: (id: string) => string | undefined
): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const titleHits: SearchHit[] = [];
  const bodyHits: SearchHit[] = [];
  for (const meta of items) {
    const title = fold(meta.title);
    if (matchesAll(title, tokens)) {
      titleHits.push({ meta, in: 'title' });
      continue;
    }
    const text = textOf(meta.id);
    if (text && matchesAll(fold(text), tokens)) {
      bodyHits.push({ meta, in: 'message', snippet: snippetAround(text, tokens) });
    }
  }
  return [...titleHits, ...bodyHits];
}

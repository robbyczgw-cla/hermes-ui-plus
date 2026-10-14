/**
 * "Im Chat suchen" (chat menu, ⌘/Ctrl+F), pure part (node:test, findInChat.test.ts): case- and accent-insensitive
 * matching over the visible text of a chat – user messages, the Markdown of answers and the text inside hui
 * components (titles, labels, items, …, never JSON keys, ids, URLs or colours) – plus the match ranges the
 * Markdown / bubble renderers highlight.
 */
import type { ChatMessage } from '../hermes/types.ts';
import { stripTurnExtras } from '../hermes/turnOverride.ts';
import { parseMessage } from '../protocol/streamParser.ts';

/** shortest query that is searched (1 char would light up every message) */
export const FIND_MIN_CHARS = 2;

type Folded = { folded: string; map: number[] };

/** lowercase + accents removed, with a map folded index → original index */
export function foldWithMap(s: string): Folded {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // surrogate pairs (emoji) stay as they are
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      folded += s[i] + s[i + 1];
      map.push(i, i);
      i++;
      continue;
    }
    const f = foldChar(s[i]);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
  }
  return { folded, map };
}

function foldChar(c: string): string {
  return c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function foldText(s: string): string {
  return foldWithMap(s).folded;
}

/** normalized query ('' = nothing to search) */
export function normalizeQuery(q: string): string {
  const f = foldText(q.trim().replace(/\s+/g, ' '));
  return f.length >= FIND_MIN_CHARS ? f : '';
}

/** [start, end) ranges of every match of `query` in `text` (original indices) */
export function matchRanges(text: string, query: string): [number, number][] {
  const q = normalizeQuery(query);
  if (!q || !text) return [];
  const { folded, map } = foldWithMap(text);
  const out: [number, number][] = [];
  let from = 0;
  for (;;) {
    const k = folded.indexOf(q, from);
    if (k === -1) break;
    const start = map[k];
    let end = map[k + q.length - 1] + 1;
    // combining marks after the last matched letter belong to it (decomposed "é")
    while (end < text.length && /[\u0300-\u036f]/.test(text[end])) end++;
    out.push([start, end]);
    from = k + q.length;
  }
  return out;
}

export function countMatches(text: string, query: string): number {
  const q = normalizeQuery(query);
  if (!q || !text) return 0;
  const folded = foldText(text);
  let n = 0;
  for (let k = folded.indexOf(q); k !== -1; k = folded.indexOf(q, k + q.length)) n++;
  return n;
}

/** split text into plain / matched parts (renderers wrap the matched ones) */
export function splitMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const ranges = matchRanges(text, query);
  if (!ranges.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) parts.push({ text: text.slice(at, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** keys of hui nodes whose string values are not visible text */
const SKIP_KEYS = new Set([
  'type', 'id', 'key', 'icon', 'emoji', 'color', 'tone', 'variant', 'layout', 'style', 'url', 'href', 'src', 'image',
  'uri', 'action', 'actions', 'format', 'lang', 'language', 'unit', 'currency', 'kind', 'mode', 'lat', 'lng', 'at',
  'start', 'end', 'date', 'time', 'phone', 'email', 'value', 'min', 'max', 'step', 'name', 'field', 'placeholderKey',
]);

/** visible strings of a hui node (depth-first, document order) */
export function huiText(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 24 || node === null || node === undefined) return out;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return out;
  }
  if (typeof node === 'number') return out;
  if (Array.isArray(node)) {
    for (const x of node) huiText(x, out, depth + 1);
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k)) continue;
      huiText(v, out, depth + 1);
    }
  }
  return out;
}

/** searchable text of one message: what the user sees (Markdown source + hui strings), not the raw JSON */
export function searchableText(m: Pick<ChatMessage, 'role' | 'text'>): string {
  if (m.role === 'user') return stripTurnExtras(m.text);
  const parts: string[] = [];
  for (const seg of parseMessage(m.text)) {
    if (seg.kind === 'markdown') parts.push(seg.text);
    else if (seg.kind === 'hui' && seg.node) parts.push(huiText(seg.node).join('\n'));
  }
  return parts.join('\n');
}

export type FindMatch = { messageId: string; /** occurrence within that message */ index: number };

export type FindResult = {
  /** every match in chat order (oldest message first) */
  matches: FindMatch[];
  /** ids of messages with at least one match */
  messageIds: Set<string>;
};

export const NO_FIND: FindResult = { matches: [], messageIds: new Set() };

/**
 * All matches of `query` in the chat. `foldedOf` returns the folded searchable text of a message; the chat view
 * caches it per message object so streaming does not re-parse and re-fold every answer on each update.
 */
export function findInMessages(
  messages: readonly Pick<ChatMessage, 'id' | 'role' | 'text'>[],
  query: string,
  foldedOf: (m: Pick<ChatMessage, 'id' | 'role' | 'text'>) => string = (m) => foldText(searchableText(m)),
): FindResult {
  const q = normalizeQuery(query);
  if (!q) return NO_FIND;
  const matches: FindMatch[] = [];
  const messageIds = new Set<string>();
  for (const m of messages) {
    const text = foldedOf(m);
    let n = 0;
    for (let k = text.indexOf(q); k !== -1; k = text.indexOf(q, k + q.length)) matches.push({ messageId: m.id, index: n++ });
    if (n) messageIds.add(m.id);
  }
  return { matches, messageIds };
}

/** next / previous match index (wraps around); -1 when there are none */
export function stepMatch(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

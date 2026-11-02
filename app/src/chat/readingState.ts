/**
 * Per-chat reading state that survives switching chats and an app restart (pure part, node:test readingState.test.ts;
 * storage in readingStore.ts): the unsent draft (text + quotes), the reading position when the user had scrolled up
 * (`anchor`: the message in view) and the newest message the user has seen (`seen`: the "jump to latest" button counts
 * the answers after it). Device-local UI state, never synced.
 */
import type { Quote } from './quoteWire.ts';

export type ChatReading = {
  draft?: string;
  quotes?: Quote[];
  /** message in view while scrolled up; absent = at the newest message */
  anchor?: string;
  /** scroll offset from the newest message (px) at `anchor`, valid while the chat still has `count` messages */
  offset?: number;
  count?: number;
  /** newest message the user had on screen */
  seen?: string;
  /** last change (ms): the oldest entries go first when the map is full */
  at: number;
};
export type ReadingMap = Record<string, ChatReading>;

/** chats remembered (least recently changed dropped first) */
export const MAX_READING_ENTRIES = 300;
/** a draft longer than this is stored cut (the composer keeps the full text while the chat is open) */
export const MAX_DRAFT_CHARS = 20_000;

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const ID_MAX = 200;

function parseQuotes(x: unknown): Quote[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: Quote[] = [];
  for (const q of x.slice(0, 3)) {
    if (!q || typeof q !== 'object') continue;
    const r = q as Record<string, unknown>;
    if (!isStr(r.text) || !r.text.trim()) continue;
    out.push({ ...(isStr(r.ref) && r.ref.length <= ID_MAX ? { ref: r.ref } : {}), role: r.role === 'user' ? 'user' : 'assistant', text: r.text.slice(0, 400) });
  }
  return out.length ? out : undefined;
}

/** stored JSON → map; anything malformed is dropped entry by entry (never throws) */
export function parseReading(raw: string | null | undefined): ReadingMap {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: ReadingMap = {};
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    if (!e || typeof e !== 'object' || id.length > ID_MAX) continue;
    const r = e as Record<string, unknown>;
    const entry: ChatReading = { at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0 };
    if (isStr(r.draft) && r.draft) entry.draft = r.draft.slice(0, MAX_DRAFT_CHARS);
    const quotes = parseQuotes(r.quotes);
    if (quotes) entry.quotes = quotes;
    if (isStr(r.anchor) && r.anchor && r.anchor.length <= ID_MAX) entry.anchor = r.anchor;
    if (isStr(r.seen) && r.seen && r.seen.length <= ID_MAX) entry.seen = r.seen;
    if (entry.anchor && isNum(r.offset) && isNum(r.count)) {
      entry.offset = r.offset;
      entry.count = r.count;
    }
    if (!isEmpty(entry)) out[id] = entry;
  }
  return out;
}

const isEmpty = (e: ChatReading) => !e.draft && !e.quotes?.length && !e.anchor && !e.seen;

export type ReadingPatch = {
  draft?: string | null;
  quotes?: readonly Quote[] | null;
  /** the reading position; null = at the newest message (also clears offset / count) */
  anchor?: { id: string; offset?: number; count?: number } | null;
  seen?: string | null;
};

/**
 * The map with one chat's entry changed (`null` / '' clears a field). Returns the SAME map when nothing changed
 * (no write needed). Empty entries are removed; over MAX_READING_ENTRIES the least recently changed go.
 */
export function patchReading(map: ReadingMap, id: string, patch: ReadingPatch, now: number): ReadingMap {
  if (!id) return map;
  const prev = map[id];
  const next: ChatReading = { ...(prev ?? { at: now }) };
  let changed = false;
  const set = <K extends 'draft' | 'seen'>(k: K, v: string | null | undefined) => {
    if (v === undefined) return;
    const val = k === 'draft' && v ? v.slice(0, MAX_DRAFT_CHARS) : v;
    if ((next[k] ?? null) === (val || null)) return;
    changed = true;
    if (val) next[k] = val;
    else delete next[k];
  };
  set('draft', patch.draft);
  if (patch.anchor !== undefined) {
    const a = patch.anchor;
    const offset = a && isNum(a.offset) && isNum(a.count) ? Math.round(a.offset) : undefined;
    const count = offset !== undefined ? a!.count : undefined;
    if ((next.anchor ?? null) !== (a?.id || null) || next.offset !== offset || next.count !== count) {
      changed = true;
      if (a?.id) next.anchor = a.id;
      else delete next.anchor;
      if (offset !== undefined) {
        next.offset = offset;
        next.count = count;
      } else {
        delete next.offset;
        delete next.count;
      }
    }
  }
  set('seen', patch.seen);
  if (patch.quotes !== undefined) {
    const q = patch.quotes?.length ? patch.quotes.slice(0, 3) : undefined;
    if (JSON.stringify(q ?? null) !== JSON.stringify(next.quotes ?? null)) {
      changed = true;
      if (q) next.quotes = q.map((x) => ({ ...x }));
      else delete next.quotes;
    }
  }
  if (!changed) return map;
  next.at = now;
  const out: ReadingMap = { ...map };
  if (isEmpty(next)) delete out[id];
  else out[id] = next;
  const ids = Object.keys(out);
  if (ids.length > MAX_READING_ENTRIES) {
    ids.sort((a, b) => out[a].at - out[b].at);
    for (const old of ids.slice(0, ids.length - MAX_READING_ENTRIES)) delete out[old];
  }
  return out;
}

/** a chat's entry removed (chat deleted) */
export function forgetReadingIn(map: ReadingMap, id: string): ReadingMap {
  if (!(id in map)) return map;
  const out = { ...map };
  delete out[id];
  return out;
}

/** a chat's unsent draft taken over by the chat `to` that replaces it (a bot's talk moving on); never over one `to` has */
export function moveDraftIn(map: ReadingMap, from: string, to: string, now: number): ReadingMap {
  const e = map[from];
  if (!e || (!e.draft && !e.quotes?.length) || map[to]?.draft || map[to]?.quotes?.length) return map;
  return patchReading(patchReading(map, to, { draft: e.draft ?? null, quotes: e.quotes ?? null }, now), from, { draft: null, quotes: null }, now);
}

/** chats with an unsent draft saved */
export function draftIdsIn(map: ReadingMap): string[] {
  return Object.keys(map).filter((id) => map[id].draft || map[id].quotes?.length);
}

/** the newest message that counts as seen while the list is at the bottom: an answer still streaming does not */
export function seenCandidate(messages: readonly { id: string; status?: string }[]): string | undefined {
  const last = messages[messages.length - 1];
  if (!last) return undefined;
  return last.status === 'streaming' ? messages[messages.length - 2]?.id : last.id;
}

/**
 * Answers after the newest message the user has seen ("2 neue" on the jump button). Unknown `seen` (first open, or the
 * message is gone) = 0: never a made-up count.
 */
export function unreadAfter(messages: readonly { id: string; role: string }[], seen: string | undefined): number {
  if (!seen) return 0;
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.id === seen) return n;
    if (m.role === 'assistant') n++;
  }
  return 0;
}

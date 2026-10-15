// Parse results of finished answers, kept between mounts (chat closed and reopened, a message scrolled out of the
// virtualized list and back). A finished answer's text never changes, so its segments, markdown blocks, inline
// nodes and detected entities are the same on every mount; without this every reopen parsed the whole chat again.
//
// Bounded LRUs (entry count + total text length). Values are shared between mounts and must be treated as
// immutable (they are: the renderers only read them). Every lookup checks the full text, so a different text under
// the same message id (edited / regenerated answer, progress-notes switch) is a miss, never a stale hit.
import { extendsText, type AppendRun } from '../protocol/appendRun.ts';
import { createStreamParser, type StreamParser } from '../protocol/streamParser.ts';
import type { Segment } from '../protocol/types.ts';
import { detectEntities, type DetectedPart } from './answers/entities.ts';
import { parseInline, parseMarkdownIncremental, type Inline, type MdParseState } from './markdown.ts';

export type Lru<K, V> = {
  get(key: K): V | undefined;
  /** `weight`: the entry's share of the budget (text length) */
  set(key: K, value: V, weight: number): void;
  delete(key: K): void;
  clear(): void;
  readonly size: number;
  readonly weight: number;
};

/** Least-recently-used map over a Map's insertion order: a hit moves the entry to the end, eviction from the front. */
export function createLru<K, V>(maxEntries: number, maxWeight: number): Lru<K, V> {
  const map = new Map<K, { v: V; w: number }>();
  let total = 0;
  const drop = (key: K) => {
    const e = map.get(key);
    if (!e) return;
    map.delete(key);
    total -= e.w;
  };
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      map.delete(key);
      map.set(key, e);
      return e.v;
    },
    set(key, v, w) {
      drop(key);
      if (w > maxWeight) return; // larger than the whole budget: not worth evicting everything else for
      map.set(key, { v, w });
      total += w;
      while (map.size > maxEntries || total > maxWeight) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        drop(oldest.value);
      }
    },
    delete: drop,
    clear() {
      map.clear();
      total = 0;
    },
    get size() {
      return map.size;
    },
    get weight() {
      return total;
    },
  };
}

// Budgets in characters of text (≈ 2 bytes each, plus the parsed objects, a few times the text): a long chat is
// 100–300 K chars, so the last few opened chats stay warm within a few MB.
const segments = createLru<string, { text: string; segs: Segment[] }>(400, 1_500_000);
const markdown = createLru<string, MdParseState>(1500, 1_500_000);
const inline = createLru<string, Inline[]>(6000, 600_000);
const entities = createLru<string, DetectedPart[]>(6000, 600_000);

/** Inline runs shorter than this are parsed on every mount (the lookup costs about as much as the parse). */
const MIN_CACHED = 24;

/** Final segments of a finished answer (message id + its full text), or undefined. */
export function cachedSegments(key: string, text: string): Segment[] | undefined {
  const e = segments.get(key);
  return e && e.text === text ? e.segs : undefined;
}

export function storeSegments(key: string, text: string, segs: Segment[]): void {
  segments.set(key, { text, segs }, text.length);
}

/** useSegments state; `parser` is null for an answer whose final segments came from the cache (nothing to feed). */
export type SegmentsState = { parser: StreamParser | null; text: string; segs: Segment[]; ended: boolean; run?: AppendRun };

/**
 * One render of useSegments: feeds only the delta of a growing text to the stream parser (closed segments keep
 * their identity), ends it once `complete`. `cacheKey` (message id): a finished answer's final segments are stored,
 * and a fresh mount of a finished answer takes them from the cache instead of parsing. Idempotent per
 * (text, complete); returns the state to keep (the same object, updated, or a new one).
 */
export function advanceSegments(prev: SegmentsState | null, text: string, complete: boolean, cacheKey?: string, run?: AppendRun): SegmentsState {
  let st = prev;
  // `run` (protocol/appendRun.ts): the same as last time → `text` extends it, no full-text compare
  if (!st || !extendsText(st.text, text, st.run, run) || (st.ended && text.length !== st.text.length)) {
    const hit = complete && cacheKey ? cachedSegments(cacheKey, text) : undefined;
    if (hit) return { parser: null, text, segs: hit, ended: true, run };
    const parser = createStreamParser();
    st = { parser, text: '', segs: parser.segments(), ended: false };
  }
  st.run = run;
  if (st.parser && text.length > st.text.length) {
    st.segs = st.parser.push(text.slice(st.text.length));
    st.text = text;
  }
  if (complete && !st.ended && st.parser) {
    st.segs = st.parser.end();
    st.ended = true;
    if (cacheKey) storeSegments(cacheKey, text, st.segs);
  }
  return st;
}

/** Markdown blocks of a finished markdown segment: parsed once per text, shared by every later mount. */
export function finishedMarkdown(text: string, prev?: MdParseState | null): MdParseState {
  if (prev && prev.text === text) {
    if (!markdown.get(text)) markdown.set(text, prev, text.length); // a streamed answer that just ended
    return prev;
  }
  const hit = markdown.get(text);
  if (hit) return hit;
  const st = parseMarkdownIncremental(text, prev);
  markdown.set(text, st, text.length);
  return st;
}

/** Inline nodes of a finished run (`partial` runs are the streaming tail and are never cached). */
export function finishedInline(text: string, cites: number): Inline[] {
  if (text.length < MIN_CACHED) return parseInline(text, { cites });
  const key = cites ? `${cites}\u0000${text}` : text;
  let v = inline.get(key);
  if (!v) inline.set(key, (v = parseInline(text, { cites })), text.length);
  return v;
}

/** Entity detection (A4) of a finished text run. */
export function detectEntitiesCached(text: string): DetectedPart[] {
  if (text.length < MIN_CACHED) return detectEntities(text);
  let v = entities.get(text);
  if (!v) entities.set(text, (v = detectEntities(text)), text.length);
  return v;
}

/** Tests / benches: forget everything. */
export function clearParseCaches(): void {
  segments.clear();
  markdown.clear();
  inline.clear();
  entities.clear();
}

/** Tests / benches: current entry counts. */
export function parseCacheStats(): { segments: number; markdown: number; inline: number; entities: number } {
  return { segments: segments.size, markdown: markdown.size, inline: inline.size, entities: entities.size };
}

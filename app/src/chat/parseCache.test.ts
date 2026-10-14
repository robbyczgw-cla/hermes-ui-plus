// Parse cache of finished answers (parseCache.ts): bounded LRU, exact-text validation, same results as a parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../protocol/streamParser.ts';
import { detectEntities } from './answers/entities.ts';
import { parseInline, parseMarkdown } from './markdown.ts';
import {
  advanceSegments,
  cachedSegments,
  clearParseCaches,
  createLru,
  detectEntitiesCached,
  finishedInline,
  finishedMarkdown,
  parseCacheStats,
  storeSegments,
} from './parseCache.ts';

const answer = [
  '## Plan for the week',
  'Some **bold** text and a [link](https://example.com) in a paragraph that is long enough.',
  '- first item with `code`\n- second item, call +43 1 234 5678 at 14.10.2026 09:30',
  '```hui\n{"type":"callout","tone":"info","title":"Note","text":"A test callout"}\n```',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  'The end of the answer.',
].join('\n\n');

test('createLru: evicts the least recently used entry by count and by total weight', () => {
  const lru = createLru<string, number>(3, 100);
  lru.set('a', 1, 10);
  lru.set('b', 2, 10);
  lru.set('c', 3, 10);
  assert.equal(lru.get('a'), 1); // a is now the most recent
  lru.set('d', 4, 10); // over 3 entries → b (oldest) goes
  assert.equal(lru.get('b'), undefined);
  assert.deepEqual([lru.get('a'), lru.get('c'), lru.get('d')], [1, 3, 4]);
  lru.set('e', 5, 85); // weight 30 + 85 > 100 → evict from the front until it fits
  assert.equal(lru.get('e'), 5);
  assert.deepEqual([lru.get('a'), lru.get('c'), lru.weight], [undefined, undefined, 95]);
  lru.set('huge', 6, 101); // bigger than the whole budget: not stored, nothing else evicted for it
  assert.equal(lru.get('huge'), undefined);
  assert.equal(lru.get('e'), 5);
  lru.set('e', 7, 5); // replace: weight is re-counted, not added
  assert.equal(lru.get('e'), 7);
  assert.equal(lru.weight, 15); // d (10) + e (5); a and c were evicted for e's 85
  lru.clear();
  assert.equal(lru.size, 0);
  assert.equal(lru.weight, 0);
});

test('advanceSegments: a finished answer is parsed once; the next mount takes the cached segments', () => {
  clearParseCaches();
  const first = advanceSegments(null, answer, true, 'm-1');
  assert.ok(first.parser, 'first mount parses');
  assert.deepEqual(first.segs, parseMessage(answer));
  const again = advanceSegments(null, answer, true, 'm-1'); // remount (chat reopened)
  assert.equal(again.parser, null, 'no parser on a cache hit');
  assert.equal(again.segs, first.segs, 'same segment objects');
  // same id, other text (regenerated / edited answer): a miss, never the stale segments
  const other = advanceSegments(null, answer + '\n\nMore.', true, 'm-1');
  assert.notEqual(other.segs, first.segs);
  assert.deepEqual(other.segs, parseMessage(answer + '\n\nMore.'));
  // no key or still streaming: never cached
  clearParseCaches();
  advanceSegments(null, answer, true);
  advanceSegments(null, answer, false, 'm-2');
  assert.equal(parseCacheStats().segments, 0);
});

test('advanceSegments: a streamed answer stores its final segments when it ends; a later mount reuses them', () => {
  clearParseCaches();
  let st = advanceSegments(null, '', false, 'm-3');
  for (let i = 16; i < answer.length; i += 16) st = advanceSegments(st, answer.slice(0, i), false, 'm-3');
  st = advanceSegments(st, answer, false, 'm-3');
  assert.equal(cachedSegments('m-3', answer), undefined, 'not while streaming');
  st = advanceSegments(st, answer, true, 'm-3');
  assert.equal(cachedSegments('m-3', answer), st.segs);
  assert.equal(advanceSegments(st, answer, true, 'm-3'), st, 'idempotent (StrictMode double render)');
  assert.equal(advanceSegments(null, answer, true, 'm-3').segs, st.segs);
});

test('cachedSegments checks the full text', () => {
  clearParseCaches();
  const segs = parseMessage(answer);
  storeSegments('m-4', answer, segs);
  assert.equal(cachedSegments('m-4', answer), segs);
  assert.equal(cachedSegments('m-4', answer.slice(0, -1)), undefined);
  assert.equal(cachedSegments('m-5', answer), undefined);
});

test('finishedMarkdown: same blocks as a parse, shared between mounts, and a streamed state is adopted', () => {
  clearParseCaches();
  const md = parseMessage(answer).find((s) => s.kind === 'markdown')!;
  const text = (md as { text: string }).text;
  const a = finishedMarkdown(text);
  assert.deepEqual(a.blocks, parseMarkdown(text));
  assert.equal(finishedMarkdown(text), a, 'second mount: the cached state');
  // a component that just streamed this text keeps its own (identical) state and hands it to the cache
  clearParseCaches();
  const streamed = { ...a, blocks: parseMarkdown(text) };
  assert.equal(finishedMarkdown(text, streamed), streamed);
  assert.equal(finishedMarkdown(text), streamed);
});

test('finishedInline / detectEntitiesCached: same results as the parse, cached per text (and per cites for inline)', () => {
  clearParseCaches();
  const run = 'Call **+43 1 234 5678** or see [1] and `x` – reachable at 14.10.2026 09:30.';
  assert.deepEqual(finishedInline(run, 0), parseInline(run, { partial: false, cites: 0 }));
  assert.equal(finishedInline(run, 0), finishedInline(run, 0));
  assert.deepEqual(finishedInline(run, 2), parseInline(run, { cites: 2 }));
  assert.notEqual(finishedInline(run, 2), finishedInline(run, 0));
  assert.deepEqual(detectEntitiesCached(run), detectEntities(run));
  assert.equal(detectEntitiesCached(run), detectEntitiesCached(run));
  const short = 'short **x**';
  assert.deepEqual(finishedInline(short, 0), parseInline(short, {}));
  assert.equal(parseCacheStats().inline, 2, 'short runs are not cached');
});

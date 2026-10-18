/// <reference types="node" />
// Web result card model (webCard.ts): facts only from what the tool output said, cited markers from the answer,
// graceful generic fallback, no card without a parsed result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolEvent } from '../hermes/types.ts';
import { toolDetailFrom } from '../hermes/sessionMapping.ts';
import {
  HERMES_WEB_SEARCH_JSON,
  WSP_CACHED_TEXT,
  WSP_512_CACHED_TEXT,
  WSP_512_EMPTY_TEXT,
  WSP_512_DOC_FALLBACK_CHAIN_TEXT,
  WSP_512_FALLBACK_TEXT,
  WSP_512_RESEARCH_TEXT,
  WSP_512_SEARCH_TEXT,
  WSP_ERROR_TEXT,
  WSP_EXTRACT_TEXT,
  WSP_EXTRACT_URLS,
  WSP_MCP_JSON,
  WSP_NEWS_TEXT,
  WSP_RESEARCH_TEXT,
  WSP_SEARCH_TEXT,
} from '../hermes/webResults.fixtures.ts';
import { makeT } from '../i18n/core.ts';
import { buildWebCard, citedUrls, hasWebCard, providerName, webToolMode } from './webCard.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');

function ev(name: string, args: Record<string, unknown>, content: string | undefined, time: [number, number] = [1000, 1850]): ToolEvent {
  const { detail } = toolDetailFrom({ id: 'w1', name, arguments: args } as never, content === undefined ? undefined : ({ id: '2', role: 'tool', content, toolCallId: 'w1' } as never));
  return { id: 'w1', name, label: String(args.query ?? ''), status: 'done', startedAt: time[0], endedAt: time[1], detail };
}

const ANSWER = `Free threading is supported, but opt-in [1]. Benchmarks show real speedups [2].

Sources:
[1] https://docs.example.org/articles/2026/09/14/free-threaded-builds-example-linux — Example Linux
[2] https://bench.example.com/posts/free-threading/ — Benchmarks`;

test('WSP search: query, provider with routing, query type, duration, live fetch, cited numbers', () => {
  const card = buildWebCard({ text: ANSWER }, ev('web_search_plus', { query: 'free threading guide' }, WSP_SEARCH_TEXT), en, 'en-US')!;
  assert.equal(card.mode, 'search');
  assert.equal(card.query, 'free threading guide');
  assert.equal(card.provider, 'Keenable');
  assert.equal(card.rich, true);
  assert.deepEqual(
    card.facts.map((f) => [f.label, f.value]),
    [
      ['Provider', 'Keenable · chosen automatically · uncertain match'],
      ['Query type', 'General'],
      ['Duration', '850 ms'],
      ['Cache', 'fetched live'],
      ['Freshness', 'newest result from Sep 25, 2026'],
    ],
  );
  assert.deepEqual(card.hits.map((h) => h.cited), [1, 2, undefined, undefined]);
  assert.equal(card.cited, 2);
  assert.equal(card.hits[0].domain, 'docs.example.org');
  assert.equal(card.hits[0].date, 'Sep 14, 2026');
});

test('cache hit, freshness filter and news type (German)', () => {
  const cached = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_CACHED_TEXT), de, 'de-DE')!;
  assert.deepEqual(cached.facts.find((f) => f.key === 'cache')?.value, 'aus dem Cache, 7 s alt');
  // a cache hit carries no routing bits: no "automatisch" claim
  assert.equal(cached.facts.find((f) => f.key === 'provider')?.value, 'Keenable');
  const news = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q', freshness: 'week' }, WSP_NEWS_TEXT), de, 'de-DE')!;
  assert.equal(news.facts.find((f) => f.key === 'type')?.value, 'Nachrichten');
  assert.equal(news.facts.find((f) => f.key === 'freshness')?.value, 'letzte Woche · neuester Treffer vom 15.10.2026');
});

test('research: pages read and no fake provider; extract: hosts as query, failed page, requested spelling counts as cited', () => {
  const research = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q', mode: 'research' }, WSP_RESEARCH_TEXT, [0, 12400]), en, 'en-US')!;
  assert.equal(research.mode, 'research');
  assert.equal(research.provider, undefined);
  assert.equal(research.facts.find((f) => f.key === 'pages')?.value, '3');
  assert.equal(research.facts.find((f) => f.key === 'duration')?.value, '12.4 s');
  const text = `See [the alpha](${WSP_EXTRACT_URLS[2]}).`;
  const ex = buildWebCard({ text }, ev('web_extract_plus', { urls: WSP_EXTRACT_URLS }, WSP_EXTRACT_TEXT), en, 'en-US')!;
  assert.equal(ex.mode, 'extract');
  assert.equal(ex.query, 'example.org, news.example.org');
  assert.deepEqual(ex.hits.map((h) => h.failed ?? null), [null, null, null, 'API error (HTTP 404)']);
  // `?ref=2` was requested and linked; the page shows the provider's URL – both slots of that page match
  assert.deepEqual(ex.hits.map((h) => h.cited), [undefined, 0, 0, undefined]);
});

test('MCP attempts show the fallback chain; errors keep the reason per provider', () => {
  const mcp = buildWebCard({ text: '' }, ev('mcp__web_search_plus__web_search', { query: 'q' }, JSON.stringify(WSP_MCP_JSON)), en, 'en-US')!;
  assert.equal(mcp.facts.find((f) => f.key === 'attempts')?.value, 'SearXNG: failed (10 ms) → Keenable: ok (883 ms)');
  const err = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_ERROR_TEXT), en, 'en-US')!;
  assert.equal(err.error, 'All providers failed');
  assert.deepEqual(err.providerErrors, [{ provider: 'Keenable', reason: 'Provider execution failed' }]);
  assert.deepEqual(err.hits, []);
});

test('without WSP: generic web_search degrades to query + hits; no parsed result → no card; other tools → none', () => {
  const generic = buildWebCard({ text: '' }, ev('web_search', { query: 'Wien' }, HERMES_WEB_SEARCH_JSON), de, 'de-DE')!;
  assert.equal(generic.rich, false);
  assert.equal(generic.query, 'Wien');
  assert.equal(generic.hits.length, 1);
  assert.deepEqual(generic.facts.map((f) => f.key), ['duration']);
  const unparsed = ev('web_search', { query: 'x' }, 'irgendein Text');
  assert.equal(hasWebCard(unparsed), false);
  assert.equal(buildWebCard({ text: '' }, unparsed, de, 'de-DE'), null);
  const live: ToolEvent = { id: 'l', name: 'web_search_plus', label: 'q', status: 'running', startedAt: 1 };
  assert.equal(buildWebCard({ text: '' }, live, de, 'de-DE'), null);
  assert.equal(webToolMode({ name: 'terminal' }), null);
});

test('citedUrls: closing list numbers, inline links, bare URLs; providerName spellings', () => {
  const m = citedUrls(`${ANSWER}\nAlso https://x.example.com/a. and [y](https://y.example.com/b)`);
  assert.equal(m.get('docs.example.org/articles/2026/09/14/free-threaded-builds-example-linux'), 1);
  assert.equal(m.get('bench.example.com/posts/free-threading'), 2);
  assert.equal(citedUrls('Also https://x.example.com/a. and [y](https://y.example.com/b)').get('x.example.com/a'), 0);
  assert.equal(citedUrls('Also https://x.example.com/a. and [y](https://y.example.com/b)').get('y.example.com/b'), 0);
  assert.equal(citedUrls('no links').size, 0);
  assert.equal(providerName('searxng'), 'SearXNG');
  assert.equal(providerName('you'), 'You.com');
  assert.equal(providerName('newone'), 'Newone');
});

// WSP 5.1.2 header bits (live captures; the two-provider chain and the empty search are built from its docs)

test('5.1.2 fallback_from: the chain ends in the serving provider; the tool\'s elapsed_ms beats the row gap', () => {
  const live = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_512_FALLBACK_TEXT, [1000, 1850]), de, 'de-DE')!;
  assert.deepEqual(
    live.facts.map((f) => [f.key, f.value]),
    [
      ['provider', 'Keenable · automatisch gewählt · Zuordnung unsicher'],
      ['type', 'Allgemein'],
      ['fallback', 'SearXNG → Keenable'],
      ['duration', '576 ms'],
      ['cache', 'frisch abgefragt'],
      ['freshness', 'neuester Treffer vom 25.09.2026'],
    ],
  );
  assert.equal(live.reported, 3);
  const card = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_512_DOC_FALLBACK_CHAIN_TEXT, [1000, 1850]), de, 'de-DE')!;
  assert.deepEqual(
    card.facts.map((f) => [f.key, f.value]),
    [
      ['provider', 'Exa · automatisch gewählt · Zuordnung unsicher'],
      ['type', 'Allgemein'],
      ['fallback', 'Serper → Brave → Exa'],
      ['duration', '37 ms'],
      ['cache', 'frisch abgefragt'],
      ['freshness', 'neuester Treffer vom 14.09.2026'],
    ],
  );
  assert.equal(card.facts.find((f) => f.key === 'fallback')?.label, 'Fallback-Kette');
  assert.equal(card.reported, 1);
  // no fallback bit, no chain row
  const direct = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_512_SEARCH_TEXT), en, 'en-US')!;
  assert.equal(direct.facts.some((f) => f.key === 'fallback'), false);
  assert.equal(direct.facts.find((f) => f.key === 'duration')?.value, '758 ms');
});

test('5.1.2 cache hit: routing of the cached search plus its age and the lookup time', () => {
  const card = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_512_CACHED_TEXT), en, 'en-US')!;
  assert.equal(card.facts.find((f) => f.key === 'provider')?.value, 'Keenable · chosen automatically · uncertain match');
  assert.equal(card.facts.find((f) => f.key === 'cache')?.value, 'from the cache, 7 s old');
  assert.equal(card.facts.find((f) => f.key === 'duration')?.value, '98 ms');
});

test('5.1.2 research: providers used, pages from the header, reported results, tool time', () => {
  const card = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q', mode: 'research' }, WSP_512_RESEARCH_TEXT, [0, 15000]), en, 'en-US')!;
  assert.equal(card.mode, 'research');
  assert.equal(card.provider, undefined);
  assert.equal(card.facts.find((f) => f.key === 'providers')?.value, 'Keenable');
  assert.equal(card.facts.find((f) => f.key === 'providers')?.label, 'Providers used');
  assert.equal(card.facts.find((f) => f.key === 'pages')?.value, '3');
  assert.equal(card.facts.find((f) => f.key === 'duration')?.value, '1.7 s');
  assert.equal(card.reported, 5);
  assert.equal(card.hits.length, 5);
  // the providers row belongs to research only
  const search = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_512_SEARCH_TEXT), en, 'en-US')!;
  assert.equal(search.facts.some((f) => f.key === 'providers' || f.key === 'pages'), false);
});

test('5.1.2 empty search: a card without hits, no error box', () => {
  const card = buildWebCard({ text: '' }, ev('web_search_plus', { query: 'q' }, WSP_512_EMPTY_TEXT), en, 'en-US')!;
  assert.equal(card.error, undefined);
  assert.equal(card.hits.length, 0);
  assert.equal(card.reported, 0);
  assert.equal(card.facts.find((f) => f.key === 'provider')?.value, 'Brave');
});

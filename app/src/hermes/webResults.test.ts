/// <reference types="node" />
// WSP / generic web tool results → hits (docs/WSP-INTEGRATION.md, Web Source Contract v1 level 1). Fixtures: real WSP
// 5.1.1 layouts (webResults.fixtures.ts), the 5.1.2 header bits (built from its docs, not a live run) and the 5.0.1
// shapes older plugins still produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, parseWebToolOutput, webMetaOf, withoutSecurityNotice } from './webResults.ts';
import {
  HERMES_NATIVE_EXTRACT_JSON,
  HERMES_NATIVE_SEARCH_JSON,
  HERMES_WEB_SEARCH_JSON,
  WSP_501_MCP_JSON,
  WSP_501_SEARCH_TEXT,
  WSP_512_CACHED_TEXT,
  WSP_512_EMPTY_TEXT,
  WSP_512_DOC_FALLBACK_CHAIN_TEXT,
  WSP_512_ERROR_TEXT,
  WSP_512_EXTRACT_NOT_TRIED_TEXT,
  WSP_512_EXTRACT_TEXT,
  WSP_512_FALLBACK_TEXT,
  WSP_512_NEWS_TEXT,
  WSP_512_RESEARCH_TEXT,
  WSP_512_SEARCH_TEXT,
  WSP_FUTURE_BITS_TEXT,
  WSP_CACHED_TEXT,
  WSP_ERROR_TEXT,
  WSP_EXTRACT_RATE_LIMIT_TEXT,
  WSP_EXTRACT_TEXT,
  WSP_EXTRACT_URLS,
  WSP_FALLBACK_TEXT,
  WSP_MCP_JSON,
  WSP_NEWS_TEXT,
  WSP_NOTICE,
  WSP_RESEARCH_TEXT,
  WSP_SEARCH_RATE_LIMIT_TEXT,
  WSP_SEARCH_TEXT,
  WSP_SETUP_ERROR_TEXT,
  WSP_V3_JSON,
} from './webResults.fixtures.ts';

test('WSP 5.1.1 search text: header bits, ISO dates, markdown-free snippets, notice never a hit', () => {
  const r = parseWebToolOutput(WSP_SEARCH_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'keenable');
  assert.equal(r.auto, true);
  assert.equal(r.confidence, 'low');
  assert.equal(r.queryType, 'general');
  assert.equal(r.cached, undefined);
  assert.equal(r.results.length, 4);
  assert.deepEqual(r.results[0], {
    title: 'Free-threaded builds are now available on Example Linux',
    url: 'https://docs.example.org/articles/2026/09/14/free-threaded-builds-example-linux',
    snippet: 'Free-threaded builds are now available on Example Linux Developers on Example Linux 9.8 and 10.2 can now install the free-threaded interpreter …',
    published: '2026-09-14',
  });
  // `… [TRUNCATED: …]` and inline code markers go, the words stay
  assert.equal(r.results[1].snippet, 'Free threading is officially supported now. You get thread-level parallelism for CPU-bound work, with roughly 3x speedups on four cores …');
  assert.equal(r.results[3].snippet, 'For years the only way to use more than one core was multiprocessing, which meant pickling every batch …');
  assert.equal(r.results[3].published, undefined);
  // shape detection: the header alone is enough, whatever the tool is called (native backend keeps generic names)
  assert.equal(parseWebToolOutput(WSP_SEARCH_TEXT, 'web_search')?.results.length, 4);
  assert.equal(parseWebToolOutput(WSP_SEARCH_TEXT)?.results.length, 4);
  assert.deepEqual(webMetaOf(r), { auto: true, confidence: 'low', queryType: 'general', provider: 'keenable', count: 4 });
});

test('cache hit: `cached 7s ago` without routing bits; fallback text reads like a direct hit', () => {
  const r = parseWebToolOutput(WSP_CACHED_TEXT, 'web_search_plus')!;
  assert.deepEqual(webMetaOf(r), { cached: true, cacheAgeS: 7, provider: 'keenable', count: 2 });
  const f = parseWebToolOutput(WSP_FALLBACK_TEXT, 'web_search_plus')!;
  assert.equal(f.provider, 'keenable');
  assert.equal(f.attempts, undefined);
});

test('news + freshness: multi-line snippet with unindented continuation lines; numbered lines inside are no hits', () => {
  const r = parseWebToolOutput(WSP_NEWS_TEXT, 'web_search_plus')!;
  assert.equal(r.queryType, 'news');
  assert.equal(r.confidence, 'medium');
  assert.deepEqual(r.freshness, { requested: 'week' });
  assert.deepEqual(
    r.results.map((h) => [h.url, h.published]),
    [
      ['https://news.example.org/2026/10/version-3160-alpha-1-is-now-available', '2026-10-13'],
      ['https://press.example.com/en/news/version-3-15-released-11484310.html', '2026-10-12'],
      ['https://register.example.net/devops/2026/10/15/315-goes-global-with-utf-8-support/5303218', '2026-10-15'],
    ],
  );
  assert.equal(r.results[0].snippet, 'Version 3.16.0 alpha 1 is now available This is an early developer preview of version 3.16 What’s new in 3.16? There’s plenty still to come, but its first alpha is ready to try! 2. not a result: a numbered line inside the snippet');
  const legacy = parseWebToolOutput(WSP_501_SEARCH_TEXT, 'web_search_plus')!;
  assert.deepEqual(legacy.freshness, { requested: 'week', appliedBy: ['brave'] });
  assert.equal(legacy.results[0].published, '3 days ago');
  assert.equal(legacy.cacheAgeS, 42);
  assert.equal(legacy.recency, true);
});

test('extract: one page per requested URL (provider URLs, repeats kept), failed slots, list in page text ignored', () => {
  const r = parseWebToolOutput(WSP_EXTRACT_TEXT, 'web_extract_plus')!;
  assert.equal(r.provider, 'keenable');
  assert.deepEqual(
    r.results.map((h) => [h.url, h.failed ?? null]),
    [
      ['http://example.org/', null],
      ['https://news.example.org/2026/10/version-3160-alpha-1-is-now-available/', null],
      ['https://news.example.org/2026/10/version-3160-alpha-1-is-now-available/', null],
      ['https://www.example.org/this-page-does-not-exist', 'API error (HTTP 404)'],
    ],
  );
  assert.equal(r.results.length, WSP_EXTRACT_URLS.length);
  assert.equal(r.results[3].snippet, undefined);
  const rl = parseWebToolOutput(WSP_EXTRACT_RATE_LIMIT_TEXT, 'web_extract_plus')!;
  assert.deepEqual(rl.results.map((h) => h.failed ?? null), [null, null, 'Rate limit exceeded. Please wait a moment and try again. (HTTP 429)', 'API error (HTTP 404)']);
});

test('research mode: `Provider: research`, pages read from the summaries, results numbered again from 1', () => {
  const r = parseWebToolOutput(WSP_RESEARCH_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'research');
  assert.deepEqual(r.research, { pages: 3 });
  assert.deepEqual(r.results.map((h) => h.url), ['https://bench.example.com/posts/free-threading', 'https://code.example.dev/nogil-guide', 'https://forum.example.net/free-threading-real-benchmarks']);
});

test('errors: error line + reason per provider, no hits', () => {
  for (const [text, line, reasons] of [
    [WSP_ERROR_TEXT, 'All providers failed', [['keenable', 'Provider execution failed']]],
    [WSP_SETUP_ERROR_TEXT, 'No configured search provider is available for this request. Run: hermes web-search-plus setup --preset starter', [['serper', 'Missing API key for serper']]],
    [WSP_SEARCH_RATE_LIMIT_TEXT, 'All providers failed', [['searxng', 'Network error: [Errno 111] Connection refused. Check your internet connection.'], ['keenable', 'Rate limit exceeded. Please wait a moment and try again. (HTTP 429)']]],
  ] as const) {
    const r = parseWebToolOutput(text, 'web_search_plus')!;
    assert.equal(r.error, true);
    assert.equal(r.errorText, line);
    assert.deepEqual(r.results, []);
    assert.deepEqual(r.providerErrors?.map((p) => [p.provider, p.reason]), reasons);
    assert.equal(webMetaOf(r).error, line);
  }
});

test('MCP JSON (object or string): provider, attempts with outcome and time, http(s) only, duplicates once', () => {
  for (const out of [WSP_MCP_JSON, JSON.stringify(WSP_MCP_JSON)]) {
    const r = parseWebToolOutput(out, 'mcp__web_search_plus__web_search')!;
    assert.equal(r.provider, 'keenable');
    assert.equal(r.cached, undefined);
    assert.deepEqual(r.attempts, [
      { provider: 'searxng', outcome: 'failed', ms: 10, results: 0 },
      { provider: 'keenable', outcome: 'success', ms: 883, results: 3 },
    ]);
    assert.deepEqual(r.results.map((h) => h.url), ['https://docs.example.org/articles/2026/09/14/free-threaded-builds-example-linux']);
    assert.equal(r.results[0].snippet, 'Free-threaded builds Developers on Example Linux …');
  }
  const v3 = parseWebToolOutput(WSP_V3_JSON, 'web_search')!;
  assert.deepEqual(v3.results, [{ title: 'Free threading explained', url: 'https://docs.example.org/articles/free-threading', snippet: 'What changes for extension modules …' }]);
  assert.equal(v3.cacheAgeS, 42);
  const legacy = parseWebToolOutput(WSP_501_MCP_JSON, 'mcp__web_search_plus__web_search')!;
  assert.equal(legacy.provider, 'serper');
  assert.equal(legacy.cached, true);
});

test('native backend (Hermes web_search / web_extract with `wsp`): provider from metadata, requested URLs, generic errors', () => {
  const s = parseWebToolOutput(HERMES_NATIVE_SEARCH_JSON, 'web_search')!;
  assert.equal(s.provider, 'keenable');
  assert.equal(s.results.length, 2);
  const e = parseWebToolOutput(HERMES_NATIVE_EXTRACT_JSON, 'web_extract')!;
  assert.deepEqual(e.results.map((h) => [h.url, h.failed ?? null]), [
    ['https://news.example.org/2026/10/version-3160-alpha-1-is-now-available?ref=1', null],
    ['https://www.example.org/this-page-does-not-exist', 'WSP extraction failed for this URL'],
  ]);
});

test('generic Hermes web_search JSON works too (no WSP needed)', () => {
  const r = parseWebToolOutput(HERMES_WEB_SEARCH_JSON, 'web_search')!;
  assert.deepEqual(r.results, [{ title: 'Wien – Wikipedia', url: 'https://de.example.org/wiki/Wien', snippet: 'Wien ist die Bundeshauptstadt …' }]);
  assert.equal(r.provider, undefined);
});

test('no false positives: terminal output, plain text, unrelated JSON', () => {
  assert.equal(parseWebToolOutput('1. step one\n   https://example.com/x\n', 'terminal'), null);
  assert.equal(parseWebToolOutput('Exit 0', 'web_search'), null);
  assert.equal(parseWebToolOutput({ output: 'ok', exit_code: 0 }, 'terminal'), null);
  assert.equal(parseWebToolOutput({ results: [1, 2, 3] }, 'x'), null);
  assert.equal(parseWebToolOutput(undefined, 'web_search'), null);
});

test('an item whose link is no http(s) URL is dropped but keeps the numbering', () => {
  const text = `${WSP_NOTICE}\n[Provider: brave]\n1. Bad\n   javascript:alert(1)\n   x\n\n2. Good\n   https://ok.example.com/\n   fine`;
  assert.deepEqual(parseWebToolOutput(text, 'web_search_plus')!.results.map((h) => h.url), ['https://ok.example.com/']);
});

test('withoutSecurityNotice hides the notice line in raw views', () => {
  assert.ok(!String(withoutSecurityNotice(WSP_SEARCH_TEXT)).includes('Security notice'));
  assert.ok(String(withoutSecurityNotice(WSP_SEARCH_TEXT)).startsWith('[Provider: keenable'));
  assert.deepEqual(withoutSecurityNotice({ a: 1 }), { a: 1 });
});

test('canonicalUrl joins cited and retrieved URLs', () => {
  assert.equal(canonicalUrl('https://www.Example.com/a/?utm_source=x&id=2#top'), 'example.com/a?id=2');
  assert.equal(canonicalUrl('http://example.com/a'), canonicalUrl('https://example.com/a/'));
  // WSP 5.1 extract shows the provider's URL for a `?ref=` request: both spellings meet
  assert.equal(canonicalUrl(WSP_EXTRACT_URLS[1]), canonicalUrl('https://news.example.org/2026/10/version-3160-alpha-1-is-now-available/'));
});

test('long page texts (extract `content`): the snippet / title cut equals collapsing the whole text', () => {
  // reference: the previous clip (whitespace runs of the WHOLE text collapsed, trimmed, then cut)
  const clipRef = (s: string, max: number) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  let seed = 17;
  const r = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const pieces = ['word', 'x', ' ', '  ', '\n', '\n\n\t', ' ', 'ü', '😀', '.', '   \n   '];
  for (let k = 0; k < 400; k++) {
    let content = r() < 0.3 ? ' '.repeat(Math.floor(r() * 900)) : '';
    const n = Math.floor(r() * 500);
    for (let i = 0; i < n; i++) content += pieces[Math.floor(r() * pieces.length)];
    let title = '';
    for (let i = Math.floor(r() * 200); i > 0; i--) title += pieces[Math.floor(r() * pieces.length)];
    const res = parseWebToolOutput({ results: [{ url: 'https://example.com/a', title, content }] });
    const hit = res?.results[0];
    assert.ok(hit);
    const want = clipRef(content, 300);
    assert.equal(hit.snippet, want || undefined, JSON.stringify(content));
    assert.equal(hit.title, clipRef(title.trim() ? title : 'example.com', 160));
  }
});

// ---------------------------------------------------------------- WSP 5.1.2 header bits

test('5.1.2 fallback header (live): a dead SearXNG, Keenable served', () => {
  const r = parseWebToolOutput(WSP_512_FALLBACK_TEXT, 'web_search_plus')!;
  assert.deepEqual(webMetaOf(r), { auto: true, confidence: 'low', queryType: 'general', provider: 'keenable', elapsedMs: 576, fallbackFrom: ['searxng'], reportedCount: 3, count: 3 });
  assert.equal(r.results.length, 3);
  assert.equal(parseWebToolOutput(WSP_512_FALLBACK_TEXT)?.provider, 'keenable');
});

test('5.1.2 fallback header: results / elapsed_ms / fallback_from are read, the chain keeps its order', () => {
  const r = parseWebToolOutput(WSP_512_DOC_FALLBACK_CHAIN_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'exa');
  assert.deepEqual(r.fallbackFrom, ['serper', 'brave']);
  assert.equal(r.elapsedMs, 37);
  assert.equal(r.reportedCount, 1);
  assert.equal(r.auto, true);
  assert.equal(r.queryType, 'general');
  assert.equal(r.results.length, 1);
  assert.deepEqual(webMetaOf(r), { auto: true, confidence: 'low', queryType: 'general', provider: 'exa', elapsedMs: 37, fallbackFrom: ['serper', 'brave'], reportedCount: 1, count: 1 });
  // shape detection still works without a tool name
  assert.equal(parseWebToolOutput(WSP_512_DOC_FALLBACK_CHAIN_TEXT)?.provider, 'exa');
});

test('5.1.2 cache hit repeats the routing of the cached search; entries cached before 5.1.2 show none', () => {
  const r = parseWebToolOutput(WSP_512_CACHED_TEXT, 'web_search_plus')!;
  assert.deepEqual(webMetaOf(r), { cached: true, cacheAgeS: 7, auto: true, confidence: 'low', queryType: 'general', provider: 'keenable', elapsedMs: 98, reportedCount: 5, count: 5 });
  // the cached body is the live search's, hit for hit
  assert.deepEqual(r.results, parseWebToolOutput(WSP_512_SEARCH_TEXT, 'web_search_plus')!.results);
  const old = webMetaOf(parseWebToolOutput(WSP_CACHED_TEXT, 'web_search_plus')!);
  assert.equal(old.auto, undefined);
  assert.equal(old.reportedCount, undefined);
});

test('5.1.2 research header: providers, pages (preferred over the counted summaries), results, elapsed_ms', () => {
  const r = parseWebToolOutput(WSP_512_RESEARCH_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'research');
  assert.deepEqual(r.providers, ['keenable']);
  assert.deepEqual(r.research, { pages: 3 });
  assert.equal(r.reportedCount, 5);
  assert.equal(r.elapsedMs, 1736);
  assert.equal(r.results.length, 5);
  assert.equal(r.results[0].url, 'https://www.bench.example.com/posts/python-314-free-threading/');
  assert.equal(r.results[1].published, undefined);
  assert.equal(r.results[4].published, '2026-04-17');
  // `pages=` wins when the summaries disagree with it
  const lie = WSP_512_RESEARCH_TEXT.replace('pages=3', 'pages=7');
  assert.deepEqual(parseWebToolOutput(lie, 'web_search_plus')!.research, { pages: 7 });
  // no `pages=`: the summaries are counted as before
  const none = WSP_512_RESEARCH_TEXT.replace(' | pages=3', '');
  assert.deepEqual(parseWebToolOutput(none, 'web_search_plus')!.research, { pages: 3 });
});

test('5.1.2 counts: results= beats the parsed number of hits; results=0 is "found nothing", not a parse failure', () => {
  const r = parseWebToolOutput(WSP_512_SEARCH_TEXT, 'web_search_plus')!;
  assert.equal(r.results.length, 5);
  assert.equal(webMetaOf(r).count, 5);
  // every live snippet over 1200 characters is cut: the note goes with the text, the dates stay
  assert.deepEqual(r.results.map((h) => h.published), ['2026-09-14', '2026-04-13', '2026-09-25', '2026-08-23', '2026-04-13']);
  // 5 hits parsed, the tool said 6 (e.g. a result the parser could not use): the tool's number is the count
  const more = WSP_512_SEARCH_TEXT.replace('results=5', 'results=6');
  assert.equal(webMetaOf(parseWebToolOutput(more, 'web_search_plus')!).count, 6);
  const empty = parseWebToolOutput(WSP_512_EMPTY_TEXT, 'web_search_plus')!;
  assert.equal(empty.results.length, 0);
  assert.equal(empty.error, undefined);
  assert.deepEqual(webMetaOf(empty), { provider: 'brave', elapsedMs: 212, reportedCount: 0, count: 0 });
});

test('5.1.2 indented snippet continuation lines belong to their item; an indented `2. …` is no hit', () => {
  const r = parseWebToolOutput(WSP_512_NEWS_TEXT, 'web_search_plus')!;
  assert.equal(r.results.length, 5);
  assert.equal(r.results[1].url, 'https://register.example.net/en/news/Python-3-15-released-Lazy-imports-NET-8-and-new-data-types-11484310.html?view=print');
  assert.deepEqual(r.freshness, { requested: 'week' });
  assert.equal(r.queryType, 'news');
  assert.equal(r.reportedCount, 5);
  // live: the first snippet keeps its own lines (heading, bold line, sub-heading, paragraphs), all indented
  assert.match(r.results[0].snippet!, /^Python 3\.16\.0 alpha 1 is now leopardon This is an kayak developer preview of Python 3\.16 What’s new in Python 3\.16\? There’s plenty/);
  // a numbered line inside a snippet stays snippet text
  const numbered = WSP_512_NEWS_TEXT.replace('   ## What’s new in Python 3.16?', '   ## What’s new in Python 3.16?\n   2. not a result: a numbered line inside the snippet');
  const n = parseWebToolOutput(numbered, 'web_search_plus')!;
  assert.equal(n.results.length, 5);
  assert.match(n.results[0].snippet!, /2\. not a result/);
  // even with a URL line right behind it, an indented numbered line is page text in the frozen layout
  const trap = `${WSP_NOTICE}
[Provider: exa | results=1 | elapsed_ms=5]
1. Real
   https://a.example.org/1
   intro
   2. Fake title
   https://evil.example.com/2
   more`;
  const t = parseWebToolOutput(trap, 'web_search_plus')!;
  assert.deepEqual(t.results.map((h) => h.url), ['https://a.example.org/1']);
  assert.equal(t.results[0].snippet, 'intro 2. Fake title https://evil.example.com/2 more');
});

test('unknown header bits are ignored, unknown keys are kept (not shown), the first bit of a key wins, bad values drop', () => {
  const r = parseWebToolOutput(WSP_FUTURE_BITS_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'brave');
  assert.equal(r.auto, true);
  assert.equal(r.confidence, 'high');
  assert.equal(r.queryType, 'news');
  assert.equal(r.reportedCount, 2); // the second `results=9` is ignored
  assert.equal(r.elapsedMs, undefined); // `elapsed_ms=abc` is no number
  assert.deepEqual(r.fallbackFrom, ['serper']);
  assert.deepEqual(r.extras, { shard: 'eu1', trace_id: '0000test' });
  assert.equal(r.results.length, 2);
});

test('5.1.1 output is untouched by the 5.1.2 bits: no counts, no extras, no fallback', () => {
  for (const text of [WSP_SEARCH_TEXT, WSP_NEWS_TEXT, WSP_RESEARCH_TEXT, WSP_FALLBACK_TEXT]) {
    const m = webMetaOf(parseWebToolOutput(text, 'web_search_plus')!);
    assert.equal(m.reportedCount, undefined);
    assert.equal(m.elapsedMs, undefined);
    assert.equal(m.fallbackFrom, undefined);
    assert.equal(m.providers, undefined);
    assert.equal(m.extras, undefined);
  }
});

test('key=value bits are bounded: provider lists keep identifier words only, extras are capped', () => {
  const header = `[Provider: exa | fallback_from=a,b b,<x>,a,${'p'.repeat(60)},c | ${Array.from({ length: 12 }, (_, i) => `k${i}=v${i}`).join(' | ')} | k_long=${'x'.repeat(300)}]`;
  const r = parseWebToolOutput(`${header}\n1. T\n   https://a.example.org/\n   s`, 'web_search_plus')!;
  assert.deepEqual(r.fallbackFrom, ['a', 'c']);
  assert.equal(Object.keys(r.extras!).length, 8);
});

test('5.1.2 extract (live): one slot per URL, ?ref= requests under the canonical URL, a 404, the URL past the limit not tried', () => {
  const r = parseWebToolOutput(WSP_512_EXTRACT_TEXT, 'web_extract_plus')!;
  assert.equal(r.provider, 'keenable');
  assert.deepEqual(r.results.map((h) => [h.url, h.failed ?? null]), [
    ['http://code.example.dev/', null],
    ['https://press.example.com/2026/10/python-3160-alpha-1-is-now-leopardon/', null],
    ['https://press.example.com/2026/10/python-3160-alpha-1-is-now-leopardon/', null],
    ['https://www.code.example.dev/this-page-does-not-tulip-tornado-404', 'API error (HTTP 404)'],
    ['https://www.example.com/', 'not tried: limit of 4 URLs per call reached'],
  ]);
  // "No title" becomes the domain; WSP's truncation footer (stored path, read_file hint) is never a snippet
  assert.equal(r.results[4].title, 'example.com');
  for (const h of r.results) assert.doesNotMatch(h.snippet ?? '', /cleaned text|read_file|\/tmp\//);
});

test('extract snippet: a page that starts with its own heading or a stub shows its first real paragraph', () => {
  // live: `# <title>` right under the URL, the paragraph after the blank line
  const live = parseWebToolOutput(WSP_512_EXTRACT_TEXT, 'web_extract_plus')!;
  assert.equal(live.results[1].snippet, 'This is an kayak developer preview of Python 3.16');
  // live: a first paragraph that is long enough stays
  assert.match(live.results[0].snippet!, /^Orange: This page marigold a primrose/);
  const page = (body: string) => `${WSP_NOTICE}
[Provider: keenable]

1. Free threading: real benchmarks
https://bench.example.com/posts/free-threading
${body}

2. Second page
https://docs.example.org/two
Second page text that is long enough to be a real paragraph of its own.`;
  const tldr = parseWebToolOutput(page('TL;DR\n\nFree threading is officially supported now; four threads run CPU work up to three times faster.'), 'web_extract_plus')!;
  assert.equal(tldr.results[0].snippet, 'Free threading is officially supported now; four threads run CPU work up to three times faster.');
  // only thin blocks on the page: the first block stays, the next item's text is never borrowed
  const thin = parseWebToolOutput(page('# Free threading: real benchmarks\n\n## Contents\n\nTL;DR'), 'web_extract_plus')!;
  assert.equal(thin.results[0].snippet, 'Free threading: real benchmarks');
  assert.equal(thin.results[1].snippet, 'Second page text that is long enough to be a real paragraph of its own.');
  // search snippets are not touched (a search hit's snippet is WSP's own excerpt)
  const search = parseWebToolOutput(page('TL;DR\n\nFree threading is officially supported now; four threads run CPU work.').replace('[Provider: keenable]\n\n', '[Provider: keenable]\n'), 'web_search_plus')!;
  assert.equal(search.results[0].snippet, 'TL;DR');
});

test('5.1.2 error (live): every provider tried gets its line', () => {
  const r = parseWebToolOutput(WSP_512_ERROR_TEXT, 'web_search_plus')!;
  assert.equal(r.error, true);
  assert.equal(r.errorText, 'All providers failed');
  assert.deepEqual(r.providerErrors?.map((e) => e.provider), ['searxng', 'keenable']);
});

test('5.1.2 extract: URLs that were not tried keep their slot with the cause as reason', () => {
  const r = parseWebToolOutput(WSP_512_EXTRACT_NOT_TRIED_TEXT, 'web_extract_plus')!;
  assert.deepEqual(r.results.map((h) => [h.url, h.failed ?? null]), [
    ['http://example.org/', null],
    ['https://docs.example.org/guide/2', 'not tried: provider rate limit reached'],
    ['https://docs.example.org/guide/3', 'not tried: provider rate limit reached'],
  ]);
  assert.equal(r.results[1].title, 'docs.example.org');
});

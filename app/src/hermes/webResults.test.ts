/// <reference types="node" />
// WSP / generic web tool results → hits (docs/WSP-INTEGRATION.md, Web Source Contract v1 level 1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, parseWebToolOutput } from './webResults.ts';
import { HERMES_WEB_SEARCH_JSON, WSP_EMPTY_TEXT, WSP_ERROR_TEXT, WSP_EXTRACT_TEXT, WSP_MCP_JSON, WSP_RESEARCH_TEXT, WSP_SEARCH_TEXT } from './webResults.fixtures.ts';

test('WSP plugin text: provider, cached, hits with title / url / snippet / published', () => {
  const r = parseWebToolOutput(WSP_SEARCH_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'brave');
  assert.equal(r.cached, true);
  assert.equal(r.results.length, 3);
  assert.deepEqual(r.results[0], {
    title: 'What’s new in Python 3.14',
    url: 'https://docs.example.org/3.14/whatsnew/3.14.html',
    snippet: 'Free-threaded build is now officially supported (PEP 779). Template strings (PEP 750) …',
    published: '3 days ago',
  });
  assert.equal(r.results[1].snippet, 'This PEP establishes the criteria …');
  // shape detection: the header alone is enough, whatever the tool is called (native backend keeps generic names)
  assert.equal(parseWebToolOutput(WSP_SEARCH_TEXT, 'web_search')?.results.length, 3);
  assert.equal(parseWebToolOutput(WSP_SEARCH_TEXT)?.results.length, 3);
});

test('WSP research mode: summaries and results de-duplicated by URL', () => {
  const r = parseWebToolOutput(WSP_RESEARCH_TEXT, 'web_search_plus')!;
  assert.equal(r.provider, 'exa');
  assert.deepEqual(r.results.map((h) => h.url), ['https://docs.example.org/3.14/whatsnew/3.14.html', 'https://docs.example.org/howto/free-threading-python.html']);
});

test('WSP extract text: pages incl. failed ones; empty and error results', () => {
  const r = parseWebToolOutput(WSP_EXTRACT_TEXT, 'web_extract_plus')!;
  assert.equal(r.provider, 'tavily');
  assert.deepEqual(r.results.map((h) => h.url), ['https://peps.example.org/pep-0779/', 'https://broken.example.net/page']);
  const empty = parseWebToolOutput(WSP_EMPTY_TEXT, 'web_search_plus')!;
  assert.deepEqual(empty.results, []);
  assert.equal(empty.provider, 'brave');
  const err = parseWebToolOutput(WSP_ERROR_TEXT, 'web_search_plus')!;
  assert.equal(err.error, true);
  assert.deepEqual(err.results, []);
});

test('MCP JSON (object or string): provider from the receipt, cache hit, http(s) only, duplicates once', () => {
  for (const out of [WSP_MCP_JSON, JSON.stringify(WSP_MCP_JSON)]) {
    const r = parseWebToolOutput(out, 'mcp__web_search_plus__web_search')!;
    assert.equal(r.provider, 'serper');
    assert.equal(r.cached, true);
    assert.deepEqual(r.results.map((h) => h.url), ['https://www.example.com/py314']);
  }
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

test('canonicalUrl joins cited and retrieved URLs', () => {
  assert.equal(canonicalUrl('https://www.Example.com/a/?utm_source=x&id=2#top'), 'example.com/a?id=2');
  assert.equal(canonicalUrl('http://example.com/a'), canonicalUrl('https://example.com/a/'));
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

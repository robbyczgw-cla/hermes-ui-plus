/// <reference types="node" />
// WSP derived sources: the model's [n] list joined with what the turn's web tools retrieved (by canonical URL)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Segment } from '../../protocol/types';
import type { ToolEvent } from '../../hermes/types.ts';
import { toolDetailFrom } from '../../hermes/sessionMapping.ts';
import { WSP_EXTRACT_TEXT, WSP_EXTRACT_URLS, WSP_SEARCH_TEXT } from '../../hermes/webResults.fixtures.ts';
import { withCitationSources } from './citations.ts';
import { joinSources, retrievedSources, withRetrievedSources } from './webSources.ts';

const search = (): ToolEvent => {
  const call = { id: 's1', name: 'web_search_plus', arguments: { query: 'python 3.14' } };
  const { detail } = toolDetailFrom(call as never, { id: '2', role: 'tool', content: WSP_SEARCH_TEXT, toolCallId: 's1' });
  return { id: 's1', name: 'web_search_plus', label: 'python 3.14', status: 'done', startedAt: 1, endedAt: 2, detail };
};
const extract = (url: string): ToolEvent => ({ id: 'e1', name: 'web_extract_plus', label: url, status: 'done', startedAt: 3, endedAt: 4, detail: { tool: 'web_extract_plus', input: { urls: [url] }, web: { count: 1 } } });

const ANSWER = `Free threading ist offiziell unterstützt [1][2]. Neu sind auch Template-Strings [3].

[1] https://docs.example.org/articles/2026/09/14/free-threaded-builds-example-linux — Example Linux
[2] https://www.blog.example.net/2026/09/25/free-threading-support-change/?utm_source=feed — Blog
[3] https://made-up.example.net/t-strings — Erfunden`;

test('cited items gain the search snippet; cited but never retrieved → unverified', () => {
  const cited = withCitationSources([{ key: 'm0', kind: 'markdown', text: ANSWER }]);
  const out = withRetrievedSources(cited.segments, [search()]);
  assert.notEqual(out, cited.segments);
  const items = (out[1] as Extract<Segment, { kind: 'hui' }>).node as unknown as { items: { url: string; snippet?: string; unverified?: true }[] };
  assert.equal(items.items[0].snippet, 'Free-threaded builds are now available on Example Linux Developers on Example Linux 9.8 and 10.2 can now install the free-threaded interpreter …');
  assert.equal(items.items[0].unverified, undefined);
  // utm parameters / www / trailing slash do not matter for the join
  assert.equal(items.items[1].unverified, undefined);
  assert.equal(items.items[2].unverified, true);
  // numbering and order stay the model's
  assert.deepEqual(items.items.map((i) => i.url), ['https://docs.example.org/articles/2026/09/14/free-threaded-builds-example-linux', 'https://www.blog.example.net/2026/09/25/free-threading-support-change/?utm_source=feed', 'https://made-up.example.net/t-strings']);
});

test('pages read with an extract tool count as retrieved', () => {
  const r = retrievedSources([search(), extract('https://made-up.example.net/t-strings')])!;
  const joined = joinSources([{ title: 'T', url: 'https://made-up.example.net/t-strings/' }], r);
  assert.equal(joined[0].unverified, undefined);
});

test('WSP 5.1 extract: requested `?ref=` spellings and provider URLs both join; a failed page is not retrieved', () => {
  const call = { id: 'e2', name: 'web_extract_plus', arguments: { urls: WSP_EXTRACT_URLS } };
  const { detail } = toolDetailFrom(call as never, { id: '3', role: 'tool', content: WSP_EXTRACT_TEXT, toolCallId: 'e2' });
  const ev: ToolEvent = { id: 'e2', name: 'web_extract_plus', label: 'x', status: 'done', startedAt: 1, endedAt: 2, detail };
  const r = retrievedSources([ev])!;
  assert.equal(r.complete, true);
  const joined = joinSources(
    [
      { title: 'requested spelling', url: WSP_EXTRACT_URLS[1] },
      { title: 'provider URL', url: 'https://news.example.org/2026/10/version-3160-alpha-1-is-now-available/' },
      { title: 'start page', url: 'https://example.org' },
      { title: '404', url: WSP_EXTRACT_URLS[3] },
    ],
    r,
  );
  assert.deepEqual(joined.map((j) => j.unverified ?? false), [false, false, false, true]);
});

test('progressive: no web tools, live / unparsed results or a model-written sources node → unchanged', () => {
  const cited = withCitationSources([{ key: 'm0', kind: 'markdown', text: ANSWER }]);
  assert.equal(withRetrievedSources(cited.segments, []), cited.segments);
  assert.equal(withRetrievedSources(cited.segments, undefined), cited.segments);
  // a web tool without parsed result (live turn, generic tool with unknown output): nothing is marked
  const live: ToolEvent = { id: 'w', name: 'web_search', label: 'q', status: 'done', startedAt: 1 };
  assert.equal(retrievedSources([live])?.complete, false);
  assert.equal(withRetrievedSources(cited.segments, [live]), cited.segments);
  // partially parsed: snippets join, but no "not retrieved" marks
  const mixed = withRetrievedSources(cited.segments, [search(), live]);
  const items = ((mixed[1] as Extract<Segment, { kind: 'hui' }>).node as unknown as { items: { unverified?: true }[] }).items;
  assert.ok(items.every((i) => !i.unverified));
  // the model's own ```hui sources block is not touched
  const own: Segment[] = [{ key: 'h0', kind: 'hui', complete: true, raw: '', node: { type: 'sources', items: [{ title: 'x', url: 'https://x.example' }] } as never }];
  assert.equal(withRetrievedSources(own, [search()]), own);
});

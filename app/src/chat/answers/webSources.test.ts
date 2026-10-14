/// <reference types="node" />
// WSP derived sources: the model's [n] list joined with what the turn's web tools retrieved (by canonical URL)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Segment } from '../../protocol/types';
import type { ToolEvent } from '../../hermes/types.ts';
import { toolDetailFrom } from '../../hermes/sessionMapping.ts';
import { WSP_SEARCH_TEXT } from '../../hermes/webResults.fixtures.ts';
import { withCitationSources } from './citations.ts';
import { joinSources, retrievedSources, withRetrievedSources } from './webSources.ts';

const search = (): ToolEvent => {
  const call = { id: 's1', name: 'web_search_plus', arguments: { query: 'python 3.14' } };
  const { detail } = toolDetailFrom(call as never, { id: '2', role: 'tool', content: WSP_SEARCH_TEXT, toolCallId: 's1' });
  return { id: 's1', name: 'web_search_plus', label: 'python 3.14', status: 'done', startedAt: 1, endedAt: 2, detail };
};
const extract = (url: string): ToolEvent => ({ id: 'e1', name: 'web_extract_plus', label: url, status: 'done', startedAt: 3, endedAt: 4, detail: { tool: 'web_extract_plus', input: { urls: [url] }, web: { count: 1 } } });

const ANSWER = `Free-Threading ist offiziell unterstützt [1][2]. Neu sind auch Template-Strings [3].

[1] https://docs.example.org/3.14/whatsnew/3.14.html — What’s new
[2] https://blog.example.com/python-3-14 — Release-Blog
[3] https://made-up.example.net/t-strings — Erfunden`;

test('cited items gain the search snippet; cited but never retrieved → unverified', () => {
  const cited = withCitationSources([{ key: 'm0', kind: 'markdown', text: ANSWER }]);
  const out = withRetrievedSources(cited.segments, [search()]);
  assert.notEqual(out, cited.segments);
  const items = (out[1] as Extract<Segment, { kind: 'hui' }>).node as unknown as { items: { url: string; snippet?: string; unverified?: true }[] };
  assert.equal(items.items[0].snippet, 'Free-threaded build is now officially supported (PEP 779). Template strings (PEP 750) …');
  assert.equal(items.items[0].unverified, undefined);
  // utm parameters / www / trailing slash do not matter for the join
  assert.equal(items.items[1].unverified, undefined);
  assert.equal(items.items[2].unverified, true);
  // numbering and order stay the model's
  assert.deepEqual(items.items.map((i) => i.url), ['https://docs.example.org/3.14/whatsnew/3.14.html', 'https://blog.example.com/python-3-14', 'https://made-up.example.net/t-strings']);
});

test('pages read with an extract tool count as retrieved', () => {
  const r = retrievedSources([search(), extract('https://made-up.example.net/t-strings')])!;
  const joined = joinSources([{ title: 'T', url: 'https://made-up.example.net/t-strings/' }], r);
  assert.equal(joined[0].unverified, undefined);
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

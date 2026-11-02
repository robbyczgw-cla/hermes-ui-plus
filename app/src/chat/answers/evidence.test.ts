// Honest evidence (research item 12): data cards check what they call a source against the chat's tool calls.
// Model-free replay of the real 0.2.0 transcript (realUserRound4.fixtures.ts) plus synthetic web / other-tool chats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ToolEvent } from '../../hermes/types.ts';
import { makeT } from '../../i18n/core.ts';
import { parseMessage } from '../../protocol/streamParser.ts';
import { makeS, S_DE } from '../../ui/components/modules/a/text.ts';
import { provenanceInfo, type EvidenceView } from '../../ui/components/modules/a/misc.ts';
import { conversationEvidence, createEvidenceDerive, factualBlock, turnEvidence } from './evidence.ts';
import { PHONES_NO_WEB } from './realUserRound4.fixtures.ts';

const S_EN = makeS(makeT('en', 'en-US'));
const S_ES = makeS(makeT('es', 'es-ES'));

let n = 0;
const user = (text: string): ChatMessage => ({ id: `u-${++n}`, role: 'user', text, tools: [], status: 'done', createdAt: n });
const answer = (text: string, tools: ToolEvent[] = []): ChatMessage => ({ id: `a-${++n}`, role: 'assistant', text, tools, status: 'done', createdAt: n });
const tool = (name: string, detail?: ToolEvent['detail']): ToolEvent => ({ id: `t-${++n}`, name, label: name, status: 'done', startedAt: n, endedAt: n, ...(detail ? { detail } : {}) });
const hui = (node: unknown) => `\`\`\`hui\n${JSON.stringify(node)}\n\`\`\``;

/** every ```hui segment of an answer: the node (or null) and the raw block */
function blocks(m: Pick<ChatMessage, 'text'>) {
  return parseMessage(m.text).flatMap((s) => (s.kind === 'hui' ? [{ node: (s.node ?? null) as Record<string, unknown> | null, raw: s.raw, fallback: !!s.fallback }] : []));
}

test('real transcript (0.2.0, no web tools): the "Quelle: Herstellerangaben" table is shown as model knowledge, never as a source', () => {
  const ev = conversationEvidence(PHONES_NO_WEB);
  const answers = PHONES_NO_WEB.filter((m) => m.role === 'assistant');
  assert.equal(answers.length, 3);
  // the only tool of the chat is Hermes' tool discovery (it found no web tool): nothing was looked up
  for (const a of answers) assert.deepEqual(ev.get(a.id), { web: false }, a.id);

  const table = blocks(answers[2]).find((b) => b.node?.type === 'table')!.node!;
  assert.equal(table.source, 'Herstellerangaben');
  assert.equal(table.basis, 'sourced');
  // what 0.2.0 showed (no evidence check): the invented attribution as a source claim
  assert.equal(provenanceInfo(table.basis, table.source, S_DE)!.label, 'Quelle: Herstellerangaben');
  // now
  const info = provenanceInfo(table.basis, table.source, S_DE, ev.get(answers[2].id))!;
  assert.equal(info.label, 'Aus Modellwissen, ohne Webquelle');
  assert.equal(info.tone, 'caution');
  assert.equal(info.url, undefined);
  assert.equal(info.unbacked, 'model');
  assert.ok(!info.label.includes('Herstellerangaben') && !info.label.includes('Quelle'));
  assert.equal(provenanceInfo(table.basis, table.source, S_EN, ev.get(answers[2].id))!.label, 'From model knowledge, no web source');
  assert.equal(provenanceInfo(table.basis, table.source, S_ES, ev.get(answers[2].id))!.label, 'Del conocimiento del modelo, sin fuente web');

  // the first answer's products block (compare shape the app cannot read → readable list fallback) names no
  // provenance at all; it still gets the badge, because product facts need a lookup
  const products = blocks(answers[0]).find((b) => /"type":\s*"products"/.test(b.raw))!;
  assert.ok(products.fallback, 'shown as the list fallback');
  assert.ok(factualBlock(products.raw));
  assert.equal(provenanceInfo(undefined, undefined, S_DE, ev.get(answers[0].id), true)!.label, 'Aus Modellwissen, ohne Webquelle');
});

test('provenanceInfo without web evidence: honest labels stay, claimed sources go, factual nodes get the badge', () => {
  const none: EvidenceView = { web: false };
  assert.equal(provenanceInfo('estimate', undefined, S_DE, none)!.label, 'Schätzung');
  assert.equal(provenanceInfo('illustrative', undefined, S_DE, none)!.label, 'Beispielwerte');
  assert.equal(provenanceInfo('calculated', undefined, S_DE, none)!.label, 'Berechnet');
  // a remembered source next to an honest basis: the basis stays, the source becomes the badge
  assert.equal(provenanceInfo('estimate', 'Statistisches Bundesamt', S_DE, none)!.label, 'Schätzung · Aus Modellwissen, ohne Webquelle');
  assert.equal(provenanceInfo('calculated', 'Herstellerangaben Oktober 2026', S_DE, none)!.label, 'Berechnet · Aus Modellwissen, ohne Webquelle');
  // a URL the model wrote from memory is no link
  const url = provenanceInfo('sourced', 'https://www.apple.com/iphone-16/specs/', S_DE, none)!;
  assert.equal(url.label, 'Aus Modellwissen, ohne Webquelle');
  assert.equal(url.url, undefined);
  assert.equal(provenanceInfo(undefined, 'Herstellerangaben', S_DE, none)!.label, 'Aus Modellwissen, ohne Webquelle');
  // the user's own data (a document they gave) keeps its source
  assert.equal(provenanceInfo('user', 'Deine Tabelle', S_DE, none)!.label, 'Deine Angaben · Quelle: Deine Tabelle');
  // nodes without provenance: only fact types get the badge, an estimate on them stays an estimate
  assert.equal(provenanceInfo(undefined, undefined, S_DE, none), null);
  assert.equal(provenanceInfo(undefined, undefined, S_DE, none, true)!.label, 'Aus Modellwissen, ohne Webquelle');
  assert.equal(provenanceInfo('estimate', undefined, S_DE, none, true)!.label, 'Schätzung');
  // unknown evidence (gallery, demo, other tools): exactly as before
  assert.equal(provenanceInfo('sourced', 'Herstellerangaben', S_DE, undefined, true)!.label, 'Quelle: Herstellerangaben');
  assert.equal(provenanceInfo(undefined, undefined, S_DE, undefined, true), null);
});

test('web results: a source on a searched site stays a link, a URL no search returned loses it', () => {
  const search = tool('web_search', {
    tool: 'web_search',
    input: { query: 'iPhone 16 specs' },
    links: [{ title: 'iPhone 16 - Tech Specs', url: 'https://www.apple.com/iphone-16/specs/' }, { title: 'Pixel 9 specs', url: 'https://support.google.com/pixelphone/answer/7158570' }],
    web: { count: 2 },
  });
  const chat = [
    user('iPhone 16 vs Pixel 9?'),
    answer('Laut den Herstellerseiten …', [search]),
    user('als Tabelle?'),
    answer(hui({ type: 'table', columns: ['', 'iPhone 16', 'Pixel 9'], rows: [['Main', '48 MP', '50 MP']], basis: 'sourced', source: 'https://www.apple.com/iphone-16/specs/' })),
  ];
  const ev = conversationEvidence(chat);
  const tableEv = ev.get(chat[3].id)!;
  assert.equal(tableEv.web, true, 'the follow-up without tools keeps the earlier search');
  const ok = provenanceInfo('sourced', 'https://www.apple.com/iphone-16/specs/', S_DE, tableEv)!;
  assert.equal(ok.label, 'Quelle: apple.com');
  assert.equal(ok.url, 'https://www.apple.com/iphone-16/specs/');
  // same site, other page, the bare domain, a parent / subdomain of a searched host count; a sibling host is another site
  assert.equal(provenanceInfo('sourced', 'https://apple.com', S_DE, tableEv)!.url, 'https://apple.com');
  assert.ok(provenanceInfo('sourced', 'https://support.google.com/pixelphone', S_DE, tableEv)!.url);
  assert.ok(provenanceInfo('sourced', 'https://google.com', S_DE, tableEv)!.url);
  assert.equal(provenanceInfo('sourced', 'https://store.google.com/pixel_9', S_DE, tableEv)!.url, undefined);
  // a site no search returned
  const bad = provenanceInfo('sourced', 'https://www.gsmarena.com/google_pixel_9-13219.php', S_DE, tableEv)!;
  assert.equal(bad.label, 'Nicht in den Suchergebnissen: gsmarena.com');
  assert.equal(bad.url, undefined);
  assert.equal(bad.unbacked, 'unretrieved');
  assert.equal(provenanceInfo('estimate', 'https://www.gsmarena.com/x', S_EN, tableEv)!.label, 'Estimate · Not in the search results: gsmarena.com');
  // free-text sources cannot be checked against URLs: as before
  assert.equal(provenanceInfo('sourced', 'Herstellerangaben', S_DE, tableEv)!.label, 'Quelle: Herstellerangaben');
  // a web call without parsed results (live turn, unknown tool output): "not retrieved" is not meaningful
  const blind = conversationEvidence([user('x'), answer('y', [tool('web_search')])]);
  const blindEv = [...blind.values()][0]!;
  assert.deepEqual(blindEv, { web: true });
  assert.ok(provenanceInfo('sourced', 'https://www.gsmarena.com/x', S_DE, blindEv)!.url);
});

test('turnEvidence: discovery / to-do / skills / reminders bring no facts; other tools are unknown', () => {
  assert.equal(turnEvidence({ tools: [] }), 'none');
  assert.equal(turnEvidence({ tools: [tool('tool_search'), tool('todo'), tool('skill_view'), tool('cronjob_manage'), tool('image_generate')] }), 'none');
  for (const name of ['web_search', 'web_extract', 'web_search_plus', 'browser_navigate', 'mcp__web_search_plus__web_search', 'x_search']) {
    assert.equal(turnEvidence({ tools: [tool(name)] }), 'web', name);
  }
  for (const name of ['terminal', 'read_file', 'memory', 'session_search', 'delegate_task', 'mcp__weather__forecast', 'some_new_tool']) {
    assert.equal(turnEvidence({ tools: [tool(name)] }), 'other', name);
  }
  // server-side search of a direct backend, counted in the metrics
  assert.equal(turnEvidence({ tools: [], metrics: { webSearchRequests: 1 } }), 'web');
});

test('conversationEvidence: unknown after another data tool or a cut history, web wins once it ran', () => {
  const a1 = answer('Ich lese die Datei.', [tool('read_file')]);
  const a2 = answer(hui({ type: 'table', columns: ['a'], rows: [['1']], source: 'Datei' }));
  const ev = conversationEvidence([user('lies x.csv'), a1, user('als Tabelle'), a2]);
  assert.equal(ev.get(a1.id), undefined);
  assert.equal(ev.get(a2.id), undefined, 'later turns stay unknown too');
  const a3 = answer('z', [tool('web_search')]);
  assert.equal(conversationEvidence([user('a'), a1, user('b'), a3]).get(a3.id)?.web, true);
  // the start of the chat is not loaded: an earlier turn may have searched
  const plain = answer('nur Text');
  assert.equal(conversationEvidence([user('a'), plain], true).get(plain.id), undefined);
  assert.deepEqual(conversationEvidence([user('a'), plain]).get(plain.id), { web: false });
});

test('createEvidenceDerive: the map keeps its identity while no verdict changes (streaming ticks)', () => {
  const derive = createEvidenceDerive();
  const u1 = user('Vergleiche A und B');
  const a1 = answer('…');
  const m1 = derive([u1, a1]);
  assert.equal(derive([u1, a1]), m1, 'same input');
  const tick = { ...a1, text: '… mehr Text' };
  assert.equal(derive([u1, tick]), m1, 'a streaming tick without tools');
  const withTodo = { ...tick, tools: [tool('todo')] };
  assert.equal(derive([u1, withTodo]), m1, 'a tool that changes nothing');
  const withWeb = { ...withTodo, tools: [...withTodo.tools, tool('web_search')] };
  const m2 = derive([u1, withWeb]);
  assert.notEqual(m2, m1);
  assert.equal(m2.get(a1.id)?.web, true);
  // a new turn: the earlier answer keeps its object
  const u2 = user('als Tabelle?');
  const a2 = answer('…');
  const m3 = derive([u1, withWeb, u2, a2]);
  assert.equal(m3.get(a1.id), m2.get(a1.id));
  assert.equal(m3.get(a2.id)?.web, true);
  // equal to the one-shot computation
  assert.deepEqual([...m3.keys()], [...conversationEvidence([u1, withWeb, u2, a2]).keys()]);
  assert.deepEqual(derive([u1, withWeb, u2, a2], true).get(a1.id)?.web, true, 'web stays web with a cut history');
});

test('factualBlock: products / places / weather blocks', () => {
  assert.ok(factualBlock('{"type":"products","columns":[]}'));
  assert.ok(factualBlock('{\n  "type": "places"}'));
  assert.ok(!factualBlock('{"type":"table"}'));
  assert.ok(!factualBlock('not json'));
});

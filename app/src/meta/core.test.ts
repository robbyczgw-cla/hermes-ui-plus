/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetaMessages, followupsNode, hasInteractiveHui, metaConnFromProfile, metaUrl, newlyFinished, parseMetaResponse, planMeta,
  statusMapOf, cleanFollowups, MetaError,
} from './core.ts';

const msg = (id: string, role: string, text: string, status = 'done') => ({ id, role, text, status });
const fence = (o: unknown) => `Text\n\n\`\`\`hui\n${typeof o === 'string' ? o : JSON.stringify(o)}\n\`\`\`\n`;

test('metaUrl strips /v1 and trailing slashes', () => {
  assert.equal(metaUrl('http://h:8643/v1/'), 'http://h:8643/bridge/meta');
  assert.equal(metaUrl('http://h:8643'), 'http://h:8643/bridge/meta');
});

test('metaConnFromProfile needs a bridge hermes profile', () => {
  assert.equal(metaConnFromProfile({ kind: 'hermes', baseUrl: 'http://x/v1', apiKey: 'k', bridge: true })?.apiKey, 'k');
  assert.equal(metaConnFromProfile({ kind: 'hermes', baseUrl: 'http://x/v1', apiKey: 'k' }), null);
  assert.equal(metaConnFromProfile({ kind: 'claude', baseUrl: 'http://x', apiKey: 'k', bridge: true }), null);
  assert.equal(metaConnFromProfile(null), null);
});

test('buildMetaMessages: last 4, text only, truncated, unfinished answers skipped', () => {
  const ms = [
    msg('1', 'user', 'a'), msg('2', 'assistant', 'b'), msg('3', 'user', 'c'),
    msg('4', 'assistant', `Antwort ${fence({ type: 'table', rows: [] })} Ende`), msg('5', 'user', 'x'.repeat(5000)),
    msg('6', 'assistant', 'läuft noch', 'streaming'),
  ];
  const t = buildMetaMessages(ms);
  assert.equal(t.length, 4);
  assert.deepEqual(t.map((x) => x.role), ['assistant', 'user', 'assistant', 'user']);
  assert.equal(t[2].content, 'Antwort Text Ende');
  assert.ok(t[3].content.length <= 1200 + 10);
  assert.ok(!t.some((x) => x.content.includes('```') || x.content.includes('läuft')));
});

test('buildMetaMessages drops empty turns and open fences', () => {
  const t = buildMetaMessages([msg('1', 'user', 'Frage'), msg('2', 'assistant', '```hui\n{"type":"tab')]);
  assert.deepEqual(t, [{ role: 'user', content: 'Frage' }]);
});

test('hasInteractiveHui: every interactive type, nested, invalid JSON', () => {
  for (const type of ['choice', 'form', 'slots', 'confirm', 'checklist', 'calc', 'quiz']) {
    assert.equal(hasInteractiveHui(fence({ type })), true, type);
  }
  assert.equal(hasInteractiveHui(fence({ type: 'card', children: [{ type: 'text' }, { type: 'stack', children: [{ type: 'quiz' }] }] })), true);
  assert.equal(hasInteractiveHui(fence('{"type":"card","children":[{"type":"choice"')), true); // streaming / broken
  assert.equal(hasInteractiveHui(fence({ type: 'table', columns: ['a'], rows: [] })), false);
  assert.equal(hasInteractiveHui(fence({ type: 'suggestions', items: ['a'] })), false);
  assert.equal(hasInteractiveHui('Nur Text mit "type": "choice" im Fließtext'), false);
  assert.equal(hasInteractiveHui(fence('')), false);
});

test('newlyFinished only reports live streaming -> done transitions', () => {
  const before = [msg('u', 'user', 'hi'), msg('a', 'assistant', 'teil', 'streaming')];
  const after = [msg('u', 'user', 'hi'), msg('a', 'assistant', 'fertig', 'done')];
  assert.deepEqual(newlyFinished(statusMapOf(before), after).map((m) => m.id), ['a']);
  assert.deepEqual(newlyFinished(statusMapOf(after), after), []); // old chat / re-render
  assert.deepEqual(newlyFinished(new Map(), after), []); // freshly opened chat
  assert.deepEqual(newlyFinished(statusMapOf(before), [after[0], msg('a', 'assistant', '  ', 'done')]), []);
});

test('planMeta: title once, follow-ups unless interactive', () => {
  const plain = msg('a', 'assistant', 'Antwort');
  const base = { title: true, followups: true, titleDone: false, hasTitle: false };
  assert.deepEqual(planMeta(plain, base), { want: ['title', 'followups'] });
  assert.deepEqual(planMeta(plain, { ...base, titleDone: true }), { want: ['followups'] });
  assert.deepEqual(planMeta(plain, { ...base, hasTitle: true }), { want: ['followups'] });
  const interactive = msg('a', 'assistant', fence({ type: 'choice' }));
  assert.deepEqual(planMeta(interactive, base), { want: ['title'] });
  assert.equal(planMeta(interactive, { ...base, titleDone: true }), null);
  assert.equal(planMeta(plain, { ...base, followups: false, titleDone: true }), null);
});

test('parseMetaResponse + cleanFollowups enforce limits', () => {
  const r = parseMetaResponse(JSON.stringify({ title: ' Hallo Welt ', followups: ['a', 'A', 'x'.repeat(61), 'b', 'c', 'd', 5], model: 'm', ms: 12, cached: true }));
  assert.deepEqual(r, { title: 'Hallo Welt', followups: ['a', 'b', 'c'], model: 'm', ms: 12, cached: true });
  assert.throws(() => parseMetaResponse('nope'), MetaError);
  assert.deepEqual(parseMetaResponse({}), {});
  assert.deepEqual(cleanFollowups([' ', 'ok  ja']), ['ok ja']);
});

test('followupsNode returns a suggestions HuiNode or null', () => {
  assert.deepEqual(followupsNode(['Mehr dazu?', 'Beispiel?'], 'f1'), { type: 'suggestions', items: ['Mehr dazu?', 'Beispiel?'], id: 'f1' });
  assert.equal(followupsNode([]), null);
  assert.equal(followupsNode(undefined), null);
});

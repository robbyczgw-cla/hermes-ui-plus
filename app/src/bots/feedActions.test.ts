import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChatAction, type ChatActionDeps } from '../chat/actionHandler.ts';
import { answerMenuItems } from '../chat/answerMenu.ts';
import { messagePlainText, quoteOf } from '../chat/quote.ts';
import { splitQuotes } from '../chat/quoteWire.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { feedActionDeps, feedActionText } from './feedActions.ts';

const row = (id: string, role: ChatMessage['role'], text: string, feed = true): ChatMessage => ({ id, role, text, tools: [], status: 'done', createdAt: 1, ...(feed ? { feed: true as const } : {}) });
const CRON = '[Cronjob "Preis-Check" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\nTisch 289 € bei Shop A';
const CARD = '```hui\n{"type":"choice","id":"c1","question":"Kaufen?","options":["Ja","Nein"]}\n```';
const list = [row('f0:hu-1', 'user', CRON), row('f0:ha-2', 'assistant', `Soll ich zuschlagen?\n\n${CARD}`), row('f0:ha-3', 'assistant', CARD), row('u1', 'user', 'hallo', false), row('a1', 'assistant', 'hi', false)];

function deps(sent: string[], ran: string[] = []): ChatActionDeps {
  return {
    send: (t) => (sent.push(t), true),
    isBusy: () => false,
    run: async (a) => {
      ran.push(a.type === 'send' ? String(a.text) : a.type);
      return { ok: true, status: 'done' } as never;
    },
    buildAsk: async (a) => `${String(a.text)} [ask]`,
  };
}
const ui = { toast: () => {}, tr: ((k: string) => k) as never, tapHaptic: () => {} };

test('a choice tapped on a delivery goes out with that row as a quote, so the bare reply is understandable', () => {
  const out = feedActionText(list, 'f0:ha-2', '[choice:c1] Kaufen? → Ja');
  const q = splitQuotes(out);
  assert.equal(q.text, '[choice:c1] Kaufen? → Ja');
  assert.match(q.quotes[0].text, /Soll ich zuschlagen/);
  assert.equal(q.quotes[0].ref, 'f0:ha-2');
});

test("a card's own words are the quote; a comment with nothing to quote takes its delivery", () => {
  assert.match(splitQuotes(feedActionText([list[0], list[2]], 'f0:ha-3', '[choice:c1] Ja')).quotes[0].text, /Kaufen\?/);
  const q = splitQuotes(feedActionText([list[0], row('f0:ha-4', 'assistant', '![](https://example.com/a.png)')], 'f0:ha-4', '[choice:c1] Ja'));
  assert.match(q.quotes[0].text, /Tisch 289/);
  assert.doesNotMatch(q.quotes[0].text, /Cronjob/);
});

test("the talk's own rows stay bare", () => {
  assert.equal(feedActionText(list, 'a1', '[choice:c1] Ja'), '[choice:c1] Ja');
  assert.equal(feedActionText(list, undefined, 'x'), 'x');
  assert.equal(feedActionText(list, 'gone', 'x'), 'x');
});

test('every path of a tap carries the quote: send, form, ask, and send after the confirm sheet', async () => {
  const sent: string[] = [];
  const ran: string[] = [];
  const d = () => feedActionDeps(deps(sent, ran), () => list, 'f0:ha-2');
  handleChatAction(d(), ui, { type: 'send', text: 'Ja' }, undefined, { label: 'Ja' } as never, 'f0:ha-2');
  handleChatAction(d(), ui, { type: 'ask', text: 'Was kostet es?' }, undefined, { label: 'Was kostet es?' } as never, 'f0:ha-2');
  handleChatAction(d(), ui, { type: 'send', text: 'something else entirely' }, undefined, { label: 'Ok' } as never, 'f0:ha-2');
  await new Promise((r) => setTimeout(r, 5));
  const all = [...sent, ...ran];
  assert.ok(all.length >= 3, JSON.stringify(all));
  for (const t of all) assert.equal(splitQuotes(t).quotes.length, 1, t);
});

test('a reformat chip on a delivery goes into the talk with the row, the tag stays readable', () => {
  const q = splitQuotes(feedActionText(list, 'f0:ha-2', '[reformat:table] Als Tabelle'));
  assert.equal(q.text, '[reformat:table] Als Tabelle');
  assert.equal(q.quotes.length, 1);
});

test('quoting a delivery reads as the job and its output, never the injected header', () => {
  const q = quoteOf(list[0])!;
  assert.match(q.text, /^Preis-Check: Tisch 289/);
  assert.doesNotMatch(messagePlainText(list[0]), /Cronjob|scheduled job/);
});

test('answer menu on a Bot Chat row: reply and copy; no retry, branch or report', () => {
  const s = { local: true, feed: true, streaming: false, failed: false, isLast: true, busy: false, hasText: true, recovering: false, usedWeb: true, shareImage: false, reported: false, canBranch: true, canReply: true };
  const keys = answerMenuItems(s);
  assert.ok(keys.includes('reply'));
  assert.ok(keys.includes('copy'));
  for (const k of ['retry', 'noWeb', 'branch', 'report'] as const) assert.ok(!keys.includes(k), k);
  // without a composer to quote into it stays off
  assert.ok(!answerMenuItems({ ...s, canReply: false }).includes('reply'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../hermes/types.ts';
import { parseMessage } from '../protocol/streamParser.ts';
import { excerptOf, liveEventsOf } from './extract.ts';

const msg = (id: string, role: 'user' | 'assistant', text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, text, tools: [], status: 'done', createdAt: 1, ...extra });
const BLOCK = '```hui\n{"type":"checklist","id":"einkauf","live":true,"title":"Einkauf","items":[{"id":"milch","text":"Milch"}]}\n```';

test('events: live blocks of finished answers and user batches, in transcript order; streaming answers wait', () => {
  const messages = [
    msg('hu-1', 'user', 'Liste bitte'),
    msg('ha-2', 'assistant', `Ich habe dir eine Liste angelegt. Sie steht oben.\n\n${BLOCK}`),
    msg('hu-3', 'user', 'Danke', { live: { einkauf: { v: 1, ops: [{ check: 'milch' }] } } }),
    msg('ha-4', 'assistant', `Noch eine Version.\n\n${BLOCK}`, { status: 'streaming' }),
    msg('ha-5', 'assistant', '```hui\n{"type":"checklist","id":"plain","items":[{"text":"x"}]}\n```'),
  ];
  const evs = liveEventsOf(messages, (m) => parseMessage(m.text));
  // once the chat has a card, a finished plain list is a `plain` event with the turn it answers (the fold decides)
  assert.deepEqual(evs.map((e) => [e.kind, e.key]), [['hermes', 'ha-2'], ['user', 'hu-3'], ['plain', 'ha-5']]);
  const plain = evs[2];
  assert.ok(plain.kind === 'plain');
  assert.equal(plain.node, 'plain');
  assert.deepEqual(plain.turn, { cards: ['einkauf'], text: 'Danke' });
  assert.deepEqual(plain.full.items, [{ text: 'x' }]);
  assert.equal(evs[0].kind === 'hermes' && evs[0].excerpt, 'Ich habe dir eine Liste angelegt.');
});

test('events: no plain or quiet events before the chat has a card', () => {
  const messages = [
    msg('hu-1', 'user', 'Liste bitte'),
    msg('ha-2', 'assistant', '```hui\n{"type":"checklist","id":"plain","items":[{"text":"x"}]}\n```'),
    msg('hu-3', 'user', 'Danke'),
    msg('ha-4', 'assistant', 'Gern.'),
  ];
  assert.deepEqual(liveEventsOf(messages, (m) => parseMessage(m.text)), []);
});

test('excerpt: first sentence before the first block, capped', () => {
  assert.equal(excerptOf('**Grillsachen** sind drauf! Mehr Text.'), 'Grillsachen sind drauf!');
  assert.equal(excerptOf('```hui\n{}\n```'), undefined);
  assert.equal(excerptOf('a'.repeat(200))?.length, 80);
});

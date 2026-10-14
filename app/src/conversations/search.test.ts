/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationMeta } from './types';
import { fold, searchConversations, snippetAround } from './search.ts';

function meta(id: string, title: string): ConversationMeta {
  return { id, title, titleSource: 'auto', profileId: 'p', profileKind: 'hermes', createdAt: 0, updatedAt: 0, preview: 'x', messageCount: 1 };
}

test('fold removes diacritics and case', () => {
  assert.equal(fold('Übersicht Café Straße'), 'ubersicht cafe strasse');
});

const items = [meta('a', 'Reise nach Köln'), meta('b', 'Rezept Kuchen'), meta('c', 'Anderes')];
const texts: Record<string, string> = {
  a: 'Wir fahren mit dem Zug',
  b: 'Mehl, Zucker und Eier. Dann Köln anrufen.',
  c: 'Nichts relevantes',
};

test('title hits first, then message hits with snippet', () => {
  const r = searchConversations(items, 'koln', (id) => texts[id]);
  assert.deepEqual(r.map((h) => [h.meta.id, h.in]), [['a', 'title'], ['b', 'message']]);
  assert.match(r[1].snippet!, /Köln/);
});

test('all tokens must match (AND)', () => {
  assert.deepEqual(searchConversations(items, 'zug reise', (id) => texts[id]).map((h) => h.meta.id), []);
  assert.deepEqual(searchConversations(items, 'reise köln', (id) => texts[id]).map((h) => h.meta.id), ['a']);
});

test('empty query -> no hits; missing text ok', () => {
  assert.deepEqual(searchConversations(items, '  ', () => undefined), []);
  assert.deepEqual(searchConversations(items, 'zug', () => undefined), []);
});

test('snippetAround adds ellipses', () => {
  const s = snippetAround('a'.repeat(100) + ' needle ' + 'b'.repeat(100), ['needle']);
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.includes('needle'));
});

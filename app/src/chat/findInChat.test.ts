/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countMatches, findInMessages, huiText, matchRanges, normalizeQuery, searchableText, splitMatches, stepMatch } from './findInChat.ts';

test('matching is case and accent insensitive, ranges map back to the original text', () => {
  assert.equal(normalizeQuery('  Café  '), 'cafe');
  assert.equal(normalizeQuery('a'), '');
  assert.deepEqual(matchRanges('Ein Café, zwei CAFE', 'cafe'), [[4, 8], [15, 19]]);
  // decomposed accent in the text (e + combining acute) still maps to the whole character run
  const nfd = 'Café Bar';
  assert.deepEqual(matchRanges(nfd, 'café'), [[0, 5]]);
  assert.equal(countMatches('Über über ÜBER', 'uber'), 3);
  assert.deepEqual(splitMatches('Hallo Welt', 'welt'), [{ text: 'Hallo ', hit: false }, { text: 'Welt', hit: true }]);
  assert.deepEqual(splitMatches('nichts', 'welt'), [{ text: 'nichts', hit: false }]);
  // emoji before a match does not shift the range
  assert.deepEqual(matchRanges('😀 Test', 'test'), [[3, 7]]);
});

test('hui text: visible strings only (no keys, ids, urls, colours)', () => {
  const node = { type: 'checklist', id: 'shop', title: 'Einkauf', items: [{ id: 'i1', label: 'Milch' }, { id: 'i2', label: 'Brot', url: 'https://example.com/milch' }], color: 'milch' };
  assert.deepEqual(huiText(node), ['Einkauf', 'Milch', 'Brot']);
});

test('searchable text: Markdown + hui strings, not the raw JSON; user text without hidden notes', () => {
  const answer = 'Hier die Liste:\n\n```hui\n{"type":"checklist","id":"shop","title":"Einkauf","items":[{"id":"a","text":"Milch"}]}\n```\n';
  const text = searchableText({ role: 'assistant', text: answer });
  assert.match(text, /Hier die Liste/);
  assert.match(text, /Milch/);
  assert.doesNotMatch(text, /checklist|"id"/);
  assert.equal(searchableText({ role: 'user', text: 'Hallo\n\n[hui:note] Beantworte ohne Websuche.' }), 'Hallo');
});

test('find over a chat: matches in order, message ids, stepping wraps', () => {
  const msgs = [
    { id: 'u1', role: 'user' as const, text: 'Was kostet Milch?' },
    { id: 'a1', role: 'assistant' as const, text: 'Milch kostet 1 €. Milch ist günstig.' },
    { id: 'u2', role: 'user' as const, text: 'Und Brot?' },
  ];
  const r = findInMessages(msgs, 'milch');
  assert.deepEqual(r.matches, [{ messageId: 'u1', index: 0 }, { messageId: 'a1', index: 0 }, { messageId: 'a1', index: 1 }]);
  assert.deepEqual([...r.messageIds], ['u1', 'a1']);
  assert.equal(findInMessages(msgs, 'm').matches.length, 0);
  assert.equal(stepMatch(-1, 3, 1), 0);
  assert.equal(stepMatch(-1, 3, -1), 2);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 3, -1), 2);
  assert.equal(stepMatch(0, 0, 1), -1);
});

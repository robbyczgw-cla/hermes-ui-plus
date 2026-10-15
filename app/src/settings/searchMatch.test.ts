import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { makeMatcher, visibleRows } from './searchMatch.ts';

test('matcher: every word, case and accents ignored, empty query matches all', () => {
  assert.ok(makeMatcher('')(['x']));
  assert.ok(makeMatcher('MICROFONO')(['micrófono']));
  assert.ok(makeMatcher('auto vorlesen')(['Antworten automatisch vorlesen']));
  assert.ok(!makeMatcher('auto diktat')(['Antworten automatisch vorlesen']));
});

test('visibleRows: title or section keywords show every row, otherwise per row', () => {
  const section = { title: 'Chat', keywords: ['Chats Unterhaltungen'], rows: [{ texts: ['Zeitstempel'] }, { texts: ['Enter sendet'] }] };
  assert.equal(visibleRows(section, makeMatcher('Unterhaltungen')).length, 2);
  assert.equal(visibleRows(section, makeMatcher('chat')).length, 2);
  assert.deepEqual(visibleRows(section, makeMatcher('zeit')), [section.rows[0]]);
  assert.deepEqual(visibleRows({ ...section, keywords: undefined }, makeMatcher('Unterhaltungen')), []);
});

test('search keywords for chats, images and connections (de/en/es)', () => {
  const cases = {
    de: [['settings.chat.keywords', 'Chats'], ['settings.media.imagesKeywords', 'Fotos'], ['settings.connections.keywords', 'Server']],
    en: [['settings.chat.keywords', 'chats'], ['settings.media.imagesKeywords', 'photos'], ['settings.connections.keywords', 'server']],
    es: [['settings.chat.keywords', 'chats'], ['settings.media.imagesKeywords', 'fotos'], ['settings.connections.keywords', 'servidor']],
  } as const;
  for (const [lang, list] of Object.entries(cases) as [keyof typeof cases, (typeof cases)[keyof typeof cases]][]) {
    const t = makeT(lang, lang);
    for (const [key, q] of list) assert.ok(makeMatcher(q)([t(key)]), `${lang} ${key}: "${q}"`);
  }
});

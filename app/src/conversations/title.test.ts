/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUserTitle, displayTitle, makeTitle, renameUnique, uniqueTitle } from './title.ts';

test('short text stays', () => assert.equal(makeTitle('Hallo Welt'), 'Hallo Welt'));
test('whitespace collapsed', () => assert.equal(makeTitle('  a \n\n b\t c '), 'a b c'));
test('empty -> default', () => assert.equal(makeTitle('   '), 'Neuer Chat'));
test('display: stored placeholder shows in the UI language, other titles unchanged', () => {
  assert.equal(displayTitle(makeTitle(''), 'New chat'), 'New chat');
  assert.equal(displayTitle('Umzug planen', 'New chat'), 'Umzug planen');
});
test('truncated to <= 40 chars incl. ellipsis, on word boundary', () => {
  const t = makeTitle('Erkläre mir bitte ausführlich wie ein Transformer Modell funktioniert');
  assert.ok(Array.from(t).length <= 40, t);
  assert.ok(t.endsWith('…'));
  assert.ok(!t.includes('funktio'));
});
test('long word without spaces is hard cut', () => {
  const t = makeTitle('x'.repeat(100));
  assert.equal(Array.from(t).length, 40);
});
test('code fences removed', () => assert.equal(makeTitle('```js\nfoo\n``` Was tut das?'), 'Was tut das?'));
test('emoji are not split', () => {
  const t = makeTitle('😀'.repeat(50));
  assert.equal(Array.from(t).length, 40);
  assert.ok(!t.includes('�'));
});
test('cleanUserTitle', () => {
  assert.equal(cleanUserTitle('  Mein  Chat '), 'Mein Chat');
  assert.equal(cleanUserTitle('   '), null);
  assert.equal(Array.from(cleanUserTitle('a'.repeat(200))!).length, 80);
});

test('N8 uniqueTitle: Hermes titles are unique per server → "#2", "#3" variants', () => {
  assert.equal(uniqueTitle('Pasta Einkaufsliste', []), 'Pasta Einkaufsliste');
  assert.equal(uniqueTitle('Pasta Einkaufsliste', ['pasta einkaufsliste']), 'Pasta Einkaufsliste #2');
  assert.equal(uniqueTitle('Pasta Einkaufsliste', ['Pasta Einkaufsliste', 'Pasta Einkaufsliste #2', undefined]), 'Pasta Einkaufsliste #3');
});

test('N8 renameUnique: retries with the next variant on a title conflict only', async () => {
  const sent: string[] = [];
  const conflict = Object.assign(new Error('Title already in use'), { code: 'invalid_title' });
  const ok = await renameUnique('Städte Österreich', ['Andere'], async (t) => {
    sent.push(t);
    if (sent.length < 3) throw conflict;
  }, (e) => (e as { code?: string }).code === 'invalid_title');
  assert.deepEqual(sent, ['Städte Österreich', 'Städte Österreich #2', 'Städte Österreich #3']);
  assert.equal(ok, 'Städte Österreich #3');
  // other errors: no retry
  const sent2: string[] = [];
  const r = await renameUnique('X', [], async (t) => {
    sent2.push(t);
    throw new Error('offline');
  }, () => false);
  assert.equal(r, null);
  assert.equal(sent2.length, 1);
});

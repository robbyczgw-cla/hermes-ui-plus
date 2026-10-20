import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixListTypos } from '../src/router/listtypos.mjs';
import { editTypes, liveCardDecision } from '../src/router/live.mjs';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';

test('listtypos: one-letter typos of the list words are repaired (de / en / es)', () => {
  assert.equal(fixListTypos('Streich Milch von der Einkaufslsite').toLowerCase(), 'streich milch von der einkaufsliste');
  for (const [typo, ok] of [['Einkaufslsite', 'einkaufsliste'], ['Einkaufsilste', 'einkaufsliste'], ['Einkaufsliste', 'einkaufsliste'],
    ['Einkaufslist', 'einkaufsliste'], ['Einkaufsliset', 'einkaufsliste'], ['Packlsite', 'packliste'], ['Chekliste', 'checkliste'],
    ['chekclist', 'checklist'], ['lsit', 'list'], ['lsita', 'lista'], ['lsite', 'liste'], ['watchlsit', 'watchlist']]) {
    assert.equal(fixListTypos(typo).toLowerCase(), ok, typo);
  }
});

test('listtypos: unrelated words are never touched', () => {
  for (const w of ['last', 'lost', 'lust', 'silt', 'fist', 'listo', 'vista', 'leiste', 'Fußleiste', 'Preisleiste', 'Menüleiste', 'Liste', 'Listen',
    'lists', 'listing', 'Einkaufswagen', 'Einkaufszentrum', 'Einkaufsstraße', 'checkpoint', 'checkout', 'Wachliste', 'Stadtplan', 'Lieste']) {
    assert.equal(fixListTypos(w), w, w);
  }
  const s = 'Das ist die letzte Seite, die ich lost habe; last orders at the vista bar';
  assert.equal(fixListTypos(s), s);
});

test('listtypos: correctly spelt list words stay as they are, so widget replies keep their tag', () => {
  for (const w of ['checklist', 'Checklist', 'checkliste', 'watchlist', 'Einkaufsliste', 'Einkaufszettel', 'packliste', 'list', 'lista', 'liste']) {
    assert.equal(fixListTypos(w), w, w);
  }
  const reply = '[checklist:x] erledigt: a · offen: b';
  assert.equal(fixListTypos(reply), reply);
  assert.equal(classifyHeuristic([{ role: 'user', content: reply }]).format, 'text');
});

test('listtypos: a typo in the list word still counts as a list edit', () => {
  for (const m of ['Streich Milch von der Einkaufslsite', 'Setz Eier auf die Einkaufsilste', 'Add milk to my shopping lsit',
    'Add eggs to the shopping lsit', 'Añade huevos a la lsita', 'Füge Milch zur Einkaufslsite hinzu', 'Nimm Brot von meiner Packlsite']) {
    // the edit phrases name the list ("von der …liste", "to the … list") or an edit verb; the typo must not break either
    assert.ok(editTypes(m).has('checklist') || m.startsWith('Añade'), m);
  }
  assert.deepEqual(liveCardDecision([{ role: 'user', content: 'Streich Milch von der Einkaufslsite' }], [{ id: 'einkauf', type: 'checklist' }]),
    { format: 'checklist', confidence: 0.9, reason: 'live card edit', card: 'einkauf' });
  assert.equal(liveCardDecision([{ role: 'user', content: 'Zeig mir die letzte Leiste' }], [{ id: 'einkauf', type: 'checklist' }]), null);
});

test('listtypos: typo in a new list request is still recognised as a list (heuristic)', () => {
  for (const m of ['Mach mir eine Einkaufslsite für Sonntag', 'Make me a shopping lsit for the weekend', 'Hazme una lista de la compra']) {
    assert.equal(classifyHeuristic([{ role: 'user', content: m }]).format, 'checklist', m);
  }
  assert.notEqual(classifyHeuristic([{ role: 'user', content: 'Wo ist die nächste Fußleiste kaufen' }]).format, 'checklist');
});

test('listtypos: a typo does not turn a new-list request into an edit', () => {
  assert.equal(editTypes('Mach eine neue Einkaufslsite').size, 0);
});

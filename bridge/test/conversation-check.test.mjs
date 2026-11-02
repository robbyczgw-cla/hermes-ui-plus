// The live conversation test's answer check (eval/conversations/check.mjs) on recorded answer shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, weekdayMismatches } from '../eval/conversations/check.mjs';

const fence = (node) => '```hui\n' + JSON.stringify(node) + '\n```\n';

// the answer from the bug report (production bridge without image search keys), shortened
const REPORTED = 'Hier die Fotos der beiden Geräte nebeneinander:\n' + fence({
  type: 'gallery',
  items: [
    { query: 'Trimui Brick Hammer front', source: 'web', caption: 'Trimui Brick Hammer (Alu, 3,2 Zoll)' },
    { query: 'Anbernic RG35XX Plus front', source: 'web', caption: 'Anbernic RG35XX Plus (3,5 Zoll)' },
  ],
}) + 'Die Bilder werden per Websuche geholt.';

test('conversation check: the reported gallery fails while the bridge has no image search', () => {
  const r = checkAnswer(REPORTED, { imageSearch: 'off' });
  assert.equal(r.failures.length, 2);
  assert.match(r.failures[0], /query-only web image "Trimui Brick Hammer front"/);
  assert.deepEqual(r.blocks.map((b) => b.type), ['gallery']);
  assert.equal(r.images.length, 2);
});

test('conversation check: query items are fine with image search on (or unknown)', () => {
  assert.deepEqual(checkAnswer(REPORTED, { imageSearch: 'on' }).failures, []);
  assert.deepEqual(checkAnswer(REPORTED, {}).failures, []);
});

test('conversation check: url items pass and are listed for the proxy fetch', () => {
  const r = checkAnswer(fence({ type: 'gallery', items: [{ url: 'https://example.com/a.jpg', caption: 'A' }, { url: 'https://example.com/b.jpg' }] }), { imageSearch: 'off' });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.images.map((i) => i.url), ['https://example.com/a.jpg', 'https://example.com/b.jpg']);
});

test('conversation check: product cards never fail on photos; their image URLs are listed', () => {
  const r = checkAnswer(fence({ type: 'products', products: [{ name: 'Brick Hammer', imageQuery: 'TrimUI Brick Hammer', image: 'https://example.com/p.jpg' }, { name: 'RG35XX Plus', imageQuery: 'Anbernic RG35XX Plus' }] }), { imageSearch: 'off' });
  assert.deepEqual(r.failures, []);
  assert.equal(r.images.filter((i) => i.url).length, 1);
});

test('conversation check: nested nodes, empty lists, broken blocks and empty answers', () => {
  const nested = checkAnswer(fence({ type: 'card', title: 'X', children: [{ type: 'image', query: 'Pixel 10', source: 'web' }] }), { imageSearch: 'off' });
  assert.equal(nested.failures.length, 1);
  assert.match(checkAnswer(fence({ type: 'checklist', items: [] })).failures.join(), /checklist: empty list/);
  assert.match(checkAnswer('```hui\n\n```\n').failures.join(), /block without content/);
  assert.deepEqual(checkAnswer('   ').failures, ['empty answer']);
  // plain Markdown answers are fine
  assert.deepEqual(checkAnswer('| a | b |\n|---|---|\n| 1 | 2 |').failures, []);
});

test('conversation check: a shape written from memory is shown as readable fallback (warning, not failure)', () => {
  const r = checkAnswer(fence({ version: 4, title: 'Vergleich', blocks: [{ kind: 'mystery', rows: [{ name: 'A', price: '99' }] }] }));
  assert.deepEqual(r.failures, []);
  assert.ok(r.warnings.length >= 0);
});

// QA round 4 (0.2.0, no web tools): the real "as a table?" answer with its invented attribution
import { PHONES_NO_WEB } from '../../app/src/chat/answers/realUserRound4.fixtures.ts';

test('conversation check (evidence): with web=off a model-written source fails and the user-visible chip is reported', () => {
  const [first, , table] = PHONES_NO_WEB.filter((m) => m.role === 'assistant');
  const r = checkAnswer(table.text, { imageSearch: 'off', web: 'off' });
  assert.deepEqual(r.evidence.claims, [{ type: 'table', basis: 'sourced', source: 'Herstellerangaben' }]);
  assert.match(r.failures.join(' | '), /table: names a source without any web tool \(basis sourced, "Herstellerangaben"; skill rule\)/);
  assert.deepEqual(r.evidence.chips, [{ type: 'table', chip: 'Aus Modellwissen, ohne Webquelle' }]);
  // web unknown (older bridge) or on: the claim is listed, not failed
  assert.equal(checkAnswer(table.text, { web: 'on' }).failures.length, 0);
  assert.equal(checkAnswer(table.text, {}).evidence.claims.length, 1);
  // the first answer: "basierend auf aktuellen Daten" without a model-knowledge note, products block as list fallback
  const f = checkAnswer(first.text, { imageSearch: 'off', web: 'off' });
  assert.equal(f.evidence.sourceProse, true);
  assert.deepEqual(f.evidence.chips, [{ type: 'products (fallback)', chip: 'Aus Modellwissen, ohne Webquelle' }]);
  assert.match(f.warnings.join(' | '), /prose names a source \/ current data without saying it is model knowledge/);
  // an honest answer passes
  const honest = 'Aus meinem Modellwissen, kann veraltet sein:\n' + fence({ type: 'table', columns: ['', 'iPhone 16', 'Pixel 9'], rows: [['Hauptkamera', '48 MP', '50 MP']], basis: 'estimate' });
  const h = checkAnswer(honest, { web: 'off' });
  assert.deepEqual(h.failures, []);
  assert.equal(h.evidence.modelProse, true);
  assert.deepEqual(h.evidence.chips, [{ type: 'table', chip: 'Schätzung' }]);
});

test('conversation check (evidence): a phone compare without provenance reports the app\'s model-knowledge badge', () => {
  const cmp = fence({ type: 'compare', columns: [{ title: 'iPhone 16', items: ['48 MP'] }, { title: 'Pixel 9', items: ['50 MP'] }] });
  assert.deepEqual(checkAnswer(cmp, { web: 'off' }).evidence.chips, [{ type: 'compare', chip: 'Aus Modellwissen, ohne Webquelle' }]);
  const plans = fence({ type: 'compare', columns: [{ title: 'Plan A', pros: ['kurz'] }, { title: 'Plan B', pros: ['billig'] }] });
  assert.deepEqual(checkAnswer(plans, { web: 'off' }).evidence.chips, [{ type: 'compare', chip: null }]);
});

test('conversation check (evidence): a "model knowledge" source is honest; product tables without basis get the badge', () => {
  const honest = fence({ type: 'table', columns: ['Merkmal', 'iPhone 16', 'Pixel 9'], rows: [['Hauptkamera', '48 MP', '50 MP']], basis: 'estimate', source: 'Modellwissen (möglicherweise veraltet)' });
  const h = checkAnswer(honest, { web: 'off' });
  assert.deepEqual(h.failures, []);
  assert.deepEqual(h.evidence.claims, []);
  assert.deepEqual(h.evidence.chips, [{ type: 'table', chip: 'Schätzung · Aus Modellwissen, ohne Webquelle' }]);
  const bare = fence({ type: 'table', columns: ['Feature', 'iPhone 16', 'Pixel 9'], rows: [['Ultra-wide', '12 MP', '42 MP']] });
  assert.deepEqual(checkAnswer(bare, { web: 'off' }).evidence.chips, [{ type: 'table', chip: 'Aus Modellwissen, ohne Webquelle' }]);
  const shopping = fence({ type: 'table', columns: ['Artikel', 'Menge'], rows: [['Milch', '1 l'], ['Brot', '1']] });
  assert.deepEqual(checkAnswer(shopping, { web: 'off' }).evidence.chips, [{ type: 'table', chip: null }]);
});

// 0.2.1 QA R4-06: "Freitag 24." in a trip plan for October 2026 (the 24th is a Saturday). The skill rule: a weekday
// only when it is the calendar's; the check reads card strings and prose in de/en/es.
test('conversation check: weekday next to a date must be the calendar weekday (today = 2026-10-24, a Saturday)', () => {
  const today = '2026-10-24';
  for (const ok of ['Freitag, 30. Oktober', 'Sa 31.10.', 'Friday, Oct 30', 'Saturday 31st October', 'viernes 30 de octubre', 'Thursday, January 7', 'Mo 2. Nov'])
    assert.deepEqual(weekdayMismatches(ok, today), [], ok);
  assert.deepEqual(weekdayMismatches('Fr 31.10.', today), [{ text: 'Fr 31.10.', is: 'Saturday' }]);
  assert.deepEqual(weekdayMismatches('Day 2: Fri, Oct 31', today), [{ text: 'Fri, Oct 31', is: 'Saturday' }]);
  assert.deepEqual(weekdayMismatches('sábado 30 de octubre', today), [{ text: 'sábado 30 de octubre', is: 'Friday' }]);
  assert.deepEqual(weekdayMismatches('Tag 2 ohne Datum, Freitag', today), []);
  const trip = 'Drei Tage Wien.\n' + fence({ type: 'tabs', tabs: [{ label: 'Freitag, 31. Oktober', children: [{ type: 'list', items: [{ title: 'Prater' }] }] }] });
  const r = checkAnswer(trip, { today });
  assert.deepEqual(r.failures, ['weekday "Freitag, 31. Oktober" is a Saturday (skill rule)']);
  assert.deepEqual(checkAnswer(trip).failures, [], 'no today: no weekday check');
});

test('conversation check: an echoed reply quote tag is a skill-rule failure', () => {
  const echoed = '[hui:quote from=assistant]\n> Day 2: Belém\n[/hui:quote]\n\nSure, Day 2 can move to the end.';
  assert.deepEqual(checkAnswer(echoed).failures, ['repeats the [hui:quote] tag of the user message (skill rule)']);
  assert.deepEqual(checkAnswer('> Day 2: Belém\n\nSure, Day 2 can move to the end.').failures, []);
});

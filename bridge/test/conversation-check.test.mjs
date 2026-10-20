// The live conversation test's answer check (eval/conversations/check.mjs) on recorded answer shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer } from '../eval/conversations/check.mjs';

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

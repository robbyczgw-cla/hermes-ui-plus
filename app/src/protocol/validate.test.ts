/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode as n, normalizeWikiLang, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, MAX_GALLERY_ITEMS, MAX_IMAGE_QUERY_LENGTH } from './validate.ts';

test('rejects non-nodes', () => {
  assert.equal(n(null), null);
  assert.equal(n(undefined), null);
  assert.equal(n('card'), null);
  assert.equal(n([]), null);
  assert.equal(n({}), null);
  assert.equal(n({ type: 5 }), null);
});

test('unknown types pass through as-is', () => {
  const x = { type: 'hologram', foo: [1, 2], id: 'z' };
  assert.equal(n(x), x as never);
});

test('card/stack drop invalid children, keep unknown ones', () => {
  const r = n({ type: 'card', title: 'T', children: [null, 3, { type: 'text', text: 'a' }, { type: 'wat' }, {}] });
  assert.deepEqual(r, { type: 'card', title: 'T', children: [{ type: 'text', text: 'a' }, { type: 'wat' }] });
  assert.deepEqual(n({ type: 'stack', gap: 'xl', direction: 'horizontal', children: 'nope' }), {
    type: 'stack', direction: 'horizontal', children: [],
  });
});

test('deep nesting is capped', () => {
  let x: unknown = { type: 'text', text: 'leaf' };
  for (let i = 0; i < 30; i++) x = { type: 'stack', children: [x] };
  let depth = 0;
  let cur = n(x) as { children?: unknown[] } | undefined;
  while (cur && Array.isArray(cur.children) && cur.children.length) {
    depth++;
    cur = cur.children[0] as typeof cur;
  }
  assert.ok(depth <= 10, `depth ${depth}`);
});

test('table enforces <=12 columns and <=200 rows, coerces cells', () => {
  const columns = Array.from({ length: 20 }, (_, i) => `c${i}`);
  const rows = Array.from({ length: 500 }, (_, i) => columns.map((_, j) => i * 100 + j));
  const r = n({ type: 'table', columns, rows }) as { columns: string[]; rows: unknown[][] };
  assert.equal(r.columns.length, MAX_TABLE_COLUMNS);
  assert.equal(r.rows.length, MAX_TABLE_ROWS);
  assert.ok(r.rows.every((row) => row.length === MAX_TABLE_COLUMNS));
  const r2 = n({ type: 'table', columns: ['a', 'b', 'c'], rows: [[1, 'x', null], 'bad', [true, { q: 1 }, undefined]] }) as {
    rows: unknown[][];
  };
  assert.deepEqual(r2.rows, [[1, 'x', null], ['true', '{"q":1}', null]]);
});

test('chart: numeric strings -> numbers, bad points dropped, defaults', () => {
  const r = n({
    type: 'chart', kind: 'sparkle',
    series: [{ name: 'A', data: [{ x: 'a', y: '3' }, { x: 2, y: '4,5' }, { x: 'c', y: 'abc' }, [ 'd', '7' ], { y: 1 }, null] }, 'bad'],
  });
  assert.deepEqual(r, {
    type: 'chart', kind: 'bar',
    series: [{ name: 'A', data: [{ x: 'a', y: 3 }, { x: 2, y: 4.5 }, { x: 'd', y: 7 }] }],
  });
});

test('stats / list / steps / timeline / compare', () => {
  assert.deepEqual(
    n({ type: 'stats', items: [{ label: 'A', value: 5, trend: 'up' }, { label: 'B', value: 'x', trend: 'sideways' }, 7, {}] }),
    { type: 'stats', items: [{ label: 'A', value: '5', trend: 'up' }, { label: 'B', value: 'x' }] },
  );
  assert.deepEqual(n({ type: 'list', style: 'check', items: ['a', { title: 'b', trailing: 3 }, { x: 1 }] }), {
    type: 'list', style: 'check', items: [{ title: 'a' }, { title: 'b', trailing: '3' }],
  });
  assert.deepEqual(n({ type: 'steps', current: '2', items: [{ title: 'a', detail: 'd' }] }), {
    type: 'steps', current: 2, items: [{ title: 'a', detail: 'd' }],
  });
  assert.deepEqual(n({ type: 'timeline', items: [{ time: '1', title: 't' }, { time: 'x' }] }), {
    type: 'timeline', items: [{ time: '1', title: 't' }],
  });
  assert.deepEqual(n({ type: 'compare', columns: [{ title: 'A', highlight: true, items: ['x', 2, {}] }] }), {
    type: 'compare', columns: [{ title: 'A', highlight: true, items: ['x', '2'] }],
  });
  // B4: optional pros/cons ride along (backwards compatible: absent stays absent, empty dropped)
  assert.deepEqual(n({ type: 'compare', columns: [{ title: 'A', items: ['50 GB'], pros: ['5G'], cons: ['Kein Ladegerät', 3] }, { title: 'B', items: [], pros: [], cons: 'x' }] }), {
    type: 'compare', columns: [{ title: 'A', items: ['50 GB'], pros: ['5G'], cons: ['Kein Ladegerät', '3'] }, { title: 'B', items: [] }],
  });
});

test('compare: pros/cons-only columns survive untouched; wording of items/pros/cons is never reinterpreted', () => {
  const col = { title: 'OLED', items: ['Kein permanentes Einbrennen'], pros: ['Kein Flackern', 'Satte Farben'], cons: ['Teurer'] };
  assert.deepEqual(n({ type: 'compare', columns: [col, { title: 'LCD', pros: ['Günstig'] }] }), {
    type: 'compare',
    columns: [{ title: 'OLED', items: ['Kein permanentes Einbrennen'], pros: ['Kein Flackern', 'Satte Farben'], cons: ['Teurer'] }, { title: 'LCD', items: [], pros: ['Günstig'] }],
  });
});

test('callout, text, image, progress, code', () => {
  assert.deepEqual(n({ type: 'callout', tone: 'nope', text: 'hi' }), { type: 'callout', tone: 'info', text: 'hi' });
  assert.deepEqual(n({ type: 'text' }), { type: 'text', text: '' });
  assert.equal(n({ type: 'image', alt: 'x' }), null);
  assert.deepEqual(n({ type: 'image', url: 'https://x/y.png', aspect: '1.5' }), { type: 'image', url: 'https://x/y.png', aspect: 1.5 });
  assert.deepEqual(n({ type: 'progress', label: 'l', value: '40', max: 100 }), { type: 'progress', label: 'l', value: 40, max: 100 });
  assert.deepEqual(n({ type: 'code', language: 'ts', code: 'x' }), { type: 'code', language: 'ts', code: 'x' });
});

test('buttons validate actions; suggestions strings only', () => {
  const r = n({
    type: 'buttons',
    items: [
      { label: 'a', action: { type: 'send', text: 'hi' }, style: 'primary' },
      { label: 'b', action: { type: 'submit' } },
      { label: 'c', action: { type: 'open_url', url: '' } },
      { label: 'd', action: { type: 'explode' } },
      { label: 'e' },
      { label: 'f', action: { type: 'copy', text: 'x' } },
    ],
  });
  assert.deepEqual(r, {
    type: 'buttons',
    items: [
      { label: 'a', action: { type: 'send', text: 'hi' }, style: 'primary' },
      { label: 'b', action: { type: 'submit' } },
      { label: 'f', action: { type: 'copy', text: 'x' } },
    ],
  });
  assert.deepEqual(n({ type: 'suggestions', items: ['a', 1, null, {}] }), { type: 'suggestions', items: ['a', '1'] });
});

test('form: fields normalized, defaults applied', () => {
  const r = n({
    type: 'form', id: 'f',
    fields: [
      { name: 'a', label: 'A', kind: 'slider', min: '1', max: 10, default: 5 },
      { name: 'b', kind: 'weird', options: ['x', 1] },
      { label: 'no name' },
      { name: 'c', label: 'C', kind: 'toggle', default: true },
    ],
  });
  assert.deepEqual(r, {
    type: 'form', id: 'f',
    fields: [
      { name: 'a', label: 'A', kind: 'slider', min: 1, max: 10, default: 5 },
      { name: 'b', label: 'b', kind: 'text', options: ['x', '1'] },
      { name: 'c', label: 'C', kind: 'toggle', default: true },
    ],
    submit: { label: '' }, // no model label: the Form falls back to the localized default
  });
});

test('never throws on hostile input', () => {
  const cyc: Record<string, unknown> = { type: 'card' };
  cyc.children = [cyc];
  assert.doesNotThrow(() => n(cyc));
  assert.doesNotThrow(() => n({ type: 'table', columns: 5, rows: { a: 1 } }));
});

test('image: query (+lang) or url; neither → null', () => {
  assert.deepEqual(n({ type: 'image', query: '  Kolosseum \n', lang: 'DE', caption: 'Rom' }), {
    type: 'image', query: 'Kolosseum', lang: 'de', caption: 'Rom',
  });
  assert.equal(n({ type: 'image', query: '   ' }), null);
  assert.equal(n({ type: 'image', url: '' }), null);
  // hostile lang must never become part of a hostname
  assert.deepEqual(n({ type: 'image', query: 'x', lang: 'evil.com/' }), { type: 'image', query: 'x' });
  const long = n({ type: 'image', query: 'a'.repeat(500) }) as { query: string };
  assert.equal(long.query.length, MAX_IMAGE_QUERY_LENGTH);
  // url wins in the renderer, but both are kept
  assert.deepEqual(n({ type: 'image', url: 'https://x/y.jpg', query: 'Y' }), { type: 'image', url: 'https://x/y.jpg', query: 'Y' });
});

test('normalizeWikiLang', () => {
  for (const ok of ['de', 'en', 'pt', 'simple', 'zh-yue', 'bat-smg']) assert.equal(normalizeWikiLang(ok), ok);
  for (const bad of ['', 'd', 'deutsch1', 'en.wikipedia.org', 'de/', 3, null, 'a b']) assert.equal(normalizeWikiLang(bad), undefined);
});

test('gallery: items need query or url, strings → query, capped at 6', () => {
  const r = n({
    type: 'gallery', aspect: '1.5', lang: 'it',
    items: ['Kolosseum', { query: 'Trevi-Brunnen', caption: 'Abends' }, { caption: 'leer' }, null, { url: 'https://x/a.jpg' }, 5, { query: '' }],
  });
  assert.deepEqual(r, {
    type: 'gallery', aspect: 1.5, lang: 'it',
    items: [{ query: 'Kolosseum' }, { query: 'Trevi-Brunnen', caption: 'Abends' }, { url: 'https://x/a.jpg' }],
  });
  const many = n({ type: 'gallery', items: Array.from({ length: 10 }, (_, i) => ({ query: `q${i}` })) }) as { items: unknown[] };
  assert.equal(many.items.length, MAX_GALLERY_ITEMS);
  assert.deepEqual(n({ type: 'gallery' }), { type: 'gallery', items: [] });
});

test('imageQuery on list / steps / timeline / card / compare', () => {
  assert.deepEqual(n({ type: 'list', items: [{ title: 'a', imageQuery: ' Pantheon (Rom) ' }, { title: 'b', imageQuery: 7 }, { title: 'c', imageQuery: {} }] }), {
    type: 'list', items: [{ title: 'a', imageQuery: 'Pantheon (Rom)' }, { title: 'b', imageQuery: '7' }, { title: 'c' }],
  });
  assert.deepEqual(n({ type: 'steps', items: [{ title: 'a', imageQuery: 'X' }] }), { type: 'steps', items: [{ title: 'a', imageQuery: 'X' }] });
  assert.deepEqual(n({ type: 'timeline', items: [{ time: '9:00', title: 'a', imageQuery: 'Petersdom' }] }), {
    type: 'timeline', items: [{ time: '9:00', title: 'a', imageQuery: 'Petersdom' }],
  });
  assert.deepEqual(n({ type: 'card', title: 'T', imageQuery: 'Rom', children: [] }), { type: 'card', title: 'T', imageQuery: 'Rom', children: [] });
  assert.deepEqual(n({ type: 'compare', columns: [{ title: 'A', items: [], imageQuery: 'Pixel 10' }] }), {
    type: 'compare', columns: [{ title: 'A', items: [], imageQuery: 'Pixel 10' }],
  });
});

test('image/gallery: source "web" kept, other values dropped', () => {
  assert.deepEqual(n({ type: 'image', query: 'Octopath Traveler 2', source: 'web' }), { type: 'image', query: 'Octopath Traveler 2', source: 'web' });
  assert.equal((n({ type: 'image', query: 'x', source: 'evil' }) as { source?: string }).source, undefined);
  const g = n({ type: 'gallery', source: 'web', items: [{ query: 'A', source: 'web' }, { query: 'B', source: 'x' }, 'C'] }) as { source?: string; items: { source?: string }[] };
  assert.equal(g.source, 'web');
  assert.deepEqual(g.items.map((i) => i.source), ['web', undefined, undefined]);
});

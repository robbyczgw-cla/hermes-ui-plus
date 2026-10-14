/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode as n, normalizeLangCode, normalizeWeatherCondition, parseClock } from './validate.ts';
import { createStreamParser, parseMessage } from './streamParser.ts';
import { huiStreamView, guessNodeType } from './streamPlaceholder.ts';
import { HUI_NODE_TYPES, INTERACTIVE_NODE_TYPES, ROUTE_FORMATS, isKnownNodeType } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
const big = <T>(len: number, f: (i: number) => T): T[] => Array.from({ length: len }, (_, i) => f(i));
const V3 = ['translation', 'poll', 'agenda', 'weather', 'decision', 'rank', 'scale'];

test('registry: v3 types are known, routes exist, interactive set', () => {
  for (const t of V3) {
    assert.ok(isKnownNodeType(t), t);
    assert.ok((ROUTE_FORMATS as readonly string[]).includes(t), `route ${t}`);
    assert.equal(guessNodeType(t), t);
  }
  for (const t of ['poll', 'agenda', 'decision', 'rank', 'scale']) assert.ok(INTERACTIVE_NODE_TYPES.has(t as never), t);
  for (const t of ['translation', 'weather']) assert.ok(!INTERACTIVE_NODE_TYPES.has(t as never), t);
  for (const t of HUI_NODE_TYPES) for (const u of HUI_NODE_TYPES) if (t !== u) assert.ok(!u.startsWith(t), `${t} prefix of ${u}`);
  assert.equal(new Set(HUI_NODE_TYPES).size, HUI_NODE_TYPES.length);
});

test('interactive v3 nodes always get a deterministic, unique id', () => {
  for (const t of ['poll', 'agenda', 'decision', 'rank', 'scale']) {
    assert.equal((n({ type: t }, { path: 'seg-2' }) as A).id, `${t}-seg-2`);
    assert.equal((n({ type: t, id: ' x ' }) as A).id, 'x');
  }
  const card = n({ type: 'card', children: [{ type: 'poll' }, { type: 'poll' }, { type: 'poll', id: 'poll-seg-1.0' }] }, { path: 'seg-1' }) as A;
  const ids = card.children.map((c: A) => c.id);
  assert.equal(new Set(ids).size, 3);
});

// ───────────────────────── translation ─────────────────────────

test('translation: language codes sanitized, targets capped 4, romanization', () => {
  assert.equal(normalizeLangCode('DE'), 'de');
  assert.equal(normalizeLangCode('pt_br'), 'pt-BR');
  assert.equal(normalizeLangCode('zh-hant'), 'zh-Hant');
  assert.equal(normalizeLangCode('<script>'), 'und');
  assert.equal(normalizeLangCode('Deutsch'), 'und');
  assert.equal(normalizeLangCode(5), 'und');
  const t = n({
    type: 'translation',
    source: { lang: 'DE', text: 'Guten Morgen' },
    targets: [
      { lang: 'ja', text: 'おはよう', romanization: 'ohayou' },
      { lang: 'en', text: 'Good morning' },
      { lang: 'x y', text: 'weird' },
      { lang: 'es', text: '' },
      null,
      { lang: 'fr', text: 'Bonjour' },
      { lang: 'it', text: 'Buongiorno' },
      { lang: 'pt', text: 'Bom dia' },
    ],
    note: 'formell',
  }) as A;
  assert.equal(t.source.lang, 'de');
  assert.deepEqual(t.targets.map((x: A) => x.lang), ['ja', 'en', 'und', 'fr']);
  assert.equal(t.targets[0].romanization, 'ohayou');
  assert.equal(t.note, 'formell');
  assert.equal(t.id, undefined);
});

test('translation: hostile / partial input', () => {
  assert.deepEqual(n({ type: 'translation' }), { type: 'translation', source: { lang: 'und', text: '' }, targets: [] });
  assert.deepEqual((n({ type: 'translation', source: 'Hallo' }) as A).source, { lang: 'und', text: 'Hallo' });
  const t = n({ type: 'translation', source: { lang: 'de' }, targets: 'x' }) as A;
  assert.deepEqual(t.source, { lang: 'de', text: '' });
  assert.deepEqual(t.targets, []);
  const long = n({ type: 'translation', source: { lang: 'de', text: 'a'.repeat(9000) }, targets: [] }) as A;
  assert.equal(long.source.text.length, 2000);
});

// ───────────────────────── poll ─────────────────────────

test('poll: options capped 8 with fallback ids, voters unique and capped', () => {
  const p = n({
    type: 'poll', id: 'p', question: 'Essen?',
    options: [{ label: 'Pizza', emoji: '🍕' }, 'Sushi', { label: '' }, { id: 'x', label: 'Burger' }, { id: 'x', label: 'Pasta' }, ...big(10, (i) => `o${i}`)],
    multiple: true, voters: ['Anna', 'anna', ' Ben ', 7, ...big(20, (i) => `v${i}`)], allowAdd: true, anonymous: 'yes',
  }) as A;
  assert.equal(p.options.length, 8);
  assert.deepEqual(p.options.slice(0, 2), [{ id: 'o0', label: 'Pizza', emoji: '🍕' }, { id: 'o1', label: 'Sushi' }]);
  assert.equal(new Set(p.options.map((o: A) => o.id)).size, 8);
  assert.equal(p.options[2].id, 'x');
  assert.equal(p.multiple, true);
  assert.equal(p.voters.length, 12);
  assert.deepEqual(p.voters.slice(0, 3), ['Anna', 'Ben', '7']);
  assert.equal(p.allowAdd, true);
  assert.equal(p.anonymous, undefined, 'non-boolean dropped');
});

test('poll: empty / hostile', () => {
  assert.deepEqual(n({ type: 'poll' }, { path: 'a' }), { type: 'poll', id: 'poll-a', question: '', options: [] });
  const p = n({ type: 'poll', question: { x: 1 }, options: 'a', voters: 'Anna' }) as A;
  assert.equal(p.question, '');
  assert.deepEqual(p.options, []);
  assert.equal(p.voters, undefined, 'non-array voters ignored');
});

// ───────────────────────── agenda ─────────────────────────

test('agenda: times validated/normalised, sorted, end after start', () => {
  assert.equal(parseClock('9:05'), 545);
  assert.equal(parseClock('09:05:30'), 545);
  assert.equal(parseClock('24:00'), undefined);
  assert.equal(parseClock('12:60'), undefined);
  assert.equal(parseClock('2026-10-10T14:30:00+02:00'), 870);
  assert.equal(parseClock('2026-10-10'), undefined);
  assert.equal(parseClock('abc'), undefined);
  const a = n({
    type: 'agenda', id: 'plan', date: '2026-10-10T08:00', title: 'Tag',
    blocks: [
      { start: '14:00', end: '15:30', title: 'Meeting', kind: 'work', location: 'Büro' },
      { start: '9:00', end: '8:00', title: 'Fokus', kind: 'focus' },
      { start: '2026-10-10T12:00', end: '2026-10-10T13:00', title: 'Essen', kind: 'bogus' },
      { start: '25:00', end: '26:00', title: 'kaputt' },
      { start: '10:00', end: '11:00', title: '' },
      { start: '23:30', title: 'Spät' },
      { start: '23:59', title: 'Kein Platz' },
      'x',
    ],
  }) as A;
  assert.equal(a.date, '2026-10-10');
  assert.deepEqual(a.blocks.map((b: A) => [b.id, b.start, b.end, b.title, b.kind]), [
    ['b1', '09:00', '10:00', 'Fokus', 'focus'],
    ['b2', '12:00', '13:00', 'Essen', undefined],
    ['b0', '14:00', '15:30', 'Meeting', 'work'],
    ['b5', '23:30', '23:59', 'Spät', undefined],
  ]);
  assert.equal(a.blocks[2].location, 'Büro');
});

test('agenda: cap 30, invalid date dropped, editable', () => {
  const a = n({ type: 'agenda', date: '2026-02-30', editable: false, blocks: big(50, (i) => ({ start: `${String(i % 24).padStart(2, '0')}:00`, title: `b${i}` })) }) as A;
  assert.equal(a.blocks.length, 30);
  assert.equal(a.date, undefined);
  assert.equal(a.editable, false);
  assert.equal(new Set(a.blocks.map((b: A) => b.id)).size, 30);
  assert.deepEqual((n({ type: 'agenda', blocks: {} }) as A).blocks, []);
});

// ───────────────────────── weather ─────────────────────────

test('weather: condition enum with fallback cloudy', () => {
  assert.equal(normalizeWeatherCondition('Rain'), 'rain');
  assert.equal(normalizeWeatherCondition('clear_night'), 'clear-night');
  assert.equal(normalizeWeatherCondition('hail'), 'cloudy');
  assert.equal(normalizeWeatherCondition(7), 'cloudy');
});

test('weather: current/hourly/daily normalised and clamped', () => {
  const w = n({
    type: 'weather', location: 'Berlin', unit: 'c', basis: 'sourced', source: 'DWD',
    current: { temp: '18,5', condition: 'sunny', feelsLike: 999, wind: -4, humidity: 140, precip: 20 },
    hourly: [
      { time: '9:00', temp: 17, condition: 'partly', precip: 10 },
      { time: '2026-10-10T10:00', temp: 19, condition: 'ufo' },
      { time: 'soon', temp: 1 },
      { time: '11:00' },
      ...big(40, (i) => ({ time: '12:00', temp: i, condition: 'rain' })),
    ],
    daily: [
      { date: '2026-10-10', min: 15, max: 8, condition: 'rain', precip: 300 },
      { date: 'x', min: 1, max: 2 },
      { date: '2026-10-11', min: 1 },
      ...big(20, (i) => ({ date: '2026-10-12', min: 0, max: i, condition: 'snow' })),
    ],
  }) as A;
  assert.equal(w.unit, 'C');
  assert.equal(w.basis, 'sourced');
  assert.equal(w.source, 'DWD');
  assert.deepEqual(w.current, { temp: 18.5, condition: 'sunny', feelsLike: 200, wind: 0, humidity: 100, precip: 20 });
  assert.equal(w.hourly.length, 24);
  assert.deepEqual(w.hourly[0], { time: '09:00', temp: 17, condition: 'partly', precip: 10 });
  assert.deepEqual(w.hourly[1], { time: '2026-10-10T10:00', temp: 19, condition: 'cloudy' });
  assert.equal(w.daily.length, 10);
  assert.deepEqual(w.daily[0], { date: '2026-10-10', min: 8, max: 15, condition: 'rain', precip: 100 });
});

test('weather: partial / hostile', () => {
  assert.deepEqual(n({ type: 'weather' }), { type: 'weather', location: '' });
  const w = n({ type: 'weather', location: 'X', unit: 'K', current: { condition: 'rain' }, hourly: 'a', daily: [null, 5] }) as A;
  assert.equal(w.unit, undefined);
  assert.equal(w.current, undefined, 'no temp yet -> no current');
  assert.equal(w.hourly, undefined);
  assert.deepEqual(w.daily, []);
  assert.equal((n({ type: 'weather', unit: '°F' }) as A).unit, 'F');
});

// ───────────────────────── decision ─────────────────────────

test('decision: weights/scores clamped 0..10, scores keyed by id or label or position', () => {
  const d = n({
    type: 'decision', id: 'd', title: 'Wohnung',
    criteria: [{ id: 'preis', label: 'Preis', weight: 15 }, { label: 'Lage', weight: -3 }, 'Ruhe', { label: 'Größe', weight: 'x' }],
    options: [
      { label: 'A', scores: { preis: 12, Lage: 7, ruhe: 5, Größe: 'viel', ghost: 9, __proto__: 3 } },
      { label: 'B', scores: [3, -2, 'x'] },
      { label: 'C', scores: 'nope', note: 'n' },
      { label: '' },
    ],
    note: 'Hinweis',
  }) as A;
  assert.deepEqual(d.criteria.map((c: A) => [c.id, c.weight]), [['preis', 10], ['c1', 0], ['c2', 5], ['c3', 5]]);
  assert.deepEqual(d.options[0].scores, { preis: 10, c1: 7, c2: 5 });
  assert.deepEqual(d.options[1].scores, { preis: 3, c1: 0 });
  assert.deepEqual(d.options[2].scores, {});
  assert.equal(d.options.length, 3);
  assert.deepEqual(d.options.map((o: A) => o.id), ['o0', 'o1', 'o2']);
  assert.equal(d.note, 'Hinweis');
});

test('decision: caps 8 criteria / 6 options, prototype-safe ids', () => {
  const d = n({
    type: 'decision',
    criteria: [{ id: '__proto__', label: 'P' }, { id: 'constructor', label: 'C' }, ...big(12, (i) => `k${i}`)],
    options: big(10, (i) => ({ label: `o${i}`, scores: { P: 4 } })),
  }) as A;
  assert.equal(d.criteria.length, 8);
  assert.equal(d.options.length, 6);
  assert.deepEqual(d.criteria.slice(0, 2).map((c: A) => c.id), ['c0', 'c1']);
  assert.deepEqual(d.options[0].scores, { c0: 4 });
  assert.equal(Object.getPrototypeOf(d.options[0].scores), Object.prototype);
  assert.deepEqual(n({ type: 'decision' }, { path: 'z' }), { type: 'decision', id: 'decision-z', criteria: [], options: [] });
});

// ───────────────────────── rank ─────────────────────────

test('rank: items capped 10, strings or objects, fallback ids', () => {
  const r = n({
    type: 'rank', id: 'r', prompt: 'Sortiere', submitLabel: 'Fertig',
    items: ['A', { label: 'B', description: 'bb' }, { label: '' }, 3, ...big(15, (i) => `x${i}`)],
  }) as A;
  assert.equal(r.items.length, 10);
  assert.deepEqual(r.items.slice(0, 3), [{ id: 'i0', label: 'A' }, { id: 'i1', label: 'B', description: 'bb' }, { id: 'i3', label: '3' }]);
  assert.equal(new Set(r.items.map((i: A) => i.id)).size, 10);
  assert.equal(r.prompt, 'Sortiere');
  assert.deepEqual(n({ type: 'rank', items: 5 }, { path: 'q' }), { type: 'rank', id: 'rank-q', items: [] });
});

// ───────────────────────── scale ─────────────────────────

test('scale: defaults 1..5, swapped/degenerate/huge ranges, style rules', () => {
  const d = n({ type: 'scale', id: 's', question: 'Wie?' }) as A;
  assert.deepEqual([d.min, d.max, d.style, d.step], [1, 5, undefined, undefined]);
  assert.deepEqual([(n({ type: 'scale', min: 9, max: 3 }) as A).min, (n({ type: 'scale', min: 9, max: 3 }) as A).max], [3, 9]);
  assert.equal((n({ type: 'scale', min: 4, max: 4 }) as A).max, 5);
  assert.equal((n({ type: 'scale', min: 0, max: 1e12 }) as A).max, 100);
  assert.equal((n({ type: 'scale', min: 'x', max: null }) as A).max, 5);
  assert.equal((n({ type: 'scale', style: 'stars', min: 1, max: 5 }) as A).style, 'stars');
  assert.equal((n({ type: 'scale', style: 'stars', min: 0, max: 100 }) as A).style, 'slider', 'too many steps for stars');
  assert.equal((n({ type: 'scale', style: 'stars', min: 0, max: 100, step: 10 }) as A).style, 'stars');
  assert.equal((n({ type: 'scale', style: 'bogus' }) as A).style, undefined);
  assert.equal((n({ type: 'scale', step: 0 }) as A).step, undefined);
  assert.equal((n({ type: 'scale', step: 50 }) as A).step, undefined);
  assert.equal((n({ type: 'scale', step: 0.5 }) as A).step, 0.5);
});

test('scale: labels and emojis', () => {
  const s = n({ type: 'scale', labels: { min: 'schlecht', max: 'super', x: 1 }, emojis: ['😞', '', 4, ...big(20, () => '🙂')] }) as A;
  assert.deepEqual(s.labels, { min: 'schlecht', max: 'super' });
  assert.equal(s.emojis.length, 10);
  assert.equal(s.emojis[1], '4');
  assert.equal((n({ type: 'scale', labels: {} }) as A).labels, undefined);
  assert.equal((n({ type: 'scale', labels: 'x' }) as A).labels, undefined);
});

// ───────────────────────── charts ─────────────────────────

test('chart v3 kinds accepted, unknown still bar', () => {
  for (const k of ['hbar', 'stacked', 'scatter', 'radar', 'gauge', 'heatmap', 'waterfall']) assert.equal((n({ type: 'chart', kind: k, series: [] }) as A).kind, k);
  assert.equal((n({ type: 'chart', kind: 'sankey', series: [] }) as A).kind, 'bar');
});

test('chart scatter: numeric x only, label kept', () => {
  const c = n({ type: 'chart', kind: 'scatter', series: [{ name: 's', data: [{ x: 1, y: 2, label: 'A' }, { x: '3,5', y: 4 }, { x: 'abc', y: 1 }, [5, 6]] }] }) as A;
  assert.deepEqual(c.series[0].data, [{ x: 1, y: 2, label: 'A' }, { x: 3.5, y: 4 }, { x: 5, y: 6 }]);
});

test('chart radar: max, 8 axes, 12 series', () => {
  const c = n({ type: 'chart', kind: 'radar', max: 10, series: big(20, (i) => ({ name: `s${i}`, data: big(12, (j) => ({ x: `a${j}`, y: j })) })) }) as A;
  assert.equal(c.max, 10);
  assert.equal(c.series.length, 12);
  assert.equal(c.series[0].data.length, 8);
  assert.equal((n({ type: 'chart', kind: 'radar', max: -1, series: [] }) as A).max, undefined);
  assert.equal((n({ type: 'chart', kind: 'bar', max: 10, series: [] }) as A).max, undefined, 'only radar/gauge carry min/max');
});

test('chart gauge: canonical series[0].data[0].y; top-level value is moved there', () => {
  const a = n({ type: 'chart', kind: 'gauge', unit: '%', min: 0, max: 100, target: 80, series: [{ name: 'CPU', data: [{ x: 'now', y: 64 }, { x: 'b', y: 1 }] }] }) as A;
  assert.deepEqual(a.series, [{ name: 'CPU', data: [{ x: 'now', y: 64 }] }]);
  assert.deepEqual([a.min, a.max, a.target], [0, 100, 80]);
  const b = n({ type: 'chart', kind: 'gauge', value: '72,5', min: 100, max: 0 }) as A;
  assert.deepEqual(b.series, [{ name: '', data: [{ x: 'value', y: 72.5 }] }]);
  assert.deepEqual([b.min, b.max], [0, 100]);
  assert.equal(b.value, undefined);
  assert.deepEqual((n({ type: 'chart', kind: 'gauge' }) as A).series, []);
  assert.deepEqual((n({ type: 'chart', kind: 'gauge', value: 'x', series: [] }) as A).series, []);
  assert.equal((n({ type: 'chart', kind: 'gauge', series: [{ data: [{ y: 3 }] }] }) as A).series[0].data[0].y, 3);
});

test('chart heatmap: calendar (ISO date x) and matrix (x, y2)', () => {
  const cal = n({ type: 'chart', kind: 'heatmap', series: [{ name: 'Commits', data: [{ x: '2026-10-01', y: 3 }, { x: '2026-10-02', y: 0 }, { x: '2026-02-30', y: 1 }] }] }) as A;
  assert.equal(cal.series[0].data[0].x, '2026-10-01');
  assert.equal(cal.series[0].data.length, 3, 'invalid date stays as category text');
  const mat = n({ type: 'chart', kind: 'heatmap', series: [{ name: 'm', data: [{ x: 'Mo', y2: 'Früh', y: 2 }, { x: 'Di', y2: '', y: 1 }, { x: 'Mi', y2: 7, y: 1 }] }] }) as A;
  assert.deepEqual(mat.series[0].data, [{ x: 'Mo', y: 2, y2: 'Früh' }, { x: 'Di', y: 1 }, { x: 'Mi', y: 1, y2: '7' }]);
  const big1 = n({ type: 'chart', kind: 'heatmap', series: [{ name: 'x', data: big(3000, (i) => ({ x: `c${i}`, y: i })) }] }) as A;
  assert.equal(big1.series[0].data.length, 1000);
});

test('chart waterfall: total points may omit y; y2/label ignored', () => {
  const c = n({ type: 'chart', kind: 'waterfall', series: [{ name: 'GuV', data: [{ x: 'Start', y: 100, total: true }, { x: 'Kosten', y: -30 }, { x: 'Summe', total: true }, { x: 'bad' }, { x: 'x', y: 1, total: 'yes', label: 'l' }] }] }) as A;
  assert.deepEqual(c.series[0].data, [{ x: 'Start', y: 100, total: true }, { x: 'Kosten', y: -30 }, { x: 'Summe', y: 0, total: true }, { x: 'x', y: 1 }]);
  const bar = n({ type: 'chart', kind: 'bar', series: [{ name: 's', data: [{ x: 'a', y: 1, total: true, label: 'q', y2: 'z' }] }] }) as A;
  assert.deepEqual(bar.series[0].data, [{ x: 'a', y: 1 }], 'extra fields only for their kinds');
});

test('chart existing behaviour unchanged (numeric/category x, array points)', () => {
  const c = n({ type: 'chart', kind: 'line', series: [{ name: 'a', data: [{ x: 'Mo', y: 1 }, [2, 3], { x: 'q', y: 'z' }] }, 'bad'] }) as A;
  assert.deepEqual(c.series, [{ name: 'a', data: [{ x: 'Mo', y: 1 }, { x: 2, y: 3 }] }]);
});

test('stats sparkline: 2..60 finite numbers', () => {
  const s = n({ type: 'stats', items: [
    { label: 'a', value: '1', sparkline: [1, '2', 'x', null, 3] },
    { label: 'b', value: '1', sparkline: [1] },
    { label: 'c', value: '1', sparkline: 'nope' },
    { label: 'd', value: '1', sparkline: big(100, (i) => i) },
    { label: 'e', value: '1', sparkline: [Infinity, NaN, 4, 5] },
  ] }) as A;
  assert.deepEqual(s.items[0].sparkline, [1, 2, 3]);
  assert.equal(s.items[1].sparkline, undefined);
  assert.equal(s.items[2].sparkline, undefined);
  assert.equal(s.items[3].sparkline.length, 60);
  assert.deepEqual(s.items[4].sparkline, [4, 5]);
});

// ───────────────────────── streaming ─────────────────────────

function view(prefix: string, route: string | null = null) {
  const seg = createStreamParser().push('```hui\n' + prefix).find((x) => x.kind === 'hui');
  assert.ok(seg && seg.kind === 'hui');
  return huiStreamView(seg, route);
}

test('streaming: partial type string -> skeleton of the unique v3 type', () => {
  for (const t of V3) {
    for (let k = 1; k < t.length; k++) {
      const v = view(`{"type":"${t.slice(0, k)}`);
      assert.equal(v.kind, 'skeleton');
    }
  }
  assert.deepEqual(view('{"type":"transl'), { kind: 'skeleton', shape: 'translation' });
  assert.deepEqual(view('{"type":"wea'), { kind: 'skeleton', shape: 'weather' });
  assert.deepEqual(view('{"type":"dec'), { kind: 'skeleton', shape: 'decision' });
  assert.deepEqual(view('{"type":"ag'), { kind: 'skeleton', shape: 'agenda' });
  assert.deepEqual(view('{"type":"po'), { kind: 'skeleton', shape: 'poll' });
  assert.deepEqual(view('{"type":"ra'), { kind: 'skeleton', shape: 'rank' });
  assert.deepEqual(view('{"type":"sca'), { kind: 'skeleton', shape: 'scale' });
  assert.deepEqual(view('', 'weather'), { kind: 'skeleton', shape: 'weather' });
});

test('streaming: open last item is hidden, closed items stay', () => {
  const items = (v: ReturnType<typeof view>, key: string) => {
    assert.equal(v.kind, 'node');
    return (v.kind === 'node' ? (v.node as A)[key] : []) as A[];
  };
  assert.equal(items(view('{"type":"poll","id":"p","question":"Q","options":[{"label":"A"},{"label":"B"},{"label":"Cc'), 'options').length, 2);
  assert.equal(items(view('{"type":"agenda","id":"a","blocks":[{"start":"09:00","end":"10:00","title":"X"},{"start":"11:00","end":"1'), 'blocks').length, 1);
  assert.equal(items(view('{"type":"weather","location":"B","hourly":[{"time":"09:00","temp":1,"condition":"rain"},{"time":"10:00","te'), 'hourly').length, 1);
  assert.equal(items(view('{"type":"weather","location":"B","daily":[{"date":"2026-10-10","min":1,"max":4,"condition":"rain"},{"date":"2026-10-11","min":1'), 'daily').length, 1);
  assert.equal(items(view('{"type":"decision","id":"d","criteria":[{"label":"P","weight":3},{"label":"L","wei'), 'criteria').length, 1);
  assert.equal(items(view('{"type":"rank","id":"r","items":[{"label":"A"},{"label":"B"},{"label":"C'), 'items').length, 2);
  assert.equal(items(view('{"type":"translation","source":{"lang":"de","text":"Hi"},"targets":[{"lang":"en","text":"Hello"},{"lang":"fr","text":"Bonj'), 'targets').length, 1);
  // scores of an option stay hidden until the option closes
  const d = view('{"type":"decision","id":"d","criteria":[{"label":"P","weight":3}],"options":[{"label":"A","scores":{"P":8}},{"label":"B","scores":{"P":');
  assert.deepEqual(items(d, 'options').map((o: A) => o.label), ['A']);
  // chart: open point dropped
  const g = view('{"type":"chart","kind":"scatter","series":[{"name":"s","data":[{"x":1,"y":2},{"x":3');
  assert.equal(g.kind === 'node' && (g.node as A).series[0].data.length, 1);
});

test('streaming: scale / translation partial scalars are fine', () => {
  const v = view('{"type":"scale","id":"s","question":"Wie zufri');
  assert.equal(v.kind, 'node');
  assert.equal(v.kind === 'node' && (v.node as A).question, 'Wie zufri');
});

test('full messages round-trip through parseMessage for every v3 node', () => {
  const nodes = [
    { type: 'translation', source: { lang: 'de', text: 'Hallo' }, targets: [{ lang: 'en', text: 'Hello' }] },
    { type: 'poll', id: 'p', question: 'Q', options: ['a', 'b'] },
    { type: 'agenda', id: 'a', blocks: [{ start: '09:00', end: '10:00', title: 'X' }] },
    { type: 'weather', location: 'B', current: { temp: 3, condition: 'rain' } },
    { type: 'decision', id: 'd', criteria: ['a', 'b'], options: [{ label: 'x', scores: { a: 1 } }, { label: 'y', scores: { b: 2 } }] },
    { type: 'rank', id: 'r', items: ['a', 'b'] },
    { type: 'scale', id: 's', question: 'Q' },
  ];
  const segs = parseMessage(nodes.map((x) => '```hui\n' + JSON.stringify(x) + '\n```\n').join('\n'));
  const hui = segs.filter((s) => s.kind === 'hui');
  assert.equal(hui.length, nodes.length);
  hui.forEach((s, i) => {
    assert.ok(s.kind === 'hui' && s.complete && s.node, String(i));
    assert.equal((s as A).node.type, nodes[i].type);
  });
});

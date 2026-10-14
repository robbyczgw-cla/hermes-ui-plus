/// <reference types="node" />
/**
 * Streaming-stage harness: every real example answer of hermes-skill/examples/*.md is fed through
 * createStreamParser in chunks of N chars (N = 1, 3, 7, 16, 61), like a token stream. At EVERY
 * intermediate state each started ```hui block must be either a renderable node or an explicit
 * skeleton marker (protocol huiStreamView) – never null / nothing. Additionally:
 *  - "```hui\n" alone → skeleton shaped like the router hint of the example
 *  - a partial `type` string → skeleton shaped like the (unique) type it will become
 *  - once a node is shown, it never falls back to a skeleton and never changes its type
 *  - plain data items (checklist items, options, questions, ingredients, markers …) only appear
 *    COMPLETE: equal to the item at the same position of the final node (no half-filled rows)
 *  - the end result equals parseMessage(full text)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createStreamParser, parseMessage } from './streamParser.ts';
import { guessNodeType, huiStreamView, skeletonShapeForRoute } from './streamPlaceholder.ts';
import { PARTIAL_MARK, parsePartialJson, prunePartialItems } from './partialJson.ts';
import { HUI_NODE_TYPES, type Segment } from './types.ts';

type Example = { file: string; route: string | undefined; answers: string[] };

const dir = new URL('../../../hermes-skill/examples/', import.meta.url);
const examples: Example[] = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((file) => {
    const md = readFileSync(new URL(file, dir), 'utf8');
    const hint = /UI-ROUTER-HINT:\s*format=(\w+)(?:\s+component=(\w+))?/.exec(md);
    const route = hint ? skeletonShapeForRoute(hint[1], hint[2]) : undefined;
    const answers = [...md.matchAll(/````markdown\n([\s\S]*?)\n````/g)].map((m) => m[1] + '\n');
    return { file, route, answers };
  });

// node types no example answer uses (yet) – same realistic one-line JSON style
const block = (o: unknown) => '```hui\n' + JSON.stringify(o) + '\n```\n';
examples.push({
  file: '(synthetic) remaining node types',
  route: undefined,
  answers: [
    'Hier ein Bild:\n\n' + block({ type: 'image', query: 'Kolosseum Rom', caption: 'Das Kolosseum', aspect: 1.5 }) + '\nUnd mehr:\n\n' +
      block({ type: 'gallery', items: [{ query: 'Trevi-Brunnen' }, 'Pantheon Rom', { query: 'Spanische Treppe', caption: 'Treppe' }] }),
    block({ type: 'accordion', open: 0, items: [{ title: 'Was ist drin?', children: [{ type: 'text', text: 'Viel.' }, { type: 'callout', tone: 'warning', title: 'Achtung', text: 'Heiß.' }] }, { title: 'Wie lange?', children: [{ type: 'progress', label: 'Fortschritt', value: 3, max: 5 }] }] }) +
      block({ type: 'card', title: 'Code', children: [{ type: 'code', language: 'ts', code: 'const a = 1;\nconsole.log(a);' }, { type: 'list', style: 'check', items: ['eins', { title: 'zwei', subtitle: 'sub' }] }] }) +
      block({ type: 'stack', direction: 'horizontal', children: [{ type: 'buttons', items: [{ label: 'Öffnen', action: { type: 'open_url', url: 'https://example.org' } }] }, { type: 'suggestions', items: ['Mehr', 'Weniger'] }] }),
  ],
});

// v3 nodes (docs/SPEC-modules-v3.md) + chart kinds, realistic one-line JSON
examples.push({
  file: '(synthetic) v3 nodes',
  route: undefined,
  answers: [
    block({ type: 'translation', source: { lang: 'de', text: 'Wo ist der Bahnhof?' }, targets: [{ lang: 'ja', text: '駅はどこですか？', romanization: 'Eki wa doko desu ka?' }, { lang: 'en', text: 'Where is the station?' }], note: 'höflich' }) +
      block({ type: 'poll', id: 'p1', question: 'Was essen wir?', options: [{ label: 'Pizza', emoji: '🍕' }, { label: 'Sushi' }, 'Burger'], multiple: false, voters: ['Anna', 'Ben'] }) +
      block({ type: 'rank', id: 'r1', prompt: 'Sortiere nach Lust', items: [{ label: 'Rom', description: 'Kultur' }, { label: 'Lissabon' }, 'Wien'] }),
    block({ type: 'agenda', id: 'a1', date: '2026-10-10', title: 'Samstag', blocks: [{ start: '09:00', end: '10:30', title: 'Fokus', kind: 'focus' }, { start: '12:00', end: '13:00', title: 'Essen', kind: 'meal', location: 'Café' }, { start: '15:00', end: '16:00', title: 'Lauf', kind: 'sport' }] }) +
      block({ type: 'weather', location: 'Berlin', unit: 'C', basis: 'sourced', source: 'DWD', current: { temp: 14, condition: 'partly', feelsLike: 12, wind: 18, humidity: 70, precip: 20 }, hourly: [{ time: '09:00', temp: 12, condition: 'cloudy' }, { time: '10:00', temp: 13, condition: 'rain', precip: 60 }], daily: [{ date: '2026-10-10', min: 8, max: 15, condition: 'rain', precip: 60 }, { date: '2026-10-11', min: 7, max: 13, condition: 'sunny' }] }),
    block({ type: 'decision', id: 'd1', title: 'Wohnung', criteria: [{ id: 'preis', label: 'Preis', weight: 8 }, { id: 'lage', label: 'Lage', weight: 6 }], options: [{ label: 'A', scores: { preis: 6, lage: 9 }, note: 'zentral' }, { label: 'B', scores: { Preis: 9, Lage: 5 } }], note: 'Schätzung' }) +
      block({ type: 'scale', id: 's1', question: 'Wie zufrieden bist du?', min: 1, max: 5, style: 'stars', labels: { min: 'gar nicht', max: 'sehr' } }),
    block({ type: 'stats', basis: 'illustrative', items: [{ label: 'Umsatz', value: '12 k', delta: '+4 %', trend: 'up', sparkline: [1, 3, 2, 5, 4, 6] }, { label: 'Nutzer', value: '300', sparkline: [4, 4, 5] }] }) +
      block({ type: 'chart', kind: 'gauge', title: 'Auslastung', unit: '%', min: 0, max: 100, target: 80, series: [{ name: 'CPU', data: [{ x: 'jetzt', y: 64 }] }] }) +
      block({ type: 'chart', kind: 'scatter', series: [{ name: 'Punkte', data: [{ x: 1, y: 2, label: 'A' }, { x: 2.5, y: 4 }, { x: 4, y: 3, label: 'C' }] }] }) +
      block({ type: 'chart', kind: 'radar', max: 10, series: [{ name: 'A', data: [{ x: 'Preis', y: 7 }, { x: 'Lage', y: 9 }, { x: 'Größe', y: 5 }] }, { name: 'B', data: [{ x: 'Preis', y: 4 }, { x: 'Lage', y: 6 }, { x: 'Größe', y: 8 }] }] }) +
      block({ type: 'chart', kind: 'heatmap', series: [{ name: 'Aktivität', data: [{ x: '2026-10-01', y: 3 }, { x: '2026-10-02', y: 0 }, { x: '2026-10-03', y: 5 }] }] }) +
      block({ type: 'chart', kind: 'heatmap', series: [{ name: 'Matrix', data: [{ x: 'Mo', y2: 'Früh', y: 2 }, { x: 'Di', y2: 'Früh', y: 4 }, { x: 'Mo', y2: 'Spät', y: 1 }] }] }) +
      block({ type: 'chart', kind: 'waterfall', series: [{ name: 'GuV', data: [{ x: 'Start', y: 100, total: true }, { x: 'Kosten', y: -30 }, { x: 'Plus', y: 15 }, { x: 'Ende', y: 85, total: true }] }] }) +
      block({ type: 'chart', kind: 'hbar', series: [{ name: 'Rang', data: [{ x: 'A', y: 5 }, { x: 'B', y: 3 }] }] }) +
      block({ type: 'chart', kind: 'stacked', series: [{ name: 'a', data: [{ x: 'Q1', y: 1 }, { x: 'Q2', y: 2 }] }, { name: 'b', data: [{ x: 'Q1', y: 3 }, { x: 'Q2', y: 1 }] }] }),
  ],
});

// v4 nodes (docs/SPEC-modules-v4.md), realistic one-line JSON
examples.push({
  file: '(synthetic) v4 nodes',
  route: undefined,
  answers: [
    block({ type: 'summary', text: 'Kurz: Option B ist die beste Wahl.', points: ['günstiger', 'leiser'], verdict: 'Nimm B.' }) +
      block({ type: 'places', id: 'pl1', title: 'Pizza in Wien', layout: 'carousel', basis: 'sourced', source: 'Google Maps', places: [{ name: 'Pizzeria Mari', category: 'Pizza', lat: 48.2, lng: 16.37, rating: 4.6, reviews: 312, price: '€€', openNow: true, hoursToday: '11:00–23:00', phone: '+43 1 234567', website: 'https://example.org/mari', imageQuery: 'Pizzeria Mari Wien', distance: '350 m', tags: ['Holzofen', 'Terrasse'] }, { name: 'Da Toni', rating: 4.2, price: '€' }] }) +
      block({ type: 'products', id: 'pr1', title: 'Kopfhörer', compare: true, products: [{ name: 'Sony WH-1000XM6', brand: 'Sony', price: 249, currency: 'EUR', rating: 4.7, reviews: 900, badge: 'Bester Preis', specs: [{ label: 'Akku', value: '30 h' }, { label: 'Gewicht', value: '250 g' }], pros: ['ANC'], cons: ['Preis'], offers: [{ merchant: 'Shop A', price: 249, url: 'https://shop.example.com/a' }] }, { name: 'Bose QC', price: 299 }] }),
    block({ type: 'timer', id: 't2', label: 'Küche', seconds: 0, mode: 'countdown', until: '2026-12-31T23:59:00', timers: [{ label: 'Nudeln', seconds: 600 }, { label: 'Sauce', seconds: 300 }] }) +
      block({ type: 'guide', id: 'g1', title: 'Rührei', intro: 'In 5 Minuten.', stuckLabel: 'Ich hänge fest', steps: [{ title: 'Eier', body: 'Zwei **Eier** verquirlen.', tip: 'Frisch', imageQuery: 'Eier' }, { title: 'Pfanne', body: 'Butter schmelzen.', seconds: 60, warning: 'Heiß' }] }) +
      block({ type: 'workout', id: 'w1', title: 'Ganzkörper', kind: 'strength', warmup: '5 min locker', exercises: [{ name: 'Kniebeuge', sets: 3, reps: 10, weight: '60 kg', restSeconds: 90 }, { name: 'Plank', sets: 2, seconds: 45, reps: '8-12' }], cooldown: 'Dehnen' }),
    block({ type: 'studyplan', id: 'sp1', title: 'Spanisch A1', goal: 'Urlaub', weeks: [{ label: 'Woche 1', days: [{ label: 'Mo', tasks: [{ text: 'Vokabeln', minutes: 20, kind: 'learn' }, { text: 'Hören', kind: 'practice' }] }, { label: 'Di', tasks: [{ text: 'Wiederholen', kind: 'review' }] }] }, { label: 'Woche 2', days: [{ label: 'Mo', tasks: [{ text: 'Test', kind: 'test' }] }] }] }) +
      block({ type: 'vocab', id: 'v1', title: 'Basics', from: 'es', to: 'de', mode: 'cards', items: [{ term: 'casa', translation: 'Haus', example: 'Mi casa es tu casa.' }, { term: 'perro', translation: 'Hund', note: 'm.' }] }) +
      block({ type: 'mindmap', id: 'm1', title: 'Photosynthese', root: { label: 'Photosynthese', children: [{ label: 'Licht', note: 'Energie', children: [{ label: 'Chlorophyll' }] }, { label: 'CO2' }, { label: 'Wasser' }] } }),
  ],
});

const CHUNKS = [1, 3, 7, 16, 61];

type Hui = Extract<Segment, { kind: 'hui' }>;
const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isLeaf = (o: Record<string, unknown>) => !('type' in o) && !('children' in o) && !('data' in o);

/**
 * Every plain-object array element of the streamed (normalized) node `cur` must deep-equal the element
 * at the same path of the final node `fin` – unless the model wrote that element as a plain STRING
 * (`raw` = final raw JSON at the same path): string items may grow letter by letter.
 */
function assertItemsComplete(cur: unknown, fin: unknown, raw: unknown, path: string, where: string): void {
  if (Array.isArray(cur)) {
    assert.ok(Array.isArray(fin), `${where}: ${path} is no array in the final node`);
    const r = Array.isArray(raw) ? raw : [];
    cur.forEach((el, i) => {
      if (isRec(el) && isLeaf(el)) {
        if (typeof r[i] !== 'string') assert.deepEqual(el, (fin as unknown[])[i], `${where}: half-filled item at ${path}[${i}]`);
      } else assertItemsComplete(el, (fin as unknown[])[i], r[i], `${path}[${i}]`, where);
    });
    return;
  }
  if (isRec(cur) && isRec(fin)) {
    const r = isRec(raw) ? raw : {};
    for (const [k, v] of Object.entries(cur)) if (typeof v === 'object' && v !== null && k in fin) assertItemsComplete(v, fin[k], r[k], `${path}.${k}`, where);
  }
}

function runStream(text: string, n: number, route: string | undefined, label: string): { segs: Segment[]; viewsSeen: number } {
  const finals = parseMessage(text);
  const p = createStreamParser();
  let viewsSeen = 0;
  // per segment key: the type once a node was shown
  const shown = new Map<string, string>();
  for (let i = 0; i < text.length; i += n) {
    const segs = p.push(text.slice(i, i + n));
    const at = `${label} @${Math.min(i + n, text.length)}/${text.length} (chunk ${n})`;
    for (const seg of segs) {
      if (seg.kind !== 'hui') continue;
      const v = huiStreamView(seg as Hui, route);
      viewsSeen++;
      // a started block always shows something: node or explicit skeleton (error only when complete)
      if (!seg.complete) assert.ok(v.kind === 'node' || v.kind === 'skeleton', `${at}: streaming block renders nothing (${v.kind})`);
      if (v.kind === 'skeleton') {
        assert.ok(typeof v.shape === 'string' && v.shape.length > 0, `${at}: skeleton without shape`);
        assert.ok(!shown.has(seg.key), `${at}: node fell back to a skeleton`);
      }
      if (v.kind === 'node') {
        const type = String((v.node as { type: unknown }).type);
        const prev = shown.get(seg.key);
        if (prev !== undefined) assert.equal(type, prev, `${at}: node type changed while streaming`);
        shown.set(seg.key, type);
        const fin = finals.find((f) => f.key === seg.key);
        if (fin && fin.kind === 'hui' && fin.node && !seg.complete) {
          let finRaw: unknown;
          try {
            finRaw = JSON.parse(fin.raw);
          } catch {
            finRaw = undefined;
          }
          assertItemsComplete(v.node, fin.node, finRaw, type, at);
        }
      }
    }
  }
  const segs = p.end();
  assert.deepEqual(segs, finals, `${label} (chunk ${n}): end result differs from parseMessage`);
  return { segs, viewsSeen };
}

for (const ex of examples) {
  test(`stream stages: ${ex.file}`, () => {
    assert.ok(ex.answers.length > 0, 'example without ````markdown answer');
    ex.answers.forEach((answer, ai) => {
      for (const n of CHUNKS) runStream(answer, n, ex.route, `${ex.file}#${ai + 1}`);
    });
  });
}

test('stream stages cover every node type (v1 + v2 + v3 + v4) and chart kind', () => {
  const types = new Set<string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isRec(x)) {
      if (typeof x.type === 'string') types.add(x.type);
      Object.values(x).forEach(walk);
    }
  };
  for (const ex of examples) for (const a of ex.answers) for (const s of parseMessage(a)) if (s.kind === 'hui') walk(s.node);
  for (const t of HUI_NODE_TYPES) assert.ok(types.has(t), `no example streams a "${t}" node`);
  const kinds = new Set<string>();
  const walkKinds = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walkKinds);
    else if (isRec(x)) {
      if (x.type === 'chart' && typeof x.kind === 'string') kinds.add(x.kind);
      Object.values(x).forEach(walkKinds);
    }
  };
  for (const ex of examples) for (const a of ex.answers) for (const s of parseMessage(a)) if (s.kind === 'hui') walkKinds(s.node);
  for (const k of ['hbar', 'stacked', 'scatter', 'radar', 'gauge', 'heatmap', 'waterfall']) assert.ok(kinds.has(k), `no example streams a "${k}" chart`);
});

// ───────────── the four stages of the reported bug (shopping list) ─────────────

const ROUTE = 'checklist';
function huiAfter(prefix: string): Hui {
  const p = createStreamParser();
  const segs = p.push(prefix);
  const h = segs.find((s): s is Hui => s.kind === 'hui');
  assert.ok(h, `no hui segment for ${JSON.stringify(prefix)}`);
  return h;
}

test('stage (a): only "```hui\\n" → skeleton shaped like the router hint (generic without hint)', () => {
  const seg = huiAfter('Hier die Liste:\n\n```hui\n');
  assert.equal(seg.node, null);
  assert.deepEqual(huiStreamView(seg, ROUTE), { kind: 'skeleton', shape: 'checklist' });
  assert.deepEqual(huiStreamView(seg, null), { kind: 'skeleton', shape: 'generic' });
  assert.deepEqual(huiStreamView(seg, 'text'), { kind: 'skeleton', shape: 'generic' });
  assert.deepEqual(huiStreamView(huiAfter('```hui\n{'), ROUTE), { kind: 'skeleton', shape: 'checklist' });
  assert.deepEqual(huiStreamView(huiAfter('```hui\n{"type":"'), ROUTE), { kind: 'skeleton', shape: 'checklist' });
});

test('stage (a2): partial type string → skeleton of the type it becomes, even without router hint', () => {
  assert.deepEqual(huiStreamView(huiAfter('```hui\n{"type":"chec'), null), { kind: 'skeleton', shape: 'checklist' });
  assert.deepEqual(huiStreamView(huiAfter('```hui\n{"type":"fla'), null), { kind: 'skeleton', shape: 'flashcards' });
  // ambiguous prefix → router hint, else generic
  assert.deepEqual(huiStreamView(huiAfter('```hui\n{"type":"t'), 'timer'), { kind: 'skeleton', shape: 'timer' });
  assert.deepEqual(huiStreamView(huiAfter('```hui\n{"type":"c'), null), { kind: 'skeleton', shape: 'generic' });
});

test('stage (b): {"type":"checklist","id":"x","title":"Einka → checklist node with partial title, no items yet', () => {
  const v = huiStreamView(huiAfter('```hui\n{"type":"checklist","id":"x","title":"Einka'), ROUTE);
  assert.equal(v.kind, 'node');
  assert.deepEqual(v.kind === 'node' && v.node, { type: 'checklist', id: 'x', title: 'Einka', items: [] });
});

test('stage (c): growing items array → only complete items, the open one is hidden', () => {
  const base = '```hui\n{"type":"checklist","id":"x","title":"Einkauf","kind":"shopping","items":[{"text":"Milch","qty":1,"unit":"l","category":"Kühlregal"},{"text":"Spaghetti","qty":500,"unit":"g","category":"Trock';
  const v = huiStreamView(huiAfter(base), ROUTE);
  assert.ok(v.kind === 'node');
  const items = (v.node as unknown as { items: { text: string; category?: string }[] }).items;
  assert.deepEqual(items.map((i) => [i.text, i.category]), [['Milch', 'Kühlregal']]);
  // the item closes → it appears in one piece
  const v2 = huiStreamView(huiAfter(base + 'enware"}'), ROUTE);
  assert.ok(v2.kind === 'node');
  const items2 = (v2.node as unknown as { items: { text: string; category?: string }[] }).items;
  assert.deepEqual(items2.map((i) => [i.text, i.category]), [['Milch', 'Kühlregal'], ['Spaghetti', 'Trockenware']]);
  // plain-string items may grow (stable id by index), they never flash with a wrong group
  const v3 = huiStreamView(huiAfter('```hui\n{"type":"checklist","items":["Milch","Eie'), ROUTE);
  assert.ok(v3.kind === 'node');
  assert.deepEqual((v3.node as unknown as { items: { text: string }[] }).items.map((i) => i.text), ['Milch', 'Eie']);
});

test('stage (d): complete block → the final node, no skeleton', () => {
  const p = createStreamParser();
  p.push('```hui\n{"type":"checklist","id":"x","items":["Milch"]}\n```\n');
  const seg = p.end().find((s): s is Hui => s.kind === 'hui')!;
  assert.equal(seg.complete, true);
  assert.equal(huiStreamView(seg, ROUTE).kind, 'node');
  const bad = parseMessage('```hui\n{}\n```');
  assert.equal(huiStreamView(bad[0] as Hui, ROUTE).kind, 'error');
  // no node type but readable content → readable fallback node (flagged), not an error line
  const odd = parseMessage('```hui\n{"foo":1}\n```')[0] as Hui;
  assert.equal(odd.fallback, true);
  assert.equal(huiStreamView(odd, ROUTE).kind, 'node');
});

test('nested nodes keep streaming progressively (card child table, tabs, chart series)', () => {
  const card = huiStreamView(huiAfter('```hui\n{"type":"card","title":"A","children":[{"type":"table","columns":["x","y"],"rows":[[1,2],[3'), null);
  assert.ok(card.kind === 'node');
  const tbl = (card.node as unknown as { children: { type: string; rows: unknown[][] }[] }).children[0];
  assert.equal(tbl.type, 'table');
  assert.equal(tbl.rows.length, 2);
  const tabs = huiStreamView(huiAfter('```hui\n{"type":"tabs","tabs":[{"label":"Eins","children":[{"type":"text","text":"Hal'), null);
  assert.ok(tabs.kind === 'node');
  assert.equal((tabs.node as unknown as { tabs: unknown[] }).tabs.length, 1);
  const chart = huiStreamView(huiAfter('```hui\n{"type":"chart","kind":"line","series":[{"name":"a","data":[{"x":"Mo","y":1},{"x":"Di","y":2},{"x":"Mi"'), null);
  assert.ok(chart.kind === 'node');
  const s0 = (chart.node as unknown as { series: { data: unknown[] }[] }).series[0];
  assert.equal(s0.data.length, 2, 'open point dropped, closed points stay');
});

test('guessNodeType / skeletonShapeForRoute', () => {
  for (const t of HUI_NODE_TYPES) assert.equal(guessNodeType(t), t, 'exact type is final');
  for (const t of HUI_NODE_TYPES) for (const u of HUI_NODE_TYPES) if (t !== u) assert.ok(!u.startsWith(t), `${t} is a prefix of ${u}`);
  assert.equal(guessNodeType('reci'), 'recipe');
  assert.equal(guessNodeType('ta'), undefined);
  assert.equal(guessNodeType(''), undefined);
  assert.equal(guessNodeType(42), undefined);
  assert.equal(skeletonShapeForRoute('choice', 'slots'), 'slots');
  assert.equal(skeletonShapeForRoute('quiz', 'flashcards'), 'flashcards');
  assert.equal(skeletonShapeForRoute('calc', 'loan'), 'calc');
  assert.equal(skeletonShapeForRoute('text'), undefined);
  assert.equal(skeletonShapeForRoute('diagram'), 'diagram');
});

test('parsePartialJson markOpen + prunePartialItems', () => {
  assert.deepEqual(parsePartialJson('{"a":[{"b":1},{"c":2', { markOpen: true }), { a: [{ b: 1 }, { c: 2, [PARTIAL_MARK]: true }], [PARTIAL_MARK]: true });
  assert.deepEqual(parsePartialJson('{"a":{', { markOpen: true }), { a: { [PARTIAL_MARK]: true }, [PARTIAL_MARK]: true });
  assert.deepEqual(parsePartialJson('{"a":1}', { markOpen: true }), { a: 1 }, 'complete JSON is never marked');
  assert.deepEqual(parsePartialJson('{"a":[{"b":1},{"c":2'), { a: [{ b: 1 }, { c: 2 }] }, 'default unchanged');
  assert.deepEqual(prunePartialItems(parsePartialJson('{"a":[{"b":1},{"c":2', { markOpen: true })), { a: [{ b: 1 }] });
  assert.deepEqual(prunePartialItems(parsePartialJson('[{"type":"text","text":"x', { markOpen: true })), [{ type: 'text', text: 'x' }], 'open nodes stay');
  assert.deepEqual(prunePartialItems(parsePartialJson('{"t":[{"label":"x","children":[', { markOpen: true })), { t: [{ label: 'x', children: [] }] });
  const evil = prunePartialItems(JSON.parse('{"__proto__":{"x":1},"a":1}')) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(evil), Object.prototype);
  assert.equal(evil.a, 1);
});

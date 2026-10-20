// 0.2 real-user round 2 (default bridge, claude-haiku-4-5): blocks verbatim from the saved transcripts
// (live/qaRound2.fixtures.ts) that rendered as an "unsupported" fallback, a mixed-up day or a quiz that gave its
// answer away. R2-02 `{"type":"live"}`, R2-07 graded choice, R2-08 trip / week in one agenda and tabs as
// `items`/`title`/`blocks`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMessage } from './streamParser.ts';
import type { Segment } from './types.ts';
import { hasReadableContent } from './validate.ts';
import { QA_ROUND2 } from '../live/qaRound2.fixtures.ts';

type Rec = Record<string, unknown>;
type Hui = Extract<Segment, { kind: 'hui' }>;

/** the hui nodes of the n-th assistant answer of a fixture transcript */
function nodes(chat: string, answer: number): Rec[] {
  const m = QA_ROUND2[chat].filter((x) => x.role === 'assistant')[answer];
  const segs = parseMessage(m.text).filter((s): s is Hui => s.kind === 'hui');
  for (const s of segs) {
    assert.ok(s.complete && s.node, `${chat}#${answer}: a node`);
    assert.equal(s.fallback, undefined, `${chat}#${answer}: no fallback`);
  }
  return segs.map((s) => s.node as unknown as Rec);
}
const tabs = (n: Rec) => n.tabs as { label: string; day?: number; id?: string; children: Rec[] }[];

test('R2-08 real J01: tabs written as `items` with `title` + `blocks` render as tabs, the map tab as its places', () => {
  const [n] = nodes('salzburg', 0);
  assert.equal(n.type, 'tabs');
  assert.deepEqual(tabs(n).map((t) => t.label), ['Übersicht', 'Karte', 'Samstag', 'Sonntag', 'Budget-Tipps']);
  assert.deepEqual(tabs(n)[0].children.map((c) => c.type), ['stats', 'table']);
  const map = tabs(n)[1].children[0];
  assert.equal(map.type, 'places', 'a map without coordinates lists its places');
  assert.deepEqual((map.places as Rec[]).map((p) => p.name), ['Altstadt (Zentrum)', 'Hohensalzburg', 'Salzburg Museum', 'Mönchsberg']);
  assert.equal(tabs(n)[2].children[0].type, 'agenda');
  assert.equal((tabs(n)[2].children[0].blocks as Rec[]).length, 5);
  // the rain answer: five tabs of tables, a list and two agendas
  const [rain] = nodes('salzburg', 1);
  assert.deepEqual(tabs(rain).map((t) => t.children[0].type), ['table', 'table', 'list', 'agenda', 'agenda']);
});

test('R2-08 real N02: a three-day trip in ONE agenda ("FREITAG: …", "SAMSTAG: …") becomes one agenda per day', () => {
  const [n] = nodes('trip', 0);
  assert.equal(n.type, 'tabs');
  assert.deepEqual(tabs(n).map((t) => t.label), ['Freitag', 'Samstag', 'Sonntag']);
  const fri = tabs(n)[0].children[0];
  assert.equal(fri.type, 'agenda');
  assert.deepEqual((fri.blocks as Rec[]).map((b) => `${b.start} ${b.title}`), ['14:00 Anreise & Altstadt', '18:30 Dinner im Stadtzentrum']);
  assert.deepEqual(tabs(n).map((t) => (t.children[0].blocks as Rec[]).length), [2, 4, 4]);
});

test('R2-08 real J06: Mon/Wed/Fri as three identical 09:00 blocks are three days, not three overlapping blocks', () => {
  const [agenda, timeline] = nodes('workout', 2);
  assert.equal(agenda.type, 'tabs');
  assert.deepEqual(tabs(agenda).map((t) => [t.label, t.day]), [['', 1], ['', 2], ['', 3]]);
  assert.equal(timeline.type, 'timeline');
});

test('R2-08: a normal day stays one agenda (unsorted times, one day name, no repeats)', () => {
  const one = parseMessage('```hui\n{"type":"agenda","id":"a","blocks":[{"start":"14:00","end":"15:00","title":"Samstag: Museum"},{"start":"09:00","end":"10:00","title":"Frühstück"},{"start":"12:00","end":"13:00","title":"Mittag"}]}\n```').find((s): s is Hui => s.kind === 'hui')!;
  assert.equal((one.node as unknown as Rec).type, 'agenda');
  assert.equal(((one.node as unknown as Rec).blocks as Rec[]).length, 3);
});

test('R2-02 real N02: `{"type":"live","id":…,"blocks":[agenda]}` is a live trip (day tabs), no "unsupported live"', () => {
  for (const i of [1, 2]) {
    const [n] = nodes('trip', i);
    assert.equal(n.type, 'tabs');
    assert.equal(n.live, true);
    assert.equal(n.id, 'salzburg_plan');
    assert.deepEqual(tabs(n).map((t) => t.label), ['Freitag', 'Samstag', 'Sonntag']);
    // every block has a stable id (live items), the same in both versions
    const ids = tabs(n).flatMap((t) => (t.children[0].blocks as Rec[]).map((b) => b.id));
    assert.ok(ids.every((x) => typeof x === 'string' && /^h/.test(String(x))), String(ids));
  }
});

test('R2-02 real N03: `{"type":"live","style":"checklist","items":[{title, subtitle}]}` is a live checklist', () => {
  const [n] = nodes('watchlist', 0);
  assert.equal(n.type, 'checklist');
  assert.equal(n.live, true);
  assert.equal(n.id, 'filmabend-watchlist');
  assert.deepEqual((n.items as Rec[]).map((i) => [i.text, i.note]), [
    ['Arrival', 'Sci-Fi Drama · 116 min'],
    ['Interstellar', 'Sci-Fi Epos · 169 min'],
    ['Die fabelhafte Welt der Amélie', 'Romantische Komödie · 122 min'],
  ]);
  const [next] = nodes('watchlist', 1);
  assert.equal((next.items as Rec[])[0].checked, true);
});

test('R2-02: other live wrappers (a wrapped node, products, several agendas) and an unreadable one', () => {
  const parse = (o: unknown) => parseMessage('```hui\n' + JSON.stringify(o) + '\n```').find((s): s is Hui => s.kind === 'hui')!;
  const wrapped = parse({ type: 'live', id: 'einkauf', card: { type: 'checklist', items: ['Milch'] } }).node as unknown as Rec;
  assert.deepEqual([wrapped.type, wrapped.live, wrapped.id], ['checklist', true, 'einkauf']);
  const watch = parse({ type: 'live', id: 'kopfhoerer', products: [{ name: 'Sony WH-1000XM5', price: 279 }] }).node as unknown as Rec;
  assert.deepEqual([watch.type, watch.live], ['products', true]);
  const days = parse({ type: 'live-card', id: 'rom', blocks: [{ type: 'agenda', title: 'Sa 14.', blocks: [{ start: '09:00', end: '10:00', title: 'Kolosseum' }] }, { type: 'agenda', title: 'So 15.', blocks: [{ start: '10:00', end: '11:00', title: 'Vatikan' }] }] }).node as unknown as Rec;
  assert.deepEqual([days.type, days.live, tabs(days).map((t) => t.label)], ['tabs', true, ['Sa 14.', 'So 15.']]);
  // nothing readable as a card: stays an unknown node, which the app shows as its readable content (never a gap)
  const raw = { type: 'live', id: 'x', note: 'Ich merke mir das.' };
  assert.equal((parse(raw).node as unknown as Rec).type, 'live');
  assert.equal(hasReadableContent(raw), true);
});

test('R2-07 real J05: a choice whose descriptions grade the answers is a quiz (solution only after the tap)', () => {
  const [n] = nodes('learning', 2);
  assert.equal(n.type, 'quiz');
  assert.equal(n.id, 'travel_question');
  const q = (n.questions as Rec[])[0];
  assert.equal(q.q, "Was ist der Unterschied zwischen 'departure' und 'arrival'?");
  assert.deepEqual(q.options, ['Departure = Ankunft, Arrival = Abfahrt', 'Departure = Abfahrt/Abflug, Arrival = Ankunft', 'Beide bedeuten das Gleiche']);
  assert.equal(q.answer, 1);
  assert.equal(q.explanation, 'Departure ist, wenn man losfährt, Arrival ist, wenn man ankommt.');
  assert.ok(!JSON.stringify(n).includes('falsch herum'), 'no grading text before the tap');
});

test('R2-07: an ordinary choice with descriptions stays a choice', () => {
  const parse = (o: unknown) => parseMessage('```hui\n' + JSON.stringify(o) + '\n```').find((s): s is Hui => s.kind === 'hui')!.node as unknown as Rec;
  const c = parse({ type: 'choice', id: 'zeit', question: 'Wann?', options: [{ label: 'Morgens', description: 'Abfahrt 8–10 Uhr' }, { label: 'Nachmittags', description: 'Abfahrt 14–16 Uhr' }] });
  assert.equal(c.type, 'choice');
  // "right" without a wrong one is no grading (an option can be "Right next to the station")
  const d = parse({ type: 'choice', id: 'h', options: [{ label: 'A', description: 'Right next to the station.' }, { label: 'B', description: 'Ten minutes away.' }] });
  assert.equal(d.type, 'choice');
  // English and Spanish gradings
  const e = parse({ type: 'choice', id: 'q', question: 'Capital of Spain?', options: [{ label: 'Madrid', description: 'Correct! Madrid is the capital.' }, { label: 'Barcelona', description: 'Not quite, that is Catalonia.' }] });
  assert.deepEqual([e.type, (e.questions as Rec[])[0].answer, (e.questions as Rec[])[0].explanation], ['quiz', 0, 'Madrid is the capital.']);
});

// Content the model sent that 0.2.0 silently dropped (found by replaying the recorded QA answers through the real
// components, 0.3 chat regression gate): a gallery's heading, a choice's actual question under its title, a workout's
// session note / equipment / place, the detail of label-value rows and the description in the readable fallback list,
// and the vocab header "EN → UND" when the model names only one language. Payloads verbatim from the QA runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamParser } from './streamParser.ts';
import type { Segment } from './types.ts';
import { REAL_USER_014 } from './realUser014.fixtures.ts';
import { normalizeWorkout } from '../ui/components/modules/d2/workoutModel.ts';
import { readVocab, vocabRoute } from '../ui/components/modules/d3/vocabModel.ts';

type Hui = Extract<Segment, { kind: 'hui' }>;
type Rec = Record<string, unknown>;

const node = (s: Hui) => s.node as unknown as Rec;

function block(raw: unknown): Hui {
  const p = createStreamParser();
  p.push('```hui\n' + JSON.stringify(raw) + '\n```\n');
  p.end();
  const s = p.segments().find((x): x is Hui => x.kind === 'hui');
  assert.ok(s?.node, 'a node');
  return s;
}

/** every string of a node tree, joined (what a reader can find in it) */
function texts(x: unknown, out: string[] = []): string {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) texts(y, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) texts(v, out);
  return out.join(' | ');
}

test('gallery: the heading ("Fotos") is kept', () => {
  const s = block({ type: 'gallery', items: [{ query: 'Bauernbrot', caption: 'Brot', source: 'web' }, { query: 'Tomaten', caption: 'Tomaten', source: 'web' }], title: 'Fotos' });
  assert.equal(node(s).title, 'Fotos');
  // no title: none invented
  assert.equal(node(block({ type: 'gallery', items: [{ query: 'Brot' }] })).title, undefined);
});

test('choice: a title plus the question under it ("subtitle") both reach the question line', () => {
  const s = block({ type: 'choice', id: 'wien_graz_zugzeit', title: 'Wien – Graz mit dem Zug', subtitle: 'Wann möchtest du fahren?', items: [{ label: 'Morgens', detail: 'Früher Start' }, { label: 'Nachmittags', detail: 'Entspannter Start' }] });
  assert.equal(node(s).question, 'Wien – Graz mit dem Zug\nWann möchtest du fahren?');
  // unchanged: an explicit question wins, a lone title stays the question
  assert.equal(node(block({ type: 'choice', question: 'Wann?', title: 'Zug', subtitle: 'x', options: ['a', 'b'] })).question, 'Wann?');
  assert.equal(node(block({ type: 'choice', title: 'Zug oder Auto?', options: ['Zug', 'Auto'] })).question, 'Zug oder Auto?');
});

test('workout (round 1 payload): session notes, equipment and place become the note under the title', () => {
  const n = node(block(REAL_USER_014.workout));
  assert.match(String(n.note), /^3 Durchgänge à 6 Minuten Training \+ 1 Minute Pause/);
  assert.match(String(n.note), /Keine · Zuhause$/);
  // the component's model carries it through
  assert.equal(normalizeWorkout(n).note, String(n.note).slice(0, 400));
  assert.equal(normalizeWorkout({ type: 'workout', title: 'x', exercises: [{ name: 'Plank', seconds: 30 }] }).note, undefined);
});

test('readable fallback (round-2 re-run: a calc with sections of label-value rows): row details and the description stay', () => {
  const raw = {
    type: 'calc',
    id: 'wien_graz_vergleich',
    title: 'Wien – Graz: Kosten vs. Zeit vs. Umwelt',
    description: 'Verschieb die Gewichte nach deinen Prioritäten',
    layout: 'panel',
    sections: [
      { title: 'Gewichtung', rows: [{ label: 'Kosten', value: 50, input: 'slider', min: 0, max: 100, unit: '%' }] },
      { title: 'Metriken', rows: [{ label: 'Zug – Kosten', value: '40 €', detail: '(30–50€, 2 Pers.)' }, { label: 'Auto – CO₂', value: '48 kg', detail: '(120 gCO₂/Pkm)' }] },
    ],
  };
  const s = block(raw);
  assert.ok(s.fallback, 'not a calc: shown as the readable list');
  const all = texts(s.node);
  assert.match(all, /Verschieb die Gewichte nach deinen Prioritäten/);
  assert.match(all, /Zug – Kosten: 40 € \(\(30–50€, 2 Pers\.\)\)/);
  assert.match(all, /Kosten: 50 %/);
  assert.doesNotMatch(all, /Layout|panel/, 'settings are not content');
});

test('vocab header: "EN → UND" never shows; one known language alone, both as before, none → no line', () => {
  const m = readVocab(node(block(REAL_USER_014.vocab)));
  assert.equal(m.to, 'und');
  assert.deepEqual(vocabRoute(m.from, m.to), { label: 'EN', codes: ['en'] });
  assert.deepEqual(vocabRoute('en', 'de-AT'), { label: 'EN → DE', codes: ['en', 'de-AT'] });
  assert.deepEqual(vocabRoute('und', 'und'), { label: '', codes: [] });
});

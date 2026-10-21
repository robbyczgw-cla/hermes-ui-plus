// A component object on its own line without a fence (live check 2026-10-21, direct Claude Haiku 5.5: "_suggestions"
// then the raw `{"type":"suggestions",…}` line, shown to the user as JSON text): drawn as the component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamParser, parseMessage } from './streamParser.ts';

const LIVE =
  'Hier ist deine Einkaufsliste. Du kannst die Artikel abhaken, sobald du sie im Laden hast.\n\n```hui\n{"type":"checklist","id":"einkauf","title":"Einkaufsliste","kind":"shopping","items":[{"text":"Brot","qty":1,"unit":"Stück"},{"text":"Tomaten","qty":500,"unit":"g"}]}\n```\n\nDie Mengen sind Vorschläge; sag Bescheid, wenn du mehr oder anderes brauchst.\n\n_suggestions\n{"type":"suggestions","items":["Weitere Artikel hinzufügen","Passende Zutaten für ein Gericht vorschlagen"]}';

const shape = (segs: ReturnType<typeof parseMessage>) => segs.map((s) => (s.kind === 'markdown' ? `md:${s.text.slice(-20)}` : `${s.kind}:${s.kind === 'hui' ? (s.node as { type?: string } | null)?.type : ''}`));

test('the recorded answer: the unfenced suggestions line is a suggestions block, its marker line is gone', () => {
  const segs = parseMessage(LIVE);
  assert.deepEqual(shape(segs), ['md:u sie im Laden hast.', 'hui:checklist', 'md:er anderes brauchst.', 'hui:suggestions']);
  assert.ok(!segs.some((s) => s.kind === 'markdown' && /_suggestions|"type"/.test(s.text)));
});

test('streamed in small pieces: the object never shows as text, the end equals the one-shot parse', () => {
  for (const step of [1, 3, 7, 50]) {
    const p = createStreamParser();
    for (let i = 0; i < LIVE.length; i += step) {
      const md = p.push(LIVE.slice(i, i + step)).filter((s) => s.kind === 'markdown').map((s) => (s as { text: string }).text).join('\n');
      assert.doesNotMatch(md, /\{"type"|\{"typ|\{"ty/, `step ${step} at ${i}`);
    }
    assert.deepEqual(shape(p.end()), shape(parseMessage(LIVE)));
  }
});

test('only known types on a line of their own: an inline mention, an unknown type and broken JSON stay text', () => {
  const segs = parseMessage('Ein Objekt {"type":"table"} im Satz.\n{"type":"spaceship","a":1}\n{"type":"table","rows":[\nFazit');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, 'markdown');
  // a block of its own after a blank line; directly under a paragraph line it stays that paragraph's text
  assert.deepEqual(shape(parseMessage('Fazit:\n\n{"type":"table","columns":["a"],"rows":[["1"]]}')), ['md:Fazit:', 'hui:table']);
  assert.equal(parseMessage('Fazit:\n{"type":"table","columns":["a"],"rows":[["1"]]}').length, 1);
});

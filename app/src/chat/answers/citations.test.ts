/// <reference types="node" />
// B3 Hermes citations, research collapse, UX8 translation dedupe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Segment } from '../../protocol/types';
import { parseMarkdown } from '../markdown.ts';
import { findCitationList, withCitationSources } from './citations.ts';
import { sectionPlan } from './collapse.ts';
import { dedupeTranslations, normalizeForDedupe } from './dedupe.ts';
import { footnoteTargets } from './footnotes.ts';

const md = (text: string, key = 'm0'): Segment => ({ key, kind: 'markdown', text });
const hui = (node: Record<string, unknown>, key = 'h0'): Segment => ({ key, kind: 'hui', complete: true, raw: '', node: node as never });

const ANSWER = `Wien hat rund 2 Millionen Einwohner [1]. Graz folgt mit großem Abstand [2][3], Linz [1, 3].

Quellen:
[1] https://example.com/wien — Stadt Wien: Bevölkerung
[2] https://example.org/graz – Statistik Graz
[3] Linz in Zahlen – https://example.net/linz`;

test('[n] url — title list: cut from the body, items in order, cited', () => {
  const r = findCitationList(ANSWER)!;
  assert.ok(r);
  assert.equal(r.body, 'Wien hat rund 2 Millionen Einwohner [1]. Graz folgt mit großem Abstand [2][3], Linz [1, 3].');
  assert.equal(r.cited, true);
  assert.deepEqual(r.items, [
    { title: 'Stadt Wien: Bevölkerung', url: 'https://example.com/wien' },
    { title: 'Statistik Graz', url: 'https://example.org/graz' },
    { title: 'Linz in Zahlen', url: 'https://example.net/linz' },
  ]);
});

test('[n]: url "title" and n. [Title](url) – snippet formats', () => {
  const a = findCitationList('Text [1] und [2].\n\n[1]: https://example.com/a "Titel A"\n[2]: <https://example.com/b> "Titel B"')!;
  assert.deepEqual(a.items, [
    { title: 'Titel A', url: 'https://example.com/a' },
    { title: 'Titel B', url: 'https://example.com/b' },
  ]);
  const b = findCitationList('Text [2] und [1].\n\n**Quellen**\n\n1. [Titel A](https://example.com/a) – Kurzbeschreibung\n2. [Titel B](https://example.com/b)')!;
  assert.equal(b.body, 'Text [2] und [1].');
  assert.deepEqual(b.items, [
    { title: 'Titel A', url: 'https://example.com/a', snippet: 'Kurzbeschreibung' },
    { title: 'Titel B', url: 'https://example.com/b' },
  ]);
  const c = findCitationList('Siehe [1].\n\n- [1] [Titel](https://example.com/a)')!;
  assert.deepEqual(c.items, [{ title: 'Titel', url: 'https://example.com/a' }]);
});

test('no false positives: plain [1], numbered link lists without cites, gaps, code, mid-text lists', () => {
  // plain "[1]" without a closing list
  assert.equal(findCitationList('Das Array arr[1] und Punkt [1] sind normaler Text.'), null);
  // a numbered link list without inline citations is just a list
  assert.equal(findCitationList('Gute Seiten:\n\n1. [A](https://example.com/a)\n2. [B](https://example.com/b)'), null);
  // numbering must be 1…k in order
  assert.equal(findCitationList('Text [1].\n\n[1] https://example.com/a\n[3] https://example.com/c'), null);
  assert.equal(findCitationList('Text [2].\n\n[2] https://example.com/a'), null);
  // lines without URL
  assert.equal(findCitationList('Text [1].\n\n[1] nur ein Titel'), null);
  // inside a code fence
  assert.equal(findCitationList('```\nx = a[1]\n[1] https://example.com/a'), null);
  // not at the end
  assert.equal(findCitationList('Text [1].\n\n[1] https://example.com/a\n\nUnd noch ein Absatz.'), null);
  // the whole answer is the list
  assert.equal(findCitationList('[1] https://example.com/a — A'), null);
});

test('withCitationSources: list → sources block after the text, cites = k, footnote targets 1…k', () => {
  const segs = [md(ANSWER)];
  const r = withCitationSources(segs);
  assert.equal(r.cites, 3);
  assert.equal(r.research, false);
  assert.equal(r.segments.length, 2);
  assert.equal((r.segments[0] as { text: string }).text.includes('Quellen'), false);
  const src = r.segments[1] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(src.kind, 'hui');
  assert.equal((src.node as { type: string }).type, 'sources');
  const targets = footnoteTargets(r.segments);
  assert.deepEqual(targets.map((t) => [t.n, t.url]), [
    [1, 'https://example.com/wien'],
    [2, 'https://example.org/graz'],
    [3, 'https://example.net/linz'],
  ]);
  // memoized per segments array; unchanged answers keep their array
  assert.equal(withCitationSources(segs), r);
  const plain = [md('Kein Zitat [1] hier.')];
  assert.equal(withCitationSources(plain).segments, plain);
  assert.equal(withCitationSources(plain).cites, 0);
});

test('research heuristic: > 250 words + closing list → collapse after the first section', () => {
  const long = Array.from({ length: 300 }, (_, i) => `wort${i}`).join(' ');
  const r = withCitationSources([md(`Kurzantwort [1].\n\n## Details\n\n${long}\n\n[1] https://example.com/a — A`)]);
  assert.equal(r.research, true);
  const blocks = parseMarkdown((r.segments[0] as { text: string }).text);
  const plan = sectionPlan(blocks)!;
  assert.equal(plan.visible, 1); // the intro paragraph; "## Details" and the rest fold away
  assert.ok(plan.hiddenLines > 4);
  // no heading → line based plan
  const flat = parseMarkdown(Array.from({ length: 8 }, () => long.slice(0, 400)).join('\n\n'));
  assert.ok(sectionPlan(flat));
  // short answers never collapse
  assert.equal(sectionPlan(parseMarkdown('Eins.\n\n## Zwei\n\nDrei.')), null);
});

test('UX8: a plain paragraph repeating the translation card is hidden', () => {
  const card = hui({ type: 'translation', source: { lang: 'de', text: 'Wo ist der Bahnhof?' }, targets: [{ lang: 'es', text: '¿Dónde está la estación?' }] });
  const segs = [md('Auf Spanisch:\n\n**„¿Dónde está la estación?“**'), card];
  const out = dedupeTranslations(segs);
  assert.notEqual(out, segs);
  assert.equal((out[0] as { text: string }).text, 'Auf Spanisch:');
  // different text stays; same array returned
  const keep = [md('Hier die Übersetzung mit Erklärung.'), card];
  assert.equal(dedupeTranslations(keep), keep);
  // only directly before the card
  const after = [card, md('¿Dónde está la estación?')];
  assert.equal(dedupeTranslations(after), after);
  assert.equal(normalizeForDedupe(' „Vielen Dank!“ '), 'vielen dank');
});

// ---- B3 rest: unnumbered "Quellen:" trailers (Hermes answers without `[n]`) ----

test('"Quellen:" line with markdown links, comma separated, no inline [n]', () => {
  const r = findCitationList('Python 3.14 bringt Free-Threading.\n\nQuellen: [Python.org – What’s New](https://docs.python.org/3.14/whatsnew), [PEP 779](https://peps.python.org/pep-0779/)')!;
  assert.ok(r);
  assert.equal(r.body, 'Python 3.14 bringt Free-Threading.');
  assert.equal(r.cited, false);
  assert.deepEqual(r.items, [
    { title: 'Python.org – What’s New', url: 'https://docs.python.org/3.14/whatsnew' },
    { title: 'PEP 779', url: 'https://peps.python.org/pep-0779/' },
  ]);
});

test('**Sources:** with bare URLs separated by · and a heading block with bullets of mixed styles', () => {
  const a = findCitationList('Answer text.\n\n**Sources:** https://example.com/a · https://example.org/b')!;
  assert.deepEqual(a.items.map((x) => x.url), ['https://example.com/a', 'https://example.org/b']);
  const b = findCitationList('Antwort.\n\n## Quellen\n\n- [Stadt Wien](https://example.com/wien)\n- Statistik Graz – https://example.org/graz\n- https://example.net/linz — Linz in Zahlen')!;
  assert.equal(b.body, 'Antwort.');
  assert.deepEqual(b.items, [
    { title: 'Stadt Wien', url: 'https://example.com/wien' },
    { title: 'Statistik Graz', url: 'https://example.org/graz' },
    { title: 'Linz in Zahlen', url: 'https://example.net/linz' },
  ]);
  // a single source is fine with the heading word
  const c = findCitationList('Antwort.\n\nQuelle: [Bundesamt](https://example.com/x)')!;
  assert.deepEqual(c.items, [{ title: 'Bundesamt', url: 'https://example.com/x' }]);
});

test('heading-less trailer: only a last line made of ≥ 2 links; inline [n] still map to it', () => {
  const r = findCitationList('Wien [1], Graz [2].\n\n[Wien](https://example.com/w) · [Graz](https://example.com/g)')!;
  assert.equal(r.cited, true);
  assert.equal(r.items.length, 2);
  // the cited trailer becomes a sources block with pills
  const segs = withCitationSources([md('Wien [1], Graz [2].\n\nQuellen: [Wien](https://example.com/w), [Graz](https://example.com/g)')]);
  assert.equal(segs.cites, 2);
  assert.equal((segs.segments[1] as { node: { type: string } }).node.type, 'sources');
});

test('trailer false positives stay plain text', () => {
  // one link without heading, prose with links, a link list the user asked for
  assert.equal(findCitationList('Mehr dazu auf [Python.org](https://python.org).'), null);
  assert.equal(findCitationList('Text.\n\nMehr: [A](https://a.example) und dann [B](https://b.example)'), null);
  assert.equal(findCitationList('Gute Seiten:\n\n- [A](https://example.com/a)\n- [B](https://example.com/b)'), null);
  // heading word without links / with prose
  assert.equal(findCitationList('Text https://example.com.\n\nQuellen: keine gefunden.'), null);
  // not at the end
  assert.equal(findCitationList('Text.\n\nQuellen: [A](https://example.com/a), [B](https://example.com/b)\n\nNoch ein Absatz.'), null);
  // inside a code fence
  assert.equal(findCitationList('```\nQuellen: https://example.com/a, https://example.com/b'), null);
  // the whole answer is the trailer
  assert.equal(findCitationList('Quellen: [A](https://example.com/a), [B](https://example.com/b)'), null);
});

test('duplicate URLs in a trailer are listed once', () => {
  const r = findCitationList('Text.\n\nQuellen:\n- [A](https://example.com/a)\n- [A again](https://example.com/a/)\n- [B](https://example.com/b)')!;
  assert.deepEqual(r.items.map((x) => x.title), ['A', 'B']);
});

test('B3c: a long cited answer without headings folds after its first ~12 lines, even when paragraph 1 is long', () => {
  const para = (n: number) => Array.from({ length: n }, (_, i) => `wort${i}`).join(' ');
  const text = [para(90), para(80), para(80), para(90), para(80), para(80), para(90)].join('\n\n');
  const r = withCitationSources([md(`${text}\n\nQuellen: [A](https://example.com/a), [B](https://example.com/b)`)]);
  assert.equal(r.research, true);
  const blocks = parseMarkdown((r.segments[0] as { text: string }).text);
  const plan = sectionPlan(blocks)!;
  assert.ok(plan);
  assert.equal(plan.visible, 1);
  assert.ok(plan.hiddenLines > 40);
});

// ---------------------------------------------------------------- GPT review #10–#12

test('#10 code spans are no citation evidence; a plain link list stays a list', () => {
  const t = 'Use `array[1]`.\n\n1. [Example](https://example.com/a)';
  assert.equal(findCitationList(t), null);
  // the same list with a real [1] in prose is cited
  assert.equal(findCitationList('Siehe [1].\n\n1. [Example](https://example.com/a)')?.cited, true);
  // escaped / link-label numbers do not count either
  assert.equal(findCitationList('Nicht \\[1] und [1](https://x.de/y).\n\n1. [Example](https://example.com/a)'), null);
});

test('#10 fence rules: a shorter fence inside a ```` block does not end it', () => {
  const t = 'Beispiel:\n\n````md\n```\nText [1]\n\n[1] https://example.com/a — A\n````';
  assert.equal(findCitationList(t), null);
  const tilde = 'x\n\n~~~\n```\n[1] https://example.com/a — A\n~~~\n\nText [1]\n\n[1] https://example.com/b — B';
  const f = findCitationList(tilde);
  assert.ok(f && f.cited);
  assert.deepEqual(f.items.map((i) => i.url), ['https://example.com/b']);
});

test('#11 footnote definitions inside code are ignored', () => {
  const t = 'Beispiel:\n\n```md\n[^1]: [Wrong](https://example.com/wrong)\n```\n\nEcht[^1].\n\n[^1]: [Right](https://example.com/right)';
  assert.equal(footnoteTargets([md(t)])[0]?.url, 'https://example.com/right');
});

test('#12 derived numbered list defines [n] even when an earlier sources node exists', () => {
  const earlier = hui({ type: 'sources', items: [{ title: 'Früher', url: 'https://example.com/early' }] });
  const { segments } = withCitationSources([earlier, md(ANSWER, 'm1')]);
  const targets = footnoteTargets(segments);
  assert.equal(targets[0]?.url, 'https://example.com/wien');
  assert.equal(targets.length, 3);
  // without a derived list, all sources nodes stay numbered in order (unchanged)
  assert.equal(footnoteTargets([earlier, md('Text [^1]')])[0]?.url, 'https://example.com/early');
});

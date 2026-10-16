/// <reference types="node" />
// v4 answer polish (docs/SPEC-modules-v4.md A2–A4): footnote mapping, `hui:` entity links,
// conservative entity auto-detection, summary collapse logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Segment } from '../../protocol/types';
import { parseMarkdown } from '../markdown.ts';
import { detectEntities, endsInIbanPrefix, entityCopyText, isoDate, parseHuiHref, type DetectedPart, type HuiEntity } from './entities.ts';
import { footnoteTarget, footnoteTargets } from './footnotes.ts';
import { collapsePlan, summaryBefore, COLLAPSE_LINES } from './collapse.ts';
import { expectBounded } from '../../testing/runBounded.test.ts';
import { assertLinear } from '../../testing/scaling.test.ts';

const md = (text: string, key = 'm'): Segment => ({ key, kind: 'markdown', text });
const hui = (node: unknown, key = 'h'): Segment => ({ key, kind: 'hui', complete: true, raw: '', node: node as never });

const entities = (s: string) => detectEntities(s).filter((p): p is HuiEntity => typeof p !== 'string');
const labels = (s: string) => entities(s).map((e) => `${e.kind}:${e.label}`);

// ---------------------------------------------------------------- footnotes

test('footnotes: sources node items map 1-based (nested sources too)', () => {
  const segs = [
    md('Rom ist alt[^1], Paris auch【2】.'),
    hui({ type: 'card', children: [{ type: 'sources', items: [{ title: 'Wikipedia', url: 'https://de.wikipedia.org/wiki/Rom', snippet: 'Rom ist…' }, { title: 'Bad', url: 'javascript:alert(1)' }] }] }),
  ];
  const t = footnoteTargets(segs);
  assert.equal(t.length, 2);
  assert.deepEqual(footnoteTarget(t, 1), { n: 1, title: 'Wikipedia', url: 'https://de.wikipedia.org/wiki/Rom', snippet: 'Rom ist…', siteName: undefined });
  // unsafe URL: no url, title kept → sheet shows it without "Öffnen"
  assert.equal(footnoteTarget(t, 2)?.url, undefined);
  assert.equal(footnoteTarget(t, 3), undefined);
});

test('footnotes: markdown definitions [^n]: …', () => {
  const t = footnoteTargets([
    md('Text[^2] und[^1].\n\n[^1]: [Statistik Austria](https://statistik.at/x) – Bevölkerung 2025\n[^2]: Bundesamt – https://destatis.de/y\n[^3]: Nur Text ohne Link'),
  ]);
  assert.deepEqual(
    t.map((x) => [x.n, x.title, x.url ?? null]),
    [
      [1, 'Statistik Austria', 'https://statistik.at/x'],
      [2, 'Bundesamt', 'https://destatis.de/y'],
      [3, 'Nur Text ohne Link', null],
    ],
  );
  assert.equal(t[0].snippet, 'Bevölkerung 2025');
});

test('footnotes: trailing list of links (only when the text cites, only a pure link list)', () => {
  const body = 'Fakt eins[^1], Fakt zwei[^2].\n\nQuellen:\n\n1. [Erste](https://a.example/1) – Ausschnitt\n2. [Zweite](https://b.example/2)';
  const t = footnoteTargets([md(body)]);
  assert.deepEqual(t.map((x) => [x.n, x.title, x.url]), [
    [1, 'Erste', 'https://a.example/1'],
    [2, 'Zweite', 'https://b.example/2'],
  ]);
  assert.equal(t[0].snippet, 'Ausschnitt');
  // no citations in the text → nothing
  assert.deepEqual(footnoteTargets([md('Siehe:\n\n- [A](https://a.example)')]), []);
  // a list with a non-link item is not a source list
  assert.deepEqual(footnoteTargets([md('X[^1]\n\n- [A](https://a.example)\n- einfach Text')]), []);
  // sources node wins over definitions
  assert.equal(footnoteTargets([md('X[^1]\n\n[^1]: [Def](https://d.example)'), hui({ type: 'sources', items: [{ title: 'Node', url: 'https://n.example' }] })])[0].title, 'Node');
});

// ---------------------------------------------------------------- hui: links

test('hui: links: the four known kinds parse, unknown kinds / missing params → null', () => {
  assert.deepEqual(parseHuiHref('hui:place?q=Kolosseum%20Rom', 'Kolosseum'), { kind: 'place', label: 'Kolosseum', q: 'Kolosseum Rom' });
  assert.deepEqual(parseHuiHref('hui:date?start=2026-10-12T09:00&end=2026-10-12T10:30&title=Zahnarzt', '12. Okt, 9:00'), {
    kind: 'date',
    label: '12. Okt, 9:00',
    start: '2026-10-12T09:00',
    end: '2026-10-12T10:30',
    title: 'Zahnarzt',
    allDay: false,
  });
  assert.equal((parseHuiHref('hui:date?start=2026-10-12', 'Mo') as { allDay: boolean }).allDay, true);
  assert.deepEqual(parseHuiHref('hui:tel?n=%2B43660123456', '+43 660 123456'), { kind: 'tel', label: '+43 660 123456', n: '+43660123456' });
  assert.deepEqual(parseHuiHref('hui:price?v=249&c=eur&q=Sony%20WH-1000XM6', '€ 249'), { kind: 'price', label: '€ 249', v: 249, c: 'EUR', q: 'Sony WH-1000XM6' });
  // end before start is dropped
  assert.equal((parseHuiHref('hui:date?start=2026-10-12T09:00&end=2026-10-11T09:00', 'x') as { end?: string }).end, undefined);
  for (const bad of ['hui:evil?x=1', 'hui:script', 'hui:date?start=2026-13-01', 'hui:date?start=morgen', 'hui:tel?n=*123%23', 'hui:tel?n=abc', 'https://x.de', 'hui:place']) {
    assert.equal(parseHuiHref(bad, ''), null, bad);
  }
  // malformed escapes do not throw
  assert.equal(parseHuiHref('hui:place?q=%E0%A4%A', 'Ort')?.kind, 'place');
  assert.equal(entityCopyText(parseHuiHref('hui:tel?n=%2B4366012345', '0660 12345')!), '+4366012345');
  assert.equal(isoDate('2026-02-29'), null);
  assert.equal(isoDate('2028-02-29'), '2028-02-29');
});

// ---------------------------------------------------------------- auto-detection

test('detect: phones, e-mails, ISO and German dates (with times)', () => {
  assert.deepEqual(labels('Ruf an: +43 660 1234567 oder 0660 / 123 45 67.'), ['tel:+43 660 1234567', 'tel:0660 / 123 45 67']);
  assert.deepEqual(labels('Praxis (Tel. 030 1234567), Fax 089-123456'), ['tel:030 1234567', 'tel:089-123456']);
  assert.deepEqual(labels('Mail an max.muster@example.com bitte.'), ['email:max.muster@example.com']);
  // B6: a bare date in running text stays text (no chip breaking the line rhythm);
  // only dates with a time (appointment-like, worth an add-to-calendar tap) become chips
  assert.deepEqual(labels('Termin am 12.10.2026 um 9:30 Uhr, Abgabe 2026-10-14.'), ['date:12.10.2026 um 9:30 Uhr']);
  assert.deepEqual(labels('Preise vom 12.10.2026, Stand 2026-10-12.'), []);
  assert.deepEqual(labels('Start 2026-10-12T09:00 bzw. 3.1.2027, 14:00'), ['date:2026-10-12T09:00', 'date:3.1.2027, 14:00']);
  const d = entities('am 12.10.2026 um 9:30 Uhr')[0] as Extract<HuiEntity, { kind: 'date' }>;
  assert.equal(d.start, '2026-10-12T09:30');
  assert.equal(d.allDay, false);
  const tel = entities('+43 (0) 660 1234567')[0] as Extract<HuiEntity, { kind: 'tel' }>;
  assert.equal(tel.n, '+4306601234567');
  // the parts reassemble to the input
  const s = 'A +43 660 1234567 B a@b.de C 2026-10-12 D';
  assert.equal(detectEntities(s).map((p: DetectedPart) => (typeof p === 'string' ? p : p.label)).join(''), s);
});

test('detect: no false positives on versions, IBANs, ids, prices, maths, paths, URLs', () => {
  const none = [
    'Version 1.2.3 und v2.10.2026',
    'Node 20.11.1, Python 3.12.0, Build 2026.10.12',
    'IBAN: AT61 1904 3002 3457 3201',
    'IBAN DE89 3704 0044 0532 0130 00',
    'BIC GIBAATWWXXX, Konto 0012345678',
    'Kosten 1.234,56 € oder 0,99 $',
    '0.5 + 0.25 = 0.75; 10/12/2026; 2026/10/12',
    'Datei build-2026-10-12.log und /var/log/2026-10-12/x',
    'https://example.com/2026-10-12?tel=+436601234567',
    'Bestellnummer #0660123456',
    'Hash a3f0660123456 und uuid 123e4567-e89b-12d3-a456-426614174000',
    'user@localhost ist kein Mailziel, @handle auch nicht',
    '31.02.2026 ist kein Datum, 2026-13-01 auch nicht',
    'Uhrzeit 09:00 allein, Jahr 2026 allein',
    'Ergebnis 0 1 2 3',
    '+1 Punkt, +5 % mehr',
  ];
  for (const s of none) assert.deepEqual(labels(s), [], s);
});

test('detect: linear on long adversarial text', () => {
  // CPU-time ratio 12.5 KB vs 200 KB (testing/scaling.test.ts) instead of an absolute budget: robust on a loaded host
  for (const unit of ['+4 ', '0660 ', '1.1.', 'a@', '@@', '2026-10-', '12.10.20 ', 'x@y.z.']) {
    const build = (n: number) => {
      let s = '';
      while (s.length < n) s += unit;
      return s;
    };
    assertLinear(unit, build, (s) => {
      detectEntities(s);
    });
  }
});

// GPT review P1 #2: the IBAN look-behind regex backtracked exponentially on short inputs
// ("ZZ00" + 28 letters + "! +12345678" took > 500 ms; 34 letters effectively hung the JS thread).
test('detect: IBAN look-behind is linear on backtracking bait (adversarial, time-bounded)', async () => {
  const mod = new URL('./entities.ts', import.meta.url).href;
  for (const k of [28, 34, 36]) {
    for (const bait of ['ZZ00' + 'A'.repeat(k) + '! +12345678', 'DE89' + 'AB1 '.repeat(k >> 2) + 'x!! 0660 123456', 'ZZ00' + 'A\u00a0'.repeat(k >> 1) + '!+4366012345']) {
      const parts = await expectBounded<DetectedPart[]>(mod, 'detectEntities', [bait], 8000);
      assert.equal(parts.map((p) => (typeof p === 'string' ? p : p.label)).join(''), bait);
    }
  }
  // the full message still detects the phone number after the bait
  assert.deepEqual(labels('ZZ00' + 'A'.repeat(34) + '! +43 660 1234567'), ['tel:+43 660 1234567']);
});

test('detect: endsInIbanPrefix accepts exactly the former regex language (differential)', () => {
  const OLD = /[A-Z]{2}\d{2}(?:[ \u00a0]?[A-Z0-9]{1,4})*[ \u00a0]?$/;
  const alpha = ['A', 'Z', '0', '1', ' ', '\u00a0', '!', 'a'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let it = 0; it < 20000; it++) {
    const len = Math.floor(rnd() * 13);
    let s = '';
    for (let k = 0; k < len; k++) s += alpha[Math.floor(rnd() * alpha.length)];
    assert.equal(endsInIbanPrefix(s), OLD.test(s), JSON.stringify(s));
  }
  for (const s of ['AT61 1904 3002 3457 ', 'DE89 3704 0044 0532 0130 00', 'xx DE89', 'DE8', 'DE89  ', 'de89 1']) {
    assert.equal(endsInIbanPrefix(s), OLD.test(s), s);
  }
});

test('#20 entity edges: supplementary letters are word chars; ISO times with seconds/zone are detected whole', () => {
  assert.deepEqual(labels('\u{10400}2026-10-12'), []);
  assert.deepEqual(labels('2026-10-12\u{10400}'), []);
  assert.deepEqual(labels('\u{1F4C5} 2026-10-12 um 09:00'), ['date:2026-10-12 um 09:00']); // emoji + space is fine (timed: B6)
  assert.deepEqual(labels('am 2026-10-12T09:00Z los'), ['date:2026-10-12T09:00Z']);
  assert.deepEqual(labels('um 2026-10-12T09:00:30+02:00.'), ['date:2026-10-12T09:00:30+02:00']);
  const e = entities('2026-10-12T09:00Z')[0];
  assert.ok(e && e.kind === 'date' && e.start === '2026-10-12T09:00Z' && !e.allDay);
});

// ---------------------------------------------------------------- summary collapse

test('collapse: long sections after a summary keep ~12 lines, short ones stay open', () => {
  const para = (n: number) => 'Wort '.repeat(Math.round((n * 42) / 5)).trim();
  const long = parseMarkdown([para(3), '## Details', para(4), para(4), para(5), para(3)].join('\n\n'));
  assert.deepEqual(collapsePlan(long), { visible: 3, hiddenLines: 13 });
  const plan = collapsePlan(parseMarkdown([para(9), '## Details', para(5), para(5), para(3)].join('\n\n')));
  assert.ok(plan);
  assert.equal(plan.visible, 1, 'heading must not be the last visible block');
  assert.equal(plan.hiddenLines, 15);
  // short: everything visible
  assert.equal(collapsePlan(parseMarkdown([para(3), para(4), para(5)].join('\n\n'))), null);
  // just over the limit but the hidden rest would be tiny → no "Weiterlesen"
  assert.equal(collapsePlan(parseMarkdown([para(6), para(6), para(3)].join('\n\n'))), null);
  // a single huge block is never split
  assert.equal(collapsePlan(parseMarkdown(para(40))), null);
  const p2 = collapsePlan(parseMarkdown([para(5), para(5), para(5), para(5)].join('\n\n')));
  assert.deepEqual(p2, { visible: 2, hiddenLines: 10 });
  assert.equal(COLLAPSE_LINES, 12);
});

test('collapse: only after a summary node', () => {
  const segs = [hui({ type: 'summary', text: 'TL;DR' }), md('a'), hui({ type: 'table' }), md('b')];
  assert.equal(summaryBefore(segs, 0), false);
  assert.equal(summaryBefore(segs, 1), true);
  assert.equal(summaryBefore(segs, 3), true);
  assert.equal(summaryBefore([md('a'), hui({ type: 'table' }), md('b')], 2), false);
});

test('entities: month/year tokens are not phone numbers (E2E 2026-10-13: "05/2026")', () => {
  assert.equal(entities('Stand 05/2026, Preise ohne Gewähr').filter((e) => e.kind === 'tel').length, 0);
  assert.equal(entities('Modelljahr 10-2025').filter((e) => e.kind === 'tel').length, 0);
  // real national numbers still work
  assert.equal(entities('Ruf an: 0316 123456').filter((e) => e.kind === 'tel').length, 1);
  assert.equal(entities('Tel. 0664/1234567').filter((e) => e.kind === 'tel').length, 1);
});

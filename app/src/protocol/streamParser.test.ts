/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createStreamParser, parseMessage } from './streamParser.ts';
import type { Segment } from './types.ts';

const fixtureDir = new URL('./fixtures/', import.meta.url);
const fixtures: Record<string, string> = {};
for (const f of readdirSync(fixtureDir).filter((x) => x.endsWith('.md')).sort()) {
  fixtures[f] = readFileSync(new URL(f, fixtureDir), 'utf8');
}

function stream(chunks: string[]): Segment[] {
  const p = createStreamParser();
  for (const c of chunks) p.push(c);
  return p.end();
}

const kinds = (s: Segment[]) => s.map((x) => x.kind);

test('fixtures exist and parse into mixed segments without errors', () => {
  assert.equal(Object.keys(fixtures).length, 4);
  for (const [name, text] of Object.entries(fixtures)) {
    const segs = parseMessage(text);
    assert.ok(segs.some((s) => s.kind === 'markdown'), name);
    assert.ok(segs.some((s) => s.kind === 'hui'), name);
    for (const s of segs) {
      assert.ok(s.kind === 'markdown' || s.complete, `${name} ${s.key}`);
      if (s.kind === 'hui') assert.ok(s.node && !s.error, `${name} ${s.key}: ${s.error}`);
      if (s.kind === 'html') assert.ok(s.html.length > 10);
    }
    segs.forEach((s, i) => assert.equal(s.key, `seg-${i}`));
  }
  const k2 = kinds(parseMessage(fixtures['02-rechner-und-tabelle.md']));
  assert.deepEqual(k2, ['markdown', 'hui', 'markdown', 'html', 'markdown', 'hui']);
});

test('plain markdown stays one segment', () => {
  const segs = parseMessage('Hallo\n\n- a\n- b\n\n```python\nprint(1)\n```\n\nEnde');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, 'markdown');
  assert.equal((segs[0] as { text: string }).text, 'Hallo\n\n- a\n- b\n\n```python\nprint(1)\n```\n\nEnde');
  assert.deepEqual(parseMessage(''), []);
  assert.deepEqual(parseMessage('  \n\n'), []);
});

test('multiple blocks, order and content', () => {
  const t = 'A\n```hui\n{"type":"text","text":"1"}\n```\nB\n```hui-html\n<p>x</p>\n```\nC\n```hui\n{"type":"text","text":"2"}\n```';
  const s = parseMessage(t);
  assert.deepEqual(kinds(s), ['markdown', 'hui', 'markdown', 'html', 'markdown', 'hui']);
  assert.equal((s[3] as { html: string }).html, '<p>x</p>');
  assert.deepEqual((s[5] as { node: unknown }).node, { type: 'text', text: '2' });
});

test('back-to-back blocks without markdown between', () => {
  const s = parseMessage('```hui\n{"type":"text","text":"1"}\n```\n```hui\n{"type":"text","text":"2"}\n```\n');
  assert.deepEqual(kinds(s), ['hui', 'hui']);
  assert.deepEqual(s.map((x) => x.key), ['seg-0', 'seg-1']);
});

test('fence with trailing spaces, CRLF, indentation', () => {
  const lf = 'x\n```hui   \n{"type":"text","text":"a"}\n```  \ny\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const a = parseMessage(lf);
  assert.deepEqual(kinds(a), ['markdown', 'hui', 'markdown']);
  assert.deepEqual(parseMessage(crlf), a);
  const ind = parseMessage('x\n  ```hui\n{"type":"text","text":"a"}\n  ```\ny');
  assert.deepEqual(kinds(ind), ['markdown', 'hui', 'markdown']);
  // 4+ spaces indent = indented code in markdown, not a fence
  assert.deepEqual(kinds(parseMessage('x\n    ```hui\n{"type":"text"}\n    ```\n')), ['markdown']);
});

test('other fences stay markdown; hui fence inside a markdown code block is not a block', () => {
  const t = 'Beispiel:\n````markdown\n```hui\n{"type":"text","text":"x"}\n```\n````\nDanach.';
  const s = parseMessage(t);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'markdown');
  assert.ok((s[0] as { text: string }).text.includes('```hui'));
  const tilde = parseMessage('~~~\n```hui\n{}\n```\n~~~\n');
  assert.deepEqual(kinds(tilde), ['markdown']);
  const json = parseMessage('```json\n{"type":"text"}\n```\n```json-hui\n{}\n```');
  assert.deepEqual(kinds(json), ['markdown']);
  // inline triple backticks are not fences
  assert.deepEqual(kinds(parseMessage('use ```hui in the middle of a line\nmore')), ['markdown']);
});

test('longer fences: ````hui closes only with >=4 backticks', () => {
  const s = parseMessage('````hui-html\n<pre>```\ncode\n```</pre>\n````\nok');
  assert.deepEqual(kinds(s), ['html', 'markdown']);
  assert.equal((s[0] as { html: string }).html, '<pre>```\ncode\n```</pre>');
});

test('unclosed blocks: incomplete while streaming, finalized on end()', () => {
  const p = createStreamParser();
  let s = p.push('Text\n```hui\n{"type":"card","title":"Ti');
  assert.deepEqual(kinds(s), ['markdown', 'hui']);
  const h = s[1] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(h.complete, false);
  assert.equal(h.error, undefined);
  assert.deepEqual(h.node, { type: 'card', title: 'Ti', children: [] });
  s = p.push('tle","children":[{"type":"text","text":"a');
  const h2 = s[1] as Extract<Segment, { kind: 'hui' }>;
  assert.deepEqual(h2.node, { type: 'card', title: 'Title', children: [{ type: 'text', text: 'a' }] });
  s = p.end();
  const h3 = s[1] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(h3.complete, true);
  assert.ok(h3.error, 'invalid JSON at end() must set error');
  assert.ok(h3.node, 'best-effort node is kept');

  const q = createStreamParser();
  let t = q.push('```hui-html\n<div>hal');
  assert.deepEqual(t, [{ key: 'seg-0', kind: 'html', complete: false, html: '<div>hal' }]);
  t = q.end();
  assert.deepEqual(t, [{ key: 'seg-0', kind: 'html', complete: true, html: '<div>hal' }]);
});

test('unclosed but valid hui at end(): complete, no error', () => {
  const s = parseMessage('```hui\n{"type":"text","text":"ok"}');
  const h = s[0] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(h.complete, true);
  assert.equal(h.error, undefined);
  assert.deepEqual(h.node, { type: 'text', text: 'ok' });
});

test('closing fence without trailing newline at end of message', () => {
  const s = parseMessage('```hui-html\n<b>x</b>\n```');
  assert.deepEqual(s, [{ key: 'seg-0', kind: 'html', complete: true, html: '<b>x</b>' }]);
});

test('invalid hui blocks set error', () => {
  const bad = parseMessage('```hui\n{not json}\n```')[0] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(bad.complete, true);
  assert.ok(bad.error);
  const notNode = parseMessage('```hui\n[1,2]\n```')[0] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(notNode.node, null);
  assert.ok(notNode.error);
  const empty = parseMessage('```hui\n```')[0] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(empty.node, null);
  assert.ok(empty.error);
  const unknown = parseMessage('```hui\n{"type":"hologram","x":1}\n```')[0] as Extract<Segment, { kind: 'hui' }>;
  assert.equal(unknown.error, undefined);
  assert.deepEqual(unknown.node, { type: 'hologram', x: 1 } as never);
});

test('partial fence markers never leak into markdown while streaming', () => {
  const full = 'Hallo\n```hui\n{"type":"text","text":"a"}\n```\nRest';
  const opener = 'Hallo\n```hui-html'.length;
  for (let cut = 'Hallo\n'.length; cut <= opener; cut++) {
    const p = createStreamParser();
    const s = p.push('Hallo\n```hui-html\n<b>x</b>\n```\n'.slice(0, cut));
    const md = s[0] as Extract<Segment, { kind: 'markdown' }>;
    assert.equal(md.text, 'Hallo', `cut ${cut}: ${JSON.stringify(s)}`);
  }
  const p = createStreamParser();
  for (const part of ['Hallo\n``', '`h', 'ui\n{"type":"text",', '"text":"a"}\n``', '`\nRest']) p.push(part);
  assert.deepEqual(kinds(p.segments()), ['markdown', 'hui', 'markdown']);
  assert.deepEqual(parseMessage(full), p.end());
});

test('partial closing fence does not leak into block content', () => {
  const p = createStreamParser();
  let s = p.push('```hui-html\n<b>x</b>\n``');
  assert.equal((s[0] as { html: string }).html, '<b>x</b>');
  s = p.push('`\nnach');
  assert.deepEqual(kinds(s), ['html', 'markdown']);
  assert.equal((s[0] as { complete: boolean }).complete, true);
  // but a line starting with backticks that is not a fence is content
  s = createStreamParser().push('```hui-html\n``x');
  assert.equal((s[0] as { html: string }).html, '``x');
});

test('keys are stable by index and closed segments keep identity', () => {
  const p = createStreamParser();
  const text = fixtures['02-rechner-und-tabelle.md'];
  let prev: Segment[] = [];
  let identityKept = 0;
  for (let i = 0; i < text.length; i += 7) {
    const s = p.push(text.slice(i, i + 7));
    s.forEach((seg, idx) => assert.equal(seg.key, `seg-${idx}`));
    assert.ok(s.length >= prev.length - 0, 'segment count never shrinks');
    // all but the last (open) segment of the previous call are unchanged objects
    for (let k = 0; k < prev.length - 1; k++) {
      assert.equal(s[k], prev[k], `segment ${k} identity changed`);
      identityKept++;
    }
    prev = s;
  }
  p.end();
  assert.ok(identityKept > 100);
});

test('fuzz: every 2-way split position of every fixture equals parseMessage(full)', () => {
  for (const [name, text] of Object.entries(fixtures)) {
    for (const variant of [text, text.replace(/\n/g, '\r\n')]) {
      const expected = parseMessage(variant);
      for (let i = 0; i <= variant.length; i++) {
        assert.deepEqual(stream([variant.slice(0, i), variant.slice(i)]), expected, `${name} split @${i}`);
      }
    }
  }
});

test('fuzz: char-by-char and random chunking equal parseMessage(full)', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const [name, text] of Object.entries(fixtures)) {
    const expected = parseMessage(text);
    assert.deepEqual(stream(text.split('')), expected, `${name} char-by-char`);
    for (let r = 0; r < 25; r++) {
      const chunks: string[] = [];
      let i = 0;
      while (i < text.length) {
        const len = 1 + Math.floor(rnd() * 40);
        chunks.push(text.slice(i, i + len));
        i += len;
      }
      assert.deepEqual(stream(chunks), expected, `${name} random #${r}`);
    }
  }
});

test('fuzz: intermediate states are sane at every char (keys, no fence debris)', () => {
  for (const [name, text] of Object.entries(fixtures)) {
    const p = createStreamParser();
    for (let i = 0; i < text.length; i++) {
      const segs = p.push(text[i]);
      segs.forEach((s, idx) => assert.equal(s.key, `seg-${idx}`));
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k];
        if (k < segs.length - 1) {
          assert.ok(s.kind === 'markdown' || s.complete, `${name}@${i}: inner segment ${k} incomplete`);
        }
        if (s.kind === 'markdown') {
          const last = s.text.split('\n').pop() ?? '';
          // trailing partial opener must be held back (fixtures contain no ``` mid-markdown except full fences)
          assert.ok(!/^`{1,2}$|^```(h|hu|hui|hui-|hui-h|hui-ht|hui-htm|hui-html)$/.test(last) || /```/.test(s.text.slice(0, -last.length)),
            `${name}@${i}: leaked ${JSON.stringify(last)}`);
        }
        const lastLine = (x: string) => x.split('\n').pop() ?? '';
        if (s.kind === 'html' && !s.complete) assert.ok(!/^ {0,3}`{1,3}$/.test(lastLine(s.html)), `${name}@${i}: html leak`);
        if (s.kind === 'hui') assert.ok(!/^ {0,3}`{1,3}$/.test(lastLine(s.raw)), `${name}@${i}: hui leak`);
      }
    }
    assert.deepEqual(p.end(), parseMessage(text));
  }
});

test('end() is idempotent; push after end is ignored', () => {
  const p = createStreamParser();
  p.push('abc');
  const a = p.end();
  assert.deepEqual(p.end(), a);
  assert.deepEqual(p.push('more'), a);
  assert.deepEqual(p.segments(), a);
});

test('segments() reflects current state without feeding', () => {
  const p = createStreamParser();
  assert.deepEqual(p.segments(), []);
  p.push('Hi ');
  assert.deepEqual(p.segments(), [{ key: 'seg-0', kind: 'markdown', text: 'Hi' }]);
});

test('perf: 50KB message streamed in small deltas', () => {
  const base = Object.values(fixtures).join('\n');
  let text = base;
  while (text.length < 50_000) text += '\n' + base;
  text = text.slice(0, 50_000);
  for (const [label, size] of [['~4 chars', 4], ['~16 chars', 16]] as const) {
    const p = createStreamParser();
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < text.length; i += size) {
      p.push(text.slice(i, i + size));
      n++;
    }
    p.end();
    const ms = performance.now() - t0;
    console.log(`# perf 50KB (${text.length} chars), ${n} deltas of ${label}: ${ms.toFixed(0)} ms total, ${(ms / n).toFixed(3)} ms/push`);
    assert.ok(ms < 3000, `too slow: ${ms}ms`);
  }
  // single huge single-line hui block streamed in many deltas (worst case for partial JSON re-parse)
  const rows = Array.from({ length: 180 }, (_, i) => [`Zeile ${i}`, i, i * 2.5, null]);
  const big = '```hui\n' + JSON.stringify({ type: 'table', columns: ['a', 'b', 'c', 'd'], rows }) + '\n```\n';
  const p = createStreamParser();
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < big.length; i += 5) {
    p.push(big.slice(i, i + 5));
    n++;
  }
  p.end();
  const ms = performance.now() - t0;
  console.log(`# perf single-line hui block ${big.length} chars, ${n} deltas: ${ms.toFixed(0)} ms total, ${(ms / n).toFixed(3)} ms/push`);
  assert.ok(ms < 3000, `too slow: ${ms}ms`);
});

test('streamed gallery / image query nodes: never throw, grow monotonically, final node exact', () => {
  const node = {
    type: 'card', title: 'Rom am Wochenende', imageQuery: 'Rom', children: [
      { type: 'gallery', items: [{ query: 'Kolosseum', caption: 'Kolosseum' }, { query: 'Trevi-Brunnen' }, { query: 'Pantheon (Rom)' }] },
      { type: 'image', query: 'Petersdom', alt: 'Petersdom' },
      { type: 'timeline', items: [{ time: 'Sa 9:00', title: 'Kolosseum', imageQuery: 'Kolosseum' }, { time: 'Sa 14:00', title: 'Forum', imageQuery: 'Forum Romanum' }] },
    ],
  };
  const src = '```hui\n' + JSON.stringify(node) + '\n```\n';
  const p = createStreamParser();
  let lastItems = 0;
  for (let i = 0; i < src.length; i += 3) {
    const segs = p.push(src.slice(i, i + 3));
    const h = segs.find((x) => x.kind === 'hui');
    if (!h || h.kind !== 'hui' || !h.node) continue;
    const kids = (h.node as { children?: { type: string; items?: { query?: string; url?: string }[] }[] }).children ?? [];
    const g = kids.find((c) => c.type === 'gallery');
    if (g) {
      const items = g.items ?? [];
      // every partial gallery item has a query or url (validator drops empty ones)
      assert.ok(items.every((it) => it.query || it.url), JSON.stringify(items));
      assert.ok(items.length >= lastItems, 'gallery items never shrink');
      lastItems = items.length;
    }
    // a partial image node only exists once it has a query/url
    for (const c of kids) if (c.type === 'image') assert.ok((c as { query?: string }).query, 'image needs query');
  }
  const done = p.end().find((x) => x.kind === 'hui');
  assert.ok(done && done.kind === 'hui' && done.complete);
  assert.deepEqual(done.node, node);
});

// ---------------------------------------------------------------- perf: large open hui blocks

function bigTable(n: number): string {
  const rows = Array.from({ length: n }, (_, i) => [`Zeile ${i}`, `${i}`, `Beschreibung ${i} mit etwas Text`]);
  return JSON.stringify({ type: 'table', columns: ['A', 'B', 'C'], rows }, null, 1);
}

test('large open hui block: rebuilt by growth/time, not on every push; final result exact', async () => {
  const { HUI_REBUILD_EVERY_PUSH_MAX, HUI_REBUILD_MIN_GROWTH } = await import('./streamParser.ts');
  const body = bigTable(200);
  assert.ok(body.length > HUI_REBUILD_EVERY_PUSH_MAX * 3);
  const text = 'Intro\n\n```hui\n' + body + '\n```\n\nEnde';
  let clock = 0;
  const p = createStreamParser({ now: () => clock });
  const nodes = new Set<unknown>();
  let lastRaw = 0;
  let bigPushes = 0;
  for (let i = 0; i < text.length; i += 15) {
    const segs = p.push(text.slice(i, i + 15));
    const h = segs.find((s) => s.kind === 'hui');
    if (h && h.kind === 'hui' && !h.complete && h.raw.length > HUI_REBUILD_EVERY_PUSH_MAX) {
      nodes.add(h.node);
      bigPushes++;
      // stale by at most the growth threshold (+ one push) once above the per-push size
      const shown = h.raw.length;
      assert.ok(shown >= lastRaw, 'raw never shrinks');
      lastRaw = shown;
      const open = text.slice(text.indexOf('```hui\n') + 7, i + 15).length;
      if (open > HUI_REBUILD_EVERY_PUSH_MAX) assert.ok(open - shown <= HUI_REBUILD_MIN_GROWTH + 16, `stale ${open - shown}`);
    }
  }
  assert.ok(bigPushes > 500 && nodes.size < bigPushes / 20, `${nodes.size} rebuilds for ${bigPushes} pushes`);
  const end = p.end();
  assert.deepEqual(end, parseMessage(text));
});

test('large open hui block: time-based rebuild keeps it fresh on a slow stream', () => {
  const body = bigTable(80);
  const head = 'x\n```hui\n' + body.slice(0, 6000);
  let clock = 0;
  const p = createStreamParser({ now: () => clock });
  p.push(head);
  const a = p.push('a').find((s) => s.kind === 'hui');
  clock += 10;
  const b = p.push('b').find((s) => s.kind === 'hui');
  assert.equal(a, b, 'skipped within the interval');
  clock += 300;
  const c = p.push('c').find((s) => s.kind === 'hui');
  assert.notEqual(c, b, 'rebuilt after the interval');
  assert.ok(c && c.kind === 'hui' && c.raw.endsWith('abc'));
});

test('streaming hui rows keep their identity across rebuilds (structural sharing)', () => {
  const body = bigTable(30);
  const text = '```hui\n' + body + '\n```';
  const p = createStreamParser();
  let prevRows: unknown[] | null = null;
  let shared = 0;
  for (let i = 0; i < text.length; i += 40) {
    const h = p.push(text.slice(i, i + 40)).find((s) => s.kind === 'hui');
    const rows = h && h.kind === 'hui' && h.node && (h.node as { rows?: unknown[] }).rows;
    if (rows && prevRows && rows !== prevRows && prevRows.length > 1 && rows.length >= prevRows.length) {
      assert.equal(rows[0], prevRows[0]);
      shared++;
    }
    if (rows) prevRows = rows;
  }
  assert.ok(shared > 5);
});

test('typed fences: ```suggestions with a "suggestions" list renders as follow-ups (real Hermes answer 2026-10-13)', () => {
  const p = createStreamParser();
  p.push('Hier die Cafés.\n\n```suggestions\n{"type":"suggestions","suggestions":["Auch Fotter?","Wo frühstückt man?"]}\n```\n');
  const segs = p.end();
  const hui = segs.filter((s) => s.kind === 'hui');
  assert.equal(hui.length, 1);
  assert.equal(hui[0].kind === 'hui' && hui[0].node?.type, 'suggestions');
  assert.deepEqual(hui[0].kind === 'hui' && (hui[0].node as { items?: string[] }).items, ['Auch Fotter?', 'Wo frühstückt man?']);
  // the fence name supplies a missing type
  const q = createStreamParser();
  q.push('```places\n{"places":[{"name":"Café A"}]}\n```\n');
  const s2 = q.end().find((s) => s.kind === 'hui');
  assert.equal(s2 && s2.kind === 'hui' && s2.node?.type, 'places');
  // ordinary code fences stay code
  const r = createStreamParser();
  r.push('```python\nprint(1)\n```\n');
  assert.ok(r.end().every((s) => s.kind === 'markdown'));
});

test('typed fences: a partial typed opener (```sugg, ```quiz ) never flashes as markdown', () => {
  const text = 'Hallo\n```suggestions\n{"type":"suggestions","suggestions":["A"]}\n```\n';
  const opener = 'Hallo\n```suggestions '.length - 1;
  for (let cut = 'Hallo\n'.length; cut <= opener; cut++) {
    const s = createStreamParser().push(text.slice(0, cut));
    assert.equal((s[0] as Extract<Segment, { kind: 'markdown' }>).text, 'Hallo', `cut ${cut}: ${JSON.stringify(s)}`);
  }
  // complete typed name + trailing space is still an opener prefix; a different word shows right away
  assert.equal((createStreamParser().push('Hallo\n```quiz ')[0] as { text: string }).text, 'Hallo');
  assert.ok((createStreamParser().push('Hallo\n```py')[0] as { text: string }).text.includes('```py'));
  assert.ok((createStreamParser().push('Hallo\n```quizz')[0] as { text: string }).text.includes('```quizz'));
});

test('typed fences: only a JSON object is a component; didactic content stays a code block', () => {
  // a fence named like a component type but holding prose / code renders as code
  const prose = parseMessage('So sieht ein Quiz aus:\n```quiz\nFrage 1: Was ist 2+2?\n```\nEnde');
  assert.deepEqual(kinds(prose), ['markdown']);
  assert.ok((prose[0] as { text: string }).text.includes('```quiz\nFrage 1: Was ist 2+2?\n```'));
  assert.ok((prose[0] as { text: string }).text.includes('Ende'));
  // a ```hui line inside such a code block is code, not an opener (a closing fence has no info string)
  assert.deepEqual(kinds(parseMessage('```guide\nSchritt 1\n```hui\n{"type":"text","text":"x"}\n```\n')), ['markdown']);
  // leading whitespace / blank lines before `{` still make a component
  const obj = parseMessage('```checklist\n\n  {"items":["a"]}\n```');
  assert.deepEqual(kinds(obj), ['hui']);
  assert.equal(obj[0].kind === 'hui' && obj[0].node?.type, 'checklist');
});

test('typed fences: a bare JSON array is a suggestions component, other typed arrays stay code', () => {
  const sug = parseMessage('Antwort.\n```suggestions\n["Mehr Details?", "Und morgen?"]\n```');
  assert.deepEqual(kinds(sug), ['markdown', 'hui']);
  const node = sug[1].kind === 'hui' ? sug[1].node : null;
  assert.equal(node?.type, 'suggestions');
  assert.deepEqual((node as { items?: unknown }).items, ['Mehr Details?', 'Und morgen?']);
  // streaming: `[` decides for suggestions
  assert.deepEqual(kinds(createStreamParser().push('Text\n```suggestions\n["a"')), ['markdown', 'hui']);
  assert.deepEqual(kinds(parseMessage('```quiz\n["a"]\n```')), ['markdown']);
});

test('typed fences while streaming: held back until the first non-whitespace char decides', () => {
  const p = createStreamParser();
  // nothing decided yet: neither the fence nor a component shows
  assert.deepEqual(kinds(p.push('Text\n```stats\n')), ['markdown']);
  assert.equal((p.segments()[0] as { text: string }).text, 'Text');
  assert.deepEqual(kinds(p.push('\n  ')), ['markdown']);
  assert.equal((p.segments()[0] as { text: string }).text, 'Text');
  // `{` → streaming component (the JSON line is still open)
  assert.deepEqual(kinds(p.push('{"type":"stats","items":[')), ['markdown', 'hui']);
  const q = createStreamParser();
  q.push('Text\n```stats\n');
  // anything else → code block, streaming on as markdown
  const s = q.push('Umsatz | 12');
  assert.deepEqual(kinds(s), ['markdown']);
  assert.ok((s[0] as { text: string }).text.includes('```stats\nUmsatz | 12'));
  assert.deepEqual(kinds(q.push('\n```\nweiter')), ['markdown']);
  assert.deepEqual(q.end(), parseMessage('Text\n```stats\nUmsatz | 12\n```\nweiter'));
  // an empty typed fence is an (empty) code block, not an error component
  assert.deepEqual(kinds(parseMessage('```poll\n```\n')), ['markdown']);
});


test('terminal text fences preserve a JSON log line instead of inferring an empty node', () => {
  const nodeOf = (text: string) => {
    const segment = parseMessage(text)[0];
    assert.equal(segment.kind, 'hui');
    return (segment as { node?: { type?: string; output?: string; status?: string } }).node;
  };
  for (const raw of ['{"level":"info","message":"started"}', '{"ok":false,"error":"test failed"}']) {
    const node = nodeOf('```terminal\n' + raw + '\n```');
    assert.equal(node?.type, 'terminal');
    assert.equal(node?.output?.trim(), raw);
  }
  assert.equal(nodeOf('```terminal\n{"command":"echo test","output":"ok"}\n```')?.output, 'ok', 'structured terminal descriptors still work');
  const running = nodeOf('```terminal\n{"status":"running"}\n```');
  assert.equal(running?.status, 'running');
  assert.equal(running?.output, undefined, 'a running descriptor stays a loading placeholder');
});

/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseMarkdownIncremental, type MdParseState } from './markdown.ts';

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

/** markdown with the constructs whose extent depends on lookahead (lists across blank lines, fences, quotes, tables, setext) */
function genDoc(parts: number): string {
  const snippets = [
    'Absatz mit **fett** und `code`.\n',
    'zweite Zeile\n',
    '\n',
    '\n\n',
    '- a\n',
    '- b\n',
    '  - nested\n',
    '  continued\n',
    '1. eins\n',
    '2) zwei\n',
    '* stern\n',
    '```js\n',
    '```\n',
    '~~~\n',
    'const x = 1;\n',
    '> zitat\n',
    'lazy\n',
    '| A | B |\n',
    '|---|---|\n',
    '| 1 | 2 |\n',
    '# Titel\n',
    'Setext\n',
    '===\n',
    '---\n',
    '    indented\n',
    '![b](u.png)\n',
    '- [x] done\n',
    '\t- tab item\n',
  ];
  let s = '';
  for (let i = 0; i < parts; i++) s += pick(snippets);
  return s;
}

test('parseMarkdownIncremental equals parseMarkdown at every streaming step (random docs, random chunks)', () => {
  for (let doc = 0; doc < 400; doc++) {
    const text = genDoc(5 + Math.floor(rnd() * 40));
    let st: MdParseState | null = null;
    let i = 0;
    while (i < text.length) {
      i = Math.min(text.length, i + 1 + Math.floor(rnd() * 12));
      // the stream parser hands Markdown trimmed text; test both raw prefixes and trimmed ones
      const view = rnd() < 0.5 ? text.slice(0, i) : text.slice(0, i).trimEnd();
      const next = parseMarkdownIncremental(view, st);
      assert.deepEqual(next.blocks, parseMarkdown(view), `doc ${doc} @${i}: ${JSON.stringify(view)}`);
      st = next;
    }
  }
});

test('parseMarkdownIncremental reuses stable prefix blocks (same objects) and handles non-prefix updates', () => {
  const a = parseMarkdownIncremental('# T\n\nPara one.\n\n- x\n- y\n\nPara two');
  assert.ok(a.stable >= 2);
  const b = parseMarkdownIncremental('# T\n\nPara one.\n\n- x\n- y\n\nPara two grows', a);
  assert.equal(b.blocks[0], a.blocks[0]);
  assert.equal(b.blocks[1], a.blocks[1]);
  assert.deepEqual(b.blocks, parseMarkdown(b.text));
  // not a prefix (edit / regenerate) → full parse
  const c = parseMarkdownIncremental('Neu', b);
  assert.deepEqual(c.blocks, parseMarkdown('Neu'));
  // CRLF falls back to the full path and stays exact
  const d = parseMarkdownIncremental('a\r\n\r\nb\r', null);
  const e = parseMarkdownIncremental('a\r\n\r\nb\r\nc', d);
  assert.deepEqual(e.blocks, parseMarkdown('a\r\n\r\nb\r\nc'));
  assert.equal(parseMarkdownIncremental(e.text, e), e);
});

test('parseMarkdownIncremental re-parses only the tail of a long answer', () => {
  let text = '';
  for (let i = 0; i < 400; i++) text += `Absatz ${i} mit etwas Text.\n\n`;
  const st = parseMarkdownIncremental(text + 'live');
  assert.equal(st.stable, 399);
  assert.ok(st.stableOffset > text.length - 40);
});

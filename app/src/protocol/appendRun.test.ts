/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendsText } from './appendRun.ts';
import { createStreamParser, segmentAppendRun } from './streamParser.ts';
import type { Segment } from './types.ts';

test('extendsText: full compare without a shared run, length + old-end compare with one', () => {
  const run = {};
  assert.equal(extendsText('abc', 'abcdef'), true);
  assert.equal(extendsText('abc', 'abXdef'), false);
  assert.equal(extendsText('abcdef', 'abc', run, run), false); // shorter: never
  assert.equal(extendsText('abc', 'abcdef', run, run), true);
  assert.equal(extendsText('abc', 'abXdef', {}, run), false); // other run: full compare
  assert.equal(extendsText('abc', 'abXdef', undefined, undefined), false);
  // a misused token is caught at the old end
  assert.equal(extendsText('x'.repeat(40) + 'abc', 'x'.repeat(40) + 'abX…', run, run), false);
  assert.equal(extendsText('', 'anything', run, run), true);
});

function rng(seed: number) {
  let s = seed;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

const PIECES = [
  'Absatz mit Text ', 'mehr ', '\n', '\n', '\n\n', '  \n', ' \t', '\r\n', '```', '```\n', '```js\n', '```hui\n', '```hui-html\n',
  '{"type":"text","text":"x"}\n', '```quiz\n', '```suggestions\n', '[1,2]\n', '~~~\n', '``', '`', '- item\n', '> zitat\n', '# Titel\n', '<div>', 'h', 'u', 'i',
];

test('stream parser: markdown segments with the same append run only ever grow (fuzz incl. fences, blocks, blank lines, CRLF)', () => {
  const r = rng(99);
  let continued = 0;
  let total = 0;
  for (let k = 0; k < 2500; k++) {
    let text = '';
    const n = 1 + Math.floor(r() * 30);
    for (let i = 0; i < n; i++) text += PIECES[Math.floor(r() * PIECES.length)];
    const p = createStreamParser({ now: () => 0 });
    const seen = new Map<string, { text: string; run: object | undefined }>();
    const check = (segs: Segment[]) => {
      for (const seg of segs) {
        if (seg.kind !== 'markdown') continue;
        const run = segmentAppendRun(seg);
        assert.ok(run, 'every parser markdown segment has a run');
        const before = seen.get(seg.key);
        if (before && before.run === run) {
          total++;
          if (before.text !== seg.text) continued++;
          assert.ok(seg.text.length >= before.text.length && seg.text.startsWith(before.text), JSON.stringify([text, before.text, seg.text]));
        }
        seen.set(seg.key, { text: seg.text, run });
      }
    };
    for (let i = 0; i < text.length; ) {
      const step = 1 + Math.floor(r() * 6);
      check(p.push(text.slice(i, i + step)));
      i += step;
    }
    check(p.end());
  }
  assert.ok(continued > 1000, `runs continued ${continued} / ${total}`);
});

test('stream parser: a plain markdown answer keeps one run for its whole stream', () => {
  const text = Array.from({ length: 60 }, (_, i) => `## Teil ${i}\n\nText mit **fett** und \`code\`.\n\n- a\n- b\n\n\`\`\`js\nx = ${i}\n\`\`\`\n`).join('\n');
  const p = createStreamParser({ now: () => 0 });
  const runs = new Set<object>();
  for (let i = 0; i < text.length; i += 7) {
    const last = p.push(text.slice(i, i + 7)).at(-1);
    if (last?.kind === 'markdown') runs.add(segmentAppendRun(last)!);
  }
  assert.equal(runs.size, 1);
});

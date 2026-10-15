/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENTER_STAGGER_MAX_MS, ENTER_STAGGER_MS, enterBlockPropsEqual, enterDelay, type EnterBlockCompare } from './enterBlock.ts';
import { parseMarkdownIncremental, type MdParseState } from './markdown.ts';

const S = {};
const props = (src: string, over: Partial<EnterBlockCompare> = {}): EnterBlockCompare => ({ block: { src }, s: S, first: false, live: false, enter: true, delay: 0, ...over });

test('enter block: equal source/styles/position/live → no re-render; the mount-time delay is ignored', () => {
  assert.ok(enterBlockPropsEqual(props('a'), props('a')));
  assert.ok(enterBlockPropsEqual(props('a', { delay: 120 }), props('a', { delay: 0 })));
  // a new block object with the same source (re-parsed tail) is still equal
  assert.ok(enterBlockPropsEqual({ ...props('a'), block: { src: 'a' } }, props('a')));
  assert.ok(!enterBlockPropsEqual(props('a'), props('ab')));
  assert.ok(!enterBlockPropsEqual(props('a'), props('a', { live: true })));
  assert.ok(!enterBlockPropsEqual(props('a'), props('a', { first: true })));
  assert.ok(!enterBlockPropsEqual(props('a'), props('a', { s: {} })));
  assert.ok(!enterBlockPropsEqual(props('a'), props('a', { enter: false })));
});

test('enter block: stagger by position after the last rendered block, capped', () => {
  assert.equal(enterDelay(3, 5), 0);
  assert.equal(enterDelay(5, 5), 0);
  assert.equal(enterDelay(6, 5), ENTER_STAGGER_MS);
  assert.equal(enterDelay(100, 0), ENTER_STAGGER_MAX_MS);
});

function longDoc(sections: number): string {
  let s = '';
  for (let i = 0; i < sections; i++) {
    s += `## Abschnitt ${i}\n\nEin Absatz mit **fett** und \`code\` der etwas länger ist, damit er über mehrere Ticks streamt.\n\n`;
    s += `- Punkt eins ${i}\n- Punkt zwei\n  - verschachtelt\n\n`;
    s += '```js\nconst x = ' + i + ';\nconsole.log(x);\n```\n\n';
    s += `> Zitat ${i}\n> zweite Zeile\n\n| A | B |\n|---|---|\n| ${i} | 2 |\n\n`;
  }
  return s;
}

test('enter block: a streaming tick re-renders only the tail – not every block of a long answer', () => {
  const full = longDoc(12);
  let st: MdParseState | undefined;
  let prev: EnterBlockCompare[] = [];
  let maxChanged = 0;
  let maxBlocks = 0;
  for (let i = 7; i <= full.length + 6; i += 7) {
    st = parseMarkdownIncremental(full.slice(0, i), st);
    const next = st.blocks.map((b, k) => props(b.src, { first: k === 0, live: k === st!.blocks.length - 1 }));
    // existing positions whose wrapper would re-render (new positions mount, they don't re-render)
    let changed = 0;
    for (let k = 0; k < Math.min(prev.length, next.length); k++) if (!enterBlockPropsEqual(prev[k], next[k])) changed++;
    maxChanged = Math.max(maxChanged, changed);
    maxBlocks = Math.max(maxBlocks, next.length);
    prev = next;
  }
  assert.ok(maxBlocks > 50, `doc has ${maxBlocks} blocks`);
  // the growing tail, plus the block before it when a new one starts (its source ends / live flips)
  assert.ok(maxChanged <= 2, `max re-rendered blocks per tick: ${maxChanged}`);
});

test('enter block guard: Markdown renders blocks through the memoized EnterBlock with a mount-time delay', () => {
  const src = readFileSync(new URL('./Markdown.tsx', import.meta.url), 'utf8');
  assert.match(src, /const EnterBlock = memo\(function EnterBlock\([\s\S]*?\}, enterBlockPropsEqual\);/);
  assert.match(src, /const \[mountDelay\] = useState\(delay\);/);
  assert.match(src, /<FadeIn delay=\{mountDelay\}>/);
  // no inline FadeIn wrapper per block in the render loop any more
  const loop = src.slice(src.indexOf('blocks.slice(0, visible).map('), src.indexOf('{folded ?'));
  assert.doesNotMatch(loop, /<FadeIn/);
  assert.match(loop, /<EnterBlock /);
});

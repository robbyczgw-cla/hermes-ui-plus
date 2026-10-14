import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDIT_PURPOSE, findEditPairs } from '../imageedit/core.ts';
import type { Attachment } from '../attachments/types.ts';
import { createListDerive, createReversedList } from './listDerive.ts';
import { reformattedSources } from './reformat.ts';

type M = { id: string; role: 'user' | 'assistant'; text: string; attachments?: Attachment[] };

const img = (id: string): Attachment => ({ id, kind: 'image', name: `${id}.png`, mime: 'image/png', size: 1, uri: `file:///${id}.png`, purpose: EDIT_PURPOSE }) as unknown as Attachment;

/** deterministic pseudo-random message lists */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

function randomMessage(r: () => number, i: number): M {
  const x = r();
  if (x < 0.15) return { id: `u${i}`, role: 'user', text: 'Bearbeite das Bild: heller', attachments: [img(`i${i}`)] };
  if (x < 0.3) return { id: `u${i}`, role: 'user', text: '[reformat:table] Als Tabelle bitte' };
  if (x < 0.5) return { id: `u${i}`, role: 'user', text: `Frage ${i}` };
  if (x < 0.6) return { id: `a${i}`, role: 'assistant', text: '' };
  return { id: `a${i}`, role: 'assistant', text: `Antwort ${i}` };
}

const expected = (list: readonly M[]) => ({ editPairs: findEditPairs(list), reformatted: reformattedSources(list) });

test('createReversedList: a REAL reversed array (descriptors agree with reads, no Proxy), source untouched', () => {
  const src = ['a', 'b', 'c'];
  const v = createReversedList<string>()(src);
  assert.equal(Array.isArray(v), true);
  assert.equal(v.length, 3);
  assert.deepEqual([v[0], v[1], v[2], v[3]], ['c', 'b', 'a', undefined]);
  // FlatList / VirtualizedList may read through descriptors or Object.keys: they must match the indexed reads
  assert.equal(Object.getOwnPropertyDescriptor(v, '0')?.value, 'c');
  assert.deepEqual(Object.keys(v), ['0', '1', '2']);
  assert.equal(v.findIndex((x) => x === 'a'), 2);
  assert.deepEqual(Array.from(v), ['c', 'b', 'a']);
  assert.deepEqual(v.map((x) => x.toUpperCase()), ['C', 'B', 'A']);
  assert.equal(createReversedList<string>()([]).length, 0);
  assert.deepEqual(src, ['a', 'b', 'c']);
});

test('createReversedList: same list → same array; a streaming tick (only the last item changed) → a NEW array', () => {
  const rev = createReversedList<{ id: string; text: string }>();
  const a = { id: 'a', text: 'A' };
  const b1 = { id: 'b', text: 'B' };
  const list1 = [a, b1];
  const r1 = rev(list1);
  assert.equal(rev(list1), r1);
  const b2 = { id: 'b', text: 'B mehr' };
  const r2 = rev([a, b2]);
  // MessageList has no `extraData` (it would defeat FlatList's memoized renderItem): the new data array is what
  // makes the list re-render, the unchanged rows keep their item objects (their memoized cells skip)
  assert.notEqual(r2, r1, 'a new array per change');
  assert.deepEqual(r1, [b1, a], 'the previous array is not mutated');
  assert.deepEqual(r2, [b2, a]);
  assert.equal(r2[1], r1[1]);
  // the stable prefix changed (append / older edit / removal) → a fresh array
  const c = { id: 'c', text: 'C' };
  const r3 = rev([a, b2, c]);
  assert.notEqual(r3, r2);
  assert.deepEqual(r3, [c, b2, a]);
  const a2 = { id: 'a', text: 'A neu' };
  const r4 = rev([a2, b2, c]);
  assert.notEqual(r4, r3);
  assert.deepEqual(r4, [c, b2, a2]);
  assert.deepEqual(rev([a2]), [a2]);
});

test('createReversedList equals [...list].reverse() over random edits', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const rev = createReversedList<M>();
    let list: M[] = [];
    for (let step = 0; step < 60; step++) {
      const op = r();
      if (op < 0.45 || !list.length) list = [...list, randomMessage(r, step)];
      else if (op < 0.8) list = [...list.slice(0, -1), { ...list[list.length - 1], text: 'x' + step }];
      else if (op < 0.9) list = list.map((m, i) => (i === 0 ? { ...m } : m));
      else list = list.slice(0, Math.max(0, list.length - 1 - Math.floor(r() * 3)));
      assert.deepEqual(rev(list), [...list].reverse(), `seed ${seed} step ${step}`);
    }
  }
});

test('createListDerive equals the full scans for random transcripts, appends and streaming ticks', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const derive = createListDerive<M>();
    let list: M[] = [];
    for (let step = 0; step < 60; step++) {
      const op = r();
      if (op < 0.45 || !list.length) list = [...list, randomMessage(r, step)];
      else if (op < 0.8) {
        // streaming tick: only the last message object changes
        const last = list[list.length - 1];
        list = [...list.slice(0, -1), { ...last, text: last.text + ' mehr' }];
      } else if (op < 0.9 && list.length > 2) {
        // an older message changed (e.g. reconcile / edit)
        const k = Math.floor(r() * (list.length - 1));
        list = list.map((m, i) => (i === k ? { ...m, text: m.role === 'assistant' ? `neu ${step}` : m.text } : m));
      } else list = list.slice(0, Math.max(0, list.length - 1 - Math.floor(r() * 3)));
      const got = derive(list);
      const want = expected(list);
      assert.deepEqual([...got.editPairs].sort(), [...want.editPairs].sort(), `seed ${seed} step ${step} pairs`);
      assert.deepEqual([...got.reformatted].sort(), [...want.reformatted].sort(), `seed ${seed} step ${step} reformatted`);
    }
  }
});

test('streaming ticks keep the prefix results by identity (no rescans)', () => {
  const derive = createListDerive<M>();
  const base: M[] = [
    { id: 'u1', role: 'user', text: 'Hallo' },
    { id: 'a1', role: 'assistant', text: 'Hi' },
    { id: 'u2', role: 'user', text: '[reformat:table] Als Tabelle' },
  ];
  const a = derive([...base, { id: 'a2', role: 'assistant', text: 'x' }]);
  const b = derive([...base, { id: 'a2', role: 'assistant', text: 'xy' }]);
  assert.equal(a.reformatted, b.reformatted);
  assert.equal(a.editPairs, b.editPairs);
  assert.deepEqual([...b.reformatted], ['a1']);
  // the request itself as the last message is recognised from the tail
  const c = createListDerive<M>()(base);
  assert.deepEqual([...c.reformatted], ['a1']);
  // edit answer streaming right after an edit request
  const edit: M[] = [{ id: 'u9', role: 'user', text: 'mach es bunt', attachments: [img('p')] }, { id: 'a9', role: 'assistant', text: '' }];
  assert.equal(createListDerive<M>()(edit).editPairs.get('a9'), 'file:///p.png');
});

test('MessageList: FlatList memoizes its item renderer (strictMode) and gets no per-tick extraData', () => {
  // FlatList passes `renderItem` through memoizeOne(ListItemComponent, renderItem, columnWrapperStyle, numColumns,
  // extraData) only with `strictMode`; without it (or with `extraData={messages}`) every streaming tick gives every
  // mounted row a new renderItem prop and re-renders them all
  const src = readFileSync(new URL('./MessageList.tsx', import.meta.url), 'utf8');
  const at = src.indexOf('<FlatList\n');
  assert.ok(at > 0);
  const flatList = src.slice(at, src.indexOf('/>', at));
  assert.match(flatList, /\n\s*strictMode\n/);
  assert.doesNotMatch(flatList, /extraData/);
});

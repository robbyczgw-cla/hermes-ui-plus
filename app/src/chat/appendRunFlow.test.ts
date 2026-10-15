/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createAssistantMessage, textAppendRun } from '../hermes/chatState.ts';
import type { ChatMessage, HermesEvent } from '../hermes/types.ts';
import { segmentAppendRun } from '../protocol/streamParser.ts';
import { parseMarkdown, parseMarkdownIncremental, type MdParseState } from './markdown.ts';
import { createMediaTagCache, extractMedia, extractMediaCached } from './mediaTags.ts';
import { advanceSegments, type SegmentsState } from './parseCache.ts';

function rng(seed: number) {
  let s = seed;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

test('chatState append run: text deltas continue it, textReplace and copies made elsewhere end it', () => {
  let m: ChatMessage = createAssistantMessage(0);
  assert.equal(textAppendRun(m), undefined);
  m = applyEvent(m, { type: 'text', text: 'Hallo' }, 1);
  const run = textAppendRun(m);
  assert.ok(run);
  m = applyEvent(m, { type: 'text', text: ' Welt' }, 2);
  assert.equal(textAppendRun(m), run);
  m = applyEvent(m, { type: 'status', kind: 'x', text: 'denkt' }, 3); // text untouched: same run
  assert.equal(textAppendRun(m), run);
  m = applyEvent(m, { type: 'tool', callId: 'c1', name: 'web', status: 'running' }, 4);
  assert.equal(textAppendRun(m), run);
  const copy = { ...m, text: 'ganz anders' }; // any text change outside applyEvent: no run
  assert.equal(textAppendRun(copy), undefined);
  m = applyEvent(m, { type: 'textReplace', text: 'Neu' }, 5);
  assert.equal(textAppendRun(m), undefined);
  m = applyEvent(m, { type: 'text', text: ' weiter' }, 6);
  assert.ok(textAppendRun(m));
  assert.notEqual(textAppendRun(m), run);
});

const DELTAS = [
  'Absatz mit Text ', 'mehr. ', '\n', '\n\n', '- punkt\n', '```js\nx = 1;\n```\n', '```hui\n{"type":"text","text":"k"}\n```\n', '> zitat\n',
  'MEDIA:/tmp/a.png\n', 'Datei MEDIA:/tmp/b.pdf ok\n', '| A | B |\n|---|---|\n| 1 | 2 |\n', '# Titel\n', '\r\n', 'ü😀 ', '[[audio_as_voice]]\n',
];

test('append runs end to end: segments, MEDIA tags and markdown equal the full computations at every update', () => {
  const r = rng(3);
  for (let k = 0; k < 120; k++) {
    let msg: ChatMessage = createAssistantMessage(0);
    let segState: SegmentsState | null = null;
    const media = createMediaTagCache();
    const md = new Map<string, MdParseState>();
    for (let step = 0; step < 50; step++) {
      const x = r();
      const ev: HermesEvent =
        x < 0.06 ? { type: 'textReplace', text: msg.text.slice(0, Math.floor(r() * msg.text.length)) + 'korrigiert ' }
        : x < 0.12 ? { type: 'tool', callId: `c${step}`, name: 'web', status: 'running' }
        : { type: 'text', text: DELTAS[Math.floor(r() * DELTAS.length)].slice(0, 1 + Math.floor(r() * 20)) };
      msg = applyEvent(msg, ev, step);
      if (r() < 0.3) continue; // throttled: not every event reaches a render
      const run = textAppendRun(msg);
      const m = extractMediaCached(msg.text, true, media, run);
      const want = extractMedia(msg.text, true);
      assert.deepEqual({ refs: m.refs.map((x) => x.path), text: m.text }, { refs: want.refs.map((x) => x.path), text: want.text });
      segState = advanceSegments(segState, m.text, false, undefined, m.text === msg.text ? run : undefined);
      const fresh = advanceSegments(null, m.text, false);
      assert.deepEqual(segState.segs, fresh.segs);
      for (const seg of segState.segs) {
        if (seg.kind !== 'markdown') continue;
        const st = parseMarkdownIncremental(seg.text, md.get(seg.key), segmentAppendRun(seg));
        md.set(seg.key, st);
        assert.deepEqual(st.blocks, parseMarkdown(seg.text));
      }
    }
  }
});

test('append runs: a token that is reused wrongly is caught at the old end, CRs in the new part take the full path', () => {
  const run = {};
  const head = '# Titel\n\nAbsatz eins.\n\n- a\n- b\n\nAbsatz zwei.\n\n';
  const a = parseMarkdownIncremental(head + 'Drei Wörter', null, run);
  assert.ok(a.stable > 0); // the head is reused on the next update
  // same token, but the old end changed ("Wörter" → "WÖrter"): the tail compare refuses the shortcut
  const b = parseMarkdownIncremental(head + 'Drei WÖrter und mehr', a, run);
  assert.deepEqual(b.blocks, parseMarkdown(b.text));
  const last = b.blocks.at(-1);
  assert.equal(last?.type === 'paragraph' ? last.text : '', 'Drei WÖrter und mehr');
  const c = parseMarkdownIncremental(b.text + '\r\nfünf\r\n', b, run);
  assert.equal(c.cr, true);
  assert.deepEqual(c.blocks, parseMarkdown(c.text));
  const d = parseMarkdownIncremental(c.text + 'sechs', c, run);
  assert.deepEqual(d.blocks, parseMarkdown(d.text));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStreamParser } from './streamParser.ts';
import { emptyNodeLabel, isEmptyNode } from './emptyNode.ts';
import { RENDER_FIXTURES } from '../ui/renderFixtures.ts';
import { GALLERY_SAMPLES } from '../ui/galleryData.ts';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'hermes-skill', 'examples');

function nodesOf(text: string): unknown[] {
  const p = createStreamParser();
  p.push(text);
  p.end();
  const out: unknown[] = [];
  const walk = (x: unknown, d = 0) => {
    if (!x || typeof x !== 'object' || d > 12) return;
    if (Array.isArray(x)) return x.forEach((y) => walk(y, d + 1));
    if (typeof (x as { type?: unknown }).type === 'string') out.push(x);
    Object.values(x).forEach((y) => walk(y, d + 1));
  };
  for (const s of p.segments()) if (s.kind === 'hui' && s.node && !s.fallback) walk(s.node);
  return out;
}

test('isEmptyNode: bare nodes and empty lists of the sweep are empty', () => {
  for (const id of ['text-bare', 'stack-empty-children', 'table-bare', 'poll-empty-options', 'card-bare', 'gallery-empty-items', 'terminal-bare', 'mindmap-bare', 'weather-empty-days', 'translation-bare']) {
    const f = RENDER_FIXTURES.find((x) => x.id === id)!;
    const nodes = nodesOf('```hui\n' + f.raw + '\n```\n');
    assert.ok(nodes.length === 0 || isEmptyNode(nodes[0]), id);
  }
});

test('isEmptyNode: types with their own empty state are never flagged', () => {
  for (const type of ['chart', 'checklist', 'products', 'places', 'quiz', 'timer', 'image', 'progress']) assert.equal(isEmptyNode({ type }), false, type);
  assert.equal(isEmptyNode(null), false);
  assert.equal(isEmptyNode({ type: 'unknown-thing' }), false);
});

test('isEmptyNode: one filled content field is enough (title-only card, question with options, nested objects)', () => {
  assert.equal(isEmptyNode({ type: 'card', title: 'Hi', children: [] }), false);
  assert.equal(isEmptyNode({ type: 'translation', source: { text: 'Hallo', lang: 'de' }, targets: [] }), false);
  assert.equal(isEmptyNode({ type: 'translation', source: { text: ' ', lang: 'und' }, targets: [] }), true);
  assert.equal(isEmptyNode({ type: 'terminal', command: 'ls' }), false);
  assert.equal(isEmptyNode({ type: 'poll', question: 'Wann?', options: [] }), true);
  assert.equal(emptyNodeLabel({ type: 'poll', question: 'Wann?', options: [] }), 'Wann?');
  assert.equal(emptyNodeLabel({ type: 'stack' }), undefined);
});

test('isEmptyNode: no false alarm on any node of the skill examples or the component gallery samples', () => {
  const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 20);
  let checked = 0;
  for (const f of files) {
    // the examples show answers inside an outer ````markdown fence: unwrap it so the ```hui blocks parse
    const text = readFileSync(join(EXAMPLES, f), 'utf8').replace(/^````[a-z]*[ \t]*$/gm, '');
    for (const n of nodesOf(text)) {
      checked++;
      assert.equal(isEmptyNode(n), false, `${f}: ${JSON.stringify(n).slice(0, 120)}`);
    }
  }
  for (const s of GALLERY_SAMPLES) {
    for (const n of nodesOf('```hui\n' + JSON.stringify(s.node) + '\n```\n')) {
      checked++;
      assert.equal(isEmptyNode(n), false, `gallery sample ${s.title}: ${JSON.stringify(n).slice(0, 120)}`);
    }
  }
  assert.ok(checked > 100, `checked ${checked} nodes`);
});

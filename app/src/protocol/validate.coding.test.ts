import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode, MAX_TERMINAL_OUTPUT, MAX_DIFF_LINES, normalizeFileStatus } from './validate.ts';
import { createStreamParser, parseMessage, TEXT_FENCE_TYPES, TYPED_FENCE_TYPES, textFenceNode } from './streamParser.ts';
import { INTERACTIVE_NODE_TYPES, isKnownNodeType, type Segment } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
const n = (x: unknown) => normalizeNode(x) as A;

test('registry: diff / terminal / changes are known; changes keeps state (id), diff / terminal do not', () => {
  for (const t of ['diff', 'terminal', 'changes']) assert.ok(isKnownNodeType(t), t);
  assert.ok(INTERACTIVE_NODE_TYPES.has('changes' as never));
  assert.ok(!INTERACTIVE_NODE_TYPES.has('diff' as never));
  assert.equal(n({ type: 'changes', files: ['a.ts'] }).id, 'changes-n');
  for (const f of ['changes', 'diff', 'patch', 'terminal']) assert.ok(TYPED_FENCE_TYPES.has(f));
  assert.deepEqual([...TEXT_FENCE_TYPES].sort(), ['diff', 'patch', 'terminal']);
});

test('diff: patch kept verbatim, files normalized (aliases, statuses, line objects, a/ b/ prefixes), root file shorthand', () => {
  const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  assert.deepEqual(n({ type: 'diff', patch }), { type: 'diff', patch });
  assert.deepEqual(n({ type: 'unified-diff', diff: patch }).patch, patch);
  const d = n({
    type: 'diff',
    title: 'T',
    view: 'side-by-side',
    diffs: [
      { file: 'b/src/a.ts', status: 'created', hunks: [{ old_start: '3', newStart: 3, lines: [' x', { type: 'add', text: 'y' }, { op: '-', content: 'z' }, ''] }] },
      { from: 'old.ts', to: 'new.ts' },
      { status: 'modified' },
    ],
  });
  assert.equal(d.view, 'split');
  assert.deepEqual(d.files, [
    { path: 'src/a.ts', status: 'added', hunks: [{ oldStart: 3, newStart: 3, lines: [' x', '+y', '-z', ' '] }] },
    { path: 'new.ts', oldPath: 'old.ts', status: 'renamed' },
  ]);
  assert.deepEqual(n({ type: 'diff', path: 'a.ts', before: 'a', after: 'b' }), { type: 'diff', files: [{ path: 'a.ts', before: 'a', after: 'b' }] });
  const big = n({ type: 'diff', files: [{ path: 'a', hunks: [{ oldStart: 1, newStart: 1, lines: Array.from({ length: MAX_DIFF_LINES + 50 }, () => '+x') }] }] });
  assert.equal(big.files[0].hunks[0].lines.length, MAX_DIFF_LINES);
  assert.equal(normalizeFileStatus('M'), 'modified');
  assert.equal(normalizeFileStatus('moved'), 'renamed');
  assert.equal(normalizeFileStatus('weird'), undefined);
});

test('terminal: aliases, prompt stripped, exit code / duration forms, status words, output tail kept', () => {
  const t = n({ type: 'shell', cmd: '$ npm test', stdout: 'ok\n', exit_code: '1', duration: '1.5s', status: 'failed', cwd: '~/p' });
  assert.deepEqual(t, { type: 'terminal', command: 'npm test', cwd: '~/p', output: 'ok\n', exitCode: 1, durationMs: 1500, status: 'error' });
  assert.equal(n({ type: 'terminal', command: 'x', duration: '2m 5s' }).durationMs, 125_000);
  assert.equal(n({ type: 'terminal', command: 'x', duration: 0.35 }).durationMs, 350);
  assert.equal(n({ type: 'terminal', command: 'x', durationMs: 42 }).durationMs, 42);
  assert.equal(n({ type: 'terminal', stdout: 'a', stderr: 'b' }).output, 'a\nb');
  assert.equal(n({ type: 'terminal', command: 'x', status: 'in_progress' }).status, 'running');
  const long = 'line\n'.repeat(MAX_TERMINAL_OUTPUT / 5 + 100);
  const cut = n({ type: 'terminal', output: long, outputStart: 10 });
  assert.ok(cut.output.length <= MAX_TERMINAL_OUTPUT);
  assert.ok(cut.output.startsWith('line\n'), 'cut at a line start');
  assert.equal(cut.truncated, long.length - cut.output.length);
  assert.equal(cut.outputStart, 10 + cut.truncated);
  assert.equal(n({ type: 'terminal', output: 'x', truncated: true }).truncated, true);
});

test('changes: files from objects and git-status-like strings, counts, agent flags, combined patch', () => {
  const c = n({ type: 'changed-files', id: 'c1', summary: 'S', agent: 'Pi', items: ['M src/a.ts', 'R old.ts -> new.ts', '?? notes.md', { file: 'b.ts', status: 'removed', insertions: 0, deletions: '7', agent: true }], diff: 'P' });
  assert.deepEqual(c, {
    type: 'changes',
    id: 'c1',
    summary: 'S',
    files: [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'new.ts', oldPath: 'old.ts', status: 'renamed' },
      { path: 'notes.md', status: 'added' },
      { path: 'b.ts', status: 'deleted', additions: 0, deletions: 7, byAgent: true },
    ],
    patch: 'P',
    agent: 'Pi',
  });
});

test('fences: ```diff / ```patch text → diff node, ```terminal "$ cmd" → terminal, ```changes JSON, empty fence stays code', () => {
  const msg = 'Fix:\n\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```\n\n```terminal\n$ npm test\nok\n```\n\n```changes\n{"id":"c","files":["M a.ts"]}\n```\n\n```diff\n```\n';
  const segs = parseMessage(msg);
  const huis = segs.filter((s): s is Extract<Segment, { kind: 'hui' }> => s.kind === 'hui');
  assert.deepEqual(huis.map((s) => (s.node as A).type), ['diff', 'terminal', 'changes']);
  assert.equal((huis[0].node as A).patch, '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b');
  assert.deepEqual(huis[1].node, { type: 'terminal', command: 'npm test', output: 'ok' });
  assert.equal(segs[segs.length - 1].kind, 'markdown', 'empty ```diff stays a code block');
  assert.deepEqual(textFenceNode('terminal', 'just output'), { type: 'terminal', output: 'just output' });
  assert.deepEqual(textFenceNode('patch', '-a'), { type: 'diff', patch: '-a' });
  // optional last line `[exit N]` / `[exit N, 4.2s]` → exit code (+ duration); elsewhere it is output
  assert.deepEqual(textFenceNode('terminal', '$ npm test\nok\n[exit 1]'), { type: 'terminal', exitCode: 1, command: 'npm test', output: 'ok' });
  assert.deepEqual(textFenceNode('terminal', '$ make\n[exit 0, 4.2s]\n'), { type: 'terminal', exitCode: 0, duration: '4.2s', command: 'make' });
  assert.deepEqual(textFenceNode('terminal', '$ x\nsaid [exit 1]'), { type: 'terminal', command: 'x', output: 'said [exit 1]' });
  const tn = (parseMessage('```terminal\n$ npm test\nfail\n[exit 2 · 1m 5s]\n```\n').find((s) => s.kind === 'hui') as A).node;
  assert.deepEqual([tn.exitCode, tn.durationMs, tn.output], [2, 65_000, 'fail']);
  // a JSON object inside ```diff is a node like any typed fence
  const j = parseMessage('```diff\n{"files":[{"path":"a","before":"x","after":"y"}]}\n```\n').find((s) => s.kind === 'hui') as A;
  assert.equal(j.node.files[0].path, 'a');
  // ```bash / ```console stay code
  assert.ok(parseMessage('```console\n$ ls\n```\n').every((s) => s.kind === 'markdown'));
});

test('fences: a streaming ```diff grows on every push (no rebuild rate limit), the segment key stays', () => {
  let clock = 0;
  const p = createStreamParser({ now: () => clock });
  p.push('Intro\n\n```diff\n');
  const body = Array.from({ length: 1500 }, (_, i) => `+line ${i}`).join('\n') + '\n';
  let last = '';
  let key = '';
  for (let i = 0; i < body.length; i += 64) {
    const segs = p.push(body.slice(i, i + 64));
    const s = segs[segs.length - 1] as A;
    assert.equal(s.kind, 'hui');
    key ||= s.key;
    assert.equal(s.key, key);
    assert.ok((s.node.patch ?? '').length >= last.length);
    last = s.node.patch ?? '';
  }
  assert.ok(body.length > 8192 && last.length >= body.length - 64, 'a big open block still updates on every push');
  const end = p.push('```\n');
  assert.equal((end[end.length - 1] as A).complete, true);
});

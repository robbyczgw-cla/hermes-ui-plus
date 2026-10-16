import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_EN, callOutcome, formatDuration, patchCounts, stepSummary, type StepInput } from './outcome.ts';
import { dictionaries, makeT } from '../i18n/core.ts';

const PATCH = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,4 +1,5 @@', ' keep', '-old', '+new', '+++counter', '--x'].join('\n');

test('patchCounts: unified hunks without file headers, edit cards via diffCounts', () => {
  assert.deepEqual(patchCounts(PATCH), { added: 2, removed: 2 });
  const two = `${PATCH}\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-1\n+2`;
  assert.deepEqual(patchCounts(two), { added: 3, removed: 3 });
  assert.deepEqual(patchCounts('  1 a\n-2 b\n+2 c\n+3 d'), { added: 2, removed: 1 });
  assert.equal(patchCounts(undefined), null);
});

test('edits and writes: a diff chip with both counts', () => {
  const edit = callOutcome({ name: 'edit', args: { path: 'src/a.ts' }, isError: false, text: 'ok', view: { kind: 'diff', path: 'src/a.ts', patch: PATCH } });
  assert.deepEqual(edit, { tone: 'good', kind: 'diff', label: '+2 −2', added: 2, removed: 2, a11y: '2 lines added, 2 removed' });
  assert.equal(callOutcome({ name: 'edit', isError: false, text: 'ok', details: { diff: '+1 a\n+2 b\n-1 c' } }).label, '+2 −1');
  assert.equal(callOutcome({ name: 'edit', isError: false, text: 'ok' }).kind, 'none');
  assert.equal(callOutcome({ name: 'write', args: { path: 'n.ts', content: 'a\nb\nc\n' }, isError: false, text: 'Wrote' }).label, '+3 −0');
});

test('reads, greps, finds', () => {
  const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
  assert.deepEqual(callOutcome({ name: 'read', isError: false, text: `${lines}\n\n[380 more lines in file. Use offset=121 to continue]` }), { tone: 'neutral', kind: 'read', label: 'read 120 lines' });
  assert.equal(callOutcome({ name: 'read', isError: false, text: 'x' }).label, 'read 1 line');
  assert.equal(callOutcome({ name: 'read', isError: false, text: '', view: { kind: 'read', path: 'a', lines: '1-200' } }).label, 'read 200 lines');
  assert.deepEqual(callOutcome({ name: 'grep', isError: false, text: 'a.ts:3: x\na.ts-4- y\nb.ts:9: w\nc.ts:1: z\nc.ts:2: z\nc.ts:5: z\nd.ts:7: z\nd.ts:8: z' }), {
    tone: 'neutral',
    kind: 'matches',
    label: '7 matches',
  });
  assert.equal(callOutcome({ name: 'grep', isError: false, text: 'a:1: x' }).label, '1 match');
  assert.equal(callOutcome({ name: 'grep', isError: false, text: 'No matches found' }).label, 'no matches');
  assert.equal(callOutcome({ name: 'ls', isError: false, text: 'a\nb/\n' }).label, '2 entries');
  assert.equal(callOutcome({ name: 'find', isError: false, text: 'No files found' }).label, 'none');
});

test('bash: test runs, exit codes, output', () => {
  const jest = 'Tests:       1 failed, 47 passed, 48 total\nTime:        3.1 s\n\nCommand exited with code 1';
  assert.deepEqual(callOutcome({ name: 'bash', args: { command: 'npm test' }, isError: true, text: jest }), { tone: 'bad', kind: 'tests', label: '47 passed / 1 failed' });
  assert.deepEqual(callOutcome({ name: 'bash', args: { command: 'node --test' }, isError: false, text: 'ℹ pass 48\nℹ fail 0' }), { tone: 'good', kind: 'tests', label: '48 passed' });
  assert.deepEqual(callOutcome({ name: 'bash', args: { command: 'make' }, isError: true, text: 'boom\n\nCommand exited with code 2' }), { tone: 'bad', kind: 'exit', label: 'exit 2' });
  assert.equal(callOutcome({ name: 'bash', args: { command: 'false' }, isError: false, text: '', view: { kind: 'terminal', command: 'false', exitCode: 1, output: '' } }).label, 'exit 1');
  assert.equal(callOutcome({ name: 'bash', args: { command: 'ls' }, isError: false, text: 'a\nb\n' }).label, '2 lines');
  assert.equal(callOutcome({ name: 'bash', args: { command: 'true' }, isError: false, text: '' }).label, 'no output');
  assert.equal(callOutcome({ name: 'bash', args: { command: 'cat x' }, isError: false, text: 'x', view: { kind: 'terminal', truncated: true } }).label, 'long output');
  // the command and output can come from the view alone
  assert.equal(callOutcome({ name: 'bash', isError: false, view: { kind: 'terminal', command: 'pytest', exitCode: 0, output: '5 passed in 0.1s' } }).label, '5 passed');
});

test('errors, stops, approvals, running', () => {
  assert.deepEqual(callOutcome({ name: 'grep', isError: true, text: '<harness>\n[error] Tool grep is not available\n</harness>' }), { tone: 'bad', kind: 'error', label: 'Tool grep is not available' });
  assert.deepEqual(callOutcome({ name: 'bash', isError: true, text: 'Command timed out after 60s' }), { tone: 'bad', kind: 'error', label: 'timed out' });
  assert.deepEqual(callOutcome({ name: 'bash', isError: true, text: 'out\n\nCommand aborted' }), { tone: 'neutral', kind: 'stopped', label: 'stopped' });
  assert.equal(callOutcome({ name: 'edit', isError: true, text: '<harness>\n[error] Tool edit was interrupted and may have partially run\n</harness>' }).label, 'cut off by a restart');
  assert.deepEqual(callOutcome({ name: 'bash', args: { command: 'rm -rf build' }, pending: true }), { tone: 'warn', kind: 'approval', label: 'needs approval' });
  assert.equal(callOutcome({ name: 'bash', approval: { status: 'pending' } }).label, 'needs approval');
  assert.equal(callOutcome({ name: 'bash', approval: { status: 'denied' }, isError: true, text: 'denied' }).label, 'denied');
  assert.deepEqual(callOutcome({ name: 'bash', args: { command: 'sleep 5' } }), { tone: 'neutral', kind: 'none', label: '' });
});

test('formatDuration', () => {
  assert.equal(formatDuration(400), '<1s');
  assert.equal(formatDuration(18_200), '18s');
  assert.equal(formatDuration(125_000), '2m 5s');
});

const GROUP: StepInput[] = [
  { kind: 'thinking' },
  { kind: 'tool', id: '1', name: 'read', args: { path: 'a.ts' }, isError: false, text: 'a\nb' },
  { kind: 'tool', id: '2', name: 'read', args: { path: 'b.ts' }, isError: false, text: 'a' },
  { kind: 'tool', id: '3', name: 'read', args: { path: 'c.ts' }, isError: false, text: 'a' },
  { kind: 'tool', id: '4', name: 'edit', args: { path: 'a.ts' }, isError: false, text: 'ok', view: { kind: 'diff', patch: '@@ -1 +1,3 @@\n-a\n+b\n+c\n+d' } },
  { kind: 'tool', id: '5', name: 'edit', args: { path: 'b.ts' }, isError: false, text: 'ok', view: { kind: 'diff', patch: '@@ -1,2 +1 @@\n-a\n-b\n+c' } },
  { kind: 'tool', id: '6', name: 'bash', args: { command: 'npm test' }, isError: true, text: 'ℹ pass 48\nℹ fail 1\n\nCommand exited with code 1' },
  { kind: 'tool', id: '7', name: 'bash', args: { command: 'make lint' }, isError: true, text: 'Command exited with code 2' },
  { kind: 'tool', id: '8', name: 'bash', args: { command: 'git push' }, pending: true },
];

test('stepSummary: the line, its duration and the group chips', () => {
  const s = stepSummary(GROUP, { durationMs: 18_000 });
  assert.equal(s.line, 'Thought, read 3 files, edited 2, ran 3 commands');
  assert.equal(s.duration, '18s');
  assert.deepEqual(
    s.chips.map((c) => [c.kind, c.tone, c.label]),
    [
      ['diff', 'good', '+4 −3'],
      ['tests', 'bad', '48 passed / 1 failed'],
      ['exit', 'bad', 'exit 2'],
      ['approval', 'warn', 'needs approval'],
    ],
  );
  assert.equal(s.a11y, 'Thought, read 3 files, edited 2, ran 3 commands, 18s. 4 lines added, 3 removed. 48 passed / 1 failed. exit 2. needs approval');
  assert.equal(stepSummary([{ kind: 'thinking' }], { thinking: true }).line, 'Thinking');
  assert.equal(stepSummary([]).duration, undefined);
  const waiting = stepSummary([GROUP[8], { ...GROUP[8], id: '9' }] as StepInput[]);
  assert.deepEqual(waiting.chips.map((c) => c.label), ['2 need approval']);
});

test('stepSummary in German through the dictionary', () => {
  const de = makeT('de', 'de-DE');
  const s = stepSummary(GROUP, { durationMs: 18_000 }, (key, vars) => de(`ui.steps.${key}` as never, vars));
  assert.equal(s.line, 'Nachgedacht, 3 Dateien gelesen, 2 bearbeitet, 3 Befehle ausgeführt');
  assert.equal(s.duration, '18 s');
  assert.deepEqual(s.chips.map((c) => c.label), ['+4 −3', '48 bestanden / 1 fehlgeschlagen', 'Exit 2', 'wartet auf Freigabe']);
});

test("the English dictionary's chip labels are OUTCOME_EN", () => {
  const { out, dur } = dictionaries.en.ui.steps;
  assert.deepEqual({ out, dur }, OUTCOME_EN);
});

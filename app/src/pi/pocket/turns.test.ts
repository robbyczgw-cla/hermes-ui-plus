// Ported from Pi Pocket `test/turns.test.ts` (github.com/TannerMidd/pi-pocket, commit de612d5), MIT,
// © 2026 Tanner Middleton – see NOTICE.md. The `itemsOf` / `rowsBefore` cases are left out
// (those functions are not ported).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOPPED, SUMMARY_EN, diffCounts, formatSummary, lineCount, matchCount, plural, short, shortError, summarize, summaryParts, testCounts, testOutcome, withoutNotes, type StepBlock } from './turns.ts';
import { dictionaries, makeT } from '../../i18n/core.ts';

const call = (id: string, name = 'bash', args: Record<string, unknown> = {}): StepBlock => ({ type: 'toolCall', id, name, args });
const thought: StepBlock = { type: 'thinking', text: 'hmm' };
const steps = (blocks: StepBlock[]) => blocks.map((block) => ({ block }));

test("a group's line says what its calls did, in the order Pi did them", () => {
  assert.equal(
    summarize(steps([thought, call('1', 'grep'), call('2', 'read', { path: 'a' }), call('3', 'read', { path: 'b' }), call('4', 'bash')])),
    'Thought, searched, read 2 files, ran 1 command',
  );
  assert.equal(
    summarize(
      steps([
        call('1', 'edit', { path: 'a' }),
        call('2', 'write', { path: 'b' }),
        call('3', 'subagent', { action: 'spawn', name: 'tests' }),
        call('4', 'bash'),
        call('5', 'bash'),
      ]),
    ),
    'Edited 1 file, wrote 1, ran a subagent and 2 commands',
  );
  assert.equal(summarize(steps([thought]), true), 'Thinking');
});

test("PiP's watches read as what they did, not as the tool's name", () => {
  assert.equal(summarize(steps([call('1', 'repo_watch', { action: 'add', repo: 'acme/api' })])), 'Set up a repository watch');
  assert.equal(
    summarize(steps([call('1', 'repo_watch', { action: 'list' }), call('2', 'repo_watch', { action: 'remove', id: 'w1' })])),
    'Checked repository watches, removed a repository watch',
  );
  assert.equal(
    summarize(steps([call('1', 'session_watch_pr', { action: 'start', session: 3 }), call('2', 'session_watch_pr', { action: 'stop', session: 3 })])),
    'Watched a pull request, stopped watching the PR',
  );
});

test('test runs read as how many passed, from each runner\'s own count', () => {
  assert.equal(testOutcome('ℹ tests 11\nℹ pass 11\nℹ fail 0\nℹ duration_ms 265.2', 'node --test'), '11 passed · 0.3s');
  assert.equal(
    testOutcome('Test Suites: 2 passed, 2 total\nTests:       1 failed, 47 passed, 48 total\nTime:        3.1 s', 'npm test'),
    '47 passed · 1 failed · 3.1s',
  );
  assert.equal(testOutcome(' Test Files  1 passed (1)\n      Tests  3 passed (3)', 'npx vitest run'), '3 passed');
  assert.equal(testOutcome('===== 5 passed in 0.12s =====', 'pytest -q'), '5 passed · 0.1s');
  assert.equal(testOutcome('3 passed the review', 'git log'), null);
});

test('what tools printed is counted as it is meant', () => {
  // Grep's matches, not the lines around them.
  assert.equal(matchCount('a.ts:3: x\na.ts-4- y\na.ts-2- z\nb-1-c.ts:9: w'), 2);
  assert.equal(matchCount('a.ts:1: x\nb.ts:2: y'), 2);
  assert.equal(withoutNotes('a\nb\n\n[1000 results limit reached. Use limit=2000]'), 'a\nb');
  assert.deepEqual(diffCounts('  1 a\n-2 b\n+2 c\n+3 d'), { added: 2, removed: 1 });
  assert.equal(shortError('out\n\nCommand exited with code 3'), 'exit 3');
  assert.equal(shortError('<harness>\n[error] Tool grep is not available\n</harness>'), 'Tool grep is not available');

  for (const stopped of [
    '<harness>\n[error] Tool bash was aborted\n</harness>',
    '<harness>\n[error] Tool edit was interrupted and may have partially run\n</harness>',
    'Operation aborted',
    'some output\n\nCommand aborted',
  ]) {
    assert.ok(STOPPED.test(stopped), stopped);
  }

  assert.ok(!STOPPED.test('the build was aborted by a flag'));
});

// ── additions (not in Pocket) ──

test('small helpers keep Pocket\'s behaviour', () => {
  assert.equal(short('  a\n\n b  '), 'a b');
  assert.equal(short('abcdef', 4), 'abc…');
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(2, 'file'), '2 files');
  assert.equal(diffCounts(undefined), null);
  assert.deepEqual(diffCounts('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b'), { added: 1, removed: 1 });
  assert.equal(shortError('Error: timed out after 30s'), 'timed out');
  assert.equal(shortError('error: no such file'), 'no such file');
  assert.equal(shortError(''), 'failed');
  assert.deepEqual(testCounts('Tests: 1 failed, 47 passed, 48 total', 'npm test'), { passed: 47, failed: 1 });
});

test('unknown tools say "used <tool>", each its own clause; subagent checks read as such', () => {
  assert.equal(summarize(steps([call('1', 'mcp_x'), call('2', 'mcp_y'), call('3', 'mcp_x')])), 'Used mcp_x, used mcp_y');
  assert.equal(summarize(steps([call('1', 'subagent', { action: 'status' })])), 'Checked on subagents');
  // The same path twice is one file.
  assert.equal(summarize(steps([call('1', 'read', { path: 'a' }), call('2', 'read', { path: 'a' })])), 'Read 1 file');
  assert.equal(summarize([]), '');
});

test('summaryParts is the structure behind the line', () => {
  assert.deepEqual(summaryParts(steps([thought, call('1', 'edit', { path: 'a' }), call('2', 'write', { path: 'b' }), call('3', 'tool_z')])), [
    { verb: 'thought', counts: [] },
    { verb: 'edited', counts: [{ noun: 'file', count: 1, bare: false }] },
    { verb: 'wrote', counts: [{ noun: 'file', count: 1, bare: true }] },
    { verb: 'used', tool: 'tool_z', counts: [] },
  ]);
});

test('the line translates through tr (German and Spanish dictionaries)', () => {
  const parts = summaryParts(steps([thought, call('1', 'grep'), call('2', 'read', { path: 'a' }), call('3', 'read', { path: 'b' }), call('4', 'bash'), call('5', 'subagent', { action: 'spawn', name: 'x' })]));
  const de = makeT('de', 'de-DE');
  const es = makeT('es', 'es-ES');
  assert.equal(
    formatSummary(parts, (key, vars) => de(`ui.steps.${key}` as never, vars)),
    'Nachgedacht, gesucht, 2 Dateien gelesen, 1 Befehl und einen Subagenten ausgeführt',
  );
  assert.equal(
    formatSummary(parts, (key, vars) => es(`ui.steps.${key}` as never, vars)),
    'Pensó, buscó, leyó 2 archivos, ejecutó 1 comando y un subagente',
  );
});

test("the English dictionary's words are Pocket's (SUMMARY_EN)", () => {
  const { and, verb, noun, a } = dictionaries.en.ui.steps;
  assert.deepEqual({ and, verb, noun, a }, SUMMARY_EN);
});

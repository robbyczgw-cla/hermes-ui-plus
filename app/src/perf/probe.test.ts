import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('./probe.ts', import.meta.url));
/** runs `code` against a fresh probe module with EXPO_PUBLIC_HUI_PERF=level; returns the HUIPERF records it logged */
function run(level: string, code: string) {
  const script = `const p = await import(${JSON.stringify(probe)});\n${code}`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, EXPO_PUBLIC_HUI_PERF: level },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout
    .split('\n')
    .filter((l) => l.startsWith('HUIPERF '))
    .map((l) => JSON.parse(l.slice(8)));
}

const TURN = `
p.perfTurnStart();
p.perfMark('request'); p.perfMark('request');
await new Promise((r) => setTimeout(r, 20));
p.perfMark('headers');
p.perfDelta(5); p.perfFlush();
p.perfCommit(5, true, p.perfNow() - 2);
p.perfDelta(7); p.perfFlush();
p.perfSpan('md.parse', p.perfNow() - 1);
p.perfCommit(12, true, p.perfNow() - 3);
p.perfTurnEnd();
p.perfCommit(12, false, p.perfNow());
await new Promise((r) => setTimeout(r, 1300));
`;

test('probe off (normal builds): no records, PERF is false', () => {
  assert.deepEqual(run('', TURN + 'console.log("HUIPERF " + JSON.stringify({ perf: p.PERF }));'), [{ perf: false }]);
});

test('probe on: one turn record with marks, commits, commit lag and spans', () => {
  const recs = run('1', TURN);
  const turns = recs.filter((r) => r.k === 'turn');
  assert.equal(turns.length, 1);
  const t = turns[0];
  assert.equal(t.chars, 12);
  assert.equal(t.deltas, 2);
  assert.equal(t.flushes, 2);
  assert.equal(t.commits, 3);
  assert.equal(t.commitLag.n, 2);
  assert.ok(t.firstDelta >= 15 && t.firstText >= t.firstDelta && t.final >= t.firstText, JSON.stringify(t));
  assert.equal(t.spans['md.parse'].n, 1);
  assert.equal(t.spans['answer.render+commit'].n, 2, 'streaming commits only');
  assert.equal(t.note, undefined);
  assert.ok(t.marks.request <= 2 && t.marks.headers >= 15 && t.marks.headers <= t.firstDelta, JSON.stringify(t.marks));
});

test('probe on: a turn without a final commit still reports (after 3 s), marked', () => {
  const recs = run('1', `p.perfTurnStart(); p.perfDelta(3); p.perfTurnEnd(); await new Promise((r) => setTimeout(r, 4300));`);
  const t = recs.find((r) => r.k === 'turn');
  assert.equal(t?.note, 'no-final-commit');
});

test('probe on: open records only for lists of 20+ messages, once per size bucket', () => {
  const recs = run('1', `p.perfOpen('c', 5, p.perfNow()); p.perfOpen('c', 500, p.perfNow()); p.perfOpen('c', 501, p.perfNow()); await new Promise((r) => setTimeout(r, 3300));`);
  assert.deepEqual(recs.filter((r) => r.k === 'open').map((r) => r.count), [500]);
});

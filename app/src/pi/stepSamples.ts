/**
 * Gallery samples for `StepSummary` (pi-host `tool.end` / `tool.pending` shapes, docs/pi/DESIGN.md §6.4). Fake paths and
 * output only.
 */
import type { StepInput } from './outcome.ts';

export type StepSample = { key: string; label: string; steps: StepInput[]; thinking?: boolean; durationMs?: number };

const PATCH = ['--- a/src/cart.ts', '+++ b/src/cart.ts', '@@ -10,6 +10,9 @@', ' export function total(items) {', '-  return items.reduce((a, b) => a + b.price, 0);', '+  const sum = items.reduce((a, b) => a + b.price * b.qty, 0);', '+  return Math.round(sum * 100) / 100;', '+}', ' '].join('\n');

const read = (id: string, path: string, lines: number): StepInput => ({
  kind: 'tool',
  id,
  name: 'read',
  args: { path },
  isError: false,
  text: Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'),
  durationMs: 40,
});

export const STEP_SAMPLES: StepSample[] = [
  {
    key: 'thinking',
    label: 'Thinking (streaming)',
    thinking: true,
    steps: [{ kind: 'thinking' }],
  },
  {
    key: 'fix',
    label: 'Read, edit, tests (1 failed)',
    durationMs: 18_400,
    steps: [
      { kind: 'thinking' },
      { kind: 'tool', id: 's1', name: 'grep', args: { pattern: 'total(' }, isError: false, text: 'src/cart.ts:10: export function total(items) {\nsrc/view.ts:4: total(items)\ntest/cart.test.ts:7: total([])' },
      read('s2', 'src/cart.ts', 120),
      read('s3', 'src/view.ts', 48),
      read('s4', 'test/cart.test.ts', 64),
      { kind: 'tool', id: 's5', name: 'edit', args: { path: 'src/cart.ts' }, isError: false, text: 'Edited src/cart.ts', view: { kind: 'diff', path: 'src/cart.ts', patch: PATCH } },
      {
        kind: 'tool',
        id: 's6',
        name: 'bash',
        args: { command: 'npm test' },
        isError: true,
        text: 'Tests:       1 failed, 47 passed, 48 total\nTime:        3.1 s\n\nCommand exited with code 1',
        view: { kind: 'terminal', command: 'npm test', exitCode: 1, output: 'Tests:       1 failed, 47 passed, 48 total' },
        durationMs: 3_400,
      },
    ],
  },
  {
    key: 'green',
    label: 'All green',
    durationMs: 6_200,
    steps: [
      { kind: 'tool', id: 'g1', name: 'edit', args: { path: 'src/cart.ts' }, isError: false, text: 'ok', view: { kind: 'diff', path: 'src/cart.ts', patch: '@@ -1 +1 @@\n-a\n+b' } },
      { kind: 'tool', id: 'g2', name: 'write', args: { path: 'src/new.ts', content: 'export const a = 1;\nexport const b = 2;\n' }, isError: false, text: 'Wrote src/new.ts' },
      { kind: 'tool', id: 'g3', name: 'bash', args: { command: 'node --test' }, isError: false, text: 'ℹ tests 48\nℹ pass 48\nℹ fail 0\nℹ duration_ms 2210' },
    ],
  },
  {
    key: 'approval',
    label: 'Waiting for approval',
    durationMs: 900,
    steps: [
      { kind: 'tool', id: 'a1', name: 'bash', args: { command: 'git status --short' }, isError: false, text: ' M src/cart.ts\n' },
      { kind: 'tool', id: 'a2', name: 'bash', args: { command: 'git push origin main' }, pending: true },
    ],
  },
  {
    key: 'errors',
    label: 'Exit code, error, stopped',
    durationMs: 74_000,
    steps: [
      { kind: 'tool', id: 'e1', name: 'bash', args: { command: 'make build' }, isError: true, text: 'cc: error\n\nCommand exited with code 2' },
      { kind: 'tool', id: 'e2', name: 'read', args: { path: 'missing.ts' }, isError: true, text: 'ENOENT: no such file or directory, open missing.ts' },
      { kind: 'tool', id: 'e3', name: 'bash', args: { command: 'sleep 600' }, isError: true, text: 'Command aborted' },
      { kind: 'tool', id: 'e4', name: 'custom_tool', args: { q: 1 }, isError: false, text: 'ok' },
    ],
  },
];

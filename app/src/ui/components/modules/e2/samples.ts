/** Gallery / test samples of the coding views (`diff`, `terminal`, `changes`). Fake paths and output only. */

const E = '\u001b';

/** two files as `git diff` prints them (English) */
export const DIFF_PATCH_EN = {
  type: 'diff',
  title: 'Fix the cart total',
  patch: [
    'diff --git a/src/cart.ts b/src/cart.ts',
    'index 3f2a1b0..8c9d4e1 100644',
    '--- a/src/cart.ts',
    '+++ b/src/cart.ts',
    '@@ -8,11 +8,12 @@ export type Item = { price: number; qty: number };',
    ' ',
    ' /** Sum of all items in the cart. */',
    ' export function total(items: Item[]): number {',
    '-  return items.reduce((sum, item) => sum + item.price, 0);',
    '+  const sum = items.reduce((acc, item) => acc + item.price * item.qty, 0);',
    '+  return Math.round(sum * 100) / 100;',
    ' }',
    ' ',
    '-export function isEmpty(items: Item[]) {',
    '+export function isEmpty(items: readonly Item[]): boolean {',
    '   return items.length === 0;',
    ' }',
    ' ',
    ' export const CURRENCY = "EUR";',
    'diff --git a/test/cart.test.ts b/test/cart.test.ts',
    'index 1111111..2222222 100644',
    '--- a/test/cart.test.ts',
    '+++ b/test/cart.test.ts',
    '@@ -1,7 +1,11 @@',
    " import { test } from 'node:test';",
    " import assert from 'node:assert/strict';",
    " import { total } from '../src/cart.ts';",
    ' ',
    " test('total adds prices', () => {",
    '   assert.equal(total([{ price: 2, qty: 1 }]), 2);',
    '+});',
    '+',
    "+test('total multiplies by quantity', () => {",
    '+  assert.equal(total([{ price: 0.1, qty: 3 }]), 0.3);',
    ' });',
  ].join('\n'),
};

/** structured form: whole old / new text → the app computes the diff; long unchanged runs fold (German title) */
export const DIFF_TEXTS_DE = {
  type: 'diff',
  title: 'Konfiguration angepasst',
  files: [
    {
      path: 'config/server.yaml',
      before: ['server:', '  port: 8080', '  host: 0.0.0.0', ...Array.from({ length: 24 }, (_, i) => `  option_${i + 1}: true`), 'logging:', '  level: info'].join('\n'),
      after: ['server:', '  port: 8443', '  host: 0.0.0.0', '  tls: true', ...Array.from({ length: 24 }, (_, i) => `  option_${i + 1}: true`), 'logging:', '  level: debug'].join('\n'),
    },
  ],
};

/** numbered edit card (`-12 old` / `+12 new`, `...` gaps), as some coding agents print their edits */
export const DIFF_EDIT_CARD = {
  type: 'diff',
  files: [
    {
      path: 'src/stream.ts',
      patch: [' 40 function flush() {', '-41   timer = setTimeout(run, 16);', '+41   frame = requestAnimationFrame(run);', ' 42 }', '...', ' 88 export function stop() {', '-89   clearTimeout(timer);', '+89   cancelAnimationFrame(frame);', '+90   frame = 0;', ' 90 }'].join('\n'),
    },
  ],
};

/** a headerless snippet, as models often write it in a ```diff fence */
export const DIFF_SNIPPET = { type: 'diff', patch: ['function greet(name) {', '-  return "Hello " + name;', '+  return `Hello, ${name}!`;', '}'].join('\n') };

/** new file + deleted lock file (collapsed by default) */
export const DIFF_ADDED_DELETED = {
  type: 'diff',
  patch: [
    'diff --git a/docs/USAGE.md b/docs/USAGE.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/docs/USAGE.md',
    '@@ -0,0 +1,4 @@',
    '+# Usage',
    '+',
    '+Run `npm start` and open the app.',
    '+Stop it with Ctrl+C.',
    'diff --git a/yarn.lock b/yarn.lock',
    'deleted file mode 100644',
    '--- a/yarn.lock',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-# yarn lockfile v1',
    '-left-pad@1.3.0:',
    '-  version "1.3.0"',
  ].join('\n'),
};

/** streaming: the patch is cut mid-hunk */
export const DIFF_PARTIAL = { type: 'diff', patch: DIFF_PATCH_EN.patch.slice(0, Math.floor(DIFF_PATCH_EN.patch.length * 0.45)) };

export const DIFF_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'git diff, 2 files (en)', node: DIFF_PATCH_EN },
  { title: 'before / after, folded context (de)', node: DIFF_TEXTS_DE },
  { title: 'numbered edit card', node: DIFF_EDIT_CARD },
  { title: 'snippet without headers', node: DIFF_SNIPPET },
  { title: 'new file + deleted lock file', node: DIFF_ADDED_DELETED },
  { title: 'streaming', node: DIFF_PARTIAL, streaming: true },
];

/** failing test run with colours */
export const TERMINAL_TESTS = {
  type: 'terminal',
  command: 'npm test',
  cwd: '~/projects/shop',
  output: [
    '> shop@1.0.0 test',
    '> node --test',
    '',
    `${E}[32m✔${E}[39m total adds prices ${E}[90m(0.4ms)${E}[39m`,
    `${E}[31m✖${E}[39m total multiplies by quantity ${E}[90m(0.6ms)${E}[39m`,
    `  ${E}[1mAssertionError${E}[22m: Expected values to be strictly equal:`,
    `  ${E}[32m+ actual${E}[39m ${E}[31m- expected${E}[39m`,
    `  ${E}[32m+ 0.30000000000000004${E}[39m`,
    `  ${E}[31m- 0.3${E}[39m`,
    '',
    `${E}[36mℹ${E}[39m tests 2`,
    `${E}[36mℹ${E}[39m pass 1`,
    `${E}[31mℹ fail 1${E}[39m`,
  ].join('\n'),
  exitCode: 1,
  durationMs: 1840,
};

/** progress bar with carriage returns + erase line, then done */
export const TERMINAL_PROGRESS = {
  type: 'terminal',
  command: 'npm install',
  output: `added 0 packages\r${E}[K[##        ] 20%\r${E}[K[#####     ] 50%\r${E}[K[##########] 100%\nadded 312 packages in 4s\n\n${E}[1m48${E}[22m packages are looking for funding`,
  exitCode: 0,
  durationMs: 4210,
};

/** still running (live append) */
export const TERMINAL_RUNNING = {
  type: 'terminal',
  command: 'cargo build --release',
  status: 'running',
  output: Array.from({ length: 6 }, (_, i) => `${E}[1;32m   Compiling${E}[0m crate-${i + 1} v0.${i}.0`).join('\n'),
};

/** long output: last 40 lines + "Show all" */
export const TERMINAL_LONG = {
  type: 'terminal',
  title: 'Build log',
  command: 'make all',
  output: Array.from({ length: 320 }, (_, i) => (i % 50 === 49 ? `${E}[33mwarning:${E}[0m unused variable in step ${i + 1}` : `[${String(i + 1).padStart(3, ' ')}/320] build target_${i + 1}.o`)).join('\n'),
  exitCode: 0,
  durationMs: 126_000,
};

export const TERMINAL_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'tests failed (ANSI colours)', node: TERMINAL_TESTS },
  { title: 'progress with \\r', node: TERMINAL_PROGRESS },
  { title: 'running', node: TERMINAL_RUNNING, streaming: true },
  { title: 'long output', node: TERMINAL_LONG },
];

/** an agent turn: 4 files, mixed with a file the agent did not touch, per-file patches from one combined patch */
export const CHANGES_TURN = {
  type: 'changes',
  id: 'turn-changes',
  summary: 'Cart total counts quantities; tests and docs updated.',
  agent: 'Hermes',
  files: [
    { path: 'src/cart.ts', status: 'modified', byAgent: true },
    { path: 'test/cart.test.ts', status: 'modified', byAgent: true },
    { path: 'docs/USAGE.md', status: 'added', byAgent: true },
    { path: 'src/util/money.ts', oldPath: 'src/money.ts', status: 'renamed', additions: 0, deletions: 0, byAgent: true },
    { path: 'yarn.lock', status: 'deleted', byAgent: false },
  ],
  patch: DIFF_PATCH_EN.patch + '\n' + DIFF_ADDED_DELETED.patch,
};

/** counts only (no diffs): a plain list */
export const CHANGES_COUNTS_DE = {
  type: 'changes',
  id: 'aenderungen',
  title: 'Geänderte Dateien',
  files: [
    { path: 'app/src/chat/Composer.tsx', status: 'modified', additions: 42, deletions: 7 },
    { path: 'app/src/chat/composerModel.ts', status: 'added', additions: 118, deletions: 0 },
    { path: 'app/src/chat/oldComposer.tsx', status: 'deleted', additions: 0, deletions: 230 },
  ],
};

export const CHANGES_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'agent turn with diffs (review sheet, agent-only filter)', node: CHANGES_TURN },
  { title: 'counts only (de)', node: CHANGES_COUNTS_DE },
];

// Streaming hot paths of the coding views (diff, terminal): what one update costs while the text grows.
// Run from app/: scripts/bench/run.sh coding   (or: node scripts/bench/coding.bench.mjs)
// "incremental" = what the components do (parser kept per block, only appended lines / chars are fed);
// "full re-parse" = a fresh parse of the whole text on every update, for comparison.
import { createDiffParser, fileRows, parseUnifiedDiff, splitRows } from '../../src/ui/components/modules/e2/diffModel.ts';
import { createTermParser } from '../../src/ui/components/modules/e2/terminalModel.ts';
import { createStreamParser } from '../../src/protocol/streamParser.ts';
import { growth, header, perStep, prefixes, report } from './lib.mjs';

const TICK = 16; // chars per throttled React update (see stream.bench.mjs)
const E = '\u001b';

function patch(files, linesPerFile) {
  const out = [];
  for (let f = 0; f < files; f++) {
    out.push(`diff --git a/src/file${f}.ts b/src/file${f}.ts`, `--- a/src/file${f}.ts`, `+++ b/src/file${f}.ts`);
    for (let h = 0; h < linesPerFile / 10; h++) {
      out.push(`@@ -${h * 20 + 1},8 +${h * 20 + 1},9 @@ function block${h}()`);
      out.push('   const a = compute(1, 2, 3);', '   const b = other(a);', '-  return a + b;', '+  const c = a * b;', '+  return c + a + b;', '   // trailing context', '   end();', '   done();', ' ');
      out.push('-old line', '+new line');
    }
  }
  return out.join('\n') + '\n';
}

function output(lines) {
  const out = [];
  for (let i = 0; i < lines; i++) {
    if (i % 25 === 0) out.push(`downloading ${'#'.repeat(5)}\r${E}[K${'#'.repeat(10)}\r${E}[Kdone ${i}`);
    else out.push(`${E}[32m✔${E}[39m test case ${i} ${E}[90m(${(i % 7) + 0.3}ms)${E}[39m`);
  }
  return out.join('\n') + '\n';
}

header('diff: one update of a growing patch (16 chars per update)');
const diffRuns = {};
for (const [files, lines] of [[2, 100], [6, 300]]) {
  const text = patch(files, lines);
  const steps = prefixes(text, TICK);
  const r = perStep(() => {
    const p = createDiffParser();
    return (t) => {
      const fs = p.update(t, false);
      for (const f of fs) splitRows(fileRows(f));
    };
  }, steps);
  report(`incremental + rows, ${files} files, ${(text.length / 1000).toFixed(0)}K chars`, r);
  diffRuns[files] = r;
  report(`full re-parse + rows, ${files} files`, perStep(() => (t) => { for (const f of parseUnifiedDiff(t)) splitRows(fileRows(f)); }, steps));
}
growth('diff incremental update', diffRuns[2], diffRuns[6]);

header('terminal: one update of growing output (16 chars per update)');
const termRuns = {};
for (const lines of [200, 1000]) {
  const text = output(lines);
  const steps = prefixes(text, TICK);
  const r = perStep(() => {
    const p = createTermParser();
    return (t) => p.update(t);
  }, steps);
  report(`incremental, ${lines} lines (${(text.length / 1000).toFixed(0)}K chars)`, r);
  termRuns[lines] = r;
  report(`full re-parse, ${lines} lines`, perStep(() => (t) => createTermParser().update(t), steps));
}
growth('terminal incremental update', termRuns[200], termRuns[1000]);

header('streamParser.push per update: an open ```diff text fence (no JSON, no rebuild rate limit)');
for (const files of [2, 6]) {
  const text = 'Here is the change:\n\n```diff\n' + patch(files, files === 2 ? 100 : 300) + '```\n';
  const deltas = [];
  for (let i = 0; i < text.length; i += TICK) deltas.push(text.slice(i, i + TICK));
  report(`${files} files (${(text.length / 1000).toFixed(0)}K chars)`, perStep(() => {
    const p = createStreamParser({ now: () => 0 });
    return (d) => p.push(d);
  }, deltas));
}

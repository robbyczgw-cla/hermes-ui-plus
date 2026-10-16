import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEL, EQ, INS, editScript } from './myers.ts';
import {
  createDiffParser,
  fileFromJson,
  filePatchText,
  fileRows,
  hunksFromTexts,
  parseUnifiedDiff,
  splitRows,
  wordDiff,
  collapsedByDefault,
  FOLD_MIN,
  type DiffFileModel,
  type LineRow,
} from './diffModel.ts';
import { alignRun, changeCells, fingerprint, headerPaths, isEditCard, lineLikeness, unquote } from './pocketDiff.ts';
import { createTermParser, plainText, terminalState, visibleLines, ansiColor, formatDuration, TERM_PREVIEW_LINES } from './terminalModel.ts';
import { readChanges } from './changesModel.ts';
import { reviewMessage, upsertComment, type ReviewComment } from './reviewModel.ts';
import { normalizeNode } from '../../../../protocol/validate.ts';
import { CHANGES_TURN, DIFF_ADDED_DELETED, DIFF_EDIT_CARD, DIFF_PATCH_EN, DIFF_TEXTS_DE, TERMINAL_PROGRESS, TERMINAL_TESTS } from './samples.ts';

const kinds = (f: DiffFileModel) => f.hunks.map((h) => h.lines.map((l) => l.kind[0] + (l.oldNo ?? '_') + '/' + (l.newNo ?? '_')).join(' '));

test('myers: edit scripts rebuild b from a (random), deletions before insertions, strict cost limit', () => {
  for (let k = 0; k < 2000; k++) {
    const r = () => Array.from({ length: Math.floor(Math.random() * 14) }, () => 'abcd'[Math.floor(Math.random() * 4)]);
    const a = r();
    const b = r();
    const ops = editScript(a, b)!;
    let i = 0;
    let j = 0;
    const out: string[] = [];
    for (const op of ops) {
      if (op === EQ) {
        assert.equal(a[i], b[j]);
        out.push(a[i++]);
        j++;
      } else if (op === DEL) i++;
      else out.push(b[j++]);
    }
    assert.equal(i, a.length);
    assert.deepEqual(out, b);
    for (let x = 1; x < ops.length; x++) if (ops[x - 1] === INS) assert.notEqual(ops[x], DEL, 'no delete right after an insert');
  }
  assert.equal(editScript('abcdef'.split(''), 'uvwxyz'.split(''), 2, true), null);
  assert.deepEqual(editScript('abcdef'.split(''), 'uvwxyz'.split(''), 2), [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
});

test('unified diff: files, statuses, line numbers, rename, new / deleted, no-newline marker, "--- x" as a removed line', () => {
  const files = parseUnifiedDiff(DIFF_PATCH_EN.patch + '\n' + DIFF_ADDED_DELETED.patch + '\ndiff --git a/old.txt b/new.txt\nsimilarity index 90%\nrename from old.txt\nrename to new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -1 +1 @@\n--- a dashed line\n+++ b plus line\n\\ No newline at end of file\n');
  assert.deepEqual(files.map((f) => [f.path, f.status, f.additions, f.deletions]), [
    ['src/cart.ts', 'modified', 3, 2],
    ['test/cart.test.ts', 'modified', 4, 0],
    ['docs/USAGE.md', 'added', 4, 0],
    ['yarn.lock', 'deleted', 0, 3],
    ['new.txt', 'renamed', 1, 1],
  ]);
  assert.equal(files[4].oldPath, 'old.txt');
  assert.deepEqual(kinds(files[4]), ['d1/_ a_/1 m_/_']);
  assert.equal(files[4].hunks[0].lines[0].text, '-- a dashed line');
  const h = files[0].hunks[0];
  assert.equal(h.section, 'export type Item = { price: number; qty: number };');
  assert.deepEqual(h.lines.slice(0, 5).map((l) => [l.kind, l.oldNo, l.newNo]), [['ctx', 8, 8], ['ctx', 9, 9], ['ctx', 10, 10], ['del', 11, undefined], ['add', undefined, 11]]);
  assert.ok(files.every((f) => f.numbered));
});

test('unified diff: preamble skipped, quoted and spaced paths, per-file patch starting at @@', () => {
  const show = 'commit 0123abc\nAuthor: Alice <alice@example.com>\n\n    message\n\ndiff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-a\n+b\n';
  assert.deepEqual(parseUnifiedDiff(show).map((f) => f.path), ['café.txt']);
  assert.deepEqual(headerPaths('a/my file.txt b/my file.txt'), ['a/my file.txt', 'b/my file.txt']);
  assert.equal(unquote('"tab\\there"'), 'tab\there');
  const bare = parseUnifiedDiff('@@ -3,2 +3,2 @@\n a\n-b\n+c\n');
  assert.equal(bare.length, 1);
  assert.deepEqual(kinds(bare[0]), ['c3/3 d4/_ a_/4']);
});

test('headerless snippet and Pi edit cards', () => {
  const s = parseUnifiedDiff('function f() {\n-  return 1;\n+  return 2;\n}');
  assert.equal(s[0].numbered, false);
  assert.deepEqual(s[0].hunks[0].lines.map((l) => [l.kind, l.text]), [['ctx', 'function f() {'], ['del', '  return 1;'], ['add', '  return 2;'], ['ctx', '}']]);
  assert.ok(isEditCard(DIFF_EDIT_CARD.files[0].patch));
  const card = parseUnifiedDiff(DIFF_EDIT_CARD.files[0].patch);
  assert.equal(card[0].hunks.length, 2, '... starts a new hunk');
  assert.deepEqual(kinds(card[0]), ['c40/40 d41/_ a_/41 c42/42', 'c88/88 d89/_ a_/89 a_/90 c90/91']);
  assert.deepEqual([card[0].additions, card[0].deletions], [3, 2]);
});

test('incremental parse: same result as one-shot for any chunking, finished hunks / lines keep identity', () => {
  const text = DIFF_PATCH_EN.patch + '\n' + DIFF_ADDED_DELETED.patch;
  const whole = parseUnifiedDiff(text);
  for (const step of [1, 7, 33, 200]) {
    const p = createDiffParser();
    let last: DiffFileModel[] = [];
    for (let i = step; i < text.length; i += step) last = p.update(text.slice(0, i), false);
    last = p.update(text, true);
    assert.deepEqual(JSON.parse(JSON.stringify(last)), JSON.parse(JSON.stringify(whole)), `step ${step}`);
  }
  const p = createDiffParser();
  const a = p.update(text.slice(0, text.indexOf('diff --git a/test')), false);
  const b = p.update(text.slice(0, text.indexOf('diff --git a/docs')), false);
  assert.equal(b[0], a[0], 'the first file is finished: same object');
  assert.equal(b[0].hunks[0].lines[3], a[0].hunks[0].lines[3]);
  assert.equal(p.update(text.slice(0, text.indexOf('diff --git a/docs')), false), b, 'nothing new → the same array');
  // a text that does not extend the previous one starts over
  const c = p.update('@@ -1 +1 @@\n-x\n+y\n', true);
  assert.equal(c.length, 1);
  assert.equal(c[0].additions, 1);
});

test('before / after texts: hunks like diff -u (3 lines of context), long unchanged runs fold', () => {
  const f = fileFromJson(DIFF_TEXTS_DE.files[0] as never, 0);
  assert.equal(f.hunks.length, 2);
  assert.deepEqual(f.hunks.map((h) => h.range), ['@@ -1,6 +1,7 @@', '@@ -26,4 +27,4 @@']);
  assert.deepEqual([f.additions, f.deletions], [3, 2]);
  assert.equal(fileFromJson(DIFF_TEXTS_DE.files[0] as never, 0), f, 'cached per file object');
  // a hunk with a long unchanged run in the middle folds it
  const before = Array.from({ length: 40 }, (_, i) => `l${i}`);
  const after = [...before];
  after[2] = 'X';
  after[37] = 'Y';
  const big = fileFromJson({ path: 'a', hunks: [{ oldStart: 1, newStart: 1, lines: before.map((l, i) => (i === 2 || i === 37 ? '-' + l : ' ' + l)).flatMap((s, i) => (i === 2 || i === 37 ? [s, '+' + after[i]] : [s])) }] }, 1);
  const rows = fileRows(big);
  const fold = rows.find((r) => r.t === 'fold');
  assert.ok(fold && fold.t === 'fold' && fold.count >= FOLD_MIN, 'middle run folded');
  assert.equal(fileRows(big)[1], rows[1], 'rows of an unchanged hunk are cached');
  const opened = fileRows(big, new Set([fold!.key]));
  assert.ok(!opened.some((r) => r.t === 'fold' && r.key === fold!.key));
  assert.equal(opened.filter((r) => r.t === 'line').length, 42);
});

test('pairing by likeness: a changed line sits beside its new version, words highlight', () => {
  assert.ok(lineLikeness('const a = 1;', 'const a = 2;') > 0.7);
  assert.deepEqual(alignRun(['const a = 1;', 'foo();'], ['// new comment', 'const a = 2;', 'foo();', 'bar();']), [[-1, 0], [0, 1], [1, 2], [-1, 3]]);
  const f = parseUnifiedDiff('@@ -1,2 +1,4 @@\n-const a = 1;\n-call();\n+// added above\n+const a = 2;\n+call();\n+more();\n')[0];
  const rows = fileRows(f).filter((r): r is LineRow => r.t === 'line');
  const del = rows.find((r) => r.line.text === 'const a = 1;')!;
  assert.deepEqual(del.words, [{ text: 'const a = ', hl: false }, { text: '1', hl: true }, { text: ';', hl: false }]);
  assert.equal(rows.find((r) => r.line.text === '// added above')!.words, undefined);
  const split = splitRows(fileRows(f)).filter((r) => r.t === 'pair');
  assert.deepEqual(split.map((r) => (r.t === 'pair' ? [r.left?.line.text ?? null, r.right?.line.text ?? null] : null)), [
    [null, '// added above'],
    ['const a = 1;', 'const a = 2;'],
    ['call();', 'call();'],
    [null, 'more();'],
  ]);
  assert.equal(wordDiff('abc', 'xyz completely different'), null, 'mostly rewritten: no highlight');
});

test('copy patch: the file text parses back to the same lines', () => {
  for (const f of parseUnifiedDiff(DIFF_PATCH_EN.patch + '\n' + DIFF_ADDED_DELETED.patch)) {
    const back = parseUnifiedDiff(filePatchText(f))[0];
    assert.deepEqual(back.hunks.map((h) => h.lines), f.hunks.map((h) => h.lines), f.path);
    assert.equal(back.status, f.status);
  }
  assert.ok(collapsedByDefault({ path: 'yarn.lock', status: 'modified', binary: false }));
  assert.ok(!collapsedByDefault({ path: 'src/a.ts', status: 'modified', binary: false }));
});

test('terminal: SGR colours, CR progress, erase line, escapes split across updates, same snapshot when nothing changed', () => {
  const p = createTermParser();
  const out = TERMINAL_TESTS.output;
  let snap = p.update('');
  for (let i = 1; i <= out.length; i += 3) snap = p.update(out.slice(0, i));
  snap = p.update(out);
  const once = createTermParser().update(out);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), JSON.parse(JSON.stringify(once)));
  assert.equal(plainText(snap).split('\n')[3], '✔ total adds prices (0.4ms)');
  const s = snap.lines[3].spans;
  assert.deepEqual(snap.styles[s[0].s], { fg: 2 });
  assert.equal(p.update(out), snap, 'unchanged output → same snapshot');
  const prog = createTermParser().update(TERMINAL_PROGRESS.output);
  assert.equal(prog.lines[0].text, '[##########] 100%');
  assert.equal(createTermParser().update('100%\r50').lines.length, 0);
  assert.equal(createTermParser().update('100%\r50').tail!.text, '500%', 'CR overwrites, it does not clear');
  assert.equal(createTermParser().update('a\tb\x1b]0;title\x07!\x1b[38;2;255;0;0mR').tail!.text, 'a       b!R');
  assert.equal(ansiColor(196, true), '#ff0000');
  assert.equal(ansiColor(232, false), '#080808');
});

test('terminal: finished lines keep identity while output grows; a moving tail window keeps earlier lines', () => {
  const p = createTermParser();
  const a = p.update('one\ntwo\nthr');
  const b = p.update('one\ntwo\nthree\nfour');
  assert.equal(b.lines[0], a.lines[0]);
  assert.equal(b.styles, a.styles);
  // retained window: the host dropped "one\n" (4 chars) and appended
  const w = createTermParser();
  w.update('one\ntwo\n', 0);
  const moved = w.update('two\nthree\n', 4);
  assert.deepEqual(moved.lines.map((l) => l.text), ['one', 'two', 'three']);
  const jumped = w.update('zzz\n', 1000);
  assert.deepEqual(jumped.lines.map((l) => l.text), ['zzz'], 'no overlap: start over');
});

test('terminal: badge state, duration parts, collapsed tail', () => {
  assert.equal(terminalState({}, true), 'running');
  assert.equal(terminalState({}, false), 'unknown');
  assert.equal(terminalState({ exitCode: 0 }, true), 'ok');
  assert.equal(terminalState({ exitCode: 2 }, false), 'failed');
  assert.equal(terminalState({ status: 'running' }, false), 'running');
  assert.equal(terminalState({ status: 'error', exitCode: 0 }, false), 'failed');
  assert.deepEqual(formatDuration(350), { n: '350', unit: 'ms' });
  assert.deepEqual(formatDuration(1840), { n: '1.8', unit: 's' });
  assert.deepEqual(formatDuration(126_000), { m: 2, s: 6 });
  const snap = createTermParser().update(Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n'));
  const v = visibleLines(snap, false);
  assert.equal(v.lines.length, TERM_PREVIEW_LINES);
  assert.equal(v.hidden, 300 - TERM_PREVIEW_LINES);
  assert.equal(v.lines[v.lines.length - 1].text, 'l299');
  assert.equal(visibleLines(snap, true).lines.length, 300);
});

test('changes: per-file diffs from the combined patch, counts computed, status totals, change bar', () => {
  const m = readChanges(normalizeNode(CHANGES_TURN) as never);
  assert.deepEqual(m.rows.map((r) => [r.path, r.status, r.additions, r.deletions, !!r.diff, r.byAgent]), [
    ['src/cart.ts', 'modified', 3, 2, true, true],
    ['test/cart.test.ts', 'modified', 4, 0, true, true],
    ['docs/USAGE.md', 'added', 4, 0, true, true],
    ['src/util/money.ts', 'renamed', 0, 0, false, true],
    ['yarn.lock', 'deleted', 0, 3, true, false],
  ]);
  assert.deepEqual(m.counts, { added: 1, modified: 2, deleted: 1, renamed: 1 });
  assert.deepEqual([m.additions, m.deletions], [11, 5]);
  const only = readChanges({ patch: DIFF_ADDED_DELETED.patch });
  assert.deepEqual(only.rows.map((r) => r.path), ['docs/USAGE.md', 'yarn.lock'], 'no file list: from the patch');
  assert.deepEqual(changeCells(10, 3), ['add', 'del', '', '', '']);
  assert.deepEqual(changeCells(0, 0), ['', '', '', '', '']);
  assert.notEqual(fingerprint('a'), fingerprint('b'));
});

test('review comments: one message, sorted by file and line, quoted code; upsert / remove by row', () => {
  const c = (id: string, path: string, line: number, text: string): ReviewComment => ({ id, path, line, side: 'new', code: '  const x = 1;', text });
  let list = upsertComment([], c('b', 'src/b.ts', 3, 'rename'));
  list = upsertComment(list, c('a', 'src/a.ts', 12, 'use a constant'));
  list = upsertComment(list, c('a', 'src/a.ts', 12, 'use a named constant'));
  assert.equal(list.length, 2);
  assert.equal(upsertComment(list, c('b', 'src/b.ts', 3, '  ')).length, 1, 'empty text removes');
  const msg = reviewMessage(list, { intro: 'Please change:', at: (p, l) => `${p}:${l}` });
  assert.equal(msg, 'Please change:\n\n1. `src/a.ts:12`\n   > const x = 1;\n   use a named constant\n\n2. `src/b.ts:3`\n   > const x = 1;\n   rename');
});

test('wiring: registry, HuiView, gallery, skeletons', () => {
  const reg = readFileSync(new URL('../registryE2.ts', import.meta.url), 'utf8');
  for (const k of ['diff', 'terminal', 'changes']) assert.match(reg, new RegExp(`${k}: `));
  assert.match(readFileSync(new URL('../../../HuiView.tsx', import.meta.url), 'utf8'), /\.\.\.registryE2/);
  assert.match(readFileSync(new URL('../../../Gallery.tsx', import.meta.url), 'utf8'), /<GallerySectionE2 onAction=\{onAction\} \/>/);
  const sk = readFileSync(new URL('../../../skeletons.tsx', import.meta.url), 'utf8');
  for (const k of ['diff', 'terminal', 'changes']) assert.match(sk, new RegExp(`case '${k}':`));
});

test('myers: the banded backtrack still finds a SHORTEST edit script (cost = n + m − 2·LCS)', () => {
  const lcs = (a: string[], b: string[]) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[a.length][b.length];
  };
  for (let k = 0; k < 1500; k++) {
    const r = () => Array.from({ length: Math.floor(Math.random() * 40) }, () => 'abcde'[Math.floor(Math.random() * 5)]);
    const a = r();
    const b = r();
    const cost = editScript(a, b)!.filter((op) => op !== EQ).length;
    assert.equal(cost, a.length + b.length - 2 * lcs(a, b), `${a.join('')} → ${b.join('')}`);
  }
  // a large rewrite past the cost cap falls back without throwing (bounded memory)
  const big = (s: string) => Array.from({ length: 4000 }, (_, i) => `${s}${i}`);
  const ops = editScript(big('x'), big('y'), 1000)!;
  assert.equal(ops.length, 8000);
});

test('changes: a streaming combined patch parsed by the view, file diffs reused across renders', () => {
  const node = normalizeNode(CHANGES_TURN) as never as { patch: string; files: unknown[] };
  const parser = createDiffParser();
  const half = node.patch.slice(0, Math.floor(node.patch.length / 2));
  const a = readChanges(node as never, parser.update(half, false));
  assert.ok(a.rows[0].diff, 'first file already has its diff while streaming');
  const b = readChanges(node as never, parser.update(node.patch, true));
  assert.deepEqual(b.rows.map((r) => [r.path, r.additions, r.deletions]), readChanges(node as never).rows.map((r) => [r.path, r.additions, r.deletions]));
  // own per-file patches: the same file object → the same diff model (no re-parse on every update)
  const own = { files: [{ path: 'a.ts', status: 'modified' as const, patch: '@@ -1 +1 @@\n-a\n+b\n' }] };
  assert.equal(readChanges(own).rows[0].diff, readChanges(own).rows[0].diff);
});

test('terminal: collapsed tail of a live output includes the unfinished line', () => {
  const snap = createTermParser().update(Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n') + '\nprogress 40%');
  const v = visibleLines(snap, false);
  assert.equal(v.lines.length, TERM_PREVIEW_LINES);
  assert.equal(v.lines[v.lines.length - 1].text, 'progress 40%');
  assert.equal(v.hidden, 101 - TERM_PREVIEW_LINES);
});

test('extendsText: appends pass, edits fail (short and long texts, a tail window that dropped its head)', async () => {
  const { extendsText, CHECK } = await import('./appendCheck.ts');
  assert.ok(extendsText('abc', 'ab'));
  assert.ok(!extendsText('axc', 'ab'));
  assert.ok(!extendsText('a', 'ab'), 'shorter is never an extension');
  const long = 'x'.repeat(CHECK * 3) + 'tail';
  assert.ok(extendsText(long + 'more', long));
  assert.ok(!extendsText('y' + long.slice(1) + 'more', long), 'changed head');
  assert.ok(!extendsText(long.slice(0, -4) + 'TAIL' + 'more', long), 'changed end');
  // window: prev = "0123456789", the host dropped 4 chars from the front → next starts at "456789"
  assert.ok(extendsText('456789AB', '0123456789', 4));
  assert.ok(!extendsText('456X89AB', '0123456789', 4));
});

test('unified diff: a hunk with too-big @@ counts does not swallow the next file header', () => {
  const text = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,7 +1,7 @@', ' a', '-b', '+B', ' c', '--- a/y.ts', '+++ b/y.ts', '@@ -1,2 +1,2 @@', '-y', '+Y', ' z'].join('\n');
  const files = parseUnifiedDiff(text);
  assert.deepEqual(files.map((f) => [f.path, f.additions, f.deletions]), [['x.ts', 1, 1], ['y.ts', 1, 1]]);
  // the same when the text arrives line by line
  const p = createDiffParser();
  let out: DiffFileModel[] = [];
  for (let i = 1; i <= text.length; i += 7) out = p.update(text.slice(0, i), false);
  out = p.update(text, true);
  assert.deepEqual(out.map((f) => [f.path, f.additions, f.deletions]), [['x.ts', 1, 1], ['y.ts', 1, 1]]);
  // a real removed "-- a/…" line followed by a context line stays a removed line
  const keep = parseUnifiedDiff(['--- a/q.sql', '+++ b/q.sql', '@@ -1,2 +1,1 @@', '--- a/comment', ' select 1;'].join('\n'));
  assert.deepEqual(keep.map((f) => [f.path, f.deletions]), [['q.sql', 1]]);
});


test('cursor motion and moving output windows keep interpreted storage bounded', () => {
  const p = createTermParser();
  const snap = p.update('\x1b[1000000000Gx');
  assert.ok((snap.tail?.text.length ?? 0) <= 4097);
  const many = createTermParser().update(('\x1b[1000000000Gx\n').repeat(1000));
  assert.ok(many.lines.reduce((sum, line) => sum + line.text.length, 0) <= 200_000);
  assert.doesNotThrow(() => createTermParser().update('x'.repeat(200_000) + '\t'));
  const window = createTermParser();
  window.update('x'.repeat(200_000));
  const tail = window.update('x'.repeat(199_999) + 'E', 1).tail!.text;
  assert.equal(tail.length, 200_000);
  assert.ok(tail.endsWith('E'), 'new output is kept when a retained line reaches the cap');
});


test('malformed indexed ANSI colors cannot crash rendering', () => {
  const snap = createTermParser().update('\x1b[38;5;16.5mx');
  assert.equal(plainText(snap), 'x');
  for (const style of snap.styles) if (style.fg !== undefined) assert.doesNotThrow(() => ansiColor(style.fg!, true));
  for (const c of [16.5, NaN, Infinity, -1, 256]) assert.equal(typeof ansiColor(c, true), 'string');
});


test('middle replacements reset terminal and growing diff parsers', () => {
  const term = createTermParser();
  const before = 'a'.repeat(800) + '\nFAIL\n' + 'z'.repeat(800) + '\n';
  term.update(before);
  assert.ok(plainText(term.update(before.replace('FAIL', 'PASS'))).includes('PASS'));
  const parser = createDiffParser();
  const patch = '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n ' + 'a'.repeat(800) + '\n-old\n+bad\n ' + 'z'.repeat(800) + '\n';
  parser.update(patch, false);
  const updated = parser.update(patch.replace('+bad', '+new') + '\n', true);
  assert.deepEqual(updated.flatMap(f => f.hunks.flatMap(h => h.lines.filter(l => l.kind === 'add').map(l => l.text))), ['new']);
});

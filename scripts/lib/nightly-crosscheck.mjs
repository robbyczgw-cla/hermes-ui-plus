// Logic of the nightly fast-path cross-check (scripts/nightly/nightly-fastpath-check.sh, docs/BUILD.md "Nightly cross-check").
// The shell script builds the x86_64 test APK twice (scripts/build-apk-fast.sh and scripts/build-apk.sh) and records the facts
// in <run>/run.json; this module decides pass / fail, compares the two APKs entry by entry and writes the result files.
//
//   node scripts/lib/nightly-crosscheck.mjs finish RUN_DIR REPORTS_DIR     compare, write <date>.md (+ ALERT-<date>.md), print verdict
//   node scripts/lib/nightly-crosscheck.mjs prune RUNS_DIR [KEEP]          keep the newest KEEP (3) runs, and the newest KEEP alert runs
//   node scripts/lib/nightly-crosscheck.mjs skip RUN_DIR REPORTS_DIR       write the "host stayed busy" result (no alert)
//
// Equality rule: every entry of both APKs (name, size, CRC) is identical; only the signing files (META-INF/*.SF|RSA|DSA|EC|MANIFEST.MF)
// and the v2 signing block (not a zip entry) may differ. That is what scripts/lib/apk_swap.py `compare` checks.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SWAP_SCRIPT = join(HERE, 'apk_swap.py');

/** parse the output of `apk_swap.py compare` (lines "<entry>: differs|only in A|only in B", last line "<n> differing entries of <m>") */
export function parseCompare(text, rc) {
  const lines = String(text).split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  const m = /^(\d+) differing entr(?:y|ies) of (\d+)$/.exec(last);
  if (!m || (rc !== 0 && rc !== 1)) return { ok: false, error: `compare did not finish (rc=${rc}): ${last || 'no output'}`, differing: [], total: 0 };
  const differing = lines.slice(0, -1).map((l) => {
    const i = l.lastIndexOf(': ');
    return i < 0 ? { name: l, kind: 'differs' } : { name: l.slice(0, i), kind: l.slice(i + 2) };
  });
  const count = Number(m[1]);
  if (count !== differing.length) return { ok: false, error: `compare output inconsistent (${count} announced, ${differing.length} listed)`, differing, total: Number(m[2]) };
  return { ok: count === 0 && rc === 0, differing, total: Number(m[2]) };
}

export function compareApks(fast, full, { python = 'python3', swap = process.env.HUI_NIGHTLY_SWAP || SWAP_SCRIPT } = {}) {
  for (const f of [fast, full]) if (!f || !existsSync(f)) return { ok: false, error: `APK missing: ${f ?? '(none)'}`, differing: [], total: 0 };
  const r = spawnSync(python, ['-I', swap, 'compare', fast, full], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) return { ok: false, error: String(r.error), differing: [], total: 0 };
  return { ...parseCompare(r.stdout ?? '', r.status), raw: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * run: facts from the shell script
 *   { date, sha, source, fast: { status: 'ok'|'unavailable'|'failed', apk?, log?, seconds?, baseBuild?, note? },
 *     full: { status: 'ok'|'failed', apk?, log?, seconds? }, fastRetry?: same as fast (second fast attempt after a full build) }
 * cmp: result of compareApks (or null when it could not run)
 * Returns { verdict: 'pass'|'fail', reasons: [] }; a failed fast build after a successful full build is a fail, "no base" is not.
 */
export function judge(run, cmp) {
  const reasons = [];
  const fast = run.fastRetry ?? run.fast;
  if (run.full?.status !== 'ok') reasons.push(`full build failed${run.full?.note ? `: ${run.full.note}` : ''}`);
  if (fast?.status === 'failed') reasons.push(`fast build failed${fast.note ? `: ${fast.note}` : ''}`);
  if (fast?.status === 'unavailable') reasons.push(`fast path not applicable even after a full build registered its base${fast.note ? `: ${fast.note}` : ''}`);
  if (run.full?.status === 'ok' && fast?.status === 'ok') {
    if (!cmp) reasons.push('comparison did not run');
    else if (cmp.error) reasons.push(cmp.error);
    else if (!cmp.ok) reasons.push(`${cmp.differing.length} of ${cmp.total} APK entries differ between fast and full build`);
  }
  return { verdict: reasons.length ? 'fail' : 'pass', reasons };
}

const rel = (p) => (p ? basename(p) : '(none)');

export function renderResult(run, cmp, j) {
  const fast = run.fastRetry ?? run.fast ?? {};
  const full = run.full ?? {};
  const head = j.verdict === 'pass'
    ? `Ergebnis: OK. Fast-Path-APK und voller Build von ${run.sha} sind in allen ${cmp?.total ?? '?'} Eintraegen identisch (nur Signatur unterscheidet sich).`
    : `Ergebnis: FEHLER. ${j.reasons.join('; ')}. Details und Artefakte siehe unten.`;
  const out = [
    `# Nightly fast-path cross-check ${run.date}`,
    '',
    head,
    '',
    `- commit: ${run.sha} (private main, fetched from ${run.source})`,
    `- verdict: ${j.verdict}`,
    `- fast: ${fast.status}${fast.seconds != null ? `, ${fast.seconds} s` : ''}${fast.baseBuild != null ? `, base build ${fast.baseBuild}` : ''}${run.fastRetry ? ' (second attempt, base registered by tonight\'s full build)' : ''}`,
    run.fastRetry || run.fast?.status === 'unavailable' ? `- first fast attempt: ${run.fast?.status}${run.fast?.note ? ` (${run.fast.note})` : ''}` : null,
    `- full: ${full.status}${full.seconds != null ? `, ${full.seconds} s` : ''}`,
    `- fast APK: ${rel(fast.apk)}`,
    `- full APK: ${rel(full.apk)}`,
    cmp && !cmp.error ? `- compared entries: ${cmp.total}, differing: ${cmp.differing.length}` : null,
    run.runDir ? `- kept in: ${run.runDir}${j.verdict === 'fail' ? ' (APKs, logs, compare.txt)' : ' (logs; newest 3 runs kept)'}` : null,
  ].filter((l) => l !== null);
  if (cmp?.differing?.length) {
    out.push('', '## Differing entries', '', ...cmp.differing.slice(0, 50).map((d) => `- ${d.name}: ${d.kind}`));
    if (cmp.differing.length > 50) out.push(`- ... ${cmp.differing.length - 50} more (compare.txt)`);
  }
  return out.join('\n') + '\n';
}

export function renderAlert(run, cmp, j) {
  const fast = run.fastRetry ?? run.fast ?? {};
  const out = [
    `# ALERT ${run.date}: nightly fast-path cross-check failed`,
    '',
    `Alarm: Der naechtliche Abgleich Fast-Path gegen vollen Build ist fehlgeschlagen (Commit ${run.sha}). Der Fast Path darf bis zur Klaerung nicht als gleichwertig gelten.`,
    '',
    '## Reasons',
    '',
    ...j.reasons.map((r) => `- ${r}`),
    '',
    '## Evidence',
    '',
    `- commit: ${run.sha} (from ${run.source})`,
    `- run dir (APKs, logs, compare.txt kept for inspection): ${run.runDir ?? '(unknown)'}`,
    `- fast log: ${fast.log ?? run.fast?.log ?? '(none)'}`,
    `- full log: ${run.full?.log ?? '(none)'}`,
    `- fast APK: ${rel(fast.apk)}   full APK: ${rel(run.full?.apk)}`,
    '',
    '## Reproduce',
    '',
    '```',
    `python3 scripts/lib/apk_swap.py compare <run dir>/fast.apk <run dir>/full.apk`,
    '```',
  ];
  if (cmp?.differing?.length) out.push('', '## Differing entries (first 50)', '', ...cmp.differing.slice(0, 50).map((d) => `- ${d.name}: ${d.kind}`));
  return out.join('\n') + '\n';
}

export function renderSkip(run) {
  return [
    `# Nightly fast-path cross-check ${run.date}`,
    '',
    `Ergebnis: uebersprungen (kein Fehler). Der Host war ${run.waitedMinutes ?? 60} Minuten lang belegt: ${run.busyReason ?? 'unbekannt'}.`,
    '',
    `- commit: not fetched`,
    `- verdict: skipped`,
    '',
  ].join('\n');
}

const RUN_RE = /^\d{4}-\d{2}-\d{2}(-\d{6})?-[0-9a-f]{4,40}$|^\d{4}-\d{2}-\d{2}-skipped$/;

/** run dirs sort by name (date first); keep the newest `keep` and, separately, the newest `keep` that carry an ALERT marker */
export function pruneRuns(dir, keep = 3, { dryRun = false } = {}) {
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && RUN_RE.test(d.name)).map((d) => d.name).sort().reverse();
  const keepSet = new Set(runs.slice(0, keep));
  runs.filter((n) => existsSync(join(dir, n, 'ALERT'))).slice(0, keep).forEach((n) => keepSet.add(n));
  const gone = runs.filter((n) => !keepSet.has(n));
  if (!dryRun) for (const n of gone) rmSync(join(dir, n), { recursive: true, force: true });
  return gone;
}

function readRun(runDir) {
  return JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
}

export function finish(runDir, reportsDir) {
  const run = readRun(runDir);
  run.runDir = runDir;
  const fast = run.fastRetry ?? run.fast;
  let cmp = null;
  if (run.full?.status === 'ok' && fast?.status === 'ok') {
    cmp = compareApks(fast.apk, run.full.apk);
    writeFileSync(join(runDir, 'compare.txt'), cmp.raw ?? `${cmp.error}\n`);
  }
  const j = judge(run, cmp);
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, `${run.date}.md`), renderResult(run, cmp, j));
  const alert = join(reportsDir, `ALERT-${run.date}.md`);
  if (j.verdict === 'fail') {
    writeFileSync(alert, renderAlert(run, cmp, j));
    writeFileSync(join(runDir, 'ALERT'), j.reasons.join('\n') + '\n');
  } else {
    rmSync(alert, { force: true });   // a passing re-run of the same night replaces an earlier alert
    rmSync(join(runDir, 'ALERT'), { force: true });
  }
  writeFileSync(join(runDir, 'verdict.json'), JSON.stringify({ verdict: j.verdict, reasons: j.reasons }, null, 2) + '\n');
  return { ...j, cmp };
}

export function skip(runDir, reportsDir) {
  const run = readRun(runDir);
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, `${run.date}.md`), renderSkip(run));
  return { verdict: 'skipped', reasons: [run.busyReason ?? 'host busy'] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'finish' && a && b) {
    const r = finish(a, b);
    console.log(`${r.verdict}${r.reasons.length ? `: ${r.reasons.join('; ')}` : ''}`);
    process.exit(r.verdict === 'pass' ? 0 : 1);
  } else if (cmd === 'skip' && a && b) {
    console.log(skip(a, b).verdict);
  } else if (cmd === 'prune' && a) {
    const gone = pruneRuns(a, b ? Number(b) : 3);
    console.log(gone.length ? `pruned: ${gone.join(' ')}` : 'nothing to prune');
  } else {
    console.error('usage: nightly-crosscheck.mjs finish RUN_DIR REPORTS_DIR | skip RUN_DIR REPORTS_DIR | prune RUNS_DIR [KEEP]');
    process.exit(2);
  }
}

// node --test scripts/nightly-crosscheck.test.mjs — nightly fast-path cross-check: APK comparison, verdict, result / ALERT files,
// pruning, busy-host waiting and the unit templates (no builds, no network).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareApks, finish, judge, parseCompare, pruneRuns, renderAlert, renderResult, skip } from './lib/nightly-crosscheck.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'nightly', 'nightly-fastpath-check.sh');

function tmp() {
  const root = mkdtempSync(join(tmpdir(), 'hui-nightly-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
/** zip with the given entries via python (same zip reader as apk_swap.py compare) */
function zip(file, entries) {
  const r = spawnSync('python3', ['-I', '-c', 'import sys,json,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nfor k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)\nz.close()', file, JSON.stringify(entries)]);
  assert.equal(r.status, 0, String(r.stderr));
}
const base = { 'classes.dex': 'dex', 'assets/index.android.bundle': 'hbc-1', 'assets/app.config': '{"build":117}', 'META-INF/CERT.SF': 'sf-a', 'META-INF/CERT.RSA': 'rsa-a', 'META-INF/MANIFEST.MF': 'mf-a' };

test('parseCompare reads entries and counts, and refuses unfinished output', () => {
  assert.deepEqual(parseCompare('0 differing entries of 12\n', 0), { ok: true, differing: [], total: 12 });
  const d = parseCompare('assets/index.android.bundle: differs\nres/x.png: only in B\n2 differing entries of 12\n', 1);
  assert.equal(d.ok, false);
  assert.deepEqual(d.differing, [{ name: 'assets/index.android.bundle', kind: 'differs' }, { name: 'res/x.png', kind: 'only in B' }]);
  assert.equal(parseCompare('1 differing entry of 3\n', 1).error, 'compare output inconsistent (1 announced, 0 listed)');
  assert.match(parseCompare('Traceback...\n', 1).error, /did not finish/);
  assert.match(parseCompare('0 differing entries of 3\n', 2).error, /did not finish/);
  assert.equal(parseCompare('', 0).ok, false);
});

test('compareApks: equal apart from signature files, flags changed / added / removed entries', () => {
  const t = tmp();
  try {
    const a = join(t.root, 'a.apk'), b = join(t.root, 'b.apk');
    zip(a, base);
    zip(b, { ...base, 'META-INF/CERT.SF': 'sf-b', 'META-INF/CERT.RSA': 'rsa-b', 'META-INF/MANIFEST.MF': 'mf-b' });
    const same = compareApks(a, b);
    assert.equal(same.ok, true, JSON.stringify(same));
    assert.equal(same.total, 3);

    const c = join(t.root, 'c.apk');
    const { 'classes.dex': _gone, ...rest } = base;
    zip(c, { ...rest, 'assets/index.android.bundle': 'hbc-2', 'res/new.png': 'png' });
    const diff = compareApks(a, c);
    assert.equal(diff.ok, false);
    assert.deepEqual(diff.differing.map((x) => `${x.name}|${x.kind}`).sort(),
      ['assets/index.android.bundle|differs', 'classes.dex|only in A', 'res/new.png|only in B']);
  } finally { t.done(); }
});

test('compareApks: a missing or broken APK is an error, never a pass', () => {
  const t = tmp();
  try {
    const a = join(t.root, 'a.apk'), bad = join(t.root, 'bad.apk');
    zip(a, base);
    writeFileSync(bad, 'not a zip');
    assert.match(compareApks(a, join(t.root, 'nope.apk')).error, /APK missing/);
    assert.equal(compareApks(a, bad).ok, false);
    assert.ok(compareApks(a, bad).error);
    assert.match(compareApks(undefined, a).error, /APK missing/);
  } finally { t.done(); }
});

const okRun = { date: '2026-10-17', sha: 'abc1234', source: 'primary (example.com)', fast: { status: 'ok', apk: '/x/fast.apk', baseBuild: 117, seconds: 70 }, full: { status: 'ok', apk: '/x/full.apk', seconds: 480 } };
const same = { ok: true, differing: [], total: 1677 };

test('judge: pass only when both builds ran and the comparison is clean', () => {
  assert.equal(judge(okRun, same).verdict, 'pass');
  const diff = judge(okRun, { ok: false, differing: [{ name: 'a', kind: 'differs' }], total: 5 });
  assert.equal(diff.verdict, 'fail');
  assert.match(diff.reasons[0], /1 of 5 APK entries differ/);
  assert.equal(judge(okRun, null).verdict, 'fail');
  assert.equal(judge(okRun, { ok: false, error: 'APK missing: x', differing: [], total: 0 }).verdict, 'fail');
  assert.match(judge({ ...okRun, full: { status: 'failed', note: 'exit 1' } }, null).reasons.join(), /full build failed: exit 1/);
  assert.match(judge({ ...okRun, fast: { status: 'failed', note: 'exit 1' } }, null).reasons.join(), /fast build failed/);
});

test('judge: no base on the first attempt is fine when the retry against the fresh base passes', () => {
  const run = { ...okRun, fast: { status: 'unavailable' }, fastRetry: { status: 'ok', apk: '/x/fast2.apk' } };
  assert.equal(judge(run, same).verdict, 'pass');
  const stillNone = { ...okRun, fast: { status: 'unavailable' }, fastRetry: { status: 'unavailable', note: 'no base' } };
  assert.match(judge(stillNone, null).reasons.join(), /not applicable even after a full build/);
  // no retry happened because the full build failed: that failure is the reason
  assert.match(judge({ ...okRun, fast: { status: 'unavailable' }, full: { status: 'failed' } }, null).reasons.join(), /full build failed/);
});

test('result and alert text', () => {
  const j = judge(okRun, same);
  const md = renderResult({ ...okRun, runDir: '/r' }, same, j);
  assert.match(md, /^# Nightly fast-path cross-check 2026-10-17/);
  assert.match(md, /Ergebnis: OK.*1677/);
  assert.match(md, /base build 117/);
  const bad = { ok: false, differing: [{ name: 'assets/app.config', kind: 'differs' }], total: 1677 };
  const jb = judge(okRun, bad);
  assert.match(renderResult(okRun, bad, jb), /Ergebnis: FEHLER/);
  const al = renderAlert({ ...okRun, runDir: '/r' }, bad, jb);
  assert.match(al, /^# ALERT 2026-10-17/);
  assert.match(al, /assets\/app\.config: differs/);
  assert.match(al, /apk_swap\.py compare/);
});

function runDir(root, run) {
  const dir = join(root, 'run');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
  return dir;
}

test('finish writes the result for a pass, and result + ALERT + marker + compare.txt for a mismatch', () => {
  const t = tmp();
  try {
    const fast = join(t.root, 'fast.apk'), full = join(t.root, 'full.apk'), other = join(t.root, 'other.apk');
    zip(fast, base); zip(full, { ...base, 'META-INF/CERT.RSA': 'zzz' }); zip(other, { ...base, 'assets/index.android.bundle': 'hbc-X' });
    const reports = join(t.root, 'reports');

    let dir = runDir(t.root, { ...okRun, fast: { status: 'ok', apk: fast }, full: { status: 'ok', apk: full } });
    const pass = finish(dir, reports);
    assert.equal(pass.verdict, 'pass');
    assert.ok(existsSync(join(reports, '2026-10-17.md')));
    assert.ok(!existsSync(join(reports, 'ALERT-2026-10-17.md')));
    assert.ok(!existsSync(join(dir, 'ALERT')));

    dir = runDir(t.root, { ...okRun, fast: { status: 'ok', apk: fast }, full: { status: 'ok', apk: other } });
    const fail = finish(dir, reports);
    assert.equal(fail.verdict, 'fail');
    assert.match(readFileSync(join(reports, 'ALERT-2026-10-17.md'), 'utf8'), /assets\/index\.android\.bundle: differs/);
    assert.ok(existsSync(join(dir, 'ALERT')));
    assert.match(readFileSync(join(dir, 'compare.txt'), 'utf8'), /1 differing entry of 3/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'verdict.json'), 'utf8')).verdict, 'fail');

    // a later passing run of the same date replaces the alert
    dir = runDir(t.root, { ...okRun, fast: { status: 'ok', apk: fast }, full: { status: 'ok', apk: full } });
    assert.equal(finish(dir, reports).verdict, 'pass');
    assert.ok(!existsSync(join(reports, 'ALERT-2026-10-17.md')));
  } finally { t.done(); }
});

test('finish: a failed build is an alert even without any APK', () => {
  const t = tmp();
  try {
    const reports = join(t.root, 'reports');
    const dir = runDir(t.root, { date: '2026-10-18', sha: '0000000', source: 'none', fast: { status: 'failed' }, full: { status: 'failed', note: 'could not fetch main' } });
    const r = finish(dir, reports);
    assert.equal(r.verdict, 'fail');
    assert.match(readFileSync(join(reports, 'ALERT-2026-10-18.md'), 'utf8'), /could not fetch main/);
  } finally { t.done(); }
});

test('skip writes a result without an ALERT', () => {
  const t = tmp();
  try {
    const reports = join(t.root, 'reports');
    const dir = runDir(t.root, { date: '2026-10-19', busyReason: 'an emulator run holds the lock', waitedMinutes: 60 });
    assert.equal(skip(dir, reports).verdict, 'skipped');
    assert.match(readFileSync(join(reports, '2026-10-19.md'), 'utf8'), /uebersprungen \(kein Fehler\).*60 Minuten.*emulator/s);
    assert.ok(!existsSync(join(reports, 'ALERT-2026-10-19.md')));
  } finally { t.done(); }
});

test('pruneRuns keeps the newest 3 runs and the newest 3 alert runs, ignores foreign directories', () => {
  const t = tmp();
  try {
    const names = ['2026-10-10-aaaa111', '2026-10-11-bbbb222', '2026-10-12-cccc333', '2026-10-13-dddd444', '2026-10-14-eeee555', '2026-10-15-skipped'];
    for (const n of names) mkdirSync(join(t.root, n));
    mkdirSync(join(t.root, 'src'));
    writeFileSync(join(t.root, '2026-10-11-bbbb222', 'ALERT'), 'x');
    assert.deepEqual(pruneRuns(t.root, 3, { dryRun: true }).sort(), ['2026-10-10-aaaa111', '2026-10-12-cccc333']);
    assert.deepEqual(pruneRuns(t.root, 3).sort(), ['2026-10-10-aaaa111', '2026-10-12-cccc333']);
    for (const n of ['2026-10-11-bbbb222', '2026-10-13-dddd444', '2026-10-14-eeee555', '2026-10-15-skipped', 'src']) assert.ok(existsSync(join(t.root, n)), n);
    assert.deepEqual(pruneRuns(join(t.root, 'missing')), []);
  } finally { t.done(); }
});

/** run a bash snippet that sources the nightly script (it only runs main when executed) */
function sh(body, env = {}) {
  return spawnSync('bash', ['-c', `set -Eeuo pipefail; source "${SCRIPT}"; ${body}`], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('script: syntax, no pkill / pgrep -f, no credentials in URLs', () => {
  for (const f of [SCRIPT, join(ROOT, 'scripts', 'nightly', 'install.sh')]) {
    assert.equal(spawnSync('bash', ['-n', f]).status, 0, f);
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text.replace(/^\s*#.*$/gm, '').replace(/\s#\s.*$/gm, ''), /\b(pkill|pgrep\s+-\w*f)/);
    assert.doesNotMatch(text, /--no-verify|chmod 777/);
  }
});

test('script: waits while the host is busy, proceeds after two quiet polls', () => {
  const r = sh(`
    cnt="$(mktemp)"; echo 0 > "$cnt"   # host_busy_reason runs in a command substitution: count in a file
    host_busy_reason() { n=$(( $(cat "$cnt") + 1 )); echo $n > "$cnt"; if [ $n -le 2 ]; then echo "busy $n"; return 0; fi; return 1; }
    sleep() { :; }
    wait_idle && echo "idle after $(cat "$cnt") polls"; rm -f "$cnt"`, { HUI_NIGHTLY_WAIT_MIN: '60', HUI_NIGHTLY_POLL_S: '0' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /idle after 4 polls/);   // 2 busy + 2 quiet
});

test('script: gives up after the wait budget with the last busy reason', () => {
  const r = sh(`
    host_busy_reason() { echo "an emulator run holds the lock"; return 0; }
    sleep() { SECONDS=$((SECONDS + 1000)); }
    if wait_idle; then echo idle; else echo "gave up: $BUSY_REASON"; fi`, { HUI_NIGHTLY_WAIT_MIN: '60' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gave up: an emulator run holds the lock/);
});

test('script: lock probes see a held lock and a free one', () => {
  const t = tmp();
  try {
    const lock = join(t.root, 'x.lock');
    writeFileSync(lock, '');
    const free = sh(`lock_held "${lock}" && echo held || echo free`);
    assert.match(free.stdout, /free/);
    const held = sh(`exec 5>"${lock}"; flock -n 5; ( lock_held "${lock}" && echo held || echo free )`);
    assert.match(held.stdout, /held/, held.stderr);
    assert.match(sh(`lock_held "${join(t.root, 'missing')}" && echo held || echo free`).stdout, /free/);
  } finally { t.done(); }
});

test('script: fetch uses the primary remote, falls back to the second, and fails cleanly', () => {
  const t = tmp();
  try {
    const run = (cmd, args, cwd) => assert.equal(spawnSync(cmd, args, { cwd, encoding: 'utf8' }).status, 0, `${cmd} ${args.join(' ')}`);
    const repo = join(t.root, 'repo');
    mkdirSync(repo);
    run('git', ['init', '-q', '-b', 'main'], repo);
    writeFileSync(join(repo, 'f'), 'x');
    run('git', ['add', 'f'], repo);
    run('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-qm', 'c'], repo);
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    const body = `RUN_DIR="${t.root}"; NIGHTLY_HOME="${join(t.root, 'home')}"; fetch_source && echo "$SOURCE_NAME $FULL_SHA"`;
    const via = (remotes) => sh(body, { HUI_NIGHTLY_REMOTES: remotes, HUI_NIGHTLY_BRANCH: 'main' });
    const fb = via(`${join(t.root, 'missing')} ${repo}`);
    assert.equal(fb.status, 0, fb.stderr);
    assert.match(fb.stdout, new RegExp(`fallback .*${sha}`));
    assert.match(via(`${repo} ${join(t.root, 'missing')}`).stdout, new RegExp(`primary .*${sha}`));
    assert.notEqual(via(`${join(t.root, 'm1')} ${join(t.root, 'm2')}`).status, 0);
    // the work tree has no remote to push to
    assert.equal(spawnSync('git', ['-C', join(t.root, 'home', 'src'), 'remote'], { encoding: 'utf8' }).stdout.trim(), '');
  } finally { t.done(); }
});

test('unit templates: timer fires at 03:30, service runs the harness, placeholders all rendered by install.sh', () => {
  const timer = readFileSync(join(ROOT, 'scripts', 'nightly', 'hui-nightly-fastpath.timer.in'), 'utf8');
  const service = readFileSync(join(ROOT, 'scripts', 'nightly', 'hui-nightly-fastpath.service.in'), 'utf8');
  assert.match(timer, /OnCalendar=\*-\*-\* 03:30:00/);
  assert.match(timer, /WantedBy=timers\.target/);
  assert.match(service, /Type=oneshot/);
  assert.match(service, /ExecStart=@HARNESS_DIR@\/nightly-fastpath-check\.sh/);
  const install = readFileSync(join(ROOT, 'scripts', 'nightly', 'install.sh'), 'utf8');
  for (const ph of new Set((timer + service).match(/@[A-Z_]+@/g))) assert.ok(install.includes(ph), `install.sh renders ${ph}`);
});

test('script: heavy slice population includes child scopes even with an empty parent cgroup.procs', () => {
  const t = tmp();
  try {
    const slice = join(t.root, 'hui-nightly-test.slice');
    mkdirSync(slice);
    writeFileSync(join(slice, 'cgroup.procs'), '');
    for (const populated of [1, 0]) {
      writeFileSync(join(slice, 'cgroup.events'), `populated ${populated}\nfrozen 0\n`);
      const r = sh('systemctl() { echo /hui-nightly-test.slice; }; if heavy_slice_busy "$TEST_CGROUP_ROOT"; then echo busy; else echo idle; fi', { TEST_CGROUP_ROOT: t.root });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), populated ? 'busy' : 'idle');
    }
  } finally { t.done(); }
});

// Check groups of the smoke suite (scripts/e2e/suite.py GROUPS, smoke.sh --group): the table covers every check
// Suite.run() registers, smoke.sh rejects bad names before it needs an APK or an emulator, --group is forwarded to the
// host, and the report says when it is a subset. Nothing here touches adb or an emulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const SUITE = join(DIR, 'suite.py');
const SMOKE = join(DIR, 'smoke.sh');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const opts = { skip: !hasPython && 'no python3' };

const py = (args, cwd = DIR) => spawnSync('python3', ['-B', ...args], { encoding: 'utf8', cwd });
const suite = (...args) => py([SUITE, ...args]);
/** smoke.sh with a private dir so no developer e2e.env (host, live link) leaks into the test */
function smoke(args, env = {}) {
  const priv = mkdtempSync(join(tmpdir(), 'e2e-groups-test-'));
  try {
    return spawnSync('bash', [SMOKE, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: priv, HUI_PRIVATE_DIR: priv, ...env },
    });
  } finally {
    rmSync(priv, { recursive: true, force: true });
  }
}
/** the groups as suite.py prints them: { core: [ids] } */
function listed() {
  const out = {};
  for (const line of suite('--list-groups').stdout.split('\n')) {
    const m = /^ {2}(\w+)\s+(\S+)$/.exec(line);
    if (m && m[1] !== 'all') out[m[1]] = m[2].split(',');
  }
  return out;
}

test('group table: every check registered in Suite.run() is in a group, and only those', opts, () => {
  const r = suite('--check-selection');
  assert.equal(r.status, 0, r.stderr);
  // independent of suite.py's own check: read the registered ids from the source text
  const src = readFileSync(SUITE, 'utf8');
  const run = src.slice(src.indexOf('    def run(self, live_link=None)'), src.indexOf('\ndef main()'));
  const ids = [...run.matchAll(/(?:self\.check|r\.run)\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, `found ${ids.length} registered checks`);
  const grouped = Object.values(listed()).flat();
  assert.equal(new Set(grouped).size, grouped.length, 'a check is in two groups');
  const special = new Set(['install', 'pair', 'logcat', 'live', 'live_bots', 'live_quick']);
  assert.deepEqual([...grouped].sort(), ids.filter((i) => !special.has(i)).sort());
});

test('group table: a new check that is in no group fails the validation', opts, () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-groups-test-'));
  try {
    for (const f of ['suite.py', 'device.py', 'report.py']) copyFileSync(join(DIR, f), join(dir, f));
    const src = readFileSync(join(dir, 'suite.py'), 'utf8');
    const anchor = "            self.check('cold_start',";
    assert.ok(src.includes(anchor));
    writeFileSync(join(dir, 'suite.py'), src.replace(anchor, "            self.check('brand_new', 'x', self.c_dark)\n" + anchor));
    const r = py([join(dir, 'suite.py'), '--check-selection'], dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /'brand_new' is in no group/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selection: names are validated, --group and --only are a union', opts, () => {
  assert.equal(suite('--check-selection', '--group', 'core,net,ui,bg,all').status, 0);
  assert.equal(suite('--check-selection', '--group', 'ui', '--only', 'airplane,dark').status, 0);
  const bad = suite('--check-selection', '--group', 'core,nope');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown group: nope/);
  const badOnly = suite('--check-selection', '--only', 'dark,nope');
  assert.equal(badOnly.status, 2);
  assert.match(badOnly.stderr, /unknown check: nope/);
  const code = [
    'import sys; sys.path.insert(0, ".")',
    'import suite',
    'ids, label = suite.selection(["airplane"], ["ui"])',
    'print(sorted(ids), label)',
    'print(suite.selection([], []), suite.selection([], ["all"]), suite.selection(["dark"], ["all"]))',
  ].join('\n');
  const r = py(['-c', code]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\['airplane', 'checklist', 'chip_text', 'dark', 'demo_live', 'demo_wsp_card', 'share_image', 'table_font'\] group ui \+ only airplane/);
  assert.match(r.stdout, /\(None, 'all'\) \(None, 'all'\) \(None, 'all'\)/);
});

test('smoke.sh: an unknown group is rejected with exit 2 and the list, before the APK is needed', opts, () => {
  const r = smoke(['--group', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown group: nope/);
  assert.match(r.stderr, /core\s+version,/);
  const o = smoke(['--only', 'nope', '--host', 'h']);
  assert.equal(o.status, 2);
  assert.match(o.stderr, /unknown check: nope/);
});

test('smoke.sh: --group is forwarded to the host like --only; no selection forwards neither', opts, () => {
  const apk = join(DIR, 'smoke.sh'); // any readable file: the dry run stops before the APK is used
  const env = { E2E_DRY_RUN: '1' };
  const both = smoke(['--host', 'h', '--wait', '7', '--group', 'core,ui', '--only', 'airplane', apk], env);
  assert.equal(both.status, 0, both.stderr);
  assert.match(both.stdout, /dry-run remote args: --local --out \S+ --wait 7 --only airplane --group core,ui$/m);
  const none = smoke(['--host', 'h', apk], env);
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /dry-run remote args: --local --out \S+ --wait 0$/m);
  assert.doesNotMatch(none.stdout, /--group|--only/);
});

test('smoke.sh usage lists the options and the group table', opts, () => {
  const r = smoke(['-h']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--group g,g/);
  assert.match(r.stderr, /--live FILE/);
  assert.doesNotMatch(r.stderr, /Host rules/);
  assert.match(r.stderr, /bg\s+background/);
});

test('report: a subset run says so in the headline and in report.json', opts, () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-groups-test-'));
  const code = [
    'import sys, json; sys.path.insert(0, ".")',
    'from report import Report',
    'for sel, nr in ((sys.argv[2], ["dark"]), ("all", [])):',
    '    r = Report(sys.argv[1] + "/" + ("sub" if sel != "all" else "full"), dict(selection=sel, not_run=nr))',
    '    r.run("version", "t", lambda: None)',
    '    r.write()',
  ].join('\n');
  try {
    const r = py(['-c', code, dir, 'group core']);
    assert.equal(r.status, 0, r.stderr);
    const sub = readFileSync(join(dir, 'sub', 'report.md'), 'utf8');
    assert.match(sub, /^# E2E smoke: PASS \(subset: group core\)$/m);
    assert.match(sub, /Not run: dark/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'sub', 'report.json'), 'utf8')).partial, true);
    assert.match(readFileSync(join(dir, 'full', 'report.md'), 'utf8'), /^# E2E smoke: PASS$/m);
    assert.equal(JSON.parse(readFileSync(join(dir, 'full', 'report.json'), 'utf8')).partial, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// scripts/check.sh all --host (scripts/lib/check-remote.sh + check-remote-run.sh) against a fake host: the ssh stub runs
// every remote command on this machine with HOME=<tmp>/home, so the whole flow (tree shipping as git packs, run dir,
// node_modules cache, exit codes, cleanup) is exercised without a network. The fixture's scripts/check.sh is a stand-in
// for the gate; the real `check.sh all` summary is tested with stubbed npx/npm/node/python3 at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// the remote half needs a Node that strips TypeScript; without one it would try to download Node 22
const NODE_STRIPS = spawnSync('node', ['-e', 'process.exit(process.features.typescript ? 0 : 1)']).status === 0;
const SKIP = !NODE_STRIPS && 'this node cannot strip TypeScript';
const HOST = 'check.example.com';

function write(file, body, mode) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (mode) chmodSync(file, mode);
}

const FAKE_CHECK = `#!/usr/bin/env bash
cd "$(dirname "$0")/.."
echo $$ > "$FAKE_PIDFILE"
echo "fake check in $(basename "$PWD"): $(git ls-files | wc -l | tr -d ' ') files, head $(git rev-parse --short HEAD)"
[ -f marker.txt ] && echo "marker: $(cat marker.txt)"
[ -d app/node_modules ] && echo "app node_modules: $(cat app/node_modules/stamp)"
echo "tmpdir: $TMPDIR $(touch "$TMPDIR/probe" && echo writable)"
[ -n "\${FAKE_SLEEP:-}" ] && sleep "$FAKE_SLEEP"
echo "check: tsc ok, app tests 3 pass/0 fail - $([ "\${FAKE_RC:-0}" = 0 ] && echo 'all green' || echo 'FAILED: app tests') in 0m1s"
exit "\${FAKE_RC:-0}"
`;

/** a git repo with the two check-remote halves, heavy.sh, a fake check.sh and an app with a lockfile; a fake host */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'check-remote-test-'));
  const repo = join(dir, 'repo'); const home = join(dir, 'home'); const bin = join(dir, 'bin'); const log = join(dir, 'calls.log');
  mkdirSync(home); mkdirSync(bin);
  for (const f of ['scripts/lib/check-remote.sh', 'scripts/lib/check-remote-run.sh', 'scripts/lib/heavy.sh', 'scripts/lib/gate-stamp.sh', 'scripts/lib/clean-route-types.sh']) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(repo, f));
  }
  write(join(repo, 'scripts/check.sh'), FAKE_CHECK, 0o755);
  write(join(repo, 'app/package.json'), '{"name":"app","private":true}\n');
  write(join(repo, 'app/package-lock.json'), '{"lockfileVersion":3}\n');
  write(join(repo, '.gitignore'), 'node_modules/\n');
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one');
  // ssh: drop the options, log "ssh HOST CMD", run CMD here in the fake home
  write(join(bin, 'ssh'), `#!/bin/bash
while [ "$1" = -o ]; do shift 2; done
h=$1; shift
echo "ssh $h $*" >> "${log}"
cd "${home}" && HOME="${home}" exec bash -c "$*"
`, 0o755);
  write(join(bin, 'npm'), `#!/bin/bash
echo "npm $* in $(basename "$PWD")" >> "${log}"
[ "$1" = ci ] && mkdir -p node_modules && echo "installed $(date +%s%N)" > node_modules/stamp
exit 0
`, 0o755);
  // capped steps: no real scope; heavy.sh's slice setup fails like on a host without a user manager
  write(join(bin, 'systemd-run'), `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in --user|--scope|-q|--slice=*) shift ;; -p) shift 2 ;; *) break ;; esac; done
exec "$@"
`, 0o755);
  write(join(bin, 'systemctl'), '#!/bin/sh\nexit 1\n', 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  const base = join(home, '.cache/hui-check-remote');
  return { dir, repo, home, bin, log, calls, git, base, pidfile: join(dir, 'check.pid') };
}

function env(f, extra = {}) {
  const e = { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, HUI_PRIVATE_DIR: join(f.dir, 'priv'), FAKE_PIDFILE: f.pidfile, ...extra };
  for (const k of ['LINUX_HOST', 'HUI_CHECK_REMOTE_DIR', 'HUI_CHECK_REMOTE_TMPDIR', 'TMPDIR', 'HUI_CHECK_PLAIN', 'CI']) if (!(k in extra)) delete e[k];
  return e;
}

const runRemote = (f, args, extra) =>
  spawnSync('bash', [join(f.repo, 'scripts/lib/check-remote.sh'), ...args], { encoding: 'utf8', env: env(f, extra) });
const runsLeft = (f) => (existsSync(join(f.base, 'runs')) ? readdirSync(join(f.base, 'runs')) : []);

test('check.sh all --host: argument errors exit 2 before any ssh', () => {
  const f = fixture();
  try {
    const cases = [
      [[], /usage: scripts\/check\.sh all --host HOST/],
      [['--host', HOST, '--bogus'], /unknown argument '--bogus'/],
      [['--host', HOST, '--worktree', '--committed'], /exclude each other/],
      [['--host'], /usage/],
      [['--host', '-oProxyCommand=touch x'], /invalid host/],
      [['--host', 'a b'], /invalid host/],
      [['--host', 'linux'], /LINUX_HOST is not set/],
    ];
    for (const [args, re] of cases) {
      const r = runRemote(f, args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re, args.join(' '));
    }
    const r = runRemote(f, ['--host', HOST], { HUI_CHECK_REMOTE_DIR: '../elsewhere' });
    assert.equal(r.status, 2); assert.match(r.stderr, /invalid HUI_CHECK_REMOTE_DIR/);
    assert.equal(f.calls(), '', 'no ssh for an argument error');
    // the real check.sh hands `all --host` over and rejects other arguments to `all`
    const d = spawnSync('bash', [join(ROOT, 'scripts/check.sh'), 'all', '--host', '-bad'], { encoding: 'utf8', env: env(f) });
    assert.equal(d.status, 2); assert.match(d.stderr, /invalid host '-bad'/);
    const u = spawnSync('bash', [join(ROOT, 'scripts/check.sh'), 'all', '--worktree'], { encoding: 'utf8', env: env(f) });
    assert.equal(u.status, 2); assert.match(u.stderr, /usage: .* all \[--host HOST/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host: a dirty tree is refused (exit 2, files listed, nothing shipped)', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'marker.txt'), 'uncommitted\n');
    const r = runRemote(f, ['--host', HOST]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /\?\? marker\.txt/);
    assert.match(r.stderr, /--worktree to include them, or --committed/);
    assert.equal(f.calls(), '');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host: green run ships the tree once, caches node_modules, cleans up, prints one summary line', { skip: SKIP }, () => {
  const f = fixture();
  try {
    const r = runRemote(f, ['--host', HOST]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const head = f.git('rev-parse', '--short=12', 'HEAD').stdout.trim();
    const tree = f.git('rev-parse', 'HEAD^{tree}').stdout.trim();
    assert.match(r.stdout, /sending \d+ git objects \(first run on this host: the whole tree\)/);
    assert.match(r.stdout, /fake check in src: 9 files, head [0-9a-f]+/);
    assert.match(r.stdout, /app node_modules: installed/);
    const last = r.stdout.trim().split('\n').at(-1);
    assert.match(last, new RegExp(`^check --host ${HOST.replace(/\./g, '\\.')}: ${head} tsc ok, app tests 3 pass/0 fail - all green in 0m1s \\| setup node host node v[0-9.]+, app npm ci \\d+s in \\d+s \\| exit 0 \\(green\\) in \\d+m\\d+s$`));
    const c = f.calls();
    assert.match(c, new RegExp(`^ssh ${HOST.replace(/\./g, '\\.')} set -e; \\[ "\\$\\(uname -s\\)" = Linux \\]`, 'm'));
    assert.match(c, /git -C repo\.git index-pack --stdin/);
    assert.match(c, new RegExp(`exec setsid --wait bash '\\.cache/hui-check-remote/runs/[0-9-]+/src/scripts/lib/check-remote-run\\.sh'`));
    assert.equal((c.match(/^npm ci .* in app$/gm) || []).length, 1);
    assert.deepEqual(runsLeft(f), [], 'run dir removed');
    assert.equal(spawnSync('git', ['-C', join(f.base, 'repo.git'), 'rev-parse', `refs/trees/${tree}`], { encoding: 'utf8' }).stdout.trim(), tree);

    // same tree again: nothing sent, node_modules from the cache (hard-link copy, no npm ci)
    rmSync(f.log);
    const r2 = runRemote(f, ['--host', HOST]);
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.doesNotMatch(r2.stdout, /sending/);
    assert.match(r2.stdout.trim().split('\n').at(-1), /\| setup node host node v[0-9.]+, app cached in \d+s \| exit 0/);
    assert.doesNotMatch(f.calls(), /npm ci/);
    assert.doesNotMatch(f.calls(), /index-pack/);

    // a new commit: only its objects travel; a changed lockfile means npm ci again
    writeFileSync(join(f.repo, 'app/package-lock.json'), '{"lockfileVersion":3,"x":1}\n');
    f.git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'two');
    rmSync(f.log);
    const r3 = runRemote(f, ['--host', HOST]);
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.match(r3.stdout, /sending 3 git objects\n/, 'root tree, app tree, lockfile blob');
    assert.match(f.calls(), /^npm ci .* in app$/m);
    assert.deepEqual(runsLeft(f), []);
    assert.equal(readdirSync(join(f.base, 'nm')).filter((n) => n.startsWith('app-')).length, 2);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host: a red check returns its exit code and still removes the run dir', { skip: SKIP }, () => {
  const f = fixture();
  try {
    const r = runRemote(f, ['--host', HOST], { FAKE_RC: '1' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout.trim().split('\n').at(-1), /tsc ok, app tests 3 pass\/0 fail - FAILED: app tests in 0m1s .*\| exit 1 \(FAILED\) in /);
    assert.deepEqual(runsLeft(f), []);
    // an unreachable host: ssh's 255 comes back as is
    write(join(f.bin, 'ssh'), '#!/bin/sh\necho "ssh: connect to host: Connection refused" >&2\nexit 255\n', 0o755);
    const u = runRemote(f, ['--host', HOST]);
    assert.equal(u.status, 255, u.stdout + u.stderr);
    assert.match(u.stderr, /host not usable \(exit 255\)/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host: --worktree ships uncommitted files, --committed warns and leaves them out', { skip: SKIP }, () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'marker.txt'), 'uncommitted\n');
    const w = runRemote(f, ['--host', HOST, '--worktree']);
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.match(w.stdout, /marker: uncommitted/);
    assert.match(w.stdout, /fake check in src: 10 files/);
    assert.match(w.stdout.trim().split('\n').at(-1), /: [0-9a-f]{12}\+worktree tsc ok/);
    assert.equal(f.git('status', '--porcelain').stdout, '?? marker.txt\n', 'the real index is untouched');
    const c = runRemote(f, ['--host', HOST, '--committed']);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.match(c.stderr, /working tree changes are NOT included \(--committed\)/);
    assert.doesNotMatch(c.stdout, /marker:/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host linux: LINUX_HOST from the environment, else from the private build.env; macOS hosts are refused', { skip: SKIP }, () => {
  const f = fixture();
  try {
    write(join(f.dir, 'priv/build.env'), 'LINUX_HOST=linux-from-file.example.com\n');
    let r = runRemote(f, ['--host', 'linux']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(f.calls(), /^ssh linux-from-file\.example\.com /m);
    rmSync(f.log);
    r = runRemote(f, ['--host=linux'], { LINUX_HOST: 'linux-from-env.example.com' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(f.calls(), /^ssh linux-from-env\.example\.com /m);
    assert.doesNotMatch(f.calls(), /linux-from-file/);
    write(join(f.bin, 'uname'), '#!/bin/sh\necho Darwin\n', 0o755);
    rmSync(f.log);
    r = runRemote(f, ['--host', HOST]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /not a Linux host/);
    assert.doesNotMatch(f.calls(), /setsid/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host: TMPDIR on the host is in the run dir (not its /tmp), or under HUI_CHECK_REMOTE_TMPDIR; removed with the run', { skip: SKIP }, () => {
  const f = fixture();
  try {
    // the local TMPDIR (and the host's /tmp) is not what the remote run uses
    let r = runRemote(f, ['--host', HOST], { TMPDIR: tmpdir() });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const m = r.stdout.match(/^tmpdir: (\S+) writable$/m);
    assert.ok(m, r.stdout);
    assert.match(m[1], new RegExp(`^${f.base.replace(/[.]/g, '\\.')}/runs/[0-9-]+/tmp$`));
    assert.ok(!existsSync(m[1]), 'removed with the run dir');
    assert.deepEqual(runsLeft(f), []);
    // overridden: a per-run dir below it, removed afterwards, the parent stays
    const alt = join(f.dir, 'disk-tmp'); mkdirSync(alt);
    r = runRemote(f, ['--host', HOST], { HUI_CHECK_REMOTE_TMPDIR: alt });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const m2 = r.stdout.match(/^tmpdir: (\S+) writable$/m);
    assert.ok(m2, r.stdout);
    assert.match(m2[1], new RegExp(`^${alt.replace(/[.]/g, '\\.')}/hui-check-[0-9-]+$`));
    assert.match(f.calls(), /HUI_CHECK_REMOTE_TMPDIR='[^']+' exec setsid --wait bash/);
    assert.deepEqual(readdirSync(alt), []);
    // relative or shell-special values are refused before any ssh
    rmSync(f.log);
    for (const bad of ['tmp', '/tmp/a b', '/tmp/$(id)', '/tmp/../etc']) {
      const b = runRemote(f, ['--host', HOST], { HUI_CHECK_REMOTE_TMPDIR: bad });
      assert.equal(b.status, 2, bad);
      assert.match(b.stderr, /HUI_CHECK_REMOTE_TMPDIR must be an absolute plain path/);
    }
    assert.equal(f.calls(), '');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('check.sh all --host: TERM to the local side stops the remote process group and removes the run dir', { skip: SKIP }, async () => {
  const f = fixture();
  try {
    const p = spawn('bash', [join(f.repo, 'scripts/lib/check-remote.sh'), '--host', HOST], { env: env(f, { FAKE_SLEEP: '30' }) });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t0 = Date.now();
    while (!/fake check in/.test(out) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /fake check in/);
    const pid = Number(readFileSync(f.pidfile, 'utf8'));
    assert.equal(runsLeft(f).length, 1);
    p.kill('SIGTERM');
    const code = await new Promise((r) => (p.exitCode !== null ? r(p.exitCode) : p.once('exit', (c) => r(c))));
    assert.equal(code, 143, out);
    assert.ok(Date.now() - t0 < 15000, 'did not wait for the 30 s check');
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(pid, 0), 'the remote check process is gone');
    assert.deepEqual(runsLeft(f), []);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** the real scripts/check.sh in a skeleton tree, plain mode, with npx/npm/node/python3 stubs; FAIL_* pick failures */
function allFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'check-all-test-'));
  const bin = join(dir, 'bin');
  write(join(dir, 'tree/scripts/check.sh'), readFileSync(join(ROOT, 'scripts/check.sh'), 'utf8'), 0o755);
  for (const f of ['gate-stamp.sh', 'clean-route-types.sh']) write(join(dir, 'tree/scripts/lib', f), readFileSync(join(ROOT, 'scripts/lib', f), 'utf8'), 0o755);
  for (const d of ['app', 'push', 'hermes-plugin', 'bridge/test', 'bridge/node_modules']) mkdirSync(join(dir, 'tree', d), { recursive: true });
  write(join(bin, 'npx'), `#!/bin/bash
[ "$*" = "tsc --noEmit" ] && [ -n "$FAIL_TSC" ] && { echo "src/a.ts(1,1): error TS2322: no"; echo "src/b.ts(2,2): error TS2345: no"; exit 2; }
[ "$*" = "tsc --noEmit" ] && [ -n "$LOCK_TSC" ] && exit 75
exit 0
`, 0o755);
  write(join(bin, 'npm'), `#!/bin/bash
case "$(basename "$PWD")" in
  app) printf '# tests 12\\n# pass 12\\n# fail 0\\n' ;;
  push) if [ -n "$FAIL_PUSH" ]; then printf 'ℹ pass 4\\nℹ fail 1\\n'; exit 1; fi; printf 'ℹ pass 5\\nℹ fail 0\\n' ;;
  *) printf 'ℹ pass 9\\nℹ fail 0\\n' ;;
esac
`, 0o755);
  write(join(bin, 'node'), "#!/bin/bash\nprintf 'ℹ pass 7\\nℹ fail 0\\n'\n", 0o755);
  write(join(bin, 'python3'), "#!/bin/bash\nprintf 'Ran 4 tests in 0.1s\\n\\nOK\\n' >&2\n", 0o755);
  const run = (extra = {}) => spawnSync('bash', [join(dir, 'tree/scripts/check.sh'), 'all'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HUI_CHECK_PLAIN: '1', ...extra } });
  return { dir, run };
}

test('check.sh all: every step runs, the last line counts per step and names the failures', () => {
  const a = allFixture();
  try {
    let r = a.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const linux = process.platform === 'linux';
    assert.match(r.stdout.trim().split('\n').at(-1), new RegExp(`^check: tsc ok, tsc-test ok, app tests 12 pass/0 fail, ${linux ? 'scripts 7 pass/0 fail' : 'scripts skipped'}, bridge 9 pass/0 fail, push 5 pass/0 fail, hermes-plugin 4 ran - all green in 0m\\ds$`));
    r = a.run({ FAIL_TSC: '1', FAIL_PUSH: '1' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const last = r.stdout.trim().split('\n').at(-1);
    assert.match(last, /^check: tsc FAILED \(2 errors\), tsc-test ok, app tests 12 pass\/0 fail, .*push 4 pass\/1 fail FAILED, hermes-plugin 4 ran - FAILED: tsc push in /);
    assert.match(r.stdout, /src\/a\.ts\(1,1\): error TS2322/, 'step output is streamed');
    // a lock timeout stops the run (the other steps would wait for the same lock) and keeps exit 75
    r = a.run({ LOCK_TSC: '1' });
    assert.equal(r.status, 75, r.stdout + r.stderr);
    assert.match(r.stdout.trim().split('\n').at(-1), /^check: tsc lock timeout - FAILED: tsc in /);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
  }
});

test('check.sh all: the full bridge suite is a step of its own; without bridge/node_modules it fails with a hint', () => {
  const a = allFixture();
  try {
    rmSync(join(a.dir, 'tree/bridge/node_modules'), { recursive: true });
    const r = a.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout.trim().split('\n').at(-1), /, bridge 0 pass\/0 fail FAILED, .* - FAILED: bridge in /);
    assert.match(r.stdout + r.stderr, /bridge\/node_modules missing: run npm ci in bridge\//);
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
  }
});

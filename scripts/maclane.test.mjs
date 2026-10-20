// The second Android lane on the build Mac: --host resolution of build-apk.sh / e2e/smoke.sh (ssh and rsync stubbed),
// the macOS memory helpers (scripts/lib/hostmem.sh) and the guards of the remote lane. Nothing here touches a real host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// the build scripts started here take the Mac heavy lock when they run on a Mac: a private lock dir keeps a check run
// that already holds the real one (scripts/check.sh all on the build Mac) from deadlocking
process.env.HUI_MAC_LOCK_DIR = join(mkdtempSync(join(tmpdir(), 'hui-test-maclock-')), 'lock');
// the remote lanes sync a commit: a tree without one (the public export check) cannot run them
const NO_HEAD = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8' }).status !== 0 && 'no git commit in this tree';
const HOSTMEM = join(ROOT, 'scripts/lib/hostmem.sh');
const SMOKE = join(ROOT, 'scripts/e2e/smoke.sh');
const BUILD = join(ROOT, 'scripts/build-apk.sh');

/** a bin dir whose stubs log "<name> <args>" (and stdin for ssh) to calls.log; ssh exits with sshRc */
function stubs({ sshRc = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'maclane-test-'));
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  for (const name of ['ssh', 'rsync']) {
    const rc = name === 'ssh' ? sshRc : 0;
    // ssh with "bash -s" gets the script on stdin: keep it in the log
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\ncase "$*" in *"bash -s"*) cat >> "${log}";; esac\nexit ${name === 'ssh' ? 'IF_REMOTE' : 0}\n`.replace('IF_REMOTE', `$(case "$*" in (*"bash -s"*) echo ${rc};; (*) echo 0;; esac)`));
    chmodSync(join(bin, name), 0o755);
  }
  return { dir, bin, log, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}

function env(extra, bin) {
  const e = { ...process.env, ...extra };
  for (const k of ['MAC_HOST', 'E2E_HOST', 'HUI_ANDROID_LANE', 'HUI_BUILD_HOST', 'MEM_MAX', 'NINJA_JOBS', 'GRADLE_WORKERS', 'GRADLE_XMX', 'SKIP_NPM_CI', 'HUI_MAC_LOCK_WAIT', 'MIN_FREE_DISK_GB', 'HUI_MAC_MIN_AVAIL_MB', 'ABIS']) if (!(k in extra)) delete e[k];
  if (bin) e.PATH = `${bin}:${process.env.PATH}`;
  return e;
}

test('hostmem: host_avail_kb parses macOS vm_stat (free + inactive + speculative + purgeable pages)', () => {
  const { dir, bin } = stubs();
  try {
    writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Darwin\n');
    writeFileSync(join(bin, 'vm_stat'), `#!/bin/sh
cat <<'X'
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    47523.
Pages active:                                 231809.
Pages inactive:                               246031.
Pages speculative:                              2525.
Pages purgeable:                                1000.
X
`);
    chmodSync(join(bin, 'uname'), 0o755); chmodSync(join(bin, 'vm_stat'), 0o755);
    const r = spawnSync('bash', ['-c', `. "${HOSTMEM}"; host_avail_kb`], { encoding: 'utf8', env: env({}, bin) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(Number(r.stdout), ((47523 + 246031 + 2525 + 1000) * 16384) / 1024);
    const m = spawnSync('bash', ['-c', `. "${HOSTMEM}"; mem_kb 7G; mem_kb 512M; mem_kb 2097152`], { encoding: 'utf8' });
    assert.deepEqual(m.stdout.trim().split('\n'), ['7340032', '524288', '2048']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hostmem: tree_rss lists a process and its descendants, kill_tree stops them by pid', async () => {
  const p = spawn('bash', ['-c', 'sleep 60 & sleep 60 & wait'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  try {
    const r = spawnSync('bash', ['-c', `. "${HOSTMEM}"; tree_rss ${p.pid}`], { encoding: 'utf8' });
    const [rss, ...pids] = r.stdout.trim().split(/\s+/).map(Number);
    assert.ok(rss > 0);
    assert.ok(pids.includes(p.pid));
    assert.ok(pids.length >= 3, `expected the shell and two sleeps, got ${pids}`);
    const k = spawnSync('bash', ['-c', `. "${HOSTMEM}"; kill_tree ${p.pid}`], { encoding: 'utf8' });
    assert.equal(k.status, 0, k.stderr);
    await new Promise((r) => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', r)));   // reap the shell
    await new Promise((r) => setTimeout(r, 300));
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), `pid ${pid} still alive`);
  } finally {
    try { p.kill('SIGKILL'); } catch { /* already gone */ }
  }
});

test('smoke.sh --host mac resolves MAC_HOST (environment, then build.env) and runs with the Mac PATH and the lock libs', () => {
  const { dir, bin, calls } = stubs();
  try {
    const priv = join(dir, 'priv'); spawnSync('mkdir', ['-p', priv]);
    writeFileSync(join(priv, 'build.env'), 'MAC_HOST=mac-from-file.example.com\n');
    const apk = join(dir, 'hermes-ui-plus-release-abc1234-mac-debugsigned.apk'); writeFileSync(apk, 'x');
    const r = spawnSync('bash', [SMOKE, '--host', 'mac', '--out', join(dir, 'out'), apk],
      { encoding: 'utf8', env: env({ HUI_PRIVATE_DIR: priv }, bin) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = calls();
    assert.match(c, /ssh mac-from-file\.example\.com mkdir -p/);
    assert.match(c, /scripts\/lib\/maclock\.sh .*hostmem\.sh mac-from-file\.example\.com:/);
    assert.match(c, /ssh mac-from-file\.example\.com PATH="\$HOME\/\.local\/node\/bin:\/opt\/homebrew\/bin:\$PATH" bash .*smoke\.sh --local /);
    // the environment wins over the file
    rmSync(join(dir, 'calls.log'));
    const r2 = spawnSync('bash', [SMOKE, '--host', 'mac', '--out', join(dir, 'out2'), apk],
      { encoding: 'utf8', env: env({ HUI_PRIVATE_DIR: priv, MAC_HOST: 'mac-from-env.example.com' }, bin) });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(calls(), /ssh mac-from-env\.example\.com /);
    assert.doesNotMatch(calls(), /mac-from-file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('smoke.sh lane selection: HUI_ANDROID_LANE=mac beats E2E_HOST, an explicit --host beats the lane, MAC_HOST missing is an error', () => {
  const { dir, bin, calls } = stubs();
  try {
    const priv = join(dir, 'priv'); spawnSync('mkdir', ['-p', priv]);
    const apk = join(dir, 'a-1234567-b.apk'); writeFileSync(apk, 'x');
    const base = { HUI_PRIVATE_DIR: priv, E2E_HOST: 'linux.example.com', MAC_HOST: 'mac.example.com' };
    let r = spawnSync('bash', [SMOKE, '--out', join(dir, 'o1'), apk], { encoding: 'utf8', env: env({ ...base, HUI_ANDROID_LANE: 'mac' }, bin) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(calls(), /ssh mac\.example\.com /);
    rmSync(join(dir, 'calls.log'));
    r = spawnSync('bash', [SMOKE, '--host', 'other.example.com', '--out', join(dir, 'o2'), apk], { encoding: 'utf8', env: env({ ...base, HUI_ANDROID_LANE: 'mac' }, bin) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(calls(), /ssh other\.example\.com /);
    rmSync(join(dir, 'calls.log'));
    r = spawnSync('bash', [SMOKE, '--out', join(dir, 'o3'), apk], { encoding: 'utf8', env: env({ ...base }, bin) });
    assert.match(calls(), /ssh linux\.example\.com /, 'default lane stays E2E_HOST');
    r = spawnSync('bash', [SMOKE, '--host', 'mac', '--out', join(dir, 'o4'), apk], { encoding: 'utf8', env: env({ HUI_PRIVATE_DIR: priv }, bin) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /MAC_HOST is not set/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const LANE_SYNC = join(ROOT, 'scripts/lib/lane-sync.sh');
const FAKE_HOST = 'mac.example.com';

/** ssh/rsync stubs that "connect" to this machine: the command runs locally with HOME=home, host: prefixes map to home/.
 *  An ssh call whose `bash -s` script runs build-apk.sh (the build) is only recorded and fails, so no build ever starts, unless
 *  fakeBuild is given: then a stand-in "builds" in the run directory the script cd's into (fakeBuild below). */
function fakeHost({ fakeBuild = null } = {}) {
  const REAL_RSYNC = spawnSync('sh', ['-c', 'command -v rsync'], { encoding: 'utf8' }).stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'lane-test-'));
  const home = join(dir, 'home'); const bin = join(dir, 'bin'); const log = join(dir, 'calls.log');
  mkdirSync(home); mkdirSync(bin);
  writeFileSync(join(bin, 'ssh'), `#!/bin/bash
while [ "$1" = -o ]; do shift 2; done
shift   # host
echo "ssh $*" >> "${log}"
if [ "$*" = "bash -s" ]; then
  script="$(cat)"; echo "$script" >> "${log}"
  case "$script" in *scripts/build-apk*) ${fakeBuild ? `cd "${home}" && HOME="${home}" exec bash "${join(dir, 'fake-build.sh')}" "$script"` : 'exit 1'};; esac   # the real build never runs in a test
  cd "${home}" && HOME="${home}" exec bash -c "$script"
fi
cd "${home}" && HOME="${home}" exec bash -c "$*"
`);
  writeFileSync(join(bin, 'rsync'), `#!/bin/bash
args=(); for a in "$@"; do case "$a" in ${FAKE_HOST}:*) a="${home}/\${a#*:}";; esac; args+=("$a"); done
echo "rsync $*" >> "${log}"
exec ${REAL_RSYNC} "\${args[@]}"
`);
  chmodSync(join(bin, 'ssh'), 0o755); chmodSync(join(bin, 'rsync'), 0o755);
  if (fakeBuild) writeFileSync(join(dir, 'fake-build.sh'), fakeBuild);
  // the real rsync must stay reachable: the stub calls it by PATH after dropping its own dir
  return { dir, home, bin, log, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function sync(fh, repo, extraEnv = {}) {
  const realPath = process.env.PATH;
  const r = spawnSync('bash', ['-c', `. "${LANE_SYNC}"; lane_sync ${FAKE_HOST} hui-lane "${repo}" && echo "LABEL=$LANE_LABEL" && echo "DIR=$LANE_DIR" && echo "STAMP=$LANE_STAMP"`], {
    encoding: 'utf8', env: { ...process.env, PATH: `${fh.bin}:${realPath}`, TMPDIR: fh.dir, ...extraEnv },
  });
  const dir = (/DIR=(\S+)/.exec(r.stdout) || [])[1];
  return { status: r.status, out: r.stdout + r.stderr, label: (/LABEL=(\S+)/.exec(r.stdout) || [])[1], dir, src: dir && join(fh.home, dir), stamp: (/STAMP=(.+)/.exec(r.stdout) || [])[1] };
}

test('lane_sync: first sync sends a bundle, then only the exact commit lands in a run dir of its own (no docs/), a repeat sends nothing', () => {
  const fh = fakeHost();
  const repo = join(fh.dir, 'repo'); mkdirSync(repo);
  try {
    git(repo, 'init', '-q');
    for (const [f, c] of [['app/a.txt', 'one'], ['scripts/s.sh', 'echo s'], ['bridge/src/replay.mjs', 'x'], ['docs/readme.md', 'doc']]) {
      mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), c);
    }
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'one');
    const sha1 = git(repo, 'rev-parse', 'HEAD');
    let r = sync(fh, repo);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /sending a bundle of [0-9a-f]{7}/);
    assert.equal(r.label, sha1.slice(0, 7));
    const src = r.src;
    assert.match(r.dir, new RegExp(`^hui-lane/runs/\\d{8}-\\d{6}-${sha1.slice(0, 7)}-\\d+-\\d+$`));
    assert.equal(readFileSync(join(src, 'app/a.txt'), 'utf8'), 'one');
    assert.ok(existsSync(join(src, 'bridge/src/replay.mjs')));
    assert.ok(!existsSync(join(src, 'docs')), 'only app/, scripts/ and replay.mjs are synced');
    assert.equal(git(join(fh.home, 'hui-lane/repo.git'), 'rev-parse', `refs/lane/${sha1}`), sha1);
    // second commit: the host has the first, the bundle must carry the prerequisite (incremental)
    writeFileSync(join(repo, 'app/a.txt'), 'two'); git(repo, 'commit', '-q', '-am', 'two');
    const sha2 = git(repo, 'rev-parse', 'HEAD');
    r = sync(fh, repo);
    assert.equal(r.status, 0, r.out);
    assert.notEqual(r.src, src, 'every sync gets a new run dir');
    assert.equal(readFileSync(join(r.src, 'app/a.txt'), 'utf8'), 'two');
    assert.equal(readFileSync(join(src, 'app/a.txt'), 'utf8'), 'one', 'the earlier run keeps its own sources');
    assert.equal(git(join(fh.home, 'hui-lane/repo.git'), 'rev-parse', `refs/lane/${sha2}`), sha2);
    // nothing new: no bundle
    r = sync(fh, repo);
    assert.match(r.out, /host already has/);
    assert.doesNotMatch(r.out, /sending a bundle/);
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
  }
});

test('lane_sync: uncommitted changes are overlaid (label gets -dirty), deleted files are removed, HUI_LANE_GIT_URL is used when set', () => {
  const fh = fakeHost();
  const repo = join(fh.dir, 'repo'); mkdirSync(repo);
  try {
    git(repo, 'init', '-q');
    for (const [f, c] of [['app/a.txt', 'one'], ['scripts/s.sh', 'echo s']]) { mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), c); }
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'one');
    writeFileSync(join(repo, 'app/a.txt'), 'edited');
    writeFileSync(join(repo, 'scripts/new.sh'), 'echo new');
    rmSync(join(repo, 'scripts/s.sh'));
    const r = sync(fh, repo, { HUI_LANE_GIT_URL: repo });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /fetched [0-9a-f]{7} itself from HUI_LANE_GIT_URL/);
    assert.doesNotMatch(r.out, /sending a bundle/);
    assert.match(r.label, /-dirty$/);
    const src = r.src;
    assert.equal(readFileSync(join(src, 'app/a.txt'), 'utf8'), 'edited');
    assert.equal(readFileSync(join(src, 'scripts/new.sh'), 'utf8'), 'echo new');
    assert.ok(!existsSync(join(src, 'scripts/s.sh')));
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
  }
});

test('lane_sync: the host tries its own git sources in order (Forgejo, then GitHub) before any bundle is sent', () => {
  const fh = fakeHost();
  const repo = join(fh.dir, 'repo'); mkdirSync(repo);
  try {
    git(repo, 'init', '-q');
    mkdirSync(join(repo, 'app')); writeFileSync(join(repo, 'app/a.txt'), 'one');
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'one');
    const srcs = join(fh.home, 'hui-lane/git-sources.d'); mkdirSync(srcs, { recursive: true });
    writeFileSync(join(srcs, '10-forgejo.url'), join(fh.dir, 'does-not-exist.git') + '\n');
    writeFileSync(join(srcs, '20-github.url'), repo + '\n');
    const r = sync(fh, repo);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /fetch from forgejo failed, trying the next source/);
    assert.match(r.out, /host fetched [0-9a-f]{7} from github in \d+ s/);
    assert.doesNotMatch(r.out, /sending a bundle/);
    assert.equal(readFileSync(join(r.src, 'app/a.txt'), 'utf8'), 'one');
    // all sources dead: the bundle is the last resort
    rmSync(join(srcs, '20-github.url'));
    writeFileSync(join(repo, 'app/a.txt'), 'two'); git(repo, 'commit', '-q', '-am', 'two');
    const r2 = sync(fh, repo);
    assert.equal(r2.status, 0, r2.out);
    assert.match(r2.out, /fetch from forgejo failed/);
    assert.match(r2.out, /sending a bundle/);
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
  }
});

test('build-apk.sh --host: needs MAC_HOST, refuses other ABIs; the remote build gets no keystore, skips the host-side gate and leaves the APK on the host', { skip: NO_HEAD }, () => {
  const fh = fakeHost();
  const distBefore = new Set(existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []);
  try {
    const priv = join(fh.dir, 'priv'); mkdirSync(priv);
    const common = { HUI_PRIVATE_DIR: priv, FLAVOR: 'hermes', HUI_LANE_GIT_URL: join(ROOT, '.git') };
    let r = spawnSync('bash', [BUILD, '--host', 'mac', 'release'], { encoding: 'utf8', env: env(common, fh.bin) });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /MAC_HOST is not set/);
    r = spawnSync('bash', [BUILD, '--host', 'mac', 'release'], { encoding: 'utf8', env: env({ ...common, MAC_HOST: FAKE_HOST, ABIS: 'x86_64' }, fh.bin) });
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /arm64-v8a only/);
    r = spawnSync('bash', [BUILD, '--host', 'mac', 'release'],
      { encoding: 'utf8', env: env({ ...common, MAC_HOST: FAKE_HOST, HERMES_KEYSTORE: '/nonexistent/release.jks', HERMES_KEYSTORE_PASS: 'fake', MEM_MAX: '6G' }, fh.bin) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /REMOTE BUILD FAILED/);
    const c = fh.calls();
    assert.doesNotMatch(c, /rsync .*app\//, 'no bulk rsync of app/ any more');
    assert.match(c, /FLAVOR=hermes HUI_ANDROID_LANE=local ABIS=arm64-v8a HUI_BUILD_SHA='[0-9a-f]{7}(-dirty)?' HUI_LANE_STAMP='[0-9a-f]{40} [0-9a-f-]+' HUI_APK_TAG=-mac HUI_SKIP_RELEASE_GATE=1 ALLOW_DEBUG_SIGNED=1 MEM_MAX=6G\s*\\\n/);
    assert.match(c, /cd "\$HOME\/hui-lane\/runs\/[0-9]{8}-[0-9]{6}-[0-9a-f]{7}-\d+-\d+"\n/, 'the build runs in its own run dir');
    assert.match(c, /bash scripts\/build-apk\.sh release/);
    assert.doesNotMatch(c, /KEYSTORE|release\.jks|fake/);
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
    for (const f of existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []) {
      if (!distBefore.has(f) && /^build-release-.*-remote\.log$/.test(f)) rmSync(join(ROOT, 'dist', f), { force: true });
    }
  }
});

test('smoke.sh --apk-on-host: uploads nothing, runs the smoke.sh of the host checkout and fetches only the report', () => {
  const { dir, bin, calls } = stubs();
  try {
    const r = spawnSync('bash', [SMOKE, '--host', 'mac.example.com', '--apk-on-host', 'hui-lane/src/dist/a-1234567-mac.apk', '--out', join(dir, 'out')],
      { encoding: 'utf8', env: env({}, bin) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = calls();
    assert.match(c, /smoke\.sh --local .* \$HOME\/hui-lane\/src\/dist\/a-1234567-mac\.apk/);
    assert.match(c, /\$HOME\/hui-lane\/src\/scripts\/e2e\/smoke\.sh/);
    assert.doesNotMatch(c, /rsync -a .*\.apk /, 'the APK is not uploaded');
    assert.match(c, /rsync -a mac\.example\.com:\/tmp\/hui-e2e-run-.*\/out\//);
    const bad = spawnSync('bash', [SMOKE, '--apk-on-host', '../x.apk', '--out', join(dir, 'o')], { encoding: 'utf8', env: env({}, bin) });
    assert.equal(bad.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lane_sync: two agents syncing different commits keep separate run dirs, each with its own stamp (the 9a929f8 race)', () => {
  const fh = fakeHost();
  const repo = join(fh.dir, 'repo'); mkdirSync(repo);
  try {
    git(repo, 'init', '-q');
    for (const [f, c] of [['app/a.txt', 'A'], ['scripts/e2e/suite.py', 'suite A']]) { mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), c); }
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'A');
    const shaA = git(repo, 'rev-parse', 'HEAD');
    const a = sync(fh, repo);
    assert.equal(a.status, 0, a.out);
    // agent B syncs another commit while A's build would still wait for the lock
    writeFileSync(join(repo, 'app/a.txt'), 'B'); writeFileSync(join(repo, 'scripts/e2e/suite.py'), 'suite B');
    git(repo, 'commit', '-q', '-am', 'B');
    const b = sync(fh, repo);
    assert.equal(b.status, 0, b.out);
    assert.notEqual(a.dir, b.dir);
    assert.equal(readFileSync(join(a.src, 'app/a.txt'), 'utf8'), 'A', "B's sync must not touch A's sources");
    assert.equal(readFileSync(join(a.src, 'scripts/e2e/suite.py'), 'utf8'), 'suite A', "nor the suite A's smoke runs");
    assert.equal(readFileSync(join(b.src, 'scripts/e2e/suite.py'), 'utf8'), 'suite B');
    // the stamp: full sha + run id, in the run and in app/ (which the build copies)
    assert.match(a.stamp, new RegExp(`^${shaA} ${a.dir.split('/').pop()}$`));
    for (const r of [a, b]) {
      assert.equal(readFileSync(join(r.src, '.lane-stamp'), 'utf8').trim(), r.stamp);
      assert.equal(readFileSync(join(r.src, 'app/.lane-stamp'), 'utf8').trim(), r.stamp);
    }
    assert.notEqual(a.stamp, b.stamp);
    assert.ok(!existsSync(join(fh.home, 'hui-lane/src')), 'the shared checkout is gone');
    assert.deepEqual(readdirSync(join(fh.home, 'hui-lane')).filter((f) => f.endsWith('.bundle')), [], 'per-run bundles are removed');
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
  }
});

test('lane_sync prunes finished runs (count, age, low disk) and abandoned ones, never a run in progress or a busy one', () => {
  const fh = fakeHost();
  const repo = join(fh.dir, 'repo'); mkdirSync(repo);
  try {
    git(repo, 'init', '-q');
    mkdirSync(join(repo, 'app')); writeFileSync(join(repo, 'app/a.txt'), 'x');
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'x');
    const runs = join(fh.home, 'hui-lane/runs'); mkdirSync(runs, { recursive: true });
    const H = 3600;
    const now = Date.now() / 1000;
    /** a fake run: done or not, its marker (or the dir itself) aged by `age` seconds */
    const mk = (name, { done = false, age = 0, busy = null } = {}) => {
      const d = join(runs, name); mkdirSync(join(d, 'dist'), { recursive: true });
      if (done) { writeFileSync(join(d, '.lane-done'), ''); utimesSync(join(d, '.lane-done'), now - age, now - age); }
      if (busy !== null) { writeFileSync(join(d, '.lane-busy'), ''); utimesSync(join(d, '.lane-busy'), now - busy, now - busy); }
      utimesSync(d, now - age, now - age);
    };
    for (let i = 1; i <= 8; i++) mk(`done-${i}`, { done: true, age: i * 60 });   // newest first: done-1 .. done-8
    mk('done-old', { done: true, age: 30 * H });
    mk('done-old-busy', { done: true, age: 30 * H, busy: 60 });
    mk('abandoned', { age: 7 * H });
    mk('abandoned-busy', { age: 7 * H, busy: 120 });
    mk('in-progress', { age: 1 * H });
    // the normal rules first: no low-disk mode, whatever this machine's free space (a full /tmp would drop every finished run)
    let r = sync(fh, repo, { HUI_LANE_MIN_FREE_GB: '0' });
    assert.equal(r.status, 0, r.out);
    const left = () => readdirSync(runs).sort();
    const keep = ['abandoned-busy', 'done-1', 'done-2', 'done-3', 'done-4', 'done-5', 'done-6', 'done-old-busy', 'in-progress', r.dir.split('/').pop()].sort();
    assert.deepEqual(left(), keep);
    assert.match(r.out, /removing the abandoned run abandoned\n/);
    // low disk: every finished run goes (busy ones stay), runs in progress stay
    r = sync(fh, repo, { HUI_LANE_MIN_FREE_GB: '999999' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /GB free on the host \(< 999999\): dropping every finished run/);
    assert.deepEqual(left().filter((n) => n.startsWith('done')), ['done-old-busy']);
    assert.ok(left().includes('in-progress'));
    // bad numbers are refused before anything happens
    r = sync(fh, repo, { HUI_LANE_KEEP_RUNS: '3; rm -rf /' });
    assert.equal(r.status, 2);
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
  }
});

const STAMP_LIB = join(ROOT, 'scripts/lib/lane-stamp.sh');
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

test('lane_stamp_check: no stamp = nothing to check; the copy must carry exactly this run\'s stamp, else the build stops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-stamp-'));
  try {
    const app = join(dir, 'app'); mkdirSync(app);
    const check = (stamp) => spawnSync('bash', ['-c', `. "${STAMP_LIB}"; lane_stamp_check "${app}" && echo "SRC=$LANE_STAMP_SOURCE"`],
      { encoding: 'utf8', env: { ...process.env, HUI_LANE_STAMP: stamp } });
    let r = check('');
    assert.equal(r.status, 0); assert.match(r.stdout, /^SRC=$/m);
    r = check(`${SHA} run-1`);
    assert.equal(r.status, 1); assert.match(r.stderr, /LANE SOURCE MISMATCH: .* carries the stamp '<none>'/);
    writeFileSync(join(app, '.lane-stamp'), `${SHA} run-1\n`);
    r = check(`${SHA} run-1`);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /SRC=abcdef0$/m); assert.match(r.stdout, /build input verified \(commit abcdef0, run run-1\)/);
    // same commit, another run (another agent's dirty overlay of the same commit): still refused
    r = check(`${SHA} run-2`);
    assert.equal(r.status, 1); assert.match(r.stderr, /Another run changed the sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** an APK-like zip whose assets/app.config names `source` */
function apkWithSource(path, source) {
  const code = 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],"w")\nz.writestr("assets/app.config",sys.argv[2])\nz.writestr("assets/index.android.bundle","x")\nz.close()';
  const cfg = JSON.stringify({ name: 'x', extra: { flavor: 'hermes', buildNumber: 7, ...(source ? { buildSource: source } : {}) } });
  assert.equal(spawnSync('python3', ['-I', '-c', code, path, cfg]).status, 0);
}

test('lane_apk_source reads buildSource from the APK\'s app.config (empty without one)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-stamp-'));
  try {
    apkWithSource(join(dir, 'a.apk'), 'abc1234');
    apkWithSource(join(dir, 'b.apk'), '');
    const r = spawnSync('bash', ['-c', `. "${STAMP_LIB}"; echo "A=$(lane_apk_source "${join(dir, 'a.apk')}")"; echo "B=$(lane_apk_source "${join(dir, 'b.apk')}")"; echo "C=$(lane_apk_source "${join(dir, 'nope.apk')}")"`], { encoding: 'utf8' });
    assert.equal(r.stdout, 'A=abc1234\nB=\nC=\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-apk.sh / build-apk-fast.sh check the lane stamp right after copying app/ and take buildSource from it', () => {
  for (const [file, copy] of [['scripts/build-apk.sh', '"$ROOT/app/" "$BUILD_DIR/app/"'], ['scripts/build-apk-fast.sh', '"$ROOT/app/" "$FAST_DIR/app/"']]) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const at = text.indexOf(copy);
    assert.ok(at > 0, `${file}: app/ copy not found`);
    const after = text.slice(at, at + 400);
    assert.match(after, /lane_stamp_check "\$(BUILD_DIR|FAST_DIR)\/app" \|\| exit 1/, `${file}: no stamp check right after the copy`);
    assert.ok(text.indexOf('maclock_acquire') < at, `${file}: the check must run under the build lock`);
  }
  assert.match(readFileSync(join(ROOT, 'scripts/build-apk.sh'), 'utf8'), /HUI_BUILD_SOURCE="\$LANE_STAMP_SOURCE"/);
  assert.match(readFileSync(join(ROOT, 'scripts/build-apk-fast.sh'), 'utf8'), /HUI_BUILD_SOURCE="\$\{LANE_STAMP_SOURCE:-\$\{SHA%-dirty\}\}" scope bundle/);
});

/** stand-in for the host's build: "builds" an APK in the run dir the script cd's into, naming the commit of the run's app/ stamp
 *  (as build-apk.sh does), or FAKE_SOURCE (a build that picked up other sources) */
const FAKE_BUILD = `script="$1"
run=$(printf '%s\\n' "$script" | sed -n 's#^cd "\\$HOME/\\(.*\\)"$#\\1#p')
label=$(printf '%s\\n' "$script" | sed -n "s#.*HUI_BUILD_SHA='\\([^']*\\)'.*#\\1#p")
src=$(cut -c1-7 "$HOME/$run/app/.lane-stamp"); [ -z "\${FAKE_SOURCE:-}" ] || src=$FAKE_SOURCE
out="$HOME/\${FAKE_OUT_DIR:-$run/dist}"; mkdir -p "$out"
apk="$out/hermes-ui-plus-release-$label-mac-debugsigned.apk"
python3 -I -c 'import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("assets/app.config","{\\"extra\\":{\\"buildSource\\":\\""+sys.argv[2]+"\\"}}"); z.close()' "$apk" "$src"
echo "APK: $apk (1M)"
`;

test('android_remote_build: the APK must name the synced commit; a mismatch fails loudly, nothing is fetched or smoke-tested; the run is finished afterwards', { skip: NO_HEAD }, () => {
  const distBefore = new Set(existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []);
  const fh = fakeHost({ fakeBuild: FAKE_BUILD });
  try {
    const priv = join(fh.dir, 'priv'); mkdirSync(priv);
    const common = { HUI_PRIVATE_DIR: priv, FLAVOR: 'hermes', HUI_LANE_GIT_URL: join(ROOT, '.git'), MAC_HOST: FAKE_HOST };
    // honest build
    let r = spawnSync('bash', [BUILD, '--host', 'mac', 'release'], { encoding: 'utf8', env: env(common, fh.bin) });
    let out = r.stdout + r.stderr;
    assert.equal(r.status, 0, out);
    assert.match(out, /== APK verified: built from [0-9a-f]{7} \(run [0-9a-f-]+\)/);
    assert.match(out, /APK stays on the host: ~\/hui-lane\/runs\/[0-9a-f-]+\/dist\/hermes-ui-plus-release-[0-9a-f]{7}(-dirty)?-mac-debugsigned\.apk/);
    const runDir = join(fh.home, /run directory ~\/(\S+)/.exec(out)[1]);
    assert.ok(existsSync(join(runDir, '.lane-done')), 'the run is marked done');
    assert.ok(!existsSync(join(runDir, 'app')), "the run's app/ is dropped");
    assert.ok(existsSync(join(runDir, 'scripts/e2e/suite.py')), 'scripts stay for a later --apk-on-host smoke');
    // the build used other sources (the race): loud failure, no fetch, no smoke
    writeFileSync(fh.log, '');
    r = spawnSync('bash', [BUILD, '--host', 'mac', '--fetch', '--smoke', 'release'], { encoding: 'utf8', env: env({ ...common, FAKE_SOURCE: 'deadbee' }, fh.bin) });
    out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    assert.match(out, /LANE COMMIT MISMATCH: .* was built from 'deadbee', this run synced [0-9a-f]{7}\. Not fetched, not smoke-tested\./);
    assert.doesNotMatch(fh.calls(), /rsync -a mac\.example\.com:.*\.apk/, 'nothing fetched');
    assert.doesNotMatch(out, /smoke on the host/);
    // an APK the host reports outside this run is refused as well
    r = spawnSync('bash', [BUILD, '--host', 'mac', 'release'], { encoding: 'utf8', env: env({ ...common, FAKE_OUT_DIR: 'hui-lane/elsewhere' }, fh.bin) });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /LANE COMMIT MISMATCH: the host reported .*hui-lane\/elsewhere\/.*, outside this run/);
  } finally {
    rmSync(fh.dir, { recursive: true, force: true });
    for (const f of existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []) {
      if (!distBefore.has(f) && /^build-release-.*-remote\.log$/.test(f)) rmSync(join(ROOT, 'dist', f), { force: true });
    }
  }
});

test('smoke.sh --apk-on-host in a run dir: the scripts of that run, marked busy while the smoke runs', () => {
  const { dir, bin, calls } = stubs();
  try {
    const run = 'hui-lane/runs/20261020-115200-abc1234-42-7';
    const r = spawnSync('bash', [SMOKE, '--host', 'mac.example.com', '--apk-on-host', `${run}/dist/a-abc1234-mac.apk`, '--out', join(dir, 'out')],
      { encoding: 'utf8', env: env({}, bin) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = calls();
    assert.match(c, new RegExp(`\\$HOME/${run}/scripts/e2e/smoke\\.sh --local `));
    assert.match(c, new RegExp(`mkdir -p /tmp/hui-e2e-run-[^ ]+-\\d+-\\d+/out; touch \\$HOME/${run}/\\.lane-busy`));
    assert.match(c, new RegExp(`rm -rf /tmp/hui-e2e-run-[^ ]+; rm -f \\$HOME/${run}/\\.lane-busy`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const STORE_LIB = join(ROOT, 'scripts/lib/android-store.sh');

/** run a snippet with android-store.sh sourced; darwin = a uname stub that says Darwin. HOME is a throwaway dir, crontab and
 *  launchctl are stubs (crontab keeps its table in `cron`, or in a fresh file per call), so no test touches this machine's own. */
function store(snippet, extraEnv = {}, { darwin = false, cron = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'android-store-bin-'));
  try {
    const tab = cron ?? join(dir, 'crontab.txt');
    if (darwin) { writeFileSync(join(dir, 'uname'), '#!/bin/sh\necho Darwin\n'); chmodSync(join(dir, 'uname'), 0o755); }
    writeFileSync(join(dir, 'crontab'), `#!/bin/sh\ncase "$1" in -l) [ -f "${tab}" ] && cat "${tab}" || { echo "no crontab" >&2; exit 1; };; -) cat > "${tab}";; esac\n`);
    writeFileSync(join(dir, 'launchctl'), `#!/bin/sh\necho "launchctl $*" >> "${tab}.launchctl"\n`);
    chmodSync(join(dir, 'crontab'), 0o755); chmodSync(join(dir, 'launchctl'), 0o755);
    const home = join(dir, 'home'); mkdirSync(home);
    const e = { ...process.env, HOME: home, PATH: `${dir}:${process.env.PATH}`, ...extraEnv };
    for (const k of ['ANDROID_HOME', 'GRADLE_USER_HOME', 'HUI_ANDROID_STORE', 'HUI_ANDROID_OLD_STORE', 'HUI_COMPAT_DIR', 'HUI_LAUNCH_AGENTS_DIR']) if (!(k in extraEnv)) delete e[k];
    const r = spawnSync('bash', ['-c', `. "${STORE_LIB}"; ${snippet}`], { encoding: 'utf8', env: e });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('android-store: Linux keeps /var/tmp, macOS uses /Users/Shared (physical path), HUI_ANDROID_STORE overrides', () => {
  let r = store('android_store_init; echo "$STORE_SDK|$STORE_GRADLE|$STORE_BUILD|$STORE_FAST"');
  assert.equal(r.out.trim(), '/var/tmp/hiui-android-sdk|/var/tmp/hiui-gradle|/var/tmp/hiui-build-hermes|/var/tmp/hiui-fast-hermes');
  r = store('android_store_init; echo "$STORE_SDK"', {}, { darwin: true });
  assert.equal(r.out.trim(), '/Users/Shared/hiui-android-sdk');
  const dir = mkdtempSync(join(tmpdir(), 'android-store-'));
  try {
    mkdirSync(join(dir, 'real')); symlinkSync(join(dir, 'real'), join(dir, 'link'));
    r = store('android_store_init; echo "$STORE_BUILD"', { HUI_ANDROID_STORE: join(dir, 'link') }, { darwin: true });
    assert.equal(r.out.trim(), `${realpathSync(join(dir, 'real'))}/hiui-build-hermes`, 'macOS: the physical path (fingerprint key)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('android-store: the Mac moves an SDK / Gradle cache left in /var/tmp once (rename + symlink), never over an existing one or a custom ANDROID_HOME', () => {
  const dir = mkdtempSync(join(tmpdir(), 'android-store-'));
  try {
    const old = join(dir, 'old'); const neu = join(dir, 'new'); mkdirSync(neu);
    mkdirSync(join(old, 'hiui-android-sdk/platforms/android-36'), { recursive: true });
    writeFileSync(join(old, 'hiui-android-sdk/marker'), 'sdk');
    mkdirSync(join(old, 'hiui-gradle/caches'), { recursive: true });
    const envs = { HUI_ANDROID_STORE: neu, HUI_ANDROID_OLD_STORE: old };
    // Linux: nothing moves
    let r = store('android_store_migrate', envs);
    assert.equal(r.status, 0); assert.ok(existsSync(join(old, 'hiui-android-sdk/marker')) && !existsSync(join(neu, 'hiui-android-sdk')));
    // a caller's own ANDROID_HOME: the default SDK location is not touched (Gradle still is)
    r = store('android_store_migrate', { ...envs, ANDROID_HOME: join(dir, 'custom') }, { darwin: true });
    assert.ok(!existsSync(join(neu, 'hiui-android-sdk')));
    assert.ok(lstatSync(join(old, 'hiui-gradle')).isSymbolicLink());
    r = store('android_store_migrate', envs, { darwin: true });
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /moved .*old\/hiui-android-sdk -> .*new\/hiui-android-sdk \(one-time migration/);
    assert.equal(readFileSync(join(neu, 'hiui-android-sdk/marker'), 'utf8'), 'sdk', 'the SDK is reused, not downloaded again');
    assert.ok(lstatSync(join(old, 'hiui-android-sdk')).isSymbolicLink(), 'older branches still find it at the old path');
    assert.equal(readFileSync(join(old, 'hiui-android-sdk/marker'), 'utf8'), 'sdk');
    // second run: nothing to move
    r = store('android_store_migrate', envs, { darwin: true });
    assert.doesNotMatch(r.out, /moved/);
    // a fresh /var/tmp SDK next to an existing store SDK is left alone
    rmSync(join(old, 'hiui-android-sdk')); mkdirSync(join(old, 'hiui-android-sdk')); writeFileSync(join(old, 'hiui-android-sdk/marker'), 'other');
    r = store('android_store_migrate', envs, { darwin: true });
    assert.equal(readFileSync(join(neu, 'hiui-android-sdk/marker'), 'utf8'), 'sdk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('android_sdk_require: a missing or incomplete SDK fails with the exact sdkmanager command; complete = ok; fast needs build-tools only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'android-store-'));
  try {
    const sdk = join(dir, 'sdk');
    let r = store(`android_sdk_require build "${sdk}"`, {}, { darwin: true });
    assert.equal(r.status, 1);
    assert.match(r.err, /Android SDK incomplete at .*sdk \(missing: platforms;android-36 build-tools;36\.0\.0 ndk;27\.1\.12297006 cmake;3\.22\.1\)/);
    assert.ok(r.err.includes(`sdkmanager --sdk_root=${sdk} "cmdline-tools;latest" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" "emulator" "system-images;android-35;google_apis;arm64-v8a"`), r.err);
    mkdirSync(join(sdk, 'build-tools/36.0.0'), { recursive: true });
    assert.equal(store(`android_sdk_require fast "${sdk}"`).status, 0);
    r = store(`android_sdk_require build "${sdk}"`);
    assert.equal(r.status, 1); assert.match(r.err, /missing: platforms;android-36 ndk;27\.1\.12297006 cmake;3\.22\.1\)/);
    assert.doesNotMatch(r.err, /system-images/, 'Linux: no Mac emulator packages in the hint');
    for (const p of ['platforms/android-36', 'ndk/27.1.12297006', 'cmake/3.22.1']) mkdirSync(join(sdk, p), { recursive: true });
    r = store(`android_sdk_require build "${sdk}"`);
    assert.equal(r.status, 0, r.err); assert.equal(r.err, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('android_store_compat: after a reboot empties /var/tmp the old paths point at the store again (cron @reboot + every 10 min, LaunchAgent); only symlinks, never a deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'android-store-'));
  try {
    const old = join(dir, 'old'); const neu = join(dir, 'new'); const compat = join(dir, 'lane'); const agents = join(dir, 'agents');
    mkdirSync(join(old, 'hiui-android-sdk'), { recursive: true }); writeFileSync(join(old, 'hiui-android-sdk/marker'), 'sdk');
    mkdirSync(neu);
    const cron = join(dir, 'crontab.txt'); writeFileSync(cron, 'MAILTO=""\n0 3 * * * /usr/bin/true # someone else\n');
    const envs = { HUI_ANDROID_STORE: neu, HUI_ANDROID_OLD_STORE: old, HUI_COMPAT_DIR: compat, HUI_LAUNCH_AGENTS_DIR: agents };
    let r = store('android_store_migrate', envs, { darwin: true, cron });
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /crontab keeps .*old\/hiui-android-sdk -> .*new \(@reboot \+ every 10 min/);
    const script = join(compat, 'compat-links.sh');
    let tab = readFileSync(cron, 'utf8');
    assert.ok(tab.startsWith('MAILTO=""\n0 3 * * * /usr/bin/true # someone else\n'), 'existing entries stay');
    assert.ok(tab.includes(`@reboot /bin/bash ${script} # hui-compat-links\n`) && tab.includes(`*/10 * * * * /bin/bash ${script} # hui-compat-links\n`), tab);
    const plist = readFileSync(join(agents, 'xyz.hermesui.lane-compat-links.plist'), 'utf8');
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/); assert.ok(plist.includes(`<string>${script}</string>`));
    assert.match(readFileSync(`${cron}.launchctl`, 'utf8'), /launchctl bootstrap gui\/\d+ /);
    // idempotent: a second build adds nothing
    r = store('android_store_migrate', envs, { darwin: true, cron });
    assert.equal(r.out, ''); assert.equal(readFileSync(cron, 'utf8'), tab);
    // "reboot": /var/tmp is empty again -> the cron / LaunchAgent script puts the links back
    rmSync(old, { recursive: true }); mkdirSync(old);
    let c = spawnSync('bash', [script], { encoding: 'utf8' });
    assert.equal(c.status, 0, c.stderr);
    assert.ok(lstatSync(join(old, 'hiui-android-sdk')).isSymbolicLink());
    assert.equal(readFileSync(join(old, 'hiui-android-sdk/marker'), 'utf8'), 'sdk', 'an older branch finds the SDK at the old path again');
    assert.ok(!existsSync(join(old, 'hiui-gradle')), 'no link to a store dir that does not exist');
    // never replaces or deletes: a real directory (or anything) at the old path stays as it is
    rmSync(join(old, 'hiui-android-sdk')); mkdirSync(join(old, 'hiui-android-sdk')); writeFileSync(join(old, 'hiui-android-sdk/own'), 'x');
    c = spawnSync('bash', [script], { encoding: 'utf8' });
    assert.equal(c.status, 0);
    assert.ok(!lstatSync(join(old, 'hiui-android-sdk')).isSymbolicLink() && existsSync(join(old, 'hiui-android-sdk/own')));
    assert.ok(existsSync(join(neu, 'hiui-android-sdk/marker')));
    // Linux: nothing of this
    r = store('android_store_compat; echo done', envs);
    assert.equal(r.out, 'done\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

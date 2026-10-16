// The second Android lane on the build Mac: --host resolution of build-apk.sh / e2e/smoke.sh (ssh and rsync stubbed),
// the macOS memory helpers (scripts/lib/hostmem.sh) and the guards of the remote lane. Nothing here touches a real host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\ncase "$*" in *"bash -s"*) cat >> "${log}";; esac\nexit ${name === 'ssh' ? 'IF_REMOTE' : 0}\n`.replace('IF_REMOTE', `$(case "$*" in *"bash -s"*) echo ${rc};; *) echo 0;; esac)`));
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
 *  An ssh call whose `bash -s` script runs build-apk.sh (the build) is only recorded and fails, so no build ever starts. */
function fakeHost() {
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
  case "$script" in *build-apk.sh*) exit 1;; esac   # the build itself never runs in a test
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
  const r = spawnSync('bash', ['-c', `. "${LANE_SYNC}"; lane_sync ${FAKE_HOST} hui-lane "${repo}" && echo "LABEL=$LANE_LABEL"`], {
    encoding: 'utf8', env: { ...process.env, PATH: `${fh.bin}:${realPath}`, TMPDIR: fh.dir, ...extraEnv },
  });
  return { status: r.status, out: r.stdout + r.stderr, label: (/LABEL=(\S+)/.exec(r.stdout) || [])[1] };
}

test('lane_sync: first sync sends a bundle, then only the exact commit lands in src/ (no docs/), a repeat sends nothing', () => {
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
    const src = join(fh.home, 'hui-lane/src');
    assert.equal(readFileSync(join(src, 'app/a.txt'), 'utf8'), 'one');
    assert.ok(existsSync(join(src, 'bridge/src/replay.mjs')));
    assert.ok(!existsSync(join(src, 'docs')), 'only app/, scripts/ and replay.mjs are synced');
    assert.equal(git(join(fh.home, 'hui-lane/repo.git'), 'rev-parse', `refs/lane/${sha1}`), sha1);
    // second commit: the host has the first, the bundle must carry the prerequisite (incremental)
    writeFileSync(join(repo, 'app/a.txt'), 'two'); git(repo, 'commit', '-q', '-am', 'two');
    const sha2 = git(repo, 'rev-parse', 'HEAD');
    r = sync(fh, repo);
    assert.equal(r.status, 0, r.out);
    assert.equal(readFileSync(join(src, 'app/a.txt'), 'utf8'), 'two');
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
    const src = join(fh.home, 'hui-lane/src');
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
    assert.equal(readFileSync(join(fh.home, 'hui-lane/src/app/a.txt'), 'utf8'), 'one');
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
    assert.match(c, /FLAVOR=hermes HUI_ANDROID_LANE=local ABIS=arm64-v8a HUI_BUILD_SHA='[0-9a-f]{7}(-dirty)?' HUI_APK_TAG=-mac HUI_SKIP_RELEASE_GATE=1 ALLOW_DEBUG_SIGNED=1 MEM_MAX=6G\s*\\\n/);
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

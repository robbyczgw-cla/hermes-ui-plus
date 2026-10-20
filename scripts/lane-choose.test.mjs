// Automatic Android lane selection (scripts/lib/lane-choose.sh, HUI_ANDROID_LANE=auto): the decision rules, the ABI rule of
// smoke.sh and the wiring in build-apk.sh. The Mac is a stub; nothing here starts a build or touches a real host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// the build scripts started here take the Mac heavy lock when they run on a Mac: a private lock dir keeps a check run
// that already holds the real one (scripts/check.sh all on the build Mac) from deadlocking
process.env.HUI_MAC_LOCK_DIR = join(mkdtempSync(join(tmpdir(), 'hui-test-maclock-')), 'lock');
// the remote lanes sync a commit: a tree without one (the public export check) cannot run them
const NO_HEAD = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8' }).status !== 0 && 'no git commit in this tree';
const LIB = join(ROOT, 'scripts/lib/lane-choose.sh');
const BUILD = join(ROOT, 'scripts/build-apk.sh');
const SMOKE = join(ROOT, 'scripts/e2e/smoke.sh');

const IDLE = { MAC_LOCK: 'free', MAC_XCODEBUILD: 0, MAC_BOOTED: 0, MAC_AVAIL_MB: 7000, MAC_SWAP_USED_MB: 1300, MAC_SWAP_TOTAL_MB: 2048, MAC_PAGEOUTS_S: 0, MAC_DISK_GB: 40, MAC_SPEED_LIMIT: 100, MAC_SDK: 1 };

function decide(over = {}, extraEnv = {}) {
  const v = { ...IDLE, ...over };
  const exports = Object.entries(v).map(([k, x]) => `${k}='${x}'`).join(' ');
  const r = spawnSync('bash', ['-c', `. "${LIB}"; ${exports}; lane_decide_mac; echo "$LANE_CHOICE|$LANE_REASON"`], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  assert.equal(r.status, 0, r.stderr);
  const [choice, ...reason] = r.stdout.trim().split('|');
  return { choice, reason: reason.join('|') };
}

test('lane_decide_mac: an idle Mac wins (with the numbers in the reason)', () => {
  const d = decide();
  assert.equal(d.choice, 'mac');
  assert.match(d.reason, /idle: lock free, 7000 MB available, 0 page-outs\/s, 40 GB disk free/);
});

test('lane_decide_mac: every busy signal sends the build to the Linux lane and names why', () => {
  const cases = [
    [{ MAC_LOCK: 'held by ios (pid 4, 3 min)' }, /heavy-job lock is taken \(held by ios/],
    [{ MAC_XCODEBUILD: 1 }, /xcodebuild is running/],
    [{ MAC_BOOTED: 2 }, /2 iOS simulator\(s\) are booted/],
    [{ MAC_AVAIL_MB: 3000 }, /only 3000 MB available/],
    [{ MAC_PAGEOUTS_S: 400 }, /swapping hard \(400 page-outs\/s\)/],
    [{ MAC_SWAP_USED_MB: 2000 }, /swap is 2000\/2048 MB full/],
    [{ MAC_DISK_GB: 5 }, /only 5 GB free disk/],
    [{ MAC_SPEED_LIMIT: 60 }, /thermally throttled \(CPU_Speed_Limit 60\)/],
    [{ MAC_SDK: 0 }, /the Android SDK is missing on the Mac \(\/Users\/Shared\/hiui-android-sdk/],
  ];
  for (const [over, re] of cases) {
    const d = decide(over);
    assert.equal(d.choice, 'local', JSON.stringify(over));
    assert.match(d.reason, re);
  }
});

test('lane_decide_mac: a steady, partly used swap file is not "hard swapping"; thresholds are tunable', () => {
  assert.equal(decide({ MAC_SWAP_USED_MB: 1300, MAC_PAGEOUTS_S: 10 }).choice, 'mac');
  assert.equal(decide({ MAC_AVAIL_MB: 3000 }, { HUI_LANE_MIN_AVAIL_MB: '2000' }).choice, 'mac');
  assert.equal(decide({ MAC_PAGEOUTS_S: 100 }, { HUI_LANE_MAX_PAGEOUTS: '200' }).choice, 'mac');
});

/** an APK-like zip with the given entries */
function zip(path, entries) {
  const code = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\n[z.writestr(e,'x') for e in sys.argv[2:]]\nz.close()`;
  assert.equal(spawnSync('python3', ['-I', '-c', code, path, ...entries]).status, 0);
}

/** ssh stub for the probe: key=value lines for the probe script, silence for everything else. buildOut: what the "build" prints,
 *  {RUN} = the run dir the build script cd's into; the APK check afterwards then gets the commit label of that build. */
function sshStub(dir, probeLines, { reachable = true, buildOut = null } = {}) {
  const bin = join(dir, 'bin'); mkdirSync(bin, { recursive: true });
  const canned = join(dir, 'probe.out'); writeFileSync(canned, probeLines.join('\n') + '\n');
  const log = join(dir, 'calls.log');
  writeFileSync(join(bin, 'ssh'), `#!/bin/bash
while [ "$1" = -o ]; do shift 2; done
host="$1"; shift
echo "ssh $host $*" >> "${log}"
${reachable ? '' : 'exit 255'}
if [ "$*" = "bash -s" ]; then
  script="$(cat)"; echo "$script" >> "${log}"
  case "$script" in
    *MAC_LOCK*) cat "${canned}"; exit 0;;
    *build-apk*.sh*)
      run=$(printf '%s\\n' "$script" | sed -n 's#^cd "\\$HOME/\\(.*\\)"$#\\1#p')
      printf '%s\\n' "$script" | sed -n "s#.*HUI_BUILD_SHA='\\([0-9a-f]*\\).*#\\1#p" > "${join(dir, 'label')}"
      ${buildOut ? `out=${JSON.stringify(buildOut)}; printf '%s\\n' "\${out//\\{RUN\\}/$run}"; exit 0` : 'exit 1'};;
    *lane_apk_source*) cat "${join(dir, 'label')}"; exit 0;;
  esac
  exit 0
fi
cat > /dev/null
exit 0
`);
  chmodSync(join(bin, 'ssh'), 0o755);
  writeFileSync(join(bin, 'rsync'), '#!/bin/sh\necho "rsync $*" >> "' + log + '"\nexit 0\n'); chmodSync(join(bin, 'rsync'), 0o755);
  return { bin, log, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}
const probe = (o = {}) => Object.entries({ ...IDLE, ...o }).map(([k, v]) => `${k}=${String(v).replace(/ /g, '_')}`);

function auto(dir, stub, apkEntries) {
  const apk = join(dir, 'a.apk'); if (apkEntries) zip(apk, apkEntries);
  const r = spawnSync('bash', ['-c', `. "${LIB}"; lane_for_apk "${apk}" mac.example.com; echo "$LANE_CHOICE"`], {
    encoding: 'utf8', env: { ...process.env, PATH: `${stub.bin}:${process.env.PATH}` },
  });
  return { out: r.stdout + r.stderr, choice: r.stdout.trim().split('\n').pop() };
}

test('lane_for_apk (smoke.sh): the ABI decides when only one emulator can run the APK, the Mac probe when both can', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-choose-'));
  try {
    let s = sshStub(dir, probe());
    let r = auto(dir, s, ['lib/arm64-v8a/libx.so', 'classes.dex']);
    assert.equal(r.choice, 'mac'); assert.match(r.out, /arm64-v8a only/);
    r = auto(dir, s, ['lib/x86_64/libx.so']);
    assert.equal(r.choice, 'local'); assert.match(r.out, /x86_64 only/);
    r = auto(dir, s, ['lib/x86_64/libx.so', 'lib/arm64-v8a/libx.so']);
    assert.equal(r.choice, 'mac'); assert.match(r.out, /lane: auto -> mac: the Mac is idle/);
    s = sshStub(dir, probe({ MAC_LOCK: 'held by android-emu (pid 7, 1 min)' }));
    r = auto(dir, s, ['lib/x86_64/libx.so', 'lib/arm64-v8a/libx.so']);
    assert.equal(r.choice, 'local'); assert.match(r.out, /lock is taken/);
    s = sshStub(dir, [], { reachable: false });
    r = auto(dir, s, ['lib/x86_64/libx.so', 'lib/arm64-v8a/libx.so']);
    assert.equal(r.choice, 'local'); assert.match(r.out, /not reachable over ssh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function envFor(extra, bin) {
  const e = { ...process.env, ...extra };
  for (const k of ['MAC_HOST', 'E2E_HOST', 'HUI_ANDROID_LANE', 'HUI_BUILD_HOST', 'ABIS', 'MEM_MAX', 'NINJA_JOBS', 'GRADLE_WORKERS', 'GRADLE_XMX', 'SKIP_NPM_CI', 'HUI_MAC_LOCK_WAIT', 'ALLOW_DEBUG_SIGNED', 'HERMES_KEYSTORE', 'HERMES_KEYSTORE_PASS', 'HERMES_KEY_ALIAS', 'HERMES_KEY_PASS', 'HERMES_CERT_SHA256', 'BUNDLE']) if (!(k in extra)) delete e[k];
  if (bin) e.PATH = `${bin}:${process.env.PATH}`;
  return e;
}

test('build-apk.sh lanes: auto + idle Mac builds on the Mac and fetches; busy Mac builds here; release/store builds never go to the Mac', { skip: NO_HEAD }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-choose-'));
  const distBefore = new Set(existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []);
  try {
    const priv = join(dir, 'priv'); mkdirSync(priv);
    const counter = join(dir, 'counter'); writeFileSync(counter, '5\n');
    const base = { HUI_PRIVATE_DIR: priv, FLAVOR: 'hermes', MAC_HOST: 'mac.example.com', ALLOW_DEBUG_SIGNED: '1', HUI_BUILD_COUNTER: counter, MIN_AVAIL_GB: '9999', HUI_LANE_GIT_URL: join(ROOT, '.git') };
    const idle = sshStub(dir, probe());
    let r = spawnSync('bash', [BUILD, 'release'], { encoding: 'utf8', env: envFor({ ...base, HUI_ANDROID_LANE: 'auto' }, idle.bin) });
    const out = r.stdout + r.stderr;
    assert.match(out, /lane: auto -> mac: the Mac is idle/);
    assert.match(out, /REMOTE BUILD FAILED/);   // the stub never builds
    assert.match(idle.calls(), /bash scripts\/build-apk\.sh release/);
    // plain build without a lane or --smoke is never rerouted
    r = spawnSync('bash', [BUILD, 'release'], { encoding: 'utf8', env: envFor(base, idle.bin) });
    assert.doesNotMatch(r.stdout + r.stderr, /lane: auto/);
    assert.doesNotMatch(r.stdout + r.stderr, /REMOTE BUILD/);
    // a busy Mac sends the same call to the local build (which stops at its memory preflight here)
    const busy = sshStub(join(dir, 'busy'), probe({ MAC_XCODEBUILD: 1 }));
    r = spawnSync('bash', [BUILD, '--smoke', 'release'], { encoding: 'utf8', env: envFor(base, busy.bin) });
    assert.match(r.stdout + r.stderr, /lane: auto -> local: xcodebuild is running on the Mac/);
    assert.doesNotMatch(busy.calls(), /build-apk\.sh release/, 'no remote build on a busy Mac');
    // release / store build (no ALLOW_DEBUG_SIGNED): auto is switched off
    const noTest = { ...base }; delete noTest.ALLOW_DEBUG_SIGNED;
    r = spawnSync('bash', [BUILD, 'release'], { encoding: 'utf8', env: envFor({ ...noTest, HUI_ANDROID_LANE: 'auto' }, idle.bin) });
    assert.match(r.stdout + r.stderr, /auto -> local: this is a release \/ store build/);
    assert.doesNotMatch(idle.calls().split('REMOTE').pop(), /nothing/);
    // a bad lane value is an error
    r = spawnSync('bash', [BUILD, 'debug'], { encoding: 'utf8', env: envFor({ ...base, HUI_ANDROID_LANE: 'cloud' }) });
    assert.equal(r.status, 2); assert.match(r.stderr, /HUI_ANDROID_LANE must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const f of existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []) {
      if (!distBefore.has(f) && /^build-.*\.log$/.test(f)) rmSync(join(ROOT, 'dist', f), { force: true });
    }
  }
});

test('smoke.sh lanes: unset/auto follows the APK ABI, mac/local force a lane, an explicit --host wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-choose-'));
  try {
    const priv = join(dir, 'priv'); mkdirSync(priv);
    const stub = sshStub(dir, probe());
    const arm = join(dir, 'arm.apk'); zip(arm, ['lib/arm64-v8a/x.so']);
    const x86 = join(dir, 'x86.apk'); zip(x86, ['lib/x86_64/x.so']);
    const base = { HUI_PRIVATE_DIR: priv, E2E_HOST: 'linux.example.com', MAC_HOST: 'mac.example.com' };
    const run = (apk, extra = {}, args = []) => {
      writeFileSync(stub.log, '');
      const r = spawnSync('bash', [SMOKE, '--out', join(dir, 'out'), ...args, apk], { encoding: 'utf8', env: envFor({ ...base, ...extra }, stub.bin) });
      return { out: r.stdout + r.stderr, calls: stub.calls() };
    };
    let r = run(arm);
    assert.match(r.out, /auto -> mac: the APK is arm64-v8a only/); assert.match(r.calls, /ssh mac\.example\.com /);
    r = run(x86);
    assert.match(r.out, /auto -> local: the APK is x86_64 only/); assert.match(r.calls, /ssh linux\.example\.com /);
    r = run(x86, { HUI_ANDROID_LANE: 'mac' });
    assert.match(r.calls, /ssh mac\.example\.com /);
    r = run(arm, { HUI_ANDROID_LANE: 'local' });
    assert.match(r.calls, /ssh linux\.example\.com /);
    r = run(arm, {}, ['--host', 'other.example.com']);
    assert.match(r.calls, /ssh other\.example\.com /); assert.doesNotMatch(r.out, /lane: auto/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-apk-fast.sh: auto is the default; an idle Mac runs the whole fast build there, a busy one keeps it here, local never asks', { skip: NO_HEAD }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-choose-'));
  const FAST = join(ROOT, 'scripts/build-apk-fast.sh');
  const distBefore = new Set(existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []);
  try {
    const priv = join(dir, 'priv'); mkdirSync(priv);
    const base = { HUI_PRIVATE_DIR: priv, FLAVOR: 'hermes', MAC_HOST: 'mac.example.com', FAST_MIN_AVAIL_GB: '9999' };
    // idle Mac: the host builds with build-apk-fast.sh (no fetch needed for this test: the stub prints the APK line it "made")
    const idle = sshStub(dir, probe(), { buildOut: 'APK: /Users/x/{RUN}/dist/hermes-ui-plus-release-abc1234-mac-debugsigned-fast.apk (61M)' });
    let r = spawnSync('bash', [FAST, '--host', 'mac'], { encoding: 'utf8', env: envFor(base, idle.bin) });
    let out = r.stdout + r.stderr;
    assert.doesNotMatch(out, /lane: auto/, 'an explicit --host skips the choice');
    assert.match(idle.calls(), /bash scripts\/build-apk-fast\.sh release/);
    assert.match(out, /APK stays on the host: ~\/hui-lane\/runs\/[0-9a-f-]+\/dist\/hermes-ui-plus-release-abc1234-mac-debugsigned-fast\.apk/, 'the name the host really produced is used (fast or full fallback)');
    assert.match(out, /== APK verified: built from [0-9a-f]{7}/);
    // default lane = auto: idle Mac -> remote fast build, fetched back because nobody else would use it
    r = spawnSync('bash', [FAST], { encoding: 'utf8', env: envFor(base, idle.bin) });
    out = r.stdout + r.stderr;
    assert.match(out, /lane: auto -> mac: the Mac is idle/);
    assert.match(out, /fetch|rsync|APK stays on the host/);
    // busy Mac: the fast path runs here (and stops at its memory preflight in this test)
    const busy = sshStub(join(dir, 'busy'), probe({ MAC_LOCK: 'held by ios (pid 4, 3 min)' }));
    r = spawnSync('bash', [FAST], { encoding: 'utf8', env: envFor(base, busy.bin) });
    out = r.stdout + r.stderr;
    assert.match(out, /lane: auto -> local: the Mac's heavy-job lock is taken/);
    assert.doesNotMatch(busy.calls(), /build-apk-fast\.sh release/);
    // HUI_ANDROID_LANE=local: the Mac is not even asked
    const none = sshStub(join(dir, 'none'), probe());
    r = spawnSync('bash', [FAST], { encoding: 'utf8', env: envFor({ ...base, HUI_ANDROID_LANE: 'local' }, none.bin) });
    assert.doesNotMatch(r.stdout + r.stderr, /lane: auto/);
    assert.equal(none.calls(), '');
    // other ABIs never go to the Mac (the nightly cross-check builds x86_64): auto stays local and says why
    r = spawnSync('bash', [FAST], { encoding: 'utf8', env: envFor({ ...base, ABIS: 'x86_64' }, idle.bin) });
    assert.match(r.stdout + r.stderr, /lane: auto -> local: ABIS=x86_64 \(the Mac lane builds arm64-v8a only\)/);
    // a bad value is an error, a release key still refuses
    r = spawnSync('bash', [FAST], { encoding: 'utf8', env: envFor({ ...base, HUI_ANDROID_LANE: 'cloud' }) });
    assert.equal(r.status, 2); assert.match(r.stderr, /HUI_ANDROID_LANE must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const f of existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []) {
      if (!distBefore.has(f) && /^build-.*\.log$/.test(f)) rmSync(join(ROOT, 'dist', f), { force: true });
    }
  }
});

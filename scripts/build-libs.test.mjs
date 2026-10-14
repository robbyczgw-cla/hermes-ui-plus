// node --test scripts/build-libs.test.mjs — shell helpers of the build scripts (no builds, no network).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const bash = (script, env = {}) => spawnSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });

test('flavor.sh: env files are parsed as data (no command substitution), bad lines are rejected', () => {
  const d = mkdtempSync(join(tmpdir(), 'hui-env-'));
  const marker = join(d, 'executed');
  try {
    writeFileSync(join(d, 'a.env'), `# comment\nA=plain value\nexport B="q $(touch ${marker}) \`touch ${marker}\`"\nC='single'\nD=x=y\n  E=it's\n`);
    const r = bash(`. scripts/lib/flavor.sh && _flavor_load_env "$F" && printf '%s|' "$A" "$B" "$C" "$D" "$E" && env | grep -c '^A=plain value$'`, { F: join(d, 'a.env'), A: '', B: '', C: '', D: '', E: '' });
    // pre-set (empty) values win: run again without them
    const r2 = spawnSync('bash', ['-c', `. scripts/lib/flavor.sh && _flavor_load_env "$F" && printf '%s|' "$A" "$B" "$C" "$D" "$E" && env | grep -c '^A=plain value$'`], {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries({ ...process.env, F: join(d, 'a.env') }).filter(([k]) => !/^[A-E]$/.test(k))),
    });
    assert.equal(r.stdout, '|||||0\n', 'existing (empty) env values win');
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout, `plain value|q $(touch ${marker}) \`touch ${marker}\`|single|x=y|it's|1\n`);
    assert.equal(existsSync(marker), false, 'nothing executed');
    writeFileSync(join(d, 'bad.env'), 'rm -rf /tmp/nothing\n');
    assert.equal(bash(`. scripts/lib/flavor.sh && _flavor_load_env "$F"`, { F: join(d, 'bad.env') }).status, 2);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('scan-artifact.sh --public is refused when a private denylist exists', () => {
  const d = mkdtempSync(join(tmpdir(), 'hui-sa-'));
  try {
    mkdirSync(join(d, 'out'));
    writeFileSync(join(d, 'out', 'index.html'), 'hello');
    writeFileSync(join(d, 'leak-denylist.txt'), 'something\n');
    const r = spawnSync(join(ROOT, 'scripts', 'scan-artifact.sh'), ['--public', join(d, 'out')], { encoding: 'utf8', env: { ...process.env, HUI_PRIVATE_DIR: d } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--public refused/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('build scripts: rsync excludes are anchored (local native modules android/ ios/ must reach the build copy)', () => {
  for (const f of ['build-apk.sh', 'build-web.sh']) {
    const src = readFileSync(join(ROOT, 'scripts', f), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(src, /--exclude (android|ios|dist|refs)\b(?!\/)/, `${f}: unanchored exclude`);
    assert.match(src, /--exclude \/android\//);
  }
  const apk = readFileSync(join(ROOT, 'scripts', 'build-apk.sh'), 'utf8');
  assert.match(apk, /StreamKeepAliveService/, 'APK build verifies the keep-alive service');
  assert.match(apk, /release_gate "\$OUT"/, 'APK build runs the release gate');
});

test('heavy.sh: aggregate slice args are empty or a single --slice', () => {
  const r = bash('. scripts/lib/heavy.sh && heavy_slice_init 2>/dev/null; echo "${#HEAVY_SLICE[@]}:${HEAVY_SLICE[*]:-}"');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^(0:|1:--slice=huiheavy\.slice)$/);
});

test('signing.sh: a hermes release needs the release key; ALLOW_DEBUG_SIGNED=1 is the only, clearly named way out', () => {
  const d = mkdtempSync(join(tmpdir(), 'hui-sign-'));
  const FP = '17:9B:2D:B4:99:6E:C6:BF:8D:B5:43:46:11:98:5E:38:AE:5E:21:A0:3E:A0:12:55:8B:A6:A6:5A:44:12:6E:06';
  const fp = FP.replace(/:/g, '').toLowerCase();
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HERMES_|ALLOW_DEBUG_SIGNED|FLAVOR$|HUI_PRIVATE_DIR$)/.test(k)));
  const run = (script, env = {}) => spawnSync('bash', ['-c', `set -euo pipefail; . scripts/lib/signing.sh; ${script}`], { cwd: ROOT, encoding: 'utf8', env: { ...clean, HUI_PRIVATE_DIR: d, ...env } });
  try {
    const ks = join(d, 'release.jks');
    writeFileSync(ks, 'fake keystore');
    // refused: hermes release without keystore
    let r = run('signing_preflight release; echo "mode=$SIGNING_MODE"', { FLAVOR: 'hermes' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSING a FLAVOR=hermes release/);
    // not affected: debug builds, the personal flavor
    assert.equal(run('signing_preflight debug; echo "$SIGNING_MODE"', { FLAVOR: 'hermes' }).stdout, 'none\n');
    assert.equal(run('signing_preflight release; echo "$SIGNING_MODE"', { FLAVOR: 'personal' }).stdout, 'none\n');
    // explicit opt-out for local tests
    r = run('signing_preflight release; echo "$SIGNING_MODE"', { FLAVOR: 'hermes', ALLOW_DEBUG_SIGNED: '1' });
    assert.equal(r.stdout, 'debug-signed\n');
    assert.match(r.stderr, /never publish/);
    // keystore: must exist and have a password
    assert.match(run('signing_preflight release', { FLAVOR: 'hermes', HERMES_KEYSTORE: join(d, 'missing.jks'), HERMES_KEYSTORE_PASS: 'x' }).stderr, /not found/);
    assert.match(run('signing_preflight release', { FLAVOR: 'hermes', HERMES_KEYSTORE: ks }).stderr, /HERMES_KEYSTORE_PASS/);
    r = run('signing_preflight release; echo "$SIGNING_MODE|$HERMES_CERT_SHA256"', { FLAVOR: 'hermes', HERMES_KEYSTORE: ks, HERMES_KEYSTORE_PASS: 'x' });
    assert.equal(r.stdout, 'release-key|\n');
    assert.match(r.stderr, /HERMES_CERT_SHA256 is not set/);
    // expected fingerprint: env wins, else read (as data) from $HUI_PRIVATE_DIR/build.env; colons/case normalized
    writeFileSync(join(d, 'build.env'), `MAC_HOST=x\nexport HERMES_CERT_SHA256="${FP}"\n`);
    assert.equal(run('signing_preflight release; echo "$HERMES_CERT_SHA256"', { FLAVOR: 'hermes', HERMES_KEYSTORE: ks, HERMES_KEYSTORE_PASS: 'x' }).stdout, `${fp}\n`);
    assert.equal(run('signing_preflight release; echo "$HERMES_CERT_SHA256"', { FLAVOR: 'hermes', HERMES_KEYSTORE: ks, HERMES_KEYSTORE_PASS: 'x', HERMES_CERT_SHA256: 'ab'.repeat(32) }).stdout, `${'ab'.repeat(32)}\n`);
    assert.equal(run('signing_preflight release', { FLAVOR: 'hermes', HERMES_KEYSTORE: ks, HERMES_KEYSTORE_PASS: 'x', HERMES_CERT_SHA256: 'nope' }).status, 1);

    // signing_verify against a fake apksigner
    const signer = join(d, 'apksigner');
    writeFileSync(signer, `#!/usr/bin/env bash\n[ "$1" = verify ] || exit 9\necho "Signer #1 certificate DN: CN=Test"\necho "Signer #1 certificate SHA-256 digest: $FAKE_FP"\n`, { mode: 0o755 });
    const verify = (fake, expected) => run('signing_preflight release; signing_verify app.apk', {
      FLAVOR: 'hermes', HERMES_KEYSTORE: ks, HERMES_KEYSTORE_PASS: 'x', APKSIGNER: signer, FAKE_FP: fake, ...(expected ? { HERMES_CERT_SHA256: expected } : {}),
    });
    r = verify(fp, FP);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /signer matches HERMES_CERT_SHA256/);
    r = verify('cd'.repeat(32), FP);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SIGNER MISMATCH/);
    // debug-signed mode never pretends to verify the release key
    assert.equal(run('signing_preflight release; signing_verify app.apk; echo ok', { FLAVOR: 'hermes', ALLOW_DEBUG_SIGNED: '1', APKSIGNER: '/nonexistent' }).stdout, 'ok\n');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('build-apk.sh: wires the signing preflight, the -debugsigned name and the final signer check', () => {
  const apk = readFileSync(join(ROOT, 'scripts', 'build-apk.sh'), 'utf8');
  const code = apk.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(code, /signing_preflight "\$VARIANT" \|\| exit 1/);
  assert.match(code, /OUT="\$ROOT\/dist\/\$APK_BASE-\$VARIANT-\$SHA\$ABI_SUFFIX\$SIGN_SUFFIX\.apk"/);
  assert.match(code, /\$LATEST\$ABI_SUFFIX\$SIGN_SUFFIX\.apk/);
  assert.match(code, /signing_verify "\$OUT"/);
  // preflight runs before the (long) build starts
  assert.ok(code.indexOf('signing_preflight') < code.indexOf('systemd-run --user --scope --quiet'));
});

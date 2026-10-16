// scripts/lib/apk-guards.sh: no build-host address may ship as React Native's dev server host, on any build host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIB = join(ROOT, 'scripts/lib/apk-guards.sh');

/** an aapt2 stand-in whose `dump resources` prints a resource table with the given dev server value (null: no such resource) */
function fakeAapt2(dir, value, { fail = false } = {}) {
  const f = join(dir, 'aapt2');
  const entry = value === null ? '' : `    resource 0x7f1301a5 string/react_native_dev_server_ip\n      () "${value}"\n`;
  writeFileSync(f, `#!/bin/sh\n${fail ? 'exit 1\n' : `cat <<'X'\nPackage name=x id=7f\n    resource 0x7f1301a4 string/rn_tab_description_x\n      () "Tab"\n${entry}    resource 0x7f1301a6 string/rn_tab_description\n      () "Tab"\nX\n`}`);
  chmodSync(f, 0o755);
  return f;
}
const check = (aapt2) => spawnSync('bash', ['-c', `. "${LIB}"; apk_check_dev_server_ip x.apk "${aapt2}"`], { encoding: 'utf8' });

test('apk_check_dev_server_ip: localhost and loopback pass; any build-host address fails with the value named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apkguard-'));
  try {
    for (const ok of ['localhost', '127.0.0.1', null]) assert.equal(check(fakeAapt2(dir, ok)).status, 0, String(ok));
    for (const bad of ['172.17.0.1', '198.51.100.9', '192.0.2.20', '203.0.113.5']) {
      const r = check(fakeAapt2(dir, bad));
      assert.equal(r.status, 1, bad);
      assert.match(r.stderr, new RegExp(`dev server \\('${bad.replace(/\./g, '\\.')}'\\)`));
    }
    assert.equal(check(fakeAapt2(dir, null, { fail: true })).status, 1, 'an unreadable APK fails the guard');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build-apk.sh pins reactNativeDevServerIp=localhost for every host and every variant, and both build scripts run the guard', () => {
  const build = readFileSync(join(ROOT, 'scripts/build-apk.sh'), 'utf8');
  const lines = build.split('\n');
  const i = lines.findIndex((l) => l.includes('echo "reactNativeDevServerIp=localhost" >> "$GP"'));
  assert.ok(i > 0, 'the property is written to gradle.properties');
  // not inside a conditional: the lines around it are comments and the plain statement
  assert.doesNotMatch(lines.slice(i - 4, i + 1).join('\n'), /\bif\b|HOST_OS|Darwin|VARIANT/);
  assert.match(build, /apk_check_dev_server_ip "\$OUT" "\$AAPT2"/);
  assert.match(readFileSync(join(ROOT, 'scripts/build-apk-fast.sh'), 'utf8'), /apk_check_dev_server_ip "\$WORK\/fast\.apk"/);
});

// Evidence on a real APK when this machine has one and aapt2: an APK built before the pin carries the Docker bridge address
const AAPT2 = '/var/tmp/hiui-android-sdk/build-tools/36.0.0/aapt2';
const OLD_APK = (existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')).filter((f) => /^hermes-ui-plus-release-.*\.apk$/.test(f)) : []).sort()[0];
test('a real APK: the guard reads react_native_dev_server_ip', { skip: !existsSync(AAPT2) || !OLD_APK }, () => {
  const r = spawnSync('bash', ['-c', `. "${LIB}"; apk_check_dev_server_ip "${join(ROOT, 'dist', OLD_APK)}" "${AAPT2}"`], { encoding: 'utf8' });
  // pass (pinned) or fail naming the address (built before the pin): never a silent pass on an unreadable value
  assert.ok(r.status === 0 || /dev server \('/.test(r.stderr), r.stderr);
});

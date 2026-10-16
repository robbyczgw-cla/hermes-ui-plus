// node --test scripts/build-apk-fast.test.mjs — JS fast path for test APKs: native fingerprint, base cache, entry swap,
// refusals of the wrapper (no builds, no network, no Gradle).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCHEMA, assetManifest, cacheKey, fingerprint, lookup, register } from './lib/apk-fast.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SWAP = join(ROOT, 'scripts', 'lib', 'apk_swap.py');
const FAST = join(ROOT, 'scripts', 'build-apk-fast.sh');

function tmp() {
  const root = mkdtempSync(join(tmpdir(), 'hui-fast-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
/** fixture app + repo: the inputs fingerprint() reads */
function fixture(root) {
  const app = join(root, 'repo', 'app');
  for (const [f, c] of Object.entries({
    'package.json': '{"name":"x"}',
    'package-lock.json': '{}',
    'app.json': '{"expo":{}}',
    'app.config.ts': 'export default {}',
    'brand/identity.json': '{}',
    'plugins/withX.js': 'module.exports = (c) => c',
    'modules/keepalive/android/Mod.kt': 'class Mod',
    'assets/icon.png': 'png',
    'src/App.tsx': 'export const a = 1',
  })) write(join(app, f), c);
  for (const f of ['scripts/build-apk.sh', 'scripts/lib/flavor.sh', 'scripts/lib/brand.sh']) write(join(root, 'repo', f), `# ${f}`);
  return { app, repo: join(root, 'repo') };
}
const stubExpo = (hash = 'e'.repeat(40)) => async () => hash;
const ENV = { FLAVOR: 'hermes', EXPO_PUBLIC_FLAVOR: 'hermes', ABIS: 'x86_64' };

test('fingerprint: JS-only changes and the per-build number keep it, native inputs change it', async () => {
  const t = tmp();
  try {
    const { app, repo } = fixture(t.root);
    const fp = (env = ENV, expo = stubExpo()) => fingerprint(app, env, { expo, root: repo }).then((r) => r.hash);
    const base = await fp();
    assert.match(base, /^[0-9a-f]{32}$/);
    write(join(app, 'src/App.tsx'), 'export const a = 2');
    write(join(app, 'src/new.ts'), 'export {}');
    assert.equal(await fp({ ...ENV, HUI_BUILD_NUMBER: '7', HUI_BUILD_SOURCE: 'abc1234', PATH: '/x' }), base, 'JS, build number, PATH');
    const changes = [
      ['plugins/withX.js', 'module.exports = (c) => ({ ...c })'],
      ['package-lock.json', '{"v":2}'],
      ['package.json', '{"name":"x","dependencies":{"y":"1"}}'],
      ['modules/keepalive/android/Mod.kt', 'class Mod2'],
      ['app.json', '{"expo":{"android":{}}}'],
      ['assets/icon.png', 'png2'],
      ['patches/react-native+1.patch', 'diff'],
    ];
    for (const [f, c] of changes) {
      const old = existsSync(join(app, f)) ? readFileSync(join(app, f)) : null;
      write(join(app, f), c);
      assert.notEqual(await fp(), base, `${f} changes the fingerprint`);
      if (old === null) rmSync(join(app, f)); else writeFileSync(join(app, f), old);
    }
    assert.equal(await fp(), base, 'restored inputs give the same fingerprint');
    write(join(repo, 'scripts/build-apk.sh'), '# changed');
    assert.notEqual(await fp(), base, 'build script');
    write(join(repo, 'scripts/build-apk.sh'), '# scripts/build-apk.sh');
    assert.notEqual(await fp({ ...ENV, ABIS: 'arm64-v8a' }), base, 'ABIs');
    assert.notEqual(await fp({ ...ENV, EXPO_PUBLIC_BG_SERVICE: '0' }), base, 'EXPO_PUBLIC_*');
    assert.notEqual(await fp(ENV, stubExpo('f'.repeat(40))), base, '@expo/fingerprint hash');
    assert.equal(await fp(ENV, async () => null), null, 'no @expo/fingerprint: unknown, never a match');
  } finally {
    t.done();
  }
});

test('fingerprint: the personal flavor includes the private overlay app dir', async () => {
  const t = tmp();
  try {
    const { app, repo } = fixture(t.root);
    const priv = join(t.root, 'private');
    write(join(priv, 'app', 'identity.json'), '{"name":"A"}');
    const env = { FLAVOR: 'personal', EXPO_PUBLIC_FLAVOR: 'personal', ABIS: 'x86_64', HUI_PRIVATE_DIR: priv };
    const fp = () => fingerprint(app, env, { expo: stubExpo(), root: repo }).then((r) => r.hash);
    const a = await fp();
    write(join(priv, 'app', 'identity.json'), '{"name":"B"}');
    assert.notEqual(await fp(), a);
    assert.notEqual(await fingerprint(app, ENV, { expo: stubExpo(), root: repo }).then((r) => r.hash), a, 'flavor');
  } finally {
    t.done();
  }
});

/** fake Gradle build copy with generated JS output */
function gradleOutput(app, bundle = 'hbc') {
  const gen = join(app, 'android', 'app', 'build', 'generated');
  write(join(gen, 'assets', 'react', 'release', 'index.android.bundle'), bundle);
  write(join(gen, 'res', 'react', 'release', 'drawable-mdpi', 'assets_icon.png'), 'icon');
  write(join(gen, 'res', 'react', 'release', 'raw', 'keep.xml'), '<x/>');
  write(join(app, 'android', 'app', 'debug.keystore'), 'ks');
}

test('base cache: register is atomic and complete, lookup checks schema and key, old bases are pruned', () => {
  const t = tmp();
  try {
    const app = join(t.root, 'build', 'app');
    gradleOutput(app);
    const apk = join(t.root, 'x.apk');
    writeFileSync(apk, 'apk');
    const bases = join(t.root, 'bases');
    const key = cacheKey('hermes', 'x86_64', 'a'.repeat(32));
    assert.equal(lookup(bases, key), null);
    const dir = register(bases, key, { apk, appDir: app, variant: 'release', buildNumber: '42', keystore: join(app, 'android/app/debug.keystore') });
    assert.equal(lookup(bases, key), dir);
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.schema, SCHEMA);
    assert.equal(meta.buildNumber, 42);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8')), assetManifest(join(app, 'android/app/build/generated/res/react/release')));
    assert.deepEqual(Object.keys(assetManifest(join(app, 'android/app/build/generated/res/react/release'))), ['drawable-mdpi/assets_icon.png', 'raw/keep.xml']);
    // the APK must hold the bundle Gradle generated
    assert.throws(() => register(bases, key, { apk, appDir: app, variant: 'release', buildNumber: '43', keystore: apk, bundleSha: '0'.repeat(64) }), /differs/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).buildNumber, 42, 'a refused register keeps the old base');
    // incomplete / foreign dirs are no base
    rmSync(join(dir, 'debug.keystore'));
    assert.equal(lookup(bases, key), null);
    // prune: newest 3 per flavor/ABI stay, other ABIs untouched
    const keys = ['1', '2', '3', '4'].map((c) => cacheKey('hermes', 'x86_64', c.repeat(32)));
    const other = cacheKey('hermes', 'arm64-v8a', '5'.repeat(32));
    let i = 0;
    for (const k of [other, ...keys]) {
      const d = register(bases, k, { apk, appDir: app, variant: 'release', buildNumber: '1', keystore: apk });
      const ts = Date.now() / 1000 - 100 + i++;
      utimesSync(join(d, 'meta.json'), ts, ts);
    }
    const left = keys.filter((k) => lookup(bases, k));
    assert.deepEqual(left, keys.slice(1), 'oldest x86_64 base pruned');
    assert.ok(lookup(bases, other), 'other ABI kept');
    assert.throws(() => cacheKey('hermes', 'x86_64', 'nothex'), /fingerprint/);
    assert.throws(() => cacheKey('evil', 'x86_64', 'a'.repeat(32)), /flavor/);
  } finally {
    t.done();
  }
});

const py = (code, ...args) => spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
const MAKE_ZIP = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr(zipfile.ZipInfo('AndroidManifest.xml', (2020, 1, 2, 3, 4, 6)), b'manifest' * 50, zipfile.ZIP_DEFLATED)
    z.writestr(zipfile.ZipInfo('assets/index.android.bundle', (2020, 1, 2, 3, 4, 6)), b'old bytecode', zipfile.ZIP_STORED)
    z.writestr(zipfile.ZipInfo('assets/app.config', (2020, 1, 2, 3, 4, 6)), b'{"a":1}' * 20, zipfile.ZIP_DEFLATED)
    z.writestr(zipfile.ZipInfo('lib/x86_64/libx.so', (2020, 1, 2, 3, 4, 6)), b'\\x7fELF' + bytes(5000), zipfile.ZIP_STORED)
    z.writestr('META-INF/CERT.RSA', b'sig')
    z.writestr('META-INF/MANIFEST.MF', b'mf')
    z.writestr('META-INF/services/x', b'keep me')
`;
const ENTRIES = `
import sys, zipfile, json
with zipfile.ZipFile(sys.argv[1]) as z:
    print(json.dumps({i.filename: [i.compress_type, i.CRC, z.read(i.filename).decode('latin1'), list(i.date_time)] for i in z.infolist()}))
`;

test('apk_swap.py: replaces only the named entries, keeps methods and every other entry, drops JAR signatures', () => {
  const t = tmp();
  try {
    const base = join(t.root, 'base.apk');
    assert.equal(py(MAKE_ZIP, base).status, 0);
    write(join(t.root, 'hbc'), 'new bytecode, longer than before');
    write(join(t.root, 'cfg'), '{"a":2}');
    const out = join(t.root, 'out.apk');
    const r = spawnSync('python3', [SWAP, 'swap', base, out, `assets/index.android.bundle=${join(t.root, 'hbc')}`, `assets/app.config=${join(t.root, 'cfg')}`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const b = JSON.parse(py(ENTRIES, base).stdout);
    const o = JSON.parse(py(ENTRIES, out).stdout);
    assert.deepEqual(Object.keys(o).sort(), Object.keys(b).filter((n) => !/^META-INF\/(CERT\.RSA|MANIFEST\.MF)$/.test(n)).sort());
    assert.equal(o['assets/index.android.bundle'][2], 'new bytecode, longer than before');
    assert.equal(o['assets/index.android.bundle'][0], 0, 'bundle stays stored');
    assert.equal(o['assets/app.config'][2], '{"a":2}');
    assert.equal(o['assets/app.config'][0], 8, 'app.config stays deflated');
    for (const n of ['AndroidManifest.xml', 'lib/x86_64/libx.so', 'META-INF/services/x']) assert.deepEqual(o[n], b[n], n);
    // the unchanged entries' raw bytes are copied, not recompressed
    const rawOf = (zip, name) => py(`
import sys, zipfile, struct
z = zipfile.ZipFile(sys.argv[1]); i = z.getinfo(sys.argv[2]); f = open(sys.argv[1], 'rb'); f.seek(i.header_offset)
h = f.read(30); n, m = struct.unpack('<HH', h[26:30]); f.seek(i.header_offset + 30 + n + m); print(f.read(i.compress_size).hex())`, zip, name).stdout;
    assert.equal(rawOf(out, 'AndroidManifest.xml'), rawOf(base, 'AndroidManifest.xml'));
    // compare: equal content = 0 differences; the swapped bundle = 2
    assert.equal(spawnSync('python3', [SWAP, 'compare', base, base], { encoding: 'utf8' }).status, 0);
    const c = spawnSync('python3', [SWAP, 'compare', base, out], { encoding: 'utf8' });
    assert.equal(c.status, 1);
    assert.match(c.stdout, /assets\/index\.android\.bundle: differs/);
    assert.match(c.stdout, /2 differing entries/);
  } finally {
    t.done();
  }
});

test('apk_swap.py: a new entry is no JS-only change (refused, nothing written)', () => {
  const t = tmp();
  try {
    const base = join(t.root, 'base.apk');
    py(MAKE_ZIP, base);
    write(join(t.root, 'x'), 'x');
    const out = join(t.root, 'out.apk');
    const r = spawnSync('python3', [SWAP, 'swap', base, out, `res/new.png=${join(t.root, 'x')}`], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not in the base APK/);
    assert.equal(existsSync(out), false);
  } finally {
    t.done();
  }
});

test('build-apk-fast.sh: release-key, App Bundle and debug builds never take the fast path', () => {
  const run = (args, env) => spawnSync('bash', [FAST, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  let r = run([], { HERMES_KEYSTORE: '/nonexistent.keystore' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /never use the fast path/);
  r = run([], { BUNDLE: '1' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /never use the fast path/);
  r = run(['debug'], {});
  assert.equal(r.status, 2);
});

test('build-apk.sh registers a base only for test APKs (never with the release key, never an App Bundle)', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'build-apk.sh'), 'utf8');
  const call = src.indexOf('fast_register "$OUT"');
  assert.ok(call > 0, 'register call present');
  const guard = src.lastIndexOf('if [', call);
  const cond = src.slice(guard, src.indexOf('\n', guard));
  assert.match(cond, /"\$SIGNING_MODE" != release-key/);
  assert.match(cond, /-z "\$\{HERMES_KEYSTORE:-\}"/);
  assert.match(cond, /"\$VARIANT" = release/);
  assert.ok(src.indexOf('if [ "$BUNDLE" = 1 ]; then collect_bundle; exit $?; fi') < guard, 'App Bundles exit before the register step');
  assert.ok(src.indexOf('release_gate "$OUT"') < call, 'only an APK that passed the release gate becomes a base');
});

// node --test scripts/verify-flavor-artifact.test.mjs  — the flavor mark check of every build script.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, deflateRawSync, gzipSync } from 'node:zlib';
import { MARKS, MARK_PREFIX, findMarks, verifyArtifact } from './verify-flavor-artifact.mjs';

const script = fileURLToPath(new URL('./verify-flavor-artifact.mjs', import.meta.url));
const APP = join(dirname(script), '..', 'app');
const H = MARKS.hermes;
const OTHER = `${MARK_PREFIX}other`;

function tmp() {
  const root = mkdtempSync(join(tmpdir(), 'hui-vfa-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

/** minimal zip writer: [name, content, deflate?] → Buffer */
function zip(files) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const [name, content, deflate = true] of files) {
    const raw = Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  // an APK signing block sits between the entries and the central directory: offsets must not assume adjacency
  return Buffer.concat([...locals, cd, end]);
}

/** Hermes bytecode stores its strings packed without separators */
const hbc = (...strings) => Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0, 0, 0, 0]), Buffer.from(strings.join(''))]);

test('findMarks: counts known marks, also packed between other strings; reports unknown ones', () => {
  const r = findMarks(hbc('abc', H, 'defhermes', H));
  assert.deepEqual([...r.known], [[H, 2]]);
  assert.deepEqual(r.unknown, []);
  assert.match(findMarks(Buffer.from(`x="${OTHER}"`)).unknown[0], /^hui-flavor:other/);
});

test('web dir: the expected mark in one chunk passes; source maps are ignored', () => {
  const t = tmp();
  try {
    const js = join(t.root, '_expo/static/js/web');
    mkdirSync(js, { recursive: true });
    writeFileSync(join(js, 'entry-1.js'), `globalThis.__HUI_FLAVOR__="${H}";`);
    writeFileSync(join(js, 'Gallery-2.js'), 'console.log(1)');
    writeFileSync(join(js, 'entry-1.js.map'), JSON.stringify({ sourcesContent: [`'${OTHER}'`] }));
    writeFileSync(join(t.root, 'index.html'), '<script src="/_expo/static/js/web/entry-1.js"></script>');
    const r = verifyArtifact(t.root, 'hermes');
    assert.equal(r.ok, true, r.errors.join('\n'));
    assert.deepEqual(r.found, ['_expo/static/js/web/entry-1.js']);
    const cli = run(t.root, 'hermes');
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /hui-flavor:hermes OK/);
  } finally {
    t.done();
  }
});

test('web dir: no mark, an unknown mark, or a stale precompressed sibling fails', () => {
  const t = tmp();
  try {
    writeFileSync(join(t.root, 'entry.js'), 'console.log("no mark")');
    let r = verifyArtifact(t.root, 'hermes');
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /no hui-flavor:hermes in any bundle/);
    assert.equal(run(t.root, 'hermes').status, 1);

    writeFileSync(join(t.root, 'entry.js'), `a="${H}"`);
    writeFileSync(join(t.root, 'entry.js.gz'), gzipSync(`a="${OTHER}"`));
    r = verifyArtifact(t.root, 'hermes');
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /entry\.js\.gz: unknown flavor mark/);

    writeFileSync(join(t.root, 'entry.js.gz'), gzipSync(`a="${H}"`));
    writeFileSync(join(t.root, 'entry.js.br'), brotliCompressSync(Buffer.from(`a="${H}"`)));
    assert.equal(verifyArtifact(t.root, 'hermes').ok, true);
  } finally {
    t.done();
  }
});

test('empty dir / dir without bundles fails', () => {
  const t = tmp();
  try {
    writeFileSync(join(t.root, 'index.html'), '<html></html>');
    const r = verifyArtifact(t.root, 'hermes');
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /no JS bundle/);
  } finally {
    t.done();
  }
});

test('APK / AAB / IPA (zip, detected by content): the Hermes bytecode bundle must carry the mark', () => {
  const t = tmp();
  try {
    const apk = join(t.root, 'app.apk.partial');
    writeFileSync(apk, zip([['AndroidManifest.xml', 'x', false], ['assets/index.android.bundle', hbc('a', H, 'b')], ['classes.dex', 'dex']]));
    assert.equal(verifyArtifact(apk, 'hermes').ok, true);

    const aab = join(t.root, 'app.aab');
    writeFileSync(aab, zip([['base/assets/index.android.bundle', hbc(H), false]]));
    assert.equal(verifyArtifact(aab, 'hermes').ok, true);

    const ipa = join(t.root, 'app.ipa');
    writeFileSync(ipa, zip([['Payload/Hermes.app/main.jsbundle', hbc('x')], ['Payload/Hermes.app/Info.plist', 'p']]));
    let r = verifyArtifact(ipa, 'hermes');
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /main\.jsbundle: no hui-flavor:hermes/);

    // the mark somewhere else does not make up for a bundle without it
    writeFileSync(ipa, zip([['Payload/Hermes.app/main.jsbundle', hbc('x')], ['Payload/Hermes.app/other.js', H]]));
    assert.equal(verifyArtifact(ipa, 'hermes').ok, false);

    const noBundle = join(t.root, 'nobundle.apk');
    writeFileSync(noBundle, zip([['assets/other.js', H]]));
    r = verifyArtifact(noBundle, 'hermes');
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /no index\.android\.bundle \/ main\.jsbundle/);
  } finally {
    t.done();
  }
});

test('tar.gz (package-web.sh archive) incl. a GNU long name', () => {
  const tarv = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  const gnu = tarv.status === 0 && /GNU tar/.test(tarv.stdout);
  const t = tmp();
  try {
    const top = join(t.root, 'hermes-ui-plus-web');
    const deep = join(top, '_expo/static/js/web', 'd'.repeat(60), 'e'.repeat(60));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'entry-0123456789abcdef.js'), `x="${H}"`);
    const out = join(t.root, 'web.tar.gz.tmp');
    const r = spawnSync('tar', ['-C', t.root, ...(gnu ? ['--format=gnu'] : []), '-czf', out, 'hermes-ui-plus-web'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const v = verifyArtifact(out, 'hermes');
    assert.equal(v.ok, true, v.errors.join('\n'));
    assert.match(v.found[0], /e{60}\/entry-0123456789abcdef\.js$/);
  } finally {
    t.done();
  }
});

test('single bundle file; usage errors exit 2', () => {
  const t = tmp();
  try {
    const f = join(t.root, 'main.jsbundle');
    writeFileSync(f, hbc(H));
    assert.equal(run(f, 'hermes').status, 0);
    assert.equal(run(f).status, 2);
    assert.equal(run(f, 'other').status, 2);
    assert.equal(run(join(t.root, 'missing'), 'hermes').status, 2);
    const list = run('--list', f);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /main\.jsbundle: hui-flavor:hermes/);
  } finally {
    t.done();
  }
});


// ── the app side: FLAVOR_MARK folds to one string, and Metro's cache is keyed on EXPO_PUBLIC_* ─────────────────

function appRequire() {
  try {
    const req = createRequire(join(APP, 'package.json'));
    req.resolve('@babel/core');
    return req;
  } catch {
    return null;
  }
}

test('flavor.ts FLAVOR_MARK folds to exactly the flavor\'s mark under the production transform', (t) => {
  const req = appRequire();
  if (!req) return t.skip('app/node_modules not installed');
  const babel = req('@babel/core');
  const { constantFoldingPlugin } = req('metro-transform-plugins');
  const preset = createRequire(req.resolve('expo/package.json')).resolve('babel-preset-expo');
  const file = join(APP, 'src/flavor.ts');
  const src = readFileSync(file, 'utf8');
  const saved = process.env.EXPO_PUBLIC_FLAVOR;
  try {
    for (const flavor of ['hermes', 'personal']) {
      process.env.EXPO_PUBLIC_FLAVOR = flavor;
      // what Metro does for a release bundle: babel-preset-expo inlines EXPO_PUBLIC_* (isDev false), then
      // metro-transform-worker runs its constant folding pass; comments are gone after minification / hermesc
      const caller = { name: 'metro', bundler: 'metro', platform: 'android', isDev: false, isServer: false };
      const a = babel.transformSync(src, { filename: file, babelrc: false, configFile: false, presets: [preset], caller, ast: true, comments: false });
      const b = babel.transformFromAstSync(a.ast, a.code, { filename: file, babelrc: false, configFile: false, plugins: [constantFoldingPlugin], comments: false });
      const r = findMarks(Buffer.from(b.code));
      assert.deepEqual([...r.known.keys()], [MARKS[flavor]], `${flavor}: ${[...r.known.keys()]}`);
      assert.deepEqual(r.unknown, []);
    }
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_FLAVOR;
    else process.env.EXPO_PUBLIC_FLAVOR = saved;
  }
});

test('the root layout keeps FLAVOR_MARK alive in a global', () => {
  const layout = readFileSync(join(APP, 'src/app/_layout.tsx'), 'utf8');
  assert.match(layout, /import \{ FLAVOR_MARK \} from '\.\.\/flavor';/);
  assert.match(layout, /\.__HUI_FLAVOR__ = FLAVOR_MARK;/);
});

test('metro.config.js keys the transform cache on the EXPO_PUBLIC_* values', (t) => {
  if (!appRequire()) return t.skip('app/node_modules not installed');
  const version = (env) => {
    const r = spawnSync(process.execPath, ['-e', "process.stdout.write(require('./metro.config.js').cacheVersion)"], {
      cwd: APP,
      encoding: 'utf8',
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('EXPO_PUBLIC_'))), ...env },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const hermes = version({ EXPO_PUBLIC_FLAVOR: 'hermes' });
  assert.match(hermes, /expo-public:[0-9a-f]{16}$/);
  assert.equal(version({ EXPO_PUBLIC_FLAVOR: 'hermes' }), hermes);
  assert.notEqual(version({ EXPO_PUBLIC_FLAVOR: 'personal' }), hermes);
  assert.notEqual(version({ EXPO_PUBLIC_FLAVOR: 'hermes', EXPO_PUBLIC_APP_NAME: 'Example' }), hermes);
});

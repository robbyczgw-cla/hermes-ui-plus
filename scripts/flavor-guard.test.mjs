// node --test scripts/flavor-guard.test.mjs  — the hermes build guard against private-overlay content.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkEnv } from './flavor-guard.mjs';

const script = fileURLToPath(new URL('./flavor-guard.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hui-fg-'));
  const priv = join(root, 'private');
  const out = join(root, 'out');
  mkdirSync(join(priv, 'branding'), { recursive: true });
  mkdirSync(out);
  writeFileSync(join(priv, 'branding', 'logo.png'), Buffer.from('PRIVATE-LOGO-BYTES-123'));
  writeFileSync(join(priv, 'leak-denylist.txt'), 'secrethost\n');
  writeFileSync(join(out, 'index.html'), '<title>Hermes Interactive UI+</title>');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, HUI_PRIVATE_DIR: priv } });
  return { root, priv, out, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('clean output passes', () => {
  const f = fixture();
  try {
    const r = f.run('--output', f.out);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    f.done();
  }
});

test('output with an overlay file, a denylisted term, the overlay path or a real ts.net host fails', () => {
  for (const make of [
    (f) => writeFileSync(join(f.out, 'icon.png'), Buffer.from('PRIVATE-LOGO-BYTES-123')),
    (f) => writeFileSync(join(f.out, 'app.js'), 'const h = "https://secrethost:8790";'),
    (f) => writeFileSync(join(f.out, 'app.js'), `const p = ${JSON.stringify(f.priv)};`),
    (f) => writeFileSync(join(f.out, 'app.js'), `fetch("https://${TS_HOST}/v1")`),
  ]) {
    const f = fixture();
    try {
      make(f);
      const r = f.run('--output', f.out);
      assert.equal(r.status, 1, r.stdout);
    } finally {
      f.done();
    }
  }
});

test('output: compressed files are checked by their content, not their compressed bytes', () => {
  // a gzip whose header comment holds the term: the raw bytes match by chance, the content is clean -> passes
  const gz = gzipSync(Buffer.from('console.log("clean bundle");'));
  gz[3] |= 0x10; // FCOMMENT
  const chance = Buffer.concat([gz.subarray(0, 10), Buffer.from('secrethost\0'), gz.subarray(10)]);
  let f = fixture();
  try {
    writeFileSync(join(f.out, 'app.js.gz'), chance);
    const r = f.run('--output', f.out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    f.done();
  }
  // the term inside the compressed content -> fails
  f = fixture();
  try {
    writeFileSync(join(f.out, 'app.js.gz'), gzipSync(Buffer.from('const h = "https://secrethost:8790";')));
    const r = f.run('--output', f.out);
    assert.equal(r.status, 1, r.stdout);
  } finally {
    f.done();
  }
});

test('build input: .env files and links into the overlay fail', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.out, '.env.local'), 'X=1');
    assert.equal(f.run('--tree', f.out, '--no-expo-config').status, 1);
    rmSync(join(f.out, '.env.local'));
    symlinkSync(join(f.priv, 'branding'), join(f.out, 'branding'));
    assert.equal(f.run('--tree', f.out, '--no-expo-config').status, 1);
    rmSync(join(f.out, 'branding'));
    assert.equal(f.run('--tree', f.out, '--no-expo-config').status, 0);
  } finally {
    f.done();
  }
});

test('env: only the public EXPO_PUBLIC_* values are allowed in a hermes build', () => {
  assert.deepEqual(checkEnv({ EXPO_PUBLIC_FLAVOR: 'hermes', EXPO_PUBLIC_APP_NAME: 'Hermes Interactive UI+' }, '/p'), []);
  assert.equal(checkEnv({ EXPO_PUBLIC_FLAVOR: 'personal' }, '/p').length, 1);
  assert.equal(checkEnv({ EXPO_PUBLIC_DEV_PROFILES: '[]' }, '/p').length, 1);
  assert.equal(checkEnv({ EXPO_PUBLIC_PERSONA_NAMES: 'x' }, '/p').length, 1);
  assert.equal(checkEnv({ EXPO_PUBLIC_APP_NAME: '/p/x' }, '/p').length, 1);
});

// A desktop app embeds the web bundle's compressed files byte for byte; --assets (or $HUI_EMBEDDED_ASSETS) names that web dir.
const chanceGz = (term) => {
  const gz = gzipSync(randomBytes(80 * 1024));
  const data = Buffer.concat([Buffer.from('XXXXXX'), Buffer.alloc(40, 0x2e), Buffer.from(`${term}\0`)]);
  const extra = Buffer.concat([Buffer.from([0x41, 0x42, data.length & 255, data.length >> 8]), data]);
  const head = Buffer.from(gz.subarray(0, 10));
  head[3] |= 0x04; // FEXTRA: the term sits in the raw bytes by chance, the content is random
  return Buffer.concat([head, Buffer.from([extra.length & 255, extra.length >> 8]), extra, gz.subarray(10)]);
};

test('output with --assets: an exact copy of a clean compressed asset in the binary is skipped and reported; without it the chance hit fails', () => {
  const f = fixture();
  try {
    const blob = chanceGz('secrethost');
    const web = join(f.root, 'web');
    mkdirSync(web);
    writeFileSync(join(web, 'entry.js.gz'), blob);
    writeFileSync(join(f.out, 'app-binary'), Buffer.concat([randomBytes(2048), blob, randomBytes(2048)]));
    assert.equal(f.run('--output', f.out).status, 1, 'without --assets the chance hit is found');
    const r = f.run('--output', f.out, '--assets', web);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /embedded asset skipped: app-binary @\d+ \+\d+ bytes/);
  } finally {
    f.done();
  }
});

test('output with --assets: a blob that differs by one byte, or a term in the decompressed asset, still fails', () => {
  const f = fixture();
  try {
    const blob = chanceGz('secrethost');
    const web = join(f.root, 'web');
    mkdirSync(web);
    writeFileSync(join(web, 'entry.js.gz'), blob);
    const other = Buffer.from(blob);
    other[blob.length - 40] ^= 0x01;
    writeFileSync(join(f.out, 'app-binary'), Buffer.concat([randomBytes(2048), other, randomBytes(2048)]));
    const r = f.run('--output', f.out, '--assets', web);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /embedded asset skipped/);
    // the term in the decompressed content of the asset: fails, and the exact copy is not skipped
    writeFileSync(join(web, 'entry.js.gz'), (() => { const g = chanceGz('x'); return Buffer.concat([g, gzipSync(Buffer.from('const h = "secrethost";'))]); })());
    writeFileSync(join(f.out, 'app-binary'), randomBytes(1024));
    const r2 = f.run('--output', f.out, '--assets', web);
    assert.equal(r2.status, 1, r2.stdout + r2.stderr);
    assert.match(r2.stderr, /assets:/);
  } finally {
    f.done();
  }
});

test('signed iOS output: code-signature files are allowed, app content is still checked', () => {
  const f = fixture();
  try {
    const app = join(f.out, 'Payload', 'X.app');
    mkdirSync(join(app, '_CodeSignature'), { recursive: true });
    // denylisted term only in signature data (profile, CodeResources) -> allowed
    writeFileSync(join(app, 'embedded.mobileprovision'), 'Apple Development: secrethost team');
    writeFileSync(join(app, '_CodeSignature', 'CodeResources'), '<string>secrethost</string>');
    assert.equal(f.run('--output', f.out).status, 0);
    writeFileSync(join(app, 'Info.plist'), '<string>https://secrethost:8790</string>');
    assert.equal(f.run('--output', f.out).status, 1, 'plist content stays strict');
  } finally {
    f.done();
  }
});

// synthetic samples assembled at runtime (this file itself must pass `leak-guard --tree`)
const TS_HOST = ['box', 'tail9876', 'ts', 'net'].join('.');
const MAIL = ['someone', 'mailhost-sample.de'].join('@');
const CGNAT = [100, 101, 2, 3].join('.');

test('output: generic findings fail even without a private denylist; node_modules trees and inline markers do not hide them', () => {
  for (const make of [
    (f) => writeFileSync(join(f.out, 'app.js'), `fetch("https://${TS_HOST}/v1")`),
    (f) => writeFileSync(join(f.out, 'app.js'), `const owner = "${MAIL}";`),
    (f) => writeFileSync(join(f.out, 'app.js'), `const ip = "${CGNAT}";`),
    (f) => {
      mkdirSync(join(f.out, 'assets', 'node_modules', 'lib'), { recursive: true });
      writeFileSync(join(f.out, 'assets', 'node_modules', 'lib', 'x.js'), `"${TS_HOST}"`);
    },
    (f) => writeFileSync(join(f.out, 'app.js'), `var a="leak-guard:allow",b="${TS_HOST}";`),
  ]) {
    const f = fixture();
    try {
      rmSync(join(f.priv, 'leak-denylist.txt'));
      make(f);
      const r = f.run('--output', f.out);
      assert.equal(r.status, 1, r.stdout + r.stderr);
    } finally {
      f.done();
    }
  }
});

test('output without any private dir still runs the generic scan', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.out, 'app.js'), `fetch("https://${TS_HOST}/v1")`);
    const r = spawnSync(process.execPath, [script, '--output', f.out], { encoding: 'utf8', env: { ...process.env, HUI_PRIVATE_DIR: join(f.root, 'missing') } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
  } finally {
    f.done();
  }
});

test('env: EXPO_PUBLIC_BG_SERVICE (store-build switch) is allowed with 0/1 only', () => {
  assert.deepEqual(checkEnv({ EXPO_PUBLIC_FLAVOR: 'hermes', EXPO_PUBLIC_BG_SERVICE: '0' }, '/p'), []);
  assert.deepEqual(checkEnv({ EXPO_PUBLIC_BG_SERVICE: '1' }, '/p'), []);
  assert.equal(checkEnv({ EXPO_PUBLIC_BG_SERVICE: 'someone-private' }, '/p').length, 1);
});

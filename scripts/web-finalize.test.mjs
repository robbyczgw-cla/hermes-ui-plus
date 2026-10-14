// node --test scripts/web-finalize.test.mjs — PWA post-processing (cache version, precache list, WEB_SW=0 retirement).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RETIRE_SW, buildVersion, finalize } from './web-finalize.mjs';

const PUBLIC = fileURLToPath(new URL('../app/public/', import.meta.url));
const quiet = { ...process.env, WEB_SW: '1', EXPO_PUBLIC_APP_NAME: 'Hermes UI+' };

/** a minimal export: the real public/ template files + one entry bundle, one lazy chunk, one asset */
function exportDir(root = mkdtempSync(join(tmpdir(), 'hui-wf-'))) {
  const d = join(root, 'dist-web');
  mkdirSync(join(d, '_expo', 'static', 'js', 'web'), { recursive: true });
  mkdirSync(join(d, 'assets', 'fonts'), { recursive: true });
  cpSync(join(PUBLIC, 'icons'), join(d, 'icons'), { recursive: true });
  cpSync(join(PUBLIC, 'sw.js'), join(d, 'sw.js'));
  cpSync(join(PUBLIC, 'manifest.webmanifest'), join(d, 'manifest.webmanifest'));
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8').replace('</body>', '<script src="/_expo/static/js/web/entry-abc.js" defer></script></body>');
  writeFileSync(join(d, 'index.html'), html);
  writeFileSync(join(d, '_expo', 'static', 'js', 'web', 'entry-abc.js'), 'console.log(1)');
  writeFileSync(join(d, '_expo', 'static', 'js', 'web', 'Lazy-def.js'), 'console.log(2)');
  writeFileSync(join(d, 'assets', 'fonts', 'x.ttf'), 'font');
  return { root, d, done: () => rmSync(root, { recursive: true, force: true }) };
}

const run = (d, env = quiet) => {
  const log = console.log;
  console.log = () => {};
  try {
    return finalize(d, env);
  } finally {
    console.log = log;
  }
};

test('sw: version + precache written, registration added, version independent of the output path', () => {
  const a = exportDir();
  const b = exportDir();
  try {
    const ra = run(a.d);
    const rb = run(b.d);
    assert.match(ra.version, /^[0-9a-f]{12}$/);
    assert.equal(ra.version, rb.version, 'same content in another directory = same cache version');
    const sw = readFileSync(join(a.d, 'sw.js'), 'utf8');
    assert.ok(sw.includes(`const SHELL_VERSION = '${ra.version}';`));
    assert.ok(sw.includes('"/_expo/static/js/web/Lazy-def.js"') && sw.includes('"/assets/fonts/x.ttf"'));
    assert.match(readFileSync(join(a.d, 'index.html'), 'utf8'), /<script data-pwa="sw">/);
  } finally {
    a.done();
    b.done();
  }
});

test('sw: an icon-, manifest- or shell-only change gives a new cache version', () => {
  const base = exportDir();
  const base2 = exportDir();
  try {
    const v0 = run(base.d).version;
    for (const change of [
      (d) => writeFileSync(join(d, 'icons', 'icon-192.png'), 'new icon bytes'),
      (d) => writeFileSync(join(d, 'manifest.webmanifest'), '{"name":"x","extra":1}'),
      (d) => writeFileSync(join(d, 'index.html'), readFileSync(join(d, 'index.html'), 'utf8').replace('<body>', '<body data-x="1">')),
    ]) {
      const e = exportDir();
      try {
        change(e.d);
        assert.notEqual(run(e.d).version, v0);
      } finally {
        e.done();
      }
    }
    // precompressed siblings / maps do not count
    writeFileSync(join(base2.d, 'index.html.br'), 'zz');
    assert.equal(run(base2.d).version, v0);
  } finally {
    base.done();
    base2.done();
  }
});

test('WEB_SW=0: no registration, sw.js becomes the retirement worker', () => {
  const e = exportDir();
  try {
    const r = run(e.d, { ...quiet, WEB_SW: '0' });
    assert.equal(r.withSw, false);
    assert.doesNotMatch(readFileSync(join(e.d, 'index.html'), 'utf8'), /data-pwa="sw"/);
    assert.equal(readFileSync(join(e.d, 'sw.js'), 'utf8'), RETIRE_SW);
  } finally {
    e.done();
  }
});

test('buildVersion hashes content, not mtimes or absolute paths', () => {
  const e = exportDir();
  try {
    const v1 = buildVersion(e.d, 'tpl');
    assert.equal(buildVersion(e.d, 'tpl'), v1);
    assert.notEqual(buildVersion(e.d, 'tpl2'), v1, 'worker template is part of the version');
    writeFileSync(join(e.d, 'assets', 'fonts', 'x.ttf'), 'font2');
    assert.notEqual(buildVersion(e.d, 'tpl'), v1);
  } finally {
    e.done();
  }
});

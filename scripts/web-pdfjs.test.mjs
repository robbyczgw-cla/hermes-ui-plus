// scripts/web-pdfjs.mjs: the PDF viewer's pdf.js files land in <dist>/pdfjs/ as .js (JS MIME on every static host), with
// the loader, the licence and the data dirs, and stay out of the service worker's precache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyPdfjs, LOADER } from './web-pdfjs.mjs';
import { finalize } from './web-finalize.mjs';

function fakePdfjs(dir) {
  mkdirSync(join(dir, 'legacy', 'build'), { recursive: true });
  writeFileSync(join(dir, 'legacy', 'build', 'pdf.min.mjs'), 'export const version = "9";');
  writeFileSync(join(dir, 'legacy', 'build', 'pdf.worker.min.mjs'), '// worker');
  for (const d of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
    mkdirSync(join(dir, d));
    writeFileSync(join(dir, d, 'f.bin'), 'x');
  }
  writeFileSync(join(dir, 'LICENSE'), 'Apache License');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
}

test('copies the browser build, data, licence and loader into <dist>/pdfjs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hui-pdfjs-'));
  try {
    const src = join(tmp, 'pdfjs-dist');
    const dist = join(tmp, 'dist');
    fakePdfjs(src);
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), '<html><head></head></html>');
    const r = copyPdfjs(dist, src);
    assert.equal(r.version, '9.9.9');
    for (const f of ['pdf.min.js', 'pdf.worker.min.js', 'load.js', 'LICENSE', 'version.txt', 'standard_fonts/f.bin', 'cmaps/f.bin', 'wasm/f.bin', 'iccs/f.bin']) {
      assert.ok(existsSync(join(dist, 'pdfjs', f)), f);
    }
    assert.equal(readFileSync(join(dist, 'pdfjs', 'load.js'), 'utf8'), LOADER);
    assert.match(LOADER, /from '\.\/pdf\.min\.js'/);
    assert.match(LOADER, /pdf\.worker\.min\.js/);
    assert.doesNotMatch(LOADER, /https?:\/\//, 'no CDN');
    // not precached: the viewer loads on demand
    writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
    writeFileSync(join(dist, 'sw.js'), "const SHELL_VERSION = 'dev';\nconst PRECACHE = [];\n");
    const fin = finalize(dist, {});
    assert.ok(!fin.precache.some((p) => p.startsWith('/pdfjs/')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing pdfjs-dist is an error, not a silent viewer-less build', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hui-pdfjs-'));
  try {
    assert.throws(() => copyPdfjs(tmp, join(tmp, 'nope')), /missing/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('build-web.sh copies pdf.js before the PWA finalize step (part of the cache version)', () => {
  const sh = readFileSync(new URL('./build-web.sh', import.meta.url), 'utf8');
  // from the clean build copy's node_modules (the inner build runs in $BUILD_DIR/app, not in the repo)
  const copy = sh.indexOf('web-pdfjs.mjs" dist-web node_modules/pdfjs-dist');
  const fin = sh.indexOf('web-finalize.mjs" dist-web');
  assert.ok(copy > 0 && fin > copy);
});

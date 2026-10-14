#!/usr/bin/env node
// Precompress the text assets of an exported web build (called by scripts/build-web.sh after web-finalize):
// every js/css/html/json/svg/webmanifest file > 1 KB gets a `.br` (brotli q11) and a `.gz` (gzip level 9) sibling.
// The bridge (BRIDGE_WEB_DIR) or any other static server that supports it serves them with Content-Encoding when the
// server (nginx brotli_static/gzip_static, ...) can do the same. Siblings are never precached by sw.js (fixed shell list).
// Usage: node scripts/web-precompress.mjs <dist-dir>
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('usage: web-precompress.mjs <dist-dir>');
  process.exit(2);
}
const EXT = new Set(['.js', '.css', '.html', '.json', '.svg', '.webmanifest']);
const MIN = 1024;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const all = walk(dir);
for (const f of all) if (/\.(br|gz)$/.test(f) && EXT.has(extname(f.replace(/\.(br|gz)$/, '')))) rmSync(f); // stale siblings
let n = 0, raw = 0, br = 0, gz = 0;
for (const f of all) {
  if (!EXT.has(extname(f)) || !existsSync(f)) continue;
  const buf = readFileSync(f);
  if (buf.length <= MIN) continue;
  const b = brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length, [constants.BROTLI_PARAM_LGWIN]: 24 },
  });
  const g = gzipSync(buf, { level: 9 });
  writeFileSync(`${f}.br`, b);
  writeFileSync(`${f}.gz`, g);
  n++, (raw += buf.length), (br += b.length), (gz += g.length);
}
const kb = (x) => `${(x / 1024).toFixed(0)} KB`;
console.log(`web-precompress: ${n} files, raw ${kb(raw)} -> gzip ${kb(gz)} / brotli ${kb(br)}`);

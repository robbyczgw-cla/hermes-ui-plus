#!/usr/bin/env node
// The in-app PDF viewer of the web app (app/src/files/PdfViewer.tsx) uses pdf.js (Mozilla, Apache-2.0). It is not part
// of the Metro bundle: this step copies the browser build from app/node_modules/pdfjs-dist into <dist>/pdfjs/, and the
// app loads it only when the first PDF is opened (a module <script src="/pdfjs/load.js">, same origin, so the app CSP's
// script-src 'self' / worker-src 'self' cover it; no CDN). Not in the service worker's precache (web-finalize.mjs only
// precaches _expo/static, assets and fonts).
//   pdf.min.js / pdf.worker.min.js  the "legacy" build (older iOS / Android browsers), renamed .mjs -> .js so every
//                                    static host serves them as JavaScript (module scripts need a JS MIME type)
//   standard_fonts/ cmaps/ wasm/ iccs/  data pdf.js fetches on demand (non-embedded fonts, CJK, JPEG 2000 / JBIG2, ICC)
//   load.js                          sets globalThis.__huiPdfjs and fires the `hui-pdfjs` event
//   LICENSE                          pdf.js licence (also listed in NOTICE.md)
// Usage: node scripts/web-pdfjs.mjs <dist-dir> [pdfjs-dist dir]   (run by scripts/build-web.sh after expo export)
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOADER = `// pdf.js loader of the in-app PDF viewer (scripts/web-pdfjs.mjs, app/src/files/pdfjs.ts)
import * as pdfjs from './pdf.min.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', import.meta.url).href;
globalThis.__huiPdfjs = pdfjs;
globalThis.dispatchEvent(new Event('hui-pdfjs'));
`;

const DATA_DIRS = ['standard_fonts', 'cmaps', 'wasm', 'iccs'];

export function copyPdfjs(dist, src) {
  const build = join(src, 'legacy', 'build');
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    if (!existsSync(join(build, f))) throw new Error(`web-pdfjs: ${join(build, f)} missing (npm ci in app/?)`);
  }
  const out = join(dist, 'pdfjs');
  mkdirSync(out, { recursive: true });
  copyFileSync(join(build, 'pdf.min.mjs'), join(out, 'pdf.min.js'));
  copyFileSync(join(build, 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.js'));
  for (const d of DATA_DIRS) if (existsSync(join(src, d))) cpSync(join(src, d), join(out, d), { recursive: true });
  copyFileSync(join(src, 'LICENSE'), join(out, 'LICENSE'));
  writeFileSync(join(out, 'load.js'), LOADER);
  const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
  writeFileSync(join(out, 'version.txt'), `${version}\n`);
  return { out, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2];
  const src = process.argv[3] ?? fileURLToPath(new URL('../app/node_modules/pdfjs-dist', import.meta.url));
  if (!dist || !existsSync(join(dist, 'index.html'))) {
    console.error(`usage: web-pdfjs.mjs <dist-dir> [pdfjs-dist dir]  (no index.html in ${dist})`);
    process.exit(2);
  }
  try {
    const r = copyPdfjs(dist, src);
    console.log(`web-pdfjs: pdf.js ${r.version} -> ${r.out}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

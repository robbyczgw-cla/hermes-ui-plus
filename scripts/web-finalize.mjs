#!/usr/bin/env node
// PWA post-processing of an `expo export -p web` output dir (called by scripts/build-web.sh):
//  - manifest.webmanifest from EXPO_PUBLIC_APP_NAME / _APP_SHORT_NAME / _THEME_COLOR (+ WEB_DESCRIPTION, official: the tagline)
//  - index.html: <title>, application-name, apple-mobile-web-app-title, theme-color metas (data-pwa="…"), <html lang="en">
//  - sw.js: SHELL_VERSION = content hash of the FINAL export (relative paths + bytes of every shipped file incl. the
//    shell, manifest and icons, plus the worker template), PRECACHE = the export's hashed bundles / lazy chunks /
//    assets; registration script.
//  - WEB_SW=0: no registration, and sw.js becomes a retirement worker: browsers that installed the worker of an earlier
//    deployment fetch it on their next update check, it deletes the hui-shell-* caches and unregisters itself
//    (other registrations / caches of the origin are left alone).
// Usage: node scripts/web-finalize.mjs <dist-dir>   (run after branding, before scripts/web-precompress.mjs)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETIRE_SW = `// Hermes UI: service worker retired (build with WEB_SW=0, scripts/web-finalize.mjs). Removes this app's caches
// and its own registration; other workers / caches of the origin are untouched.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hui-shell-')).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister()),
  );
});
`;

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const rel = (dir, f) => relative(dir, f).split(sep).join('/');

/**
 * Deterministic cache version: relative path + content of every file of the final export (except the worker itself
 * and precompressed / source-map siblings) and the worker template. Independent of the absolute output path.
 */
export function buildVersion(dir, swTemplate = '') {
  const h = createHash('sha256');
  for (const f of walk(dir).map((f) => rel(dir, f)).filter((f) => !/^sw\.js(\.(br|gz))?$/.test(f) && !/\.(br|gz|map)$/.test(f)).sort()) {
    h.update(`${f}\0`);
    h.update(createHash('sha256').update(readFileSync(join(dir, f))).digest());
  }
  h.update(`sw\0${swTemplate}`);
  return h.digest('hex').slice(0, 12);
}

export function finalize(dir, env = process.env) {
  const color = (v, d) => (v && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : d);
  const text = (v, d, max) => {
    const s = (v ?? '').replace(/[\u0000-\u001f\u007f<>"&]/g, '').trim();
    return (s || d).slice(0, max);
  };
  const name = text(env.EXPO_PUBLIC_APP_NAME, 'Hermes', 45);
  const shortName = text(env.EXPO_PUBLIC_APP_SHORT_NAME, name, 20);
  const theme = color(env.EXPO_PUBLIC_THEME_COLOR, '#ffffff');
  const themeDark = color(env.EXPO_PUBLIC_THEME_COLOR_DARK, '#000000');
  const withSw = env.WEB_SW !== '0';

  // offline shell: every hashed bundle / lazy chunk / asset of THIS export plus the bundled web fonts (public/fonts,
  // referenced from index.html) (root-relative URLs; the app is served at '/').
  // Runs before web-precompress.mjs, the .br/.gz siblings are not there yet (and are skipped anyway).
  const precache = walk(dir)
    .map((f) => rel(dir, f))
    .filter((f) => (/^(_expo\/static|assets)\//.test(f) || /^fonts\/[^/]+\.woff2$/.test(f)) && !/\.(br|gz|map)$/.test(f))
    .sort()
    .map((f) => '/' + f.split('/').map(encodeURIComponent).join('/'));

  const manifestPath = join(dir, 'manifest.webmanifest');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  Object.assign(manifest, { name, short_name: shortName, theme_color: theme, background_color: theme });
  // the Web Share Target POST is answered by sw.js only (docs/SHARE-TARGET.md "Web"): without a worker, no share target
  if (!withSw) delete manifest.share_target;
  if (env.WEB_DESCRIPTION) manifest.description = text(env.WEB_DESCRIPTION, manifest.description ?? '', 200);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let html = readFileSync(join(dir, 'index.html'), 'utf8');
  const setMeta = (key, value) => {
    const re = new RegExp(`(<meta\\b[^>]*?content=")[^"]*("[^>]*data-pwa="${key}")`);
    if (!re.test(html)) console.warn(`web-finalize: meta data-pwa="${key}" not found`);
    html = html.replace(re, `$1${value}$2`);
  };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`);
  // static default language of the shell: en (app.json web.lang used to be "de"); the inline data-pwa="lang" script and
  // the app (applyDocumentLang) switch it to the UI language at runtime
  if (!/<html\b[^>]*\blang="/.test(html)) console.warn('web-finalize: <html lang> not found');
  html = html.replace(/(<html\b[^>]*?\blang=")[^"]*"/, '$1en"');
  setMeta('name', name);
  setMeta('short-name', shortName);
  setMeta('theme-light', theme);
  setMeta('theme-dark', themeDark);
  html = html.replace(/<script data-pwa="sw">[\s\S]*?<\/script>/, '');
  const swPath = join(dir, 'sw.js');
  let version = 'off';
  if (withSw && existsSync(swPath)) {
    // only on secure origins (HTTPS / localhost); service workers are unavailable elsewhere anyway
    const reg = `<script data-pwa="sw">if('serviceWorker' in navigator&&window.isSecureContext){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>`;
    html = html.replace('</head>', `${reg}\n</head>`);
    writeFileSync(join(dir, 'index.html'), html);
    const template = readFileSync(swPath, 'utf8');
    // version over the FINAL files (manifest + index.html written above, icons already branded)
    version = buildVersion(dir, template);
    const sw = template
      .replace(/const SHELL_VERSION = '[^']*';/, `const SHELL_VERSION = '${version}';`)
      .replace(/const PRECACHE = \[[^\]]*\];/, `const PRECACHE = ${JSON.stringify(precache)};`);
    if (!sw.includes(`const SHELL_VERSION = '${version}';`)) throw new Error('web-finalize: SHELL_VERSION placeholder not found in sw.js');
    if (!sw.includes(`const PRECACHE = ${JSON.stringify(precache)};`)) throw new Error('web-finalize: PRECACHE placeholder not found in sw.js');
    writeFileSync(swPath, sw);
  } else {
    writeFileSync(join(dir, 'index.html'), html);
    writeFileSync(swPath, RETIRE_SW); // replaces an installed worker of an earlier deployment (see header)
  }
  console.log(`web-finalize: name="${name}" short="${shortName}" theme=${theme}/${themeDark} sw=${withSw ? `${version} (${precache.length} precached)` : 'retired'}`);
  return { version, precache, withSw };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !existsSync(join(dir, 'index.html'))) {
    console.error(`usage: web-finalize.mjs <dist-dir>  (no index.html in ${dir})`);
    process.exit(2);
  }
  try {
    finalize(dir);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

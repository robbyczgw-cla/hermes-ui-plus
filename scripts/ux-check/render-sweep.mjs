#!/usr/bin/env node
// Render sweep: every answer node type with degenerate data (app/src/ui/renderFixtures.ts: bare node, empty lists,
// unknown fields, image items that cannot be resolved) rendered in the built web app the way the chat renders a
// complete ```hui block, then checked in the DOM: each fixture must show visible text or a loaded image – never
// nothing, an empty box or a shimmer that never settles. Catches the "empty gap instead of a gallery" class of bugs.
//
//   node scripts/ux-check/render-sweep.mjs [--only=gallery,image] [--lang=en|de|es] [--theme=light|dark]
//                                          [--shots=gallery,image] [--unknown-images=always]
//   UX_CHECK_PORT=8119 UX_WEB_DIR=dist/web node scripts/ux-check/render-sweep.mjs
//
// Network: everything outside the local bundle is aborted (no image search, no Wikipedia: the "failed fetch" and
// "no image search" cases), except the sweep's own test photo https://upload.wikimedia.org/render-sweep/photo-ok.jpg
// (a generated JPEG) and photo-404.jpg (HTTP 404). --shots saves JPEG screenshots (≤ 1280 px wide) of the matching
// fixtures for eyeballing. Output: dist/render-sweep/ (report.json + shots). Exit 1 when a fixture fails, 2 when the
// harness cannot run. Needs a web bundle (FLAVOR=hermes scripts/build-web.sh) and a Chromium via playwright-core.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';
import { fixtureVerdict } from './checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = Number(process.env.UX_CHECK_PORT || 8119);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const argv = process.argv.slice(2);
const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg('out') || join(ROOT, 'dist', 'render-sweep');
const only = arg('only') ?? '';
const lang = arg('lang') ?? 'en';
const themes = arg('theme') ? [arg('theme')] : ['light'];
const shots = arg('shots')?.split(',').filter(Boolean) ?? [];
const unknownImages = arg('unknown-images');
const VIEWPORT = { width: 390, height: 844 };
// image lookups give up after IMAGE_LOOKUP_CAP_MS (8 s, app/src/images/miss.ts); wait past it before judging
const SETTLE_MS = Number(process.env.RENDER_SWEEP_SETTLE_MS || 9500);

function seedScript(s) {
  try {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  } catch {}
}

/** In the page: what is visible inside each fixture box (texts, loaded images, skeletons). */
function collectFixtures() {
  const visibleText = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.textContent.replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const p = n.parentElement;
      if (!p) continue;
      const r = p.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let op = 1;
      let hidden = false;
      for (let a = p; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden') hidden = true;
        op *= Number(cs.opacity || 1);
      }
      const color = getComputedStyle(p).color;
      const transparent = /rgba\(.*,\s*0\)$/.test(color);
      if (!hidden && op > 0.05 && !transparent) out.push(s.slice(0, 80));
    }
    return out;
  };
  return [...document.querySelectorAll('[data-testid^="fx-"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const images = [...el.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width >= 24).length;
    // expo-image on the web may paint a background-image div instead of <img>
    const bgImages = [...el.querySelectorAll('div')].filter((d) => /url\(/.test(getComputedStyle(d).backgroundImage) && d.getBoundingClientRect().width >= 24).length;
    const skeletons = el.querySelectorAll('[data-testid="hui-skeleton"]').length;
    return { id: el.getAttribute('data-testid').slice(3), height: Math.round(r.height), texts: visibleText(el), images: images + bgImages, skeletons };
  });
}

/** A test photo as JPEG bytes, drawn in the browser (no binary fixture in the repo). */
async function makePhoto(browser) {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 720;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 960, 720);
    grad.addColorStop(0, '#5b7c99');
    grad.addColorStop(1, '#d9a066');
    g.fillStyle = grad;
    g.fillRect(0, 0, 960, 720);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(330, 200, 300, 320);
    g.fillStyle = '#333';
    g.fillRect(370, 240, 220, 150);
    return c.toDataURL('image/jpeg', 0.8);
  });
  await page.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function sweep(browser, theme, photo) {
  const prefs = { themeMode: theme, toolDetails: 'compact', ...(unknownImages ? { unknownImages } : {}) };
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-US', colorScheme: theme, serviceWorkers: 'block' });
  await ctx.addInitScript(seedScript, {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: 'preset-demo', kind: 'demo', name: 'Demo (offline)', baseUrl: 'demo://local' }] }),
    'hermes.activeProfile.v1': 'preset-demo',
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs }),
  });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'upload.wikimedia.org' && u.pathname.startsWith('/render-sweep/')) {
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (u.pathname.endsWith('photo-ok.jpg')) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'image/jpeg' }, body: photo });
      return route.fulfill({ status: 404, headers: cors, body: '' });
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && Number(u.port) === PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  try {
    await page.goto(`${APP_URL}gallery?fixtures=render${only ? `&only=${encodeURIComponent(only)}` : ''}`, { waitUntil: 'load', timeout: 180000 });
    await page.locator('[data-testid^="fx-"]').first().waitFor({ state: 'attached', timeout: 180000 });
    // lazy content (cards that wait for visibility): scroll through once, then let the lookups give up
    const h = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
    for (let y = 0; y < h; y += 700) await page.mouse.wheel(0, 700);
    await page.waitForTimeout(SETTLE_MS);
    const facts = await page.evaluate(collectFixtures);
    const results = facts.map((f) => ({ ...f, theme, ...fixtureVerdict(f) }));
    const shotFiles = [];
    for (const f of results.filter((r) => shots.some((s) => r.id === s || r.id.startsWith(`${s}-`)))) {
      const box = page.locator(`[data-testid="fx-${f.id}"]`);
      await box.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const file = join(OUT, `${f.id}-${lang}-${theme}.jpg`);
      await box.screenshot({ path: file, type: 'jpeg', quality: 75 });
      shotFiles.push(file);
    }
    return { theme, results, pageErrors, shots: shotFiles };
  } finally {
    await ctx.close();
  }
}

async function main() {
  if (!existsSync(join(WEB_DIR, 'index.html'))) {
    console.error(`no web bundle in ${WEB_DIR} – build it first (FLAVOR=hermes scripts/build-web.sh)`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  // keep only this run's screenshots (user rule: no piles of old test images)
  for (const f of readdirSync(OUT)) if (themes.some((th) => f.endsWith(`-${lang}-${th}.jpg`))) rmSync(join(OUT, f));
  const server = await serveStatic(WEB_DIR, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
  const runs = [];
  try {
    const photo = await makePhoto(browser);
    for (const theme of themes) runs.push(await sweep(browser, theme, photo));
  } finally {
    await browser.close();
    server.close();
  }
  let failed = 0;
  let total = 0;
  for (const r of runs) {
    for (const f of r.results) {
      total++;
      if (!f.pass) {
        failed++;
        console.log(`FAIL ${f.id} (${r.theme}): ${f.reasons.join('; ')}`);
      }
    }
    if (r.pageErrors.length) console.log(`page errors (${r.theme}): ${r.pageErrors.join(' | ')}`);
  }
  const report = { at: new Date().toISOString(), webDir: WEB_DIR, lang, only, runs };
  writeFileSync(join(OUT, `report-${lang}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`${total - failed}/${total} fixtures show content (${lang}, ${themes.join('+')})${runs.some((r) => r.shots.length) ? ` · shots in ${OUT}` : ''}`);
  if (!total) {
    console.error('no fixtures rendered – is /gallery?fixtures=render in this bundle?');
    process.exit(2);
  }
  process.exit(failed ? 1 : 0);
}

await main();

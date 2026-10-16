#!/usr/bin/env node
// Share-as-image sample shots: drives the built web app (offline demo profile, 390×844) through real answers, sets
// some interactive state (ticks checklist items, answers a quiz question), opens "Share as image" from the answer's
// action row and saves the PNG the app hands to the browser's download – the exact file a user would get.
// Light and dark theme per scenario; also a screenshot of the open sheet and a JSON report with timings.
//
//   node scripts/ux-check/share-shots.mjs [--out=DIR] [--scenario=checklist,quiz] [--theme=light|dark]
//   UX_CHECK_PORT=8118 UX_WEB_DIR=dist/web node scripts/ux-check/share-shots.mjs
//   --fake-images=PNG   answers the image URLs https://upload.wikimedia.org/share-check/photo-{ok,slow,404}.png with
//                       PNG (CORS on) / PNG after 8 s (past the capture deadline) / 404 – for a bundle whose demo answer
//                       was pointed at them, to see the wait, the timeout fallback and the error fallback in the image
//
// Needs a web bundle in dist/web (FLAVOR=hermes scripts/build-web.sh) and a Chromium via playwright-core (same as
// run.mjs). Network outside the local bundle is aborted: the demo answers locally.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = Number(process.env.UX_CHECK_PORT || 8118);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const argv = process.argv.slice(2);
const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg('out') || join(ROOT, 'dist', 'share-shots');
const only = arg('scenario')?.split(',').filter(Boolean) ?? null;
const themes = arg('theme') ? [arg('theme')] : ['light', 'dark'];
const fakeImages = arg('fake-images') ? readFileSync(arg('fake-images')) : null;
const VIEWPORT = { width: 390, height: 844 };

/** prompt → demo scenario; `act` sets interactive state before sharing; `question: false` turns the header off */
const SCENARIOS = [
  { id: 'products', prompt: 'Compare noise cancelling headphones' },
  { id: 'places', prompt: 'Restaurants nearby' },
  { id: 'paths', prompt: 'Show me ways to back up my photos' },
  { id: 'checklist', prompt: 'Make me a shopping list for the weekend', act: 'tick' },
  { id: 'quiz', prompt: 'Quiz me on European capitals', act: 'answer' },
  { id: 'recipe', prompt: 'Cook spaghetti carbonara with me – step by step, with timers.' },
  { id: 'chart', prompt: 'Show me a chart of the temperature trend.' },
  { id: 'coding', prompt: 'Fix the bug in my code' },
  { id: 'mindmap', prompt: 'Mind map of a heat pump' },
  { id: 'compare', prompt: 'Compare three plans' },
  { id: 'trip-map', prompt: 'Plan a relaxed weekend in Rome, with a schedule and a map.' },
  { id: 'long', prompt: 'A long answer please', question: false },
  // text + a sandboxed HTML widget: the widget is left out, the sheet says so
  { id: 'widget', prompt: 'Build me a calculator' },
];

function seedScript(s) {
  try {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  } catch {}
}

async function act(page, kind) {
  if (kind === 'tick') {
    const boxes = page.getByRole('checkbox');
    const n = await boxes.count();
    for (const i of [0, 2, 3].filter((i) => i < n)) {
      await boxes.nth(i).click();
      await page.waitForTimeout(250);
    }
  } else if (kind === 'answer') {
    const radios = page.getByRole('radio');
    if (await radios.count()) {
      await radios.nth(1).click();
      await page.waitForTimeout(300);
      const check = page.getByRole('button', { name: /^(Check|Submit|Prüfen)/ }).first();
      if (await check.isVisible().catch(() => false)) await check.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }
}

async function shoot(browser, sc, theme) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'en-US', colorScheme: theme, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(seedScript, {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: 'preset-demo', kind: 'demo', name: 'Demo (offline)', baseUrl: 'demo://local' }] }),
    'hermes.activeProfile.v1': 'preset-demo',
    'hui.lang': 'en',
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: theme, toolDetails: 'compact' } }),
  });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (fakeImages && u.hostname === 'upload.wikimedia.org' && u.pathname.startsWith('/share-check/')) {
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (u.pathname.includes('photo-404')) return route.fulfill({ status: 404, headers: cors, body: '' });
      if (u.pathname.includes('photo-slow')) await new Promise((r) => setTimeout(r, 8000));
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'image/png' }, body: fakeImages }).catch(() => {});
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && Number(u.port) === PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const r = { id: sc.id, theme, prompt: sc.prompt };
  try {
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 180000 });
    const input = page.getByLabel('Type a message');
    await input.waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(800);
    await input.click();
    await input.fill(sc.prompt);
    await page.getByLabel('Send', { exact: true }).click();
    const stop = page.getByLabel('Stop answer');
    if (await stop.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) await stop.waitFor({ state: 'hidden', timeout: 120000 });
    await page.waitForTimeout(1500);
    if (sc.act) await act(page, sc.act);
    const open = page.getByRole('button', { name: 'Share as image', exact: true }).last();
    await open.scrollIntoViewIfNeeded();
    const t0 = Date.now();
    await open.click();
    if (sc.question === false) {
      const toggle = page.getByRole('switch', { name: 'Show my question' });
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
    }
    const dl = page.locator('[data-testid="share-image-download"]');
    await dl.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="share-image-download"]');
      return b && b.getAttribute('aria-disabled') !== 'true' && !b.hasAttribute('disabled');
    }, null, { timeout: 30000 });
    r.readyMs = Date.now() - t0;
    await page.waitForTimeout(300);
    const sheet = join(OUT, `${sc.id}-${theme}-sheet.png`);
    await page.screenshot({ path: sheet });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), dl.click()]);
    const file = join(OUT, `${sc.id}-${theme}.png`);
    await download.saveAs(file);
    r.file = file;
    r.suggested = download.suggestedFilename();
    r.sheet = sheet;
    await page.waitForTimeout(400);
    r.sheetClosed = !(await dl.isVisible().catch(() => false));
  } catch (e) {
    r.error = String(e?.message || e).slice(0, 400);
    await page.screenshot({ path: join(OUT, `${sc.id}-${theme}-error.png`) }).catch(() => {});
  } finally {
    r.pageErrors = errors;
    await ctx.close();
  }
  return r;
}

async function main() {
  if (!existsSync(join(WEB_DIR, 'index.html'))) {
    console.error(`no web bundle in ${WEB_DIR} – build it first (FLAVOR=hermes scripts/build-web.sh)`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  const server = await serveStatic(WEB_DIR, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
  const results = [];
  try {
    for (const sc of SCENARIOS.filter((s) => !only || only.includes(s.id))) {
      for (const theme of themes) {
        const r = await shoot(browser, sc, theme);
        results.push(r);
        console.log(`${r.error ? 'FAIL' : 'ok  '} ${sc.id} ${theme}${r.readyMs ? ` ready ${r.readyMs} ms` : ''}${r.error ? ` – ${r.error}` : ''}${r.pageErrors.length ? ` (${r.pageErrors.length} page errors)` : ''}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), webDir: WEB_DIR, results }, null, 2) + '\n');
  process.exit(results.every((r) => !r.error) ? 0 : 1);
}

await main();

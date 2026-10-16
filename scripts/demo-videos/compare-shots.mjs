#!/usr/bin/env node
// Design screenshot of the compare safety net: a model wrote generic `compare` columns for products (no imageQuery),
// the app still shows a small product thumbnail per column (app/src/ui/components/compareProducts.ts). Fictional
// headphones from the demo mock (mock.mjs scenario compareNoImages, photos from ./media via the fake image search;
// "Lumo L5" has none → neutral glyph). 390×844 phone viewport, light. Writes PNGs to $SHOTS_OUT.
//
//   FLAVOR=hermes scripts/build-web.sh
//   XDG_RUNTIME_DIR=/run/user/$(id -u) systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 \
//     node scripts/demo-videos/compare-shots.mjs
//
// Env: SHOTS_OUT [dist/share/design/compare-thumbs]  DEMO_WEB_DIR [dist/web]  CHROME_PATH (optional Chromium binary)
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_URL, BROWSER_ARGS, MOCK_PORT, actions, ensureDir, loadPlaywright, newClipPage } from './lib.mjs';
import { serveStatic } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = resolve(process.env.SHOTS_OUT || join(ROOT, 'dist/share/design/compare-thumbs'));
const WEB = resolve(process.env.DEMO_WEB_DIR || join(ROOT, 'dist/web'));
const PROMPT = 'Aurel QX7 vs Nordwell ANC 5 vs Kiro K3 vs Halden H2 vs Lumo L5 – deep comparison';

const up = (u) => fetch(u).then((r) => r.ok, () => false);
ensureDir(OUT);
const web = await serveStatic(WEB, Number(new URL(APP_URL).port || 80));
const mock = spawn(process.execPath, [join(HERE, 'mock.mjs'), '--port', String(MOCK_PORT)], { stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 40 && !(await up(`http://localhost:${MOCK_PORT}/health`)); i++) await new Promise((r) => setTimeout(r, 250));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const { page } = await newClipPage(browser, {});
  const a = actions(page);
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 120000 });
  const input = page.getByLabel('Type a message');
  await input.waitFor({ timeout: 120000 });
  await input.focus();
  await page.keyboard.insertText(PROMPT);
  await page.getByLabel('Send', { exact: true }).click();
  await page.getByLabel('Stop answer').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page.getByLabel('Stop answer').waitFor({ state: 'hidden', timeout: 60000 });
  const first = page.getByText('Aurel QX7', { exact: true }).last();
  await a.scrollTo(first, { band: 0.3 });
  await a.wait(4500); // photo lookups + the 3 s slot cap for the column without a photo
  await page.screenshot({ path: join(OUT, 'compare-thumbs-1.png') });
  // the remaining columns of the horizontal rail
  const last = page.getByText('Lumo L5', { exact: true }).last();
  await last.scrollIntoViewIfNeeded();
  await a.wait(1500);
  await page.screenshot({ path: join(OUT, 'compare-thumbs-2.png') });
  console.log(`wrote ${OUT}/compare-thumbs-{1,2}.png`);
} finally {
  await browser.close();
  mock.kill();
  web.close?.();
}

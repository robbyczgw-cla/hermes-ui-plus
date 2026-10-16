#!/usr/bin/env node
// Screenshots of the coding views (diff, terminal, changes) from the built web app: every gallery entry (/gallery) and
// the offline demo's coding answer ("Fix the bug in my code"), at phone 390×844 and desktop 1440×900, in the
// Standard / OLED / Paper / Nord themes (light + dark), plus the changes review sheet and an inline comment.
//
//   node scripts/ux-check/coding-shots.mjs          # needs dist/web (FLAVOR=hermes scripts/build-web.sh)
//   UX_WEB_DIR=dist/web UX_CHECK_PORT=8118 node scripts/ux-check/coding-shots.mjs
//   PLAYWRIGHT_CORE=/path/to/playwright-core CHROME=/path/to/chrome node scripts/ux-check/coding-shots.mjs
//   node scripts/ux-check/coding-shots.mjs --demo-only    # only the demo answer + the comment shots (keeps other files)
//
// Output: dist/ux-check/coding/*.png (gitignored). Offline: every request outside the local bundle is aborted.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = Number(process.env.UX_CHECK_PORT || 8118);
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const OUT = join(ROOT, 'dist', 'ux-check', 'coding');
const BASE = `http://127.0.0.1:${PORT}`;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** gallery anchors (nativeID → id on web) */
const GALLERY = [
  ['diff-git', 'gallery-e2-diff-0'],
  ['diff-folded', 'gallery-e2-diff-1'],
  ['diff-editcard', 'gallery-e2-diff-2'],
  ['diff-snippet', 'gallery-e2-diff-3'],
  ['diff-added-deleted', 'gallery-e2-diff-4'],
  ['diff-streaming', 'gallery-e2-diff-5'],
  ['terminal-tests', 'gallery-e2-terminal-0'],
  ['terminal-progress', 'gallery-e2-terminal-1'],
  ['terminal-running', 'gallery-e2-terminal-2'],
  ['terminal-long', 'gallery-e2-terminal-3'],
  ['changes-turn', 'gallery-e2-changes-0'],
  ['changes-counts', 'gallery-e2-changes-1'],
];

/** [label, themeFamily, scheme] – every entry at both sizes for standard; the other families on the phone + desktop for the key entries */
const THEMES = [
  ['standard-light', 'standard', 'light'],
  ['standard-dark', 'standard', 'dark'],
  ['oled-dark', 'oled', 'dark'],
  ['paper-light', 'paper', 'light'],
  ['nord-dark', 'nord', 'dark'],
  ['nord-light', 'nord', 'light'],
];
const KEY_ENTRIES = new Set(['diff-git', 'terminal-tests', 'changes-turn']);

function seed(s) {
  try {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  } catch {}
}

async function context(browser, { viewport, family, scheme, lang = 'en', demo = false }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-US', colorScheme: scheme, serviceWorkers: 'block' });
  const store = {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: scheme, themeFamily: family, toolDetails: 'compact' } }),
  };
  if (demo) {
    store['hermes.profiles.v1'] = JSON.stringify({ v: 2, profiles: [{ id: 'preset-demo', kind: 'demo', name: 'Demo (offline)', baseUrl: 'demo://local' }] });
    store['hermes.activeProfile.v1'] = 'preset-demo';
  }
  await ctx.addInitScript(seed, store);
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && Number(u.port) === PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  // the gallery's sandboxed hui-html iframes (other sections) touch navigator.serviceWorker, which this context blocks
  page.on('pageerror', (e) => {
    const m = String(e);
    if (!/Failed to read the 'serviceWorker' property/.test(m)) errors.push(m.slice(0, 300));
  });
  return { ctx, page, errors };
}

async function openGallery(browser, opts) {
  const c = await context(browser, opts);
  await c.page.goto(`${BASE}/gallery`, { waitUntil: 'load', timeout: 180000 });
  await c.page.waitForSelector('#gallery-e2-diff-0', { timeout: 120000 });
  await c.page.waitForTimeout(1500);
  return c;
}

async function shoot(page, id, file) {
  const el = page.locator(`#${id}`);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await el.screenshot({ path: join(OUT, file) });
}

/** the offline demo chat: send a prompt, wait for the stream to end, screenshot the answer from its start to its end */
async function demoAnswer(browser, { viewport, family, scheme, size, lang = 'en', prompt = 'Fix the bug in my code' }) {
  const { ctx, page, errors } = await context(browser, { viewport, family, scheme, lang, demo: true });
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 180000 });
  // the composer (not the sidebar search on wide screens), by its label in the UI language
  const input = page.getByLabel({ en: 'Type a message', de: 'Nachricht eingeben', es: 'Escribe un mensaje' }[lang]);
  await input.waitFor({ state: 'visible', timeout: 180000 });
  await page.waitForTimeout(1200);
  await input.click();
  await input.fill(prompt);
  await page.keyboard.press('Enter');
  // mid-stream: the diff / terminal fences grow
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(OUT, `demo-${size}-${family}-${scheme}-streaming.png`) });
  const stop = page.getByLabel(/stop/i).first();
  await stop.waitFor({ state: 'hidden', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `demo-${size}-${family}-${scheme}-end.png`) });
  // scroll back towards the answer's start (inverted chat list: wheel up), one shot per screen
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let i = 1; i <= 3; i++) {
    await page.mouse.wheel(0, -Math.round(viewport.height * 0.7));
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `demo-${size}-${family}-${scheme}-up${i}.png`) });
  }
  await ctx.close();
  return errors;
}

async function main() {
  if (!existsSync(join(WEB_DIR, 'index.html'))) {
    console.error(`no web bundle in ${WEB_DIR}: run FLAVOR=hermes scripts/build-web.sh first`);
    process.exit(2);
  }
  const demoOnly = process.argv.includes('--demo-only');
  if (!demoOnly) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await serveStatic(WEB_DIR, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
  const errors = [];
  try {
    // 1. gallery entries: all at both sizes in standard light / dark, the key entries in the other theme families
    for (const [label, family, scheme] of demoOnly ? THEMES.slice(0, 1) : THEMES) {
      for (const [size, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
        const all = family === 'standard' && !demoOnly;
        const { ctx, page, errors: e } = await openGallery(browser, { viewport, family, scheme });
        for (const [name, id] of GALLERY) if (all || (!demoOnly && KEY_ENTRIES.has(name))) await shoot(page, id, `gallery-${size}-${label}-${name}.png`);
        if (label === 'standard-light') {
          // split layout on the desktop
          // (the switch only shows where the diff is >= 720 dp wide; the gallery column is narrower)
          const splitSw = page.locator('#gallery-e2-diff-0').getByRole('radio', { name: 'Split' });
          if (size === 'desktop' && (await splitSw.count())) {
            await splitSw.click();
            await page.waitForTimeout(400);
            await shoot(page, 'gallery-e2-diff-0', `gallery-${size}-${label}-diff-git-split.png`);
            await page.locator('#gallery-e2-diff-0').getByRole('radio', { name: 'Unified' }).click();
          }
          // web comment: click a line number → composer → saved comment + "Request changes"
          const no = page.locator('#gallery-e2-diff-0').getByText('11', { exact: true }).first();
          await no.scrollIntoViewIfNeeded();
          await no.click();
          await page.waitForTimeout(400);
          await shoot(page, 'gallery-e2-diff-0', `gallery-${size}-${label}-diff-composer.png`);
          const box = page.getByPlaceholder('What should change here?');
          if (await box.count()) {
            await box.fill('Use a rounding helper instead of Math.round.');
            await page.getByText('Add', { exact: true }).click();
            await page.waitForTimeout(400);
            await shoot(page, 'gallery-e2-diff-0', `gallery-${size}-${label}-diff-comment.png`);
          } else errors.push(`${size}: comment composer did not open on click`);
          // elements taller than the viewport come out cut in element shots: the long terminal's end ("Show all") as a viewport shot
          const showAll = page.locator('#gallery-e2-terminal-3').getByText(/^Show all \d+ lines$/);
          await showAll.scrollIntoViewIfNeeded();
          await page.waitForTimeout(350);
          await page.screenshot({ path: join(OUT, `gallery-${size}-${label}-terminal-long-end.png`) });
          await showAll.click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: join(OUT, `gallery-${size}-${label}-terminal-long-all.png`) });
          // the review sheet of the agent turn, then j (next file) on the desktop
          await page.locator('#gallery-e2-changes-0').getByRole('button', { name: 'Review all changes' }).click();
          await page.waitForTimeout(1200);
          await page.screenshot({ path: join(OUT, `review-${size}-${label}.png`) });
          await page.keyboard.press('j');
          await page.waitForTimeout(900);
          await page.screenshot({ path: join(OUT, `review-${size}-${label}-j.png`) });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
        errors.push(...e.map((x) => `${size} ${label}: ${x}`));
        await ctx.close();
      }
    }
    // 2. the demo's coding answer (a real chat message: ```diff + ```terminal fences, a changes node)
    for (const [size, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
      for (const [family, scheme] of [['standard', 'light'], ['standard', 'dark'], ['nord', 'dark']]) {
        const e = await demoAnswer(browser, { viewport, family, scheme, size });
        errors.push(...e.map((x) => `demo ${size} ${family}-${scheme}: ${x}`));
      }
    }
    errors.push(...(await demoAnswer(browser, { viewport: PHONE, family: 'paper', scheme: 'light', size: 'phone-de', lang: 'de', prompt: 'Zeig mir den Diff' })));
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) console.error('problems:\n' + errors.join('\n'));
  console.log(`screenshots in ${OUT}`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

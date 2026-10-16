#!/usr/bin/env node
// Screenshots of the "Let your agent set it up" sheet (first-run connect screen of the guided onboarding) from the
// public web build: fresh browser storage, no server, nothing leaves the machine. Same browser setup as the demo videos
// (lib.mjs: playwright-core, 390×844 phone viewport) plus one wide window (the sheet as a centred dialog).
//
//   FLAVOR=hermes scripts/build-web.sh
//   XDG_RUNTIME_DIR=/run/user/$(id -u) systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 \
//     node scripts/demo-videos/agent-setup-shots.mjs
//
// Env: PLAYWRIGHT_CORE, CHROME_PATH (playwright-core / Chromium outside the npx cache)  SHOTS_OUT [dist/share/design/agent-setup]  DEMO_WEB_DIR [dist/web]  SHOTS_PORT [8121]  DEMO_DSF [3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, VIEWPORT, DSF } from './lib.mjs';
import { serveStatic } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(process.env.SHOTS_OUT || join(ROOT, 'dist/share/design/agent-setup'));
const WEB = resolve(process.env.DEMO_WEB_DIR || join(ROOT, 'dist/web'));
const PORT = Number(process.env.SHOTS_PORT || 8121);
const URL_ = `http://127.0.0.1:${PORT}/`;

/** the labels the script clicks (app/src/i18n/ns/onboarding*.ts) */
const L = {
  en: { locale: 'en-US', connect: 'Connect', option: /^Let your agent set it up/, copy: 'Copy prompt', share: 'Share', paste: 'Paste the pairing link' },
  de: { locale: 'de-AT', connect: 'Verbinden', option: /^Lass deinen Agenten es einrichten/, copy: 'Prompt kopieren', share: 'Teilen', paste: 'Pair-Link einfügen' },
  es: { locale: 'es-ES', connect: 'Conectar', option: /^Deja que tu agente lo configure/, copy: 'Copiar prompt', share: 'Compartir', paste: 'Pegar el enlace' },
};

const shots = [];
async function shot(page, name, caption) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push({ name, caption });
  console.log('  shot', name);
}

async function newPage(browser, { lang = 'en', mode = 'light', viewport = VIEWPORT, dsf = DSF } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, locale: L[lang].locale, colorScheme: mode, reducedMotion: 'reduce' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL_ });
  await ctx.addInitScript(
    ([l, m]) => {
      try {
        localStorage.setItem('hui.lang', l);
        localStorage.setItem('hermes.prefs.v1', JSON.stringify({ v: 1, prefs: { themeMode: m, themeFamily: 'paper' } }));
      } catch {}
    },
    [lang, mode],
  );
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  pageerror:', String(e).slice(0, 200)));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

async function openSheet(page, lang) {
  await page.getByRole('button', { name: L[lang].connect, exact: true }).last().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: L[lang].option }).last().click();
  await page.waitForTimeout(700);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveStatic(WEB, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    // phone, English, light: connect screen → sheet → copy → share (no Web Share API here: copy fallback) → paste link
    let { ctx, page } = await newPage(browser);
    await page.getByRole('button', { name: L.en.connect, exact: true }).last().click();
    await page.waitForTimeout(800);
    await shot(page, '01-connect-screen', '<b>Connect screen</b> – “Let your agent set it up” next to the QR / link option');
    await page.getByRole('button', { name: L.en.option }).last().click();
    await page.waitForTimeout(800);
    await shot(page, '02-sheet', '<b>Sheet</b> – two lines of explanation, the canonical prompt from docs/SETUP-WITH-AGENT.md, Copy / Share');
    await page.getByRole('button', { name: L.en.copy }).last().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    console.log('  clipboard after copy:', JSON.stringify(clip.slice(0, 60)), `(${clip.length} chars)`);
    await shot(page, '03-copied', '<b>Copy prompt</b> – “Prompt copied” (announced to screen readers)');
    const hasShare = await page.evaluate(() => typeof navigator.share === 'function');
    await page.getByRole('button', { name: L.en.share, exact: true }).last().click();
    await shot(page, '04-share-fallback', `<b>Share</b> – ${hasShare ? 'Web Share API' : 'no Web Share API in this browser → copied instead, with a note'}`);
    await page.getByRole('button', { name: L.en.paste }).last().click();
    await page.waitForTimeout(900);
    await shot(page, '05-paste-link', '<b>“Paste the pairing link”</b> – closes the sheet and opens the scan / paste-link step');
    await ctx.close();

    // dark, German and Spanish
    ({ ctx, page } = await newPage(browser, { mode: 'dark' }));
    await openSheet(page, 'en');
    await shot(page, '06-sheet-dark', '<b>Dark</b>');
    await ctx.close();
    for (const lang of ['de', 'es']) {
      ({ ctx, page } = await newPage(browser, { lang }));
      await openSheet(page, lang);
      await shot(page, `07-sheet-${lang}`, `<b>${lang.toUpperCase()}</b> – UI translated, the prompt stays English`);
      await ctx.close();
    }

    // wide window (web / desktop): centred dialog over the onboarding card
    ({ ctx, page } = await newPage(browser, { viewport: { width: 1280, height: 820 }, dsf: 1.5 }));
    await openSheet(page, 'en');
    await shot(page, '08-wide-dialog', '<b>Wide window</b> – the sheet as a centred dialog (web, desktop, tablets)');
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(shots, null, 2));
  const fig = (s) => `<figure><a href="${s.name}.png"><img src="${s.name}.png" alt=""></a><figcaption>${s.caption}</figcaption></figure>`;
  writeFileSync(
    join(OUT, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Let your agent set it up</title><style>body{font:15px system-ui;margin:32px;background:#F8F6F1;color:#161B26}main{display:flex;flex-wrap:wrap;gap:24px}figure{margin:0;width:300px}img{width:100%;border-radius:18px;box-shadow:0 8px 30px rgba(0,0,0,.15)}figcaption{font-size:13px;margin-top:8px}</style></head><body><h1>Let your agent set it up</h1><main>${shots.map(fig).join('\n')}</main></body></html>\n`,
  );
  console.log(`done: ${shots.length} shots in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

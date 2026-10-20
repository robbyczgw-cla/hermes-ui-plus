#!/usr/bin/env node
// Skills & memory screenshots: drives the built web app (offline demo profile) from "/skills" in the composer through
// the skill list, a search, a skill with its SKILL.md, the memory tab, "Ask to forget" (hand-off into the chat) and the
// Settings entry. Phone (390×844) and desktop (1280×860); language and theme per variant.
//
//   node scripts/ux-check/library-shots.mjs [--out=DIR] [--variant=phone-en-light,…]
//   UX_CHECK_PORT=8119 UX_WEB_DIR=dist/web node scripts/ux-check/library-shots.mjs
//
// Needs a web bundle (FLAVOR=hermes scripts/build-web.sh) and a Chromium via playwright-core (same as run.mjs).
// Network outside the local bundle is aborted: the demo answers locally.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = Number(process.env.UX_CHECK_PORT || 8119);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const argv = process.argv.slice(2);
const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg('out') || join(ROOT, 'dist', 'library-shots');
const only = arg('variant')?.split(',').filter(Boolean) ?? null;

const VARIANTS = [
  { id: 'phone-en-light', lang: 'en', theme: 'light', viewport: { width: 390, height: 844 } },
  { id: 'phone-de-dark', lang: 'de', theme: 'dark', viewport: { width: 390, height: 844 } },
  { id: 'phone-es-light', lang: 'es', theme: 'light', viewport: { width: 390, height: 844 } },
  { id: 'desktop-en-dark', lang: 'en', theme: 'dark', viewport: { width: 1280, height: 860 } },
];

/** visible labels per language (the screen's i18n; demo data is English) */
const L = {
  en: { input: 'Type a message', send: 'Send', memory: 'Memory', search: 'Search skills', forget: 'Ask Hermes to forget this entry', settings: 'Skills & memory', back: 'Back' },
  de: { input: 'Nachricht eingeben', send: 'Senden', memory: 'Gedächtnis', search: 'Skills durchsuchen', forget: 'Hermes bitten, diesen Eintrag zu vergessen', settings: 'Skills & Gedächtnis', back: 'Zurück' },
  es: { input: 'Escribe un mensaje', send: 'Enviar', memory: 'Memoria', search: 'Buscar skills', forget: 'Pedir a Hermes que olvide esta entrada', settings: 'Skills y memoria', back: 'Atrás' },
};

function seedScript(s) {
  try {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  } catch {}
}

async function shoot(browser, v) {
  const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: 2, locale: v.lang, colorScheme: v.theme, serviceWorkers: 'block' });
  await ctx.addInitScript(seedScript, {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: 'preset-demo', kind: 'demo', name: 'Demo (offline)', baseUrl: 'demo://local' }] }),
    'hermes.activeProfile.v1': 'preset-demo',
    'hui.lang': v.lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: v.theme, toolDetails: 'compact' } }),
  });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && Number(u.port) === PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  // web: "Ask to forget" confirms with window.confirm → accept, the text goes to the chat
  page.on('dialog', (d) => void d.accept());
  const l = L[v.lang];
  const r = { id: v.id, shots: [] };
  const snap = async (name) => {
    await page.waitForTimeout(500);
    const file = join(OUT, `${v.id}-${r.shots.length}-${name}.png`);
    await page.screenshot({ path: file });
    r.shots.push(file);
  };
  try {
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 180000 });
    const input = page.getByLabel(l.input);
    await input.waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(800);
    // 1) "/skills" from the composer
    await input.click();
    await input.fill('/skills');
    await page.waitForTimeout(400);
    await input.press('Enter');
    await page.getByTestId('skill-meal-planner').waitFor({ state: 'visible', timeout: 20000 });
    await snap('skills');
    // 2) search
    const search = page.getByLabel(l.search);
    await search.fill('research');
    await snap('search');
    await search.fill('');
    // 3) a skill with its SKILL.md
    await page.getByTestId('skill-meal-planner').click();
    await page.getByTestId('skill-doc').waitFor({ state: 'visible', timeout: 10000 });
    await snap('detail');
    // a skill that is off
    await page.getByTestId('library-back').click();
    await page.getByTestId('skill-release-notes').click();
    await page.waitForTimeout(300);
    await snap('detail-off');
    await page.getByTestId('library-back').click();
    // 4) memory tab
    await page.getByRole('radio', { name: l.memory }).or(page.getByRole('button', { name: l.memory })).or(page.getByText(l.memory, { exact: true })).first().click();
    await page.getByTestId('memory-memory').waitFor({ state: 'visible', timeout: 10000 });
    await snap('memory');
    await page.getByTestId('memory-forget-open').click();
    await page.getByTestId('memory-forget-input').fill('the backup time');
    await snap('memory-forget-form');
    // 5) "Ask to forget" on an entry → back in the chat, the request is sent as a normal message
    await page.getByTestId('memory-forget-user-1').click();
    await page.getByLabel(l.input).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2500);
    // the request arrived in the chat as a normal user message
    r.handoff = (await page.getByText(/delete this entry|lösche diesen Eintrag|borra esta entrada/).count()) > 0;
    if (!r.handoff) throw new Error('forget request not found in the chat');
    await snap('chat-after-forget');
    // 6) the Settings entry
    await page.goto(`${APP_URL}settings`, { waitUntil: 'load', timeout: 60000 });
    await page.getByText(l.settings, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
    await snap('settings');
  } catch (e) {
    r.error = String(e?.message || e).slice(0, 400);
    await page.screenshot({ path: join(OUT, `${v.id}-error.png`) }).catch(() => {});
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
    for (const v of VARIANTS.filter((x) => !only || only.includes(x.id))) {
      const r = await shoot(browser, v);
      results.push(r);
      console.log(`${r.error ? 'FAIL' : 'ok  '} ${v.id} ${r.shots.length} shots${r.error ? ` – ${r.error}` : ''}${r.pageErrors.length ? ` (${r.pageErrors.length} page errors: ${r.pageErrors[0]})` : ''}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), webDir: WEB_DIR, results }, null, 2) + '\n');
  process.exit(results.every((r) => !r.error) ? 0 : 1);
}

await main();

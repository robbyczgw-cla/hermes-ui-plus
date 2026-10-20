#!/usr/bin/env node
// Settings → Chat → "Routinen" (routines/enabled.ts) on the built web app in the offline demo, as a user sees it:
// on (default): "Über Lumi" lists Lumi's routine with the demo note → Settings, the switch off → "Über Lumi" keeps name
// and model but has no routines part → /routines shows the "hidden" explanation → "Routinen einschalten" brings the
// Routines screen back. The demo connection only, no server, all other network aborted.
// JPEG screenshots (quality 75, ≤ 1280 px wide) and a JSON report.
//
//   node scripts/ux-check/routines-toggle-shots.mjs [--out DIR] [--variants de-light-phone,…]
// Needs dist/web (FLAVOR=hermes scripts/build-web.sh, or UX_WEB_DIR) and playwright-core.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = arg('out', join(ROOT, 'dist', 'routines-toggle-shots'));
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.ROUTINES_TOGGLE_APP_PORT || 8125);
const SIZES = { phone: { viewport: { width: 390, height: 844 }, scale: 2 }, tablet: { viewport: { width: 1194, height: 834 }, scale: 1 } };
const VARIANTS = arg('variants', 'de-light-phone,en-dark-phone,es-light-tablet').split(',');

const T = {
  de: { routines: 'Routinen', model: 'Modell', infoDemo: /^Demo: Diese Routinen sind erfunden/ },
  en: { routines: 'Routines', model: 'Model', infoDemo: /^Demo: these routines are invented/ },
  es: { routines: 'Rutinas', model: 'Modelo', infoDemo: /^Demo: estas rutinas son inventadas/ },
};

const report = { at: new Date().toISOString(), variants: {} };

function seed(lang, theme) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'demo' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: 'preset-demo', kind: 'demo', name: 'Demo (offline)', baseUrl: 'demo://local' }] }),
    'hermes.activeProfile.v1': 'preset-demo',
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: theme, toolDetails: 'compact' } }),
  };
}

async function variant(browser, name) {
  const [lang, theme, size] = name.split('-');
  const L = T[lang];
  const S = SIZES[size];
  const wide = S.viewport.width >= 900;
  const r = { checks: {}, shots: [], pageErrors: [] };
  report.variants[name] = r;
  const ctx = await browser.newContext({ viewport: S.viewport, deviceScaleFactor: S.scale, locale: { de: 'de-DE', en: 'en-US', es: 'es-ES' }[lang], colorScheme: theme, serviceWorkers: 'block' });
  await ctx.addInitScript((s) => {
    try {
      if (!localStorage.getItem('__seeded')) {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        localStorage.setItem('__seeded', '1');
      }
    } catch {}
  }, seed(lang, theme));
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && Number(u.port) === APP_PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => r.pageErrors.push(String(e).slice(0, 300)));
  const shot = async (label) => {
    await page.waitForTimeout(400);
    const file = join(OUT, `${name}-${label}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 75 });
    r.shots.push(file.slice(OUT.length + 1));
  };
  const visible = (sel) => sel.first().isVisible().catch(() => false);
  const waitFor = (sel, timeout = 15000) => sel.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
  const home = async () => {
    await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
    await page.getByTestId('composer-input').first().waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(1200);
  };
  const aboutLumi = async () => {
    if (!wide) await page.getByTestId('header-chats').click();
    await page.waitForTimeout(800);
    const tab = page.getByTestId('drawer-tab-bots');
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await page.getByTestId('bot-row-lumi').click();
    await page.waitForTimeout(800);
    await page.getByTestId('header-model').first().click();
    return waitFor(page.getByTestId('bot-info'), 10000);
  };
  try {
    // 1. default ON: "Über Lumi" with its routine and the demo note
    await home();
    r.checks.onAbout = await aboutLumi();
    r.checks.onRoutine = await waitFor(page.getByTestId('bot-info-routine-d0000000003a'), 10000);
    r.checks.onDemoNote = await visible(page.getByText(L.infoDemo));
    await shot('1-on-about');
    await page.keyboard.press('Escape');

    // 2. Settings: the switch in the Chat section, turned off
    await page.goto(`http://127.0.0.1:${APP_PORT}/settings`, { waitUntil: 'load', timeout: 60000 });
    const sw = page.getByRole('switch', { name: L.routines, exact: true });
    r.checks.switchShown = await waitFor(sw, 20000);
    await sw.first().scrollIntoViewIfNeeded();
    r.checks.switchOnByDefault = await sw.first().isChecked();
    await sw.first().click();
    await page.waitForTimeout(500);
    r.checks.switchOff = !(await sw.first().isChecked());
    await shot('2-settings-off');

    // 3. OFF: "Über Lumi" keeps name and model, no routines part
    await home();
    r.checks.offAbout = await aboutLumi();
    r.checks.offModelRow = await visible(page.getByText(L.model, { exact: true }));
    await page.waitForTimeout(1200);
    r.checks.offNoRoutines = !(await visible(page.getByTestId('bot-info-routines'))) && !(await visible(page.getByTestId('bot-info-routines-more'))) && !(await visible(page.getByTestId('bot-info-routine-d0000000003a'))) && !(await visible(page.getByText(L.infoDemo)));
    await shot('3-off-about');
    await page.keyboard.press('Escape');

    // 4. OFF: the Routines route explains, "Turn on Routines" brings the screen back
    await page.goto(`http://127.0.0.1:${APP_PORT}/routines`, { waitUntil: 'load', timeout: 60000 });
    r.checks.hiddenScreen = await waitFor(page.getByTestId('routines-hidden'), 20000);
    await shot('4-off-route');
    await page.getByTestId('routines-enable').click();
    r.checks.screenBack = await page.getByTestId('routines-hidden').first().waitFor({ state: 'hidden', timeout: 10000 }).then(() => true, () => false);
    r.checks.screenContent = await waitFor(page.getByTestId('routines-tab-inbox'), 15000); // the lazy screen has loaded
    await page.waitForTimeout(1500);
    await shot('5-on-again');
  } catch (e) {
    r.error = String(e?.message ?? e).slice(0, 400);
    await shot('fail').catch(() => {});
  } finally {
    await ctx.close();
  }
  const failed = Object.entries(r.checks).filter(([, v]) => v !== true).map(([k]) => k);
  r.ok = !r.error && !failed.length && !r.pageErrors.length;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name}${failed.length ? ` failed: ${failed.join(', ')}` : ''}${r.error ? ` error: ${r.error}` : ''}${r.pageErrors.length ? ` pageErrors: ${r.pageErrors.join(' | ')}` : ''}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const web = await serveStatic(WEB_DIR, APP_PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    for (const v of VARIANTS) await variant(browser, v);
  } finally {
    await browser.close();
    web.close();
  }
  writeFileSync(join(OUT, 'routines-toggle-report.json'), JSON.stringify(report, null, 2));
  const bad = Object.values(report.variants).filter((v) => !v.ok).length;
  console.log(`${VARIANTS.length - bad}/${VARIANTS.length} variants ok, report ${join(OUT, 'routines-toggle-report.json')}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

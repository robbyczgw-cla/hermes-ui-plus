#!/usr/bin/env node
// Live-card receipts (0.3, app/src/live/receipts.ts + ui/LiveSync.tsx): drives the built web app against the E2E mock
// (scripts/e2e/mock.mjs) through every state a user's edit can be in, and saves JPEG screenshots (q75, < 150 KB) plus a
// JSON report of what it saw. German UI, 390×844; the "done differently" state also dark and in English.
//
//   node scripts/ux-check/live-trust-shots.mjs [--out DIR]   # needs dist/web (FLAVOR=hermes scripts/build-web.sh)
//
// Flow: the list → tick Milch (waiting) → a slow answer (sent, "Hermes antwortet …") → stop (not confirmed, goes again)
// → next message (the trailer names the stopped batch in `re`, saved in vN) → "aufräumen": Hermes opens the tick again
// and drops the own item (named, "Meine Änderung wiederherstellen") → restore (waiting again).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(ROOT, 'dist', 'live-trust-shots');
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.LIVE_SHOTS_APP_PORT || 8121);
const MOCK_PORT = Number(process.env.LIVE_SHOTS_MOCK_PORT || 8795);
const HOST = 'hermes.local';
const TOKEN = 'nca_e2e_test_token_static_0000000000';
const VIEWPORT = { width: 390, height: 844 };
const PROFILE_ID = 'p-live-trust';
const L = {
  de: { input: 'Nachricht eingeben', stop: 'Antwort stoppen', card: /^Live-Karte Einkauf Samstag/, close: 'Schließen' },
  en: { input: 'Type a message', stop: 'Stop answer', card: /^Live card Einkauf Samstag/, close: 'Close' },
};

function seed({ mode, lang }) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PROFILE_ID, kind: 'hermes', name: 'Hermes', baseUrl: `http://${HOST}/v1`, bridge: true }] }),
    [`hermes.apikey.${PROFILE_ID}`]: TOKEN,
    'hermes.activeProfile.v1': PROFILE_ID,
    'hui.aiConsent': JSON.stringify({ version: 2, at: Date.now() }),
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: mode, toolDetails: 'compact' } }),
  };
}

const report = { at: new Date().toISOString(), steps: [], checks: {}, pageErrors: [] };
const step = (name, data = {}) => {
  report.steps.push({ name, ...data });
  console.log(`- ${name}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''}`);
};

async function newDevice(browser, opts) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: opts.lang === 'en' ? 'en-US' : 'de-DE', colorScheme: opts.mode, serviceWorkers: 'block' });
  await ctx.addInitScript((s) => {
    try {
      if (!localStorage.getItem('__live_seeded')) {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        localStorage.setItem('__live_seeded', '1');
      }
    } catch {}
  }, seed(opts));
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === HOST || (u.hostname === '127.0.0.1' && Number(u.port) === APP_PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 300)));
  return { ctx, page };
}

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 75 });
  step(`shot ${name}`);
};
const visible = (page, re) => page.getByText(re).first().isVisible().catch(() => false);

async function type(page, l, text) {
  const input = page.getByLabel(l.input);
  await input.click();
  await input.fill(text);
  await page.getByTestId('composer-send').click();
}
async function send(page, l, text) {
  await type(page, l, text);
  const stop = page.getByLabel(l.stop);
  if (await stop.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) await stop.waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForTimeout(1500);
}
async function openCard(page, l) {
  await page.getByRole('button', { name: l.card }).first().click();
  await page.waitForTimeout(900);
}
async function closeCard(page, l) {
  await page.getByRole('button', { name: l.close, exact: true }).last().click().catch(() => {});
  await page.waitForTimeout(500);
}

/** One chat through the states; `prefix` names the shots. A failure keeps a shot of the screen it happened on. */
async function journey(browser, ctl, opts) {
  const { ctx, page } = await newDevice(browser, opts);
  try {
    await steps(page, ctl, opts);
  } catch (e) {
    await shot(page, `${opts.prefix}-error`).catch(() => {});
    report.checks[`${opts.prefix}.error`] = String(e).split('\n')[0].slice(0, 200);
  } finally {
    await ctx.close();
  }
}

async function steps(page, ctl, { lang, prefix, full }) {
  const l = L[lang];
  await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
  await page.getByLabel(l.input).waitFor({ state: 'visible', timeout: 180000 });
  await page.waitForTimeout(1200);
  // the "New in this version" sheet of a seeded (already onboarded) profile
  const gotIt = page.getByRole('button', { name: /^(Verstanden|Got it)$/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await page.waitForTimeout(600);
  }
  const c = (k, v) => (report.checks[`${prefix}.${k}`] = v);

  await send(page, l, lang === 'en' ? 'Make me an Einkaufsliste für Samstag please.' : 'Mach mir eine Einkaufsliste für Samstag.');
  await page.getByRole('checkbox', { name: /Milch/ }).first().click();
  await page.waitForTimeout(600);
  if (full) {
    c('waiting', await visible(page, /1 Änderung wartet/));
    await shot(page, `${prefix}-01-waiting`);
  }

  // a slow answer: the tick rode along, Hermes is answering
  await type(page, l, lang === 'en' ? 'Go through it slowly please' : 'Geh die Liste bitte langsam durch');
  await page.getByLabel(l.stop).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2500);
  if (full) {
    c('sendingLine', await visible(page, /Hermes antwortet …/));
    await shot(page, `${prefix}-02-sending`);
  }
  // stop: the answer broke off, the tick goes again with the next message
  await page.getByLabel(l.stop).click();
  await page.waitForTimeout(1500);
  c('resendLine', await visible(page, lang === 'en' ? /Not confirmed, the answer broke off/ : /Nicht bestätigt, die Antwort brach ab/));
  await shot(page, `${prefix}-03-stopped`);
  if (full) {
    await openCard(page, l);
    c('resendFooter', await visible(page, /nicht bestätigt/));
    await shot(page, `${prefix}-04-stopped-card`);
    await closeCard(page, l);
  }

  // the next message carries it again, naming the stopped batch
  await send(page, l, lang === 'en' ? 'Thanks' : 'Danke');
  const turns = await ctl('/__e2e/turns');
  const last = turns.at(-1)?.text ?? '';
  const prev = turns.at(-2)?.text ?? '';
  const stoppedBid = /"bid":"(b-[a-z0-9]+)"/.exec(prev)?.[1];
  c('trailerRe', !!stoppedBid && last.includes(`"re":["${stoppedBid}"]`) && /"check":"milch"/.test(last));
  c('savedLine', await visible(page, lang === 'en' ? /Saved in v\d/ : /Gespeichert in v\d/));
  c('resentLine', await visible(page, lang === 'en' ? /Sent again with a later message/ : /Mit einer späteren Nachricht noch einmal mitgeschickt/));
  if (full) await shot(page, `${prefix}-05-resent-saved`);

  // an own item, then Hermes tidies up: the tick open again, the own item gone, named, with the restore action
  await openCard(page, l);
  const add = page.getByPlaceholder(/z\. B\.|e\.g\./).last();
  await add.click();
  await add.fill('Brot vom Bäcker');
  await add.press('Enter');
  await page.waitForTimeout(500);
  await closeCard(page, l);
  await page.getByRole('checkbox', { name: /Eier/ }).first().click();
  await page.waitForTimeout(400);
  await send(page, l, lang === 'en' ? 'Please tidy up the list' : 'Kannst du die Liste aufräumen?');
  c('undoneLine', await visible(page, lang === 'en' ? /Hermes then did it differently/ : /Hermes hat danach anders entschieden/));
  c('undoneNames', await visible(page, /Brot vom Bäcker/));
  await shot(page, `${prefix}-06-undone`);
  await openCard(page, l);
  c('restoreButton', await visible(page, lang === 'en' ? /^Restore my change$/ : /^Meine Änderung wiederherstellen$/));
  await shot(page, `${prefix}-07-undone-card`);
  if (full) {
    await page.getByRole('button', { name: lang === 'en' ? /^Restore your change/ : /^Deine Änderung wiederherstellen/ }).last().click().catch(() => {});
    await page.waitForTimeout(700);
    c('restoredPending', await visible(page, /noch nicht bei Hermes/));
    await shot(page, `${prefix}-08-restored`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const mock = createServer();
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  const web = await serveStatic(WEB_DIR, APP_PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${MOCK_PORT}`, '--force-color-profile=srgb', '--hide-scrollbars'] });
  const ctl = (path, body) => fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
  try {
    await journey(browser, ctl, { lang: 'de', mode: 'light', prefix: 'de-light', full: true });
    await journey(browser, ctl, { lang: 'de', mode: 'dark', prefix: 'de-dark', full: false });
    await journey(browser, ctl, { lang: 'en', mode: 'light', prefix: 'en-light', full: false });
  } finally {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    web.close?.();
    mock.close();
  }
  console.log(JSON.stringify(report.checks, null, 2));
  if (report.pageErrors.length) console.log('page errors:', report.pageErrors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

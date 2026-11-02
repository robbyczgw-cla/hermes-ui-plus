#!/usr/bin/env node
// Bots v2 slices 4 + 5 on the built web app, as a normal user sees it, against the E2E mock (scripts/e2e/mock.mjs with
// `about: true`: allow-list, archive, the three fields, every bot's library, activity). Per variant (language × theme ×
// phone/tablet) a fresh mock and a fresh browser profile:
//   "Über Hermes" with nothing stored: every part says something (no memory yet, nothing always allowed);
//   "Über Research": how it works (edit + save), remembers (3 entries), can (2 skills, 1 off), always allowed (2) with
//   an inline revoke, notification level (kept after reopening), archive;
//   a running turn: "Research arbeitet" card with its steps, the current step as the roster line, Stop;
//   a turn of another device (bridge activity): the same card with the remote note, Stop through the bridge;
//   archive → the bot leaves the list → "Archiviert" → bring back;
//   a routine run that skipped a step: the stopped-run card below its delivery, "catch up" sends a turn; with Routines
//   off on the device the card never appears.
// JPEG screenshots (quality 75, at most 1280 px wide) and a JSON report of every check. All other network is aborted.
//
//   node scripts/ux-check/bots-about-shots.mjs [--out DIR] [--variants de-light-phone,en-dark-phone,es-light-tablet]
// Needs dist/web (FLAVOR=hermes scripts/build-web.sh) and playwright-core (same as bots-shots.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = arg('out', join(ROOT, 'dist', 'bots-about-shots'));
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.BOTS_SHOTS_APP_PORT || 8122);
const MOCK_PORT = Number(process.env.BOTS_SHOTS_MOCK_PORT || 8796);
const HOST = 'hermes.local';
const TOKEN = 'nca_e2e_test_token_static_0000000000';
const PROFILE_ID = 'p-bots-about';
const SIZES = { phone: { viewport: { width: 390, height: 844 }, scale: 2 }, tablet: { viewport: { width: 1194, height: 834 }, scale: 1 } };
const VARIANTS = arg('variants', 'de-light-phone,en-dark-phone,es-light-tablet').split(',');

const T = {
  de: { input: 'Nachricht eingeben', chatMenu: 'Chat-Optionen', aboutHermes: 'Über Hermes', memEmpty: /Noch nichts/, allowEmpty: /Nichts\. Wählst du/, mem3: /3 Einträge/, skills2: /2 Skills/, remote: /anderen Gerät/, step: 'Reading the shop page', archived: /Archiviert/ },
  en: { input: 'Type a message', chatMenu: 'Chat options', aboutHermes: 'About Hermes', memEmpty: /Nothing yet/, allowEmpty: /Nothing\. When you choose/, mem3: /3 entries/, skills2: /2 skills/, remote: /another device/, step: 'Reading the shop page', archived: /Archived/ },
  es: { input: 'Escribe un mensaje', chatMenu: 'Opciones del chat', aboutHermes: 'Sobre Hermes', memEmpty: /Nada todavía/, allowEmpty: /Nada\. Si eliges/, mem3: /3 entradas/, skills2: /2 skills/, remote: /otro dispositivo/, step: 'Reading the shop page', archived: /Archivados/ },
};

const report = { at: new Date().toISOString(), variants: {} };

function seed(lang, theme, routines = true) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    // an existing user who has seen this version's "What's new" sheet (whatsnew/storage.ts); otherwise it covers the app
    'hui.whatsNew.seen.v1': '99.0.0',
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PROFILE_ID, kind: 'hermes', name: 'Hermes', baseUrl: `http://${HOST}/v1`, bridge: true }] }),
    [`hermes.apikey.${PROFILE_ID}`]: TOKEN,
    'hermes.activeProfile.v1': PROFILE_ID,
    'hui.aiConsent': JSON.stringify({ version: 2, at: Date.now() }),
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: theme, toolDetails: 'compact', routines } }),
  };
}

async function variant(browser, name) {
  const [lang, theme, size] = name.split('-');
  const L = T[lang];
  const S = SIZES[size];
  const wide = S.viewport.width >= 900;
  const r = { checks: {}, shots: [], pageErrors: [] };
  report.variants[name] = r;
  const shot = async (page, label) => {
    const file = join(OUT, `${name}-${label}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 75 });
    r.shots.push(file.slice(OUT.length + 1));
  };
  const mock = createServer();
  await new Promise((res) => mock.listen(MOCK_PORT, '127.0.0.1', res));
  const ctl = (path, body) => fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  const open = async (o = {}) => {
    const ctx = await browser.newContext({ viewport: S.viewport, deviceScaleFactor: S.scale, locale: { de: 'de-DE', en: 'en-US', es: 'es-ES' }[lang], colorScheme: theme, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => {
      try {
        if (!localStorage.getItem('__seeded')) {
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
          localStorage.setItem('__seeded', '1');
        }
      } catch {}
    }, seed(lang, theme, o.routines !== false));
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === HOST || (u.hostname === '127.0.0.1' && Number(u.port) === APP_PORT)) return route.continue();
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.pageErrors.push(String(e).slice(0, 300)));
    await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(1500);
    return { ctx, page };
  };
  const drawer = async (page) => {
    if (!wide) await page.getByTestId('header-chats').click();
    await page.waitForTimeout(900);
  };
  const closeDrawer = async (page) => {
    if (!wide) await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  };
  const botsTab = async (page) => {
    await drawer(page);
    const tab = page.getByTestId('drawer-tab-bots');
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await page.waitForTimeout(600);
  };
  const openBot = async (page, key) => {
    await botsTab(page);
    await page.getByTestId(`bot-row-${key}`).click();
    await page.waitForTimeout(1500);
  };
  const about = async (page) => {
    await page.getByTestId('header-model').click();
    await page.getByTestId('bot-info').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200); // library, allow-list and fields load
  };
  const closeSheet = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  };
  const send = async (page, text) => {
    const input = page.getByLabel(L.input);
    await input.click();
    await input.fill(text);
    await page.getByTestId('composer-send').click();
    await page.waitForTimeout(500);
  };
  const seen = (loc, timeout = 8000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
  const textOf = (loc) => loc.first().innerText().catch(() => '');
  try {
    await ctl('/__e2e/config', { profiles: true, about: true });
    const { ctx, page } = await open();

    // 1. "Über Hermes" with nothing stored yet: visible text in every part, never an empty gap
    await openBot(page, 'default');
    await about(page);
    r.checks.defaultMemoryEmpty = L.memEmpty.test(await textOf(page.getByTestId('bot-info-memory')));
    r.checks.defaultAllowEmpty = await seen(page.getByText(L.allowEmpty));
    r.checks.defaultNoArchive = !(await page.getByTestId('bot-info-archive').isVisible().catch(() => false));
    await shot(page, '1-about-hermes');
    await closeSheet(page);

    // 2. "Über Research": fields, memory, skills, always allowed
    await openBot(page, 'research');
    await about(page);
    r.checks.howShown = /Find sources and sum them up/.test(await textOf(page.getByTestId('bot-info-how')));
    r.checks.memory3 = L.mem3.test(await textOf(page.getByTestId('bot-info-memory')));
    r.checks.skills2 = L.skills2.test(await textOf(page.getByTestId('bot-info-skills')));
    r.checks.allowed2 = (await page.locator('[data-testid^="bot-info-allowed-"]').filter({ hasNot: page.getByTestId('bot-info-allowed-note') }).count()) >= 2;
    await shot(page, '2-about-research');
    // revoke the first entry (inline confirm)
    await page.getByTestId('bot-info-revoke-0').click();
    await page.getByTestId('bot-info-revoke-confirm-0').click();
    r.checks.revokedNote = await seen(page.getByTestId('bot-info-allowed-note'));
    r.checks.revokedOnServer = (await ctl('/__e2e/requests')).some((q) => q.path === '/bridge/bots/research/allowlist/revoke' && q.status === 200);
    await page.getByTestId('bot-info-notify').scrollIntoViewIfNeeded();
    await shot(page, '3-revoked');
    // notification level
    await page.getByTestId('bot-info-notify-needed').click();
    await page.waitForTimeout(300);
    r.checks.levelChecked = (await page.getByTestId('bot-info-notify-needed').getAttribute('aria-checked')) === 'true';
    // edit how it works
    await page.getByTestId('bot-info-how').scrollIntoViewIfNeeded();
    await page.getByTestId('bot-info-how-edit').click();
    await page.getByTestId('bot-info-how-job').fill(`Watch prices ${name}`);
    await shot(page, '4-edit');
    await page.getByTestId('bot-info-how-save').click();
    r.checks.saved = await seen(page.getByTestId('bot-info-how-saved'));
    r.checks.savedOnServer = (await ctl('/__e2e/requests')).some((q) => q.method === 'PATCH' && q.path === '/bridge/bots/research' && q.status === 200);
    await closeSheet(page);
    await about(page);
    r.checks.levelKept = (await page.getByTestId('bot-info-notify-needed').getAttribute('aria-checked')) === 'true';
    await closeSheet(page);

    // 3. a running turn: the working card with steps, the step as the roster line, Stop
    await send(page, `e2e working ${name}`);
    r.checks.workingCard = await seen(page.getByTestId('bot-working'), 15000);
    r.checks.workingStep = await seen(page.getByTestId('bot-working').getByText(new RegExp(L.step)), 10000);
    await shot(page, '5-working');
    await botsTab(page);
    await page.waitForTimeout(6000); // one activity poll
    r.checks.rosterStep = new RegExp(L.step).test(await textOf(page.getByTestId('bot-row-research')));
    await shot(page, '6-roster-working');
    await closeDrawer(page);
    await page.getByTestId('bot-working-stop').click();
    r.checks.stoppedLocal = await page.getByTestId('bot-working').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false);

    // 4. a turn of another device (bridge activity)
    await ctl('/__e2e/remote-turn', { profile: 'research' });
    r.checks.remoteCard = await seen(page.getByText(L.remote), 15000);
    await shot(page, '7-remote');
    await page.getByTestId('bot-working-stop').click();
    r.checks.remoteStopped = await seen(page.getByTestId('bot-working-note'), 8000);
    r.checks.remoteGone = await page.getByTestId('bot-working').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false);

    // 5. archive → archived list → bring back
    await about(page);
    await page.getByTestId('bot-info-archive').scrollIntoViewIfNeeded();
    await page.getByTestId('bot-info-archive').click();
    await shot(page, '8-archive-confirm');
    await page.getByTestId('bot-info-archive-confirm').click();
    await page.waitForTimeout(2000);
    await botsTab(page);
    await page.waitForTimeout(1500);
    r.checks.archivedGone = !(await page.getByTestId('bot-row-research').isVisible().catch(() => false));
    r.checks.archivedListed = await seen(page.getByTestId('bots-archived'));
    if (r.checks.archivedListed) {
      await page.getByTestId('bots-archived').click();
      await shot(page, '9-archived');
      await page.getByTestId('bots-restore-research').click();
      r.checks.restored = await seen(page.getByTestId('bot-row-research'), 15000);
    }
    await closeDrawer(page);

    // 6. a routine run that skipped a step: the card below its delivery in Hermes' Bot Chat
    await ctl('/__e2e/config', { routines: true, routinesBlocked: true });
    await ctl('/__e2e/fire-reminder', { name: 'E2E morning briefing', text: `Three things for today (${name}).` });
    await page.reload({ waitUntil: 'load' });
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForTimeout(2500);
    await openBot(page, 'default');
    await page.waitForTimeout(2500);
    r.checks.stoppedCard = await seen(page.getByTestId('bot-stopped-run'), 15000);
    await shot(page, '10-stopped-run');
    if (r.checks.stoppedCard) {
      await page.getByTestId('bot-stopped-retry').click();
      await page.waitForTimeout(1500);
      r.checks.retrySent = (await ctl('/__e2e/turns')).some((t) => /E2E morning briefing/.test(t.text) && /rm -rf ~\/Downloads\/old-offers/.test(t.text));
    }
    await ctx.close();

    // 7. Routines off on this device: no stopped-run card (and nothing else of routines)
    {
      const { ctx: c2, page: p2 } = await open({ routines: false });
      await openBot(p2, 'default');
      await p2.waitForTimeout(3000);
      r.checks.routinesOffNoCard = !(await p2.getByTestId('bot-stopped-run').isVisible().catch(() => false));
      await shot(p2, '11-routines-off');
      await c2.close();
    }
  } catch (e) {
    r.error = String(e?.message ?? e).slice(0, 400);
    if (process.env.SHOTS_DEBUG) console.error(e);
  } finally {
    await ctl('/__e2e/config', { profiles: false, about: false, routines: false, routinesBlocked: false }).catch(() => {});
    await new Promise((res) => mock.close(res));
    mock.closeAllConnections?.();
  }
  const failed = Object.entries(r.checks).filter(([, v]) => v !== true).map(([k]) => k);
  r.ok = !r.error && !failed.length && !r.pageErrors.length;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name}${failed.length ? ` failed: ${failed.join(', ')}` : ''}${r.error ? ` error: ${r.error}` : ''}${r.pageErrors.length ? ` pageErrors: ${r.pageErrors.length}` : ''}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const web = await serveStatic(WEB_DIR, APP_PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${MOCK_PORT}`, '--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    for (const v of VARIANTS) await variant(browser, v);
  } finally {
    await browser.close();
    web.close();
  }
  writeFileSync(join(OUT, 'bots-about-report.json'), JSON.stringify(report, null, 2));
  const bad = Object.values(report.variants).filter((v) => !v.ok).length;
  console.log(`${VARIANTS.length - bad}/${VARIANTS.length} variants ok, report ${join(OUT, 'bots-about-report.json')}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

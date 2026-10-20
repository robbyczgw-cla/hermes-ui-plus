#!/usr/bin/env node
// Bots as contacts (app/src/bots, docs/BOTS-SERVER.md) on the built web app, as a normal user sees it, against the E2E
// mock (scripts/e2e/mock.mjs, a bridge + Hermes with an optional second bot "Research"). Per variant (language × theme ×
// phone/tablet) a fresh mock and a fresh browser profile:
//   default bridge (no extra profile): the drawer is exactly the chat list, no "Chats | Bots" switch;
//   two bots: Bots tab → Research → its Bot Chat (start screen) → a message → an approval naming the bot (no
//   "for this task") → "Wartet auf dich" in the drawer → "Einmal erlauben" → the answer; the Bot Chat not under Chats.
// JPEG screenshots (quality 75, at most 1280 px wide) and a JSON report of every check. All other network is aborted.
//
//   node scripts/ux-check/bots-shots.mjs [--out DIR] [--variants de-light-phone,en-dark-tablet,…]
// Needs dist/web (FLAVOR=hermes scripts/build-web.sh) and playwright-core (same as share-shots.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = arg('out', join(ROOT, 'dist', 'bots-shots'));
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.BOTS_SHOTS_APP_PORT || 8121);
const MOCK_PORT = Number(process.env.BOTS_SHOTS_MOCK_PORT || 8795);
const HOST = 'hermes.local';
const TOKEN = 'nca_e2e_test_token_static_0000000000';
const PROFILE_ID = 'p-bots-shots';
const SIZES = { phone: { viewport: { width: 390, height: 844 }, scale: 2 }, tablet: { viewport: { width: 1194, height: 834 }, scale: 1 } };
const VARIANTS = arg('variants', 'de-light-phone,en-dark-phone,de-dark-tablet,en-light-tablet').split(',');

const T = {
  de: { chatMenu: 'Chat-Optionen', aboutHermes: 'Über Hermes', hermesRow: /^Hermes, (App|Hermes)$/, about: 'Über Research', input: 'Nachricht eingeben', stop: 'Antwort stoppen', chats: 'Chats', request: 'Research möchte etwas ausführen', once: 'Diesen Befehl einmal erlauben', session: 'Für diesen Auftrag', waiting: 'Wartet auf dich', since: /Research wartet auf dich, seit/ },
  en: { chatMenu: 'Chat options', aboutHermes: 'About Hermes', hermesRow: /^Hermes, (App|Hermes)$/, about: 'About Research', input: 'Type a message', stop: 'Stop answer', chats: 'Chats', request: 'Research wants to run something', once: 'Allow this command once', session: 'For this task', waiting: 'Waiting for you', since: /Research has been waiting for you since/ },
};

const report = { at: new Date().toISOString(), variants: {} };

function seed(lang, theme) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PROFILE_ID, kind: 'hermes', name: 'Hermes', baseUrl: `http://${HOST}/v1`, bridge: true }] }),
    [`hermes.apikey.${PROFILE_ID}`]: TOKEN,
    'hermes.activeProfile.v1': PROFILE_ID,
    'hui.aiConsent': JSON.stringify({ version: 2, at: Date.now() }),
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
  const shot = async (page, label) => {
    const file = join(OUT, `${name}-${label}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 75 });
    r.shots.push(file.slice(OUT.length + 1));
  };
  const mock = createServer();
  await new Promise((res) => mock.listen(MOCK_PORT, '127.0.0.1', res));
  const ctl = (path, body) => fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  const open = async (profiles) => {
    await ctl('/__e2e/config', { profiles });
    const ctx = await browser.newContext({ viewport: S.viewport, deviceScaleFactor: S.scale, locale: lang === 'de' ? 'de-DE' : 'en-US', colorScheme: theme, serviceWorkers: 'block' });
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
  const send = async (page, text) => {
    const input = page.getByLabel(L.input);
    await input.click();
    await input.fill(text);
    await page.getByTestId('composer-send').click();
    await page.waitForTimeout(800);
  };
  const visible = (page, sel) => sel.first().isVisible().catch(() => false);
  try {
    // 1. the default bridge: no Bots tab anywhere
    {
      const { ctx, page } = await open(false);
      await drawer(page);
      await page.waitForTimeout(1500); // /bridge/profiles has answered by now
      r.checks.defaultNoSwitch = !(await visible(page, page.getByTestId('drawer-tab-bots')));
      await shot(page, '1-default-drawer');
      // slice 2: a reminder fires into the default bot's Bot Chat (deliver: bot-chat); the drawer shows it as "Hermes"
      await ctl('/__e2e/fire-reminder', { name: 'Buy tea', text: `Time to buy tea (${name}).` });
      // the user comes back later: the app looks the thread up after its session sync (bots/refresh.ts); the mock has
      // no live inbox stream, which would announce it while the app is open
      await page.reload({ waitUntil: 'load' });
      await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 120000 });
      await page.waitForTimeout(2500);
      await drawer(page);
      const hermesRow = page.getByRole('button', { name: L.hermesRow });
      r.checks.reminderRow = await hermesRow.first().isVisible({ timeout: 10000 }).catch(() => false);
      await shot(page, '1b-reminder-row');
      if (r.checks.reminderRow) {
        await hermesRow.first().click();
        // the marker is one accessible element (its label carries the reminder text), as on Android
        const reminder = `Time to buy tea (${name}).`;
        const esc = reminder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await page.waitForTimeout(2000);
        r.checks.reminderText =
          (await page.getByText(reminder).last().isVisible().catch(() => false)) || (await page.getByLabel(new RegExp(esc)).last().isVisible().catch(() => false));
        r.checks.noCronHeader = !(await visible(page, page.getByText(/^\[Cronjob/)));
        await shot(page, '1c-reminder-thread');
      }
      // routines on a default bridge (off for every bot): no drawer row, the chat menu → "Über Hermes" → the Routines
      // screen with the owner's step and the chat route
      await ctl('/__e2e/config', { routines: 'off' });
      await page.getByLabel(L.chatMenu).first().click();
      await page.getByText(L.aboutHermes).first().click();
      const more = page.getByTestId('bot-info-routines-more');
      r.checks.routinesReachable = await more.isVisible({ timeout: 15000 }).catch(() => false);
      await shot(page, '1d-about-hermes');
      if (r.checks.routinesReachable) {
        await more.click();
        r.checks.routinesOffExplained = await page.getByTestId('routines-off').isVisible({ timeout: 15000 }).catch(() => false);
        await shot(page, '1e-routines-off');
      }
      await ctl('/__e2e/config', { routines: false });
      await ctx.close();
    }
    // 2. two bots
    const { ctx, page } = await open(true);
    await drawer(page);
    const tab = page.getByTestId('drawer-tab-bots');
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await page.getByTestId('bot-row-research').waitFor({ state: 'visible', timeout: 10000 });
    r.checks.rosterDefaultFirst = await visible(page, page.getByTestId('bot-row-default'));
    await shot(page, '2-roster');
    await page.getByTestId('bot-row-research').click();
    await page.getByText(/Research/).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1200);
    const sessions = await ctl('/__e2e/sessions');
    r.checks.botChatCreatedOnce = sessions.filter((s) => s.title === 'Bot Chat' && s.profile === 'research').length === 1;
    r.checks.noNewChatButton = !(await visible(page, page.getByTestId('header-new-chat')));
    await shot(page, '3-botchat-start');
    // slice 2: the name opens "Über <Name>" (model, routines)
    await page.getByTestId('header-model').click();
    r.checks.aboutSheet = await page.getByText(L.about).first().isVisible({ timeout: 8000 }).catch(() => false) || (await visible(page, page.getByTestId('bot-info')));
    await shot(page, '3b-about');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    // the mock's state is process-wide: texts are unique per variant
    const hello = `e2e bots hello ${name}`;
    const ask = `e2e approval for ${name}`;
    await send(page, hello);
    await page.getByText(new RegExp(`${name}.*apple, mango and strawberry`)).first().waitFor({ state: 'visible', timeout: 30000 });
    const t1 = (await ctl('/__e2e/turns')).findLast((x) => x.text === hello);
    r.checks.turnOnBotChat = !!t1 && t1.profile === 'research' && sessions.some((s) => s.id === t1.sid && s.title === 'Bot Chat' && s.profile === 'research');
    await send(page, ask);
    await page.getByText(L.request).first().waitFor({ state: 'visible', timeout: 20000 });
    r.checks.approvalNamesBot = true;
    r.checks.noSessionChoice = !(await visible(page, page.getByText(L.session)));
    r.checks.waitingSince = await visible(page, page.getByText(L.since));
    await shot(page, '4-approval');
    await drawer(page);
    const waiting = page.getByTestId('bots-waiting');
    r.checks.waitingRow = await waiting.isVisible({ timeout: 8000 }).catch(() => false);
    await shot(page, '5-drawer-waiting');
    if (r.checks.waitingRow) await waiting.click();
    else await closeDrawer(page);
    await page.waitForTimeout(800);
    await page.getByLabel(L.once).first().click();
    await page.getByText(/folder check is done/).last().waitFor({ state: 'visible', timeout: 30000 });
    const t2 = (await ctl('/__e2e/turns')).findLast((x) => x.text === ask);
    r.checks.answeredOnce = t2?.approval?.choice === 'once';
    await shot(page, '6-answered');
    // the Bot Chat is not a chat of the Chats tab
    await drawer(page);
    await page.getByTestId('drawer-tab-chats').click();
    await page.waitForTimeout(700);
    // drawer rows are labelled "<title>, <source>"; the chat itself (behind the drawer / next to the sidebar) has the text too
    r.checks.notUnderChats = !(await visible(page, page.getByRole('button', { name: new RegExp(`^(Bot Chat|${hello}), `) })));
    await shot(page, '7-chats-tab');
    await ctx.close();
  } catch (e) {
    r.error = String(e?.message ?? e).slice(0, 400);
  } finally {
    await new Promise((res) => mock.close(res));
    mock.closeAllConnections?.();
  }
  const failed = Object.entries(r.checks).filter(([, v]) => v !== true).map(([k]) => k);
  r.ok = !r.error && !failed.length && !r.pageErrors.length;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name}${failed.length ? ` failed: ${failed.join(', ')}` : ''}${r.error ? ` error: ${r.error}` : ''}`);
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
  writeFileSync(join(OUT, 'bots-report.json'), JSON.stringify(report, null, 2));
  const bad = Object.values(report.variants).filter((v) => !v.ok).length;
  console.log(`${VARIANTS.length - bad}/${VARIANTS.length} variants ok, report ${join(OUT, 'bots-report.json')}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

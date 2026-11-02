#!/usr/bin/env node
// Bot groups (app/src/groups, docs/BOT-GROUPS.md) on the built web app, as a normal user sees it, against the E2E mock
// (scripts/e2e/mock.mjs), whose /bridge/groups is the real bridge driver. Per variant (language × theme × phone/tablet)
// a fresh browser profile:
//   groups off (the default): the Bots tab has no "Gruppe" button and no groups section;
//   groups on: "Gruppe" → pick Hermes + Research, cost line → the empty room → @-autocomplete → Research answers →
//   a plan: Hermes proposes, the grey hand-over line, Research answers → an approval only as a line with "Öffnen", the
//   card in Research's own chat ("Aus der Gruppe …") → "Einmal erlauben" → the group row in the Bots tab.
// JPEG screenshots (quality 75, at most 1280 px wide) and a JSON report of every check. All other network is aborted.
//
//   node scripts/ux-check/groups-shots.mjs [--out DIR] [--variants de-light-phone,en-dark-tablet,…]
// Needs dist/web (FLAVOR=hermes scripts/build-web.sh; UX_WEB_DIR overrides) and playwright-core.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = arg('out', join(ROOT, 'dist', 'groups-shots'));
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.GROUPS_SHOTS_APP_PORT || 8122);
const MOCK_PORT = Number(process.env.GROUPS_SHOTS_MOCK_PORT || 8796);
const HOST = 'hermes.local';
const TOKEN = 'nca_e2e_test_token_static_0000000000';
const PROFILE_ID = 'p-groups-shots';
const SIZES = { phone: { viewport: { width: 390, height: 844 }, scale: 2 }, tablet: { viewport: { width: 1194, height: 834 }, scale: 1 } };
const VARIANTS = arg('variants', 'de-light-phone,en-dark-phone,es-light-phone,de-dark-tablet,en-light-tablet').split(',');

const T = {
  de: { input: 'Nachricht eingeben', name: 'Hermes und Research', plan: 'Plant ein Wochenende', handoff: /^Hermes an Research: such bitte/, waiting: 'Research wartet auf eine Freigabe in seinem Chat', request: 'Research möchte etwas ausführen', from: /Aus der Gruppe „Hermes und Research“/, once: 'Diesen Befehl einmal erlauben', hintLeader: /^Hermes antwortet\. Mit @ holst du andere dazu\./, hintNamed: /^Es antworten: Research/, cost: /1 Bot antwortet = 1 Modellaufruf/, round: /von 8 Beiträgen in dieser Runde/ },
  en: { input: 'Type a message', name: 'Hermes and Research', plan: 'Plan a weekend', handoff: /^Hermes to Research: such bitte/, waiting: 'Research is waiting for an approval in its chat', request: 'Research wants to run something', from: /From the group "Hermes and Research"/, once: 'Allow this command once', hintLeader: /^Hermes answers\. Use @ to bring others in\./, hintNamed: /^Answering: Research/, cost: /1 bot answers = 1 model call/, round: /of 8 contributions in this round/ },
  es: { input: 'Escribe un mensaje', name: 'Hermes y Research', plan: 'Planifica un fin de semana', handoff: /^Hermes a Research: such bitte/, waiting: 'Research espera una aprobación en su chat', request: null, from: /Del grupo «Hermes y Research»/, once: null, hintLeader: /^Responde Hermes\. Con @ sumas a otros\./, hintNamed: /^Responden: Research/, cost: /1 bot responde = 1 llamada al modelo/, round: /de 8 aportaciones en esta ronda/ },
};

// "What's new" was seen for this version (a normal returning user; the sheet would cover the drawer)
const APP_VERSION = JSON.parse(readFileSync(join(ROOT, 'app', 'package.json'), 'utf8')).version;
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
    'hui.whatsNew.seen.v1': APP_VERSION,
  };
}

async function variant(browser, mockCtl, name) {
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
  const visible = (page, sel, timeout = 0) => (timeout ? sel.first().isVisible({ timeout }) : sel.first().isVisible()).catch(() => false);
  const waitFor = (sel, timeout) => sel.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
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
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === HOST || (u.hostname === '127.0.0.1' && Number(u.port) === APP_PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => r.pageErrors.push(String(e).slice(0, 300)));
  const start = async () => {
    await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
    await page.getByLabel(L.input).first().waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(1500);
  };
  const botsTab = async () => {
    if (!wide) await page.getByTestId('header-chats').click();
    await page.waitForTimeout(900);
    const tab = page.getByTestId('drawer-tab-bots');
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await page.getByTestId('bot-row-research').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500); // GET /bridge/groups has answered by now
  };
  const groupSend = async (text) => {
    const input = page.getByTestId('group-input');
    await input.click();
    await input.fill(text);
    await page.getByTestId('group-send').click();
  };
  try {
    // 1. the default bridge: groups off, the Bots tab as before
    await mockCtl('/__e2e/config', { profiles: true, groups: false });
    await start();
    await botsTab();
    r.checks.offNoButton = !(await visible(page, page.getByTestId('groups-new')));
    r.checks.offNoSection = !(await visible(page, page.getByTestId('groups-section')));
    await shot(page, '1-off-bots-tab');

    // 2. groups on: the button, "Neue Gruppe"
    await mockCtl('/__e2e/config', { groups: true });
    await start();
    await botsTab();
    r.checks.button = await visible(page, page.getByTestId('groups-new'), 8000);
    await shot(page, '2-bots-tab');
    await page.getByTestId('groups-new').click();
    await page.getByTestId('group-create-bot-default').click();
    await page.getByTestId('group-create-bot-research').click();
    r.checks.proposedName = (await page.getByTestId('group-create-name').inputValue().catch(() => '')) === L.name;
    r.checks.costLine = await visible(page, page.getByTestId('group-create-cost'));
    await shot(page, '3-create');
    await page.getByTestId('group-create-submit').click();

    // 3. the empty room, the composer hint, @-autocomplete
    r.checks.emptyRoom = await waitFor(page.getByTestId('group-empty'), 15000);
    r.checks.hintLeader = await visible(page, page.getByText(L.hintLeader));
    r.checks.costHint = await visible(page, page.getByText(L.cost));
    await shot(page, '4-empty');
    const input = page.getByTestId('group-input');
    await input.click();
    await page.keyboard.type('@res');
    r.checks.mentionOffered = await waitFor(page.getByTestId('group-mention-research'), 6000);
    await shot(page, '5-mention');
    if (r.checks.mentionOffered) await page.getByTestId('group-mention-research').click();
    else await input.fill('@research ');
    await page.waitForTimeout(300); // the field takes the focus back (next animation frame)
    r.checks.mentionCompleted = (await input.inputValue()) === '@research ';
    await page.keyboard.type('hello');
    r.checks.hintNamed = await visible(page, page.getByText(L.hintNamed), 3000);
    await page.getByTestId('group-send').click();
    // room checks inside the group screen only: on wide windows the hidden sidebar repeats the last line
    const room = page.getByTestId('group-screen');
    r.checks.namedAnswers = await waitFor(room.getByText(/^Research hier: @research hello/), 30000);

    // 4. a plan: Hermes proposes, hands over, Research answers; the round bar while it runs
    await groupSend(L.plan);
    r.checks.roundBar = await waitFor(page.getByText(L.round), 8000);
    r.checks.handoffLine = await waitFor(room.getByText(L.handoff), 30000);
    r.checks.researchAnswers = await waitFor(room.getByText(/Drei Quellen gefunden/), 30000);
    await page.waitForTimeout(1500);
    await shot(page, '6-handover');

    // 5. an approval: a line in the group, the card in Research's own chat
    await groupSend('@research e2e approval');
    r.checks.approvalLine = await waitFor(room.getByText(L.waiting), 30000);
    r.checks.noCardInGroup = L.request ? !(await visible(page, room.getByText(L.request))) : true;
    await shot(page, '7-approval-line');
    await page.getByTestId('group-approval-open-research').click();
    r.checks.cardInBotChat = await waitFor(page.getByText(L.from), 20000);
    await page.waitForTimeout(800);
    await shot(page, '8-approval-botchat');
    if (L.once) {
      await page.getByLabel(L.once).first().click();
      let choice = null;
      for (let i = 0; i < 60 && !choice; i++) {
        choice = (await mockCtl('/__e2e/turns')).findLast((x) => /e2e approval/.test(x.text) && x.profile === 'research')?.approval?.choice ?? null;
        if (!choice) await page.waitForTimeout(250);
      }
      r.checks.answeredOnce = choice === 'once';
    }
    // 6. the group in the Bots tab
    if (!wide) await page.getByTestId('header-chats').click();
    await page.waitForTimeout(900);
    await page.getByTestId('drawer-tab-bots').click();
    r.checks.groupRow = await waitFor(page.getByTestId('groups-section'), 10000);
    await page.waitForTimeout(800);
    await shot(page, '9-bots-tab-group');
  } catch (e) {
    r.error = String(e?.message ?? e).slice(0, 400);
    await shot(page, 'error').catch(() => {});
  } finally {
    await ctx.close();
  }
  r.ok = !r.error && Object.values(r.checks).every(Boolean) && !r.pageErrors.length;
  return r.ok;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const web = await serveStatic(WEB_DIR, APP_PORT);
  const mock = createServer();
  await new Promise((res) => mock.listen(MOCK_PORT, '127.0.0.1', res));
  const mockCtl = (path, body) => fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${MOCK_PORT}`, '--force-color-profile=srgb', '--hide-scrollbars'] });
  let ok = true;
  try {
    for (const v of VARIANTS) {
      const pass = await variant(browser, mockCtl, v);
      console.log(`${pass ? 'PASS' : 'FAIL'} ${v} ${JSON.stringify(report.variants[v].checks)}${report.variants[v].error ? ` error=${report.variants[v].error}` : ''}`);
      ok &&= pass;
    }
  } finally {
    await browser.close();
    mock.close();
    web.close();
  }
  report.ok = ok;
  writeFileSync(join(OUT, 'groups-report.json'), JSON.stringify(report, null, 2));
  process.exitCode = ok ? 0 : 1;
}

main();

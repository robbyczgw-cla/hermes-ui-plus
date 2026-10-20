#!/usr/bin/env node
// Live cards (app/src/live): drives the built web app against the E2E mock (scripts/e2e/mock.mjs, a deterministic
// "Hermes" that applies the [hui:live] edits like the real one) and saves screenshots of the main screens plus a JSON
// report of what it saw. German UI, 390×844, light (the conflict also dark).
//
//   node scripts/ux-check/live-shots.mjs [--out DIR]        # needs dist/web (FLAVOR=hermes scripts/build-web.sh)
//
// Flow: create the list → tick two items (pending, tray says so) → "Wir grillen …" (the ticks ride along, receipt +
// "mitgeschickt" line) → open the card, add an item → history → a second device's turn changes items this device
// edits → conflict → card list. Phase 2 (dark, mockups 05 and 06): a live trip (created, Hermes moves two blocks, the
// open card on Saturday and its map tab) and a live watchlist (created, a wish price, the price update as a patch,
// the open card). All network outside the local bundle and the mock is aborted.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(ROOT, 'dist', 'live-shots');
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.LIVE_SHOTS_APP_PORT || 8119);
const MOCK_PORT = Number(process.env.LIVE_SHOTS_MOCK_PORT || 8793);
const HOST = 'hermes.local';
const TOKEN = 'nca_e2e_test_token_static_0000000000';
const VIEWPORT = { width: 390, height: 844 };
const PROFILE_ID = 'p-live-shots';

function seed({ mode = 'light', lang = 'de' } = {}) {
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
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: opts.mode ?? 'light', serviceWorkers: 'block' });
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
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors = [...(report.consoleErrors ?? []), m.text().slice(0, 300)].slice(-10); });
  return { ctx, page };
}

const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  step(`shot ${name}`);
  return file;
};

async function send(page, text) {
  const input = page.getByLabel('Nachricht eingeben');
  await input.click();
  await input.fill(text);
  // the composer's button (a plain checklist has its own "Senden")
  await page.getByTestId('composer-send').click();
  const stop = page.getByLabel('Antwort stoppen');
  if (await stop.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) await stop.waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForTimeout(1500);
}

/** RN-web AppState: hidden → visible = "app came to the foreground" (Hermes transcript + drawer sync). */
async function foreground(page) {
  await page.evaluate(() => {
    const set = (v) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set('hidden');
    setTimeout(() => set('visible'), 300);
  });
  await page.waitForTimeout(3500);
}

const visible = (page, re) => page.getByText(re).first().isVisible().catch(() => false);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const mock = createServer();
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  const web = await serveStatic(WEB_DIR, APP_PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${MOCK_PORT}`, '--force-color-profile=srgb', '--hide-scrollbars'] });
  const ctl = (path, body) => fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const { page } = await newDevice(browser, { mode: 'light' });
    await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
    await page.getByLabel('Nachricht eingeben').waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(1200);

    // 1. Hermes creates the live list
    await send(page, 'Mach mir eine Einkaufsliste für Samstag.');
    report.checks.createdTray = await visible(page, /0 von 8 · Hermes/);
    await shot(page, '01-created');

    // 2. two ticks in the inline card: pending, the tray says so
    await page.getByRole('checkbox', { name: /Milch.*offen/ }).first().click();
    await page.getByRole('checkbox', { name: /Eier.*offen/ }).first().click();
    await page.waitForTimeout(600);
    report.checks.pendingTray = await visible(page, /2 Änderungen warten/);
    await shot(page, '02-ticked-pending');

    // 3. the next message carries the ticks; Hermes' full version keeps them
    await send(page, 'Wir grillen doch am Samstag. Pack noch was dazu, die Tomaten brauch ich nicht mehr.');
    const turns = await ctl('/__e2e/turns');
    const sent = turns.at(-1)?.text ?? '';
    report.checks.trailerSent = /\[hui:live\]\{"einkauf":\{"v":1,"ops":\[\{"check":"milch"\},\{"check":"eier"\}\],"bid":"b-[a-z0-9]+"\}\}\[\/hui:live\]$/.test(sent);
    report.trailer = sent.slice(sent.indexOf('[hui:live]'));
    report.checks.sentLine = await visible(page, /2 Häkchen in „Einkauf Samstag“ mitgeschickt/);
    report.checks.receipt = await visible(page, /Grillkohle/);
    report.checks.trayAfter = await visible(page, /2 von 10 · Hermes/);
    report.checks.noRawTrailer = !(await visible(page, /\[hui:live\]/));
    await shot(page, '03-receipt');

    // 4. open the card from the tray, add an own item (pending, "von dir")
    await page.getByRole('button', { name: /^Live-Karte Einkauf Samstag/ }).first().click();
    await page.waitForTimeout(800);
    report.checks.cardNewTags = await visible(page, /^neu$/);
    const add = page.getByPlaceholder(/z\. B\./).last();
    await add.click();
    await add.fill('Brot vom Bäcker');
    await add.press('Enter');
    await page.waitForTimeout(600);
    report.checks.cardMine = await visible(page, /^von dir$/);
    report.checks.cardFooterPending = await visible(page, /Eine Änderung noch nicht bei Hermes/);
    await page.mouse.move(VIEWPORT.width / 2, 400);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(500);
    await shot(page, '04-card-open');
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
    await shot(page, '04b-card-open-bottom');

    // 5. history with versions and the diff of the newest Hermes version
    await page.getByRole('button', { name: 'Verlauf', exact: true }).first().click();
    await page.waitForTimeout(900);
    report.checks.history = await visible(page, /3 Versionen, alle aus dem Chat/);
    await shot(page, '05-history');
    await page.getByRole('button', { name: 'Fertig', exact: true }).last().click();
    await page.waitForTimeout(600);

    // 6. conflict: this device edits Mozzarella and ticks Gurke; a second device's turn changes both
    const moz = page.getByRole('checkbox', { name: /Mozzarella.*offen/ }).first();
    const box = await moz.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      await page.waitForTimeout(400);
      const edit = page.getByLabel('Text').last();
      await edit.fill('3 Mozzarella');
      await edit.press('Enter');
      await page.waitForTimeout(400);
    }
    await page.getByRole('checkbox', { name: /Gurke.*offen/ }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click();
    await page.waitForTimeout(500);
    const sid = (await ctl('/__e2e/sessions')).find((s) => s.live)?.id;
    step('second device turn', await ctl('/__e2e/live-turn', { sid, text: 'Nimm bitte vier Mozzarella, die Gurke brauchen wir nicht.' }));
    await page.waitForTimeout(21000); // the app syncs Hermes' session list at most every 20 s
    await foreground(page);
    report.checks.conflictTray = await visible(page, /Stellen? brauch/);
    await shot(page, '06-conflict-tray');
    await page.getByRole('button', { name: /^Live-Karte Einkauf Samstag/ }).first().click();
    await page.waitForTimeout(900);
    report.checks.conflictCard = await visible(page, /Hermes hat die Liste geändert/);
    await shot(page, '07-conflict');

    // dark: same state after a reload with the dark theme (pending edits survive the reload)
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('hermes.prefs.v1') || '{"v":1,"prefs":{}}');
      p.prefs.themeMode = 'dark';
      localStorage.setItem('hermes.prefs.v1', JSON.stringify(p));
    });
    await page.reload({ waitUntil: 'load' });
    await page.getByLabel('Nachricht eingeben').waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForTimeout(2500);
    const row = page.getByRole('button', { name: /^Live-Karte Einkauf Samstag/ }).first();
    report.checks.reloadKeepsChat = await row.isVisible().catch(() => false);
    if (report.checks.reloadKeepsChat) {
      await row.click();
      await page.waitForTimeout(900);
      report.checks.pendingSurvivesReload = await visible(page, /Hermes hat die Liste geändert/);
      await shot(page, '07b-conflict-dark');
      await page.getByRole('radio', { name: /^Behalten/ }).first().click().catch(() => {});
      await page.getByRole('button', { name: 'Übernehmen', exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      await shot(page, '08-conflict-resolved-dark');
      await page.getByRole('button', { name: 'Schließen', exact: true }).last().click().catch(() => {});
      await page.waitForTimeout(400);
      // the resolution goes with the next message; the other device's view is the transcript
      await send(page, 'Danke!');
      const last = (await ctl('/__e2e/turns')).at(-1)?.text ?? '';
      report.checks.resolutionSent = /"add":\{"id":"gurke"/.test(last) && /"set":"mozzarella","qty":3/.test(last);
      await shot(page, '09-after-send-dark');
    }

    // 7. a second device opens the same chat from the drawer: same state, from the transcript alone
    const b = await newDevice(browser, { mode: 'light' });
    await b.page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
    await b.page.getByLabel('Nachricht eingeben').waitFor({ state: 'visible', timeout: 180000 });
    await b.page.waitForTimeout(2500);
    const menu = b.page.getByRole('button', { name: /Menü|Chats/ }).first();
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
      await b.page.waitForTimeout(1200);
      await b.page.getByText(/Einkaufsliste für Samstag/).first().click().catch(() => {});
      await b.page.waitForTimeout(3000);
      report.checks.secondDeviceTray = await visible(b.page, /Einkauf Samstag/);
      await shot(b.page, '10-second-device');
    }
    await b.ctx.close();

    // 8. the card list from the chat menu
    await page.getByRole('button', { name: 'Chat-Optionen', exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    await page.getByText('Alle Live-Karten').first().click().catch(() => {});
    await page.waitForTimeout(800);
    report.checks.list = await visible(page, /Live-Karten in diesem Chat/);
    await shot(page, '11-card-list-dark');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);

    // 9. a live trip: created (compact inline card), Hermes moves two blocks (receipt), the open card on Saturday
    await send(page, 'Plane mir drei Tage Rom, 13. bis 15. November.');
    report.checks.tripInline = await visible(page, /3 Tage · 9 Termine/);
    await shot(page, '12-trip-created-dark');
    await send(page, 'Am Samstag soll es ab Mittag regnen.');
    report.checks.tripReceipt = await visible(page, /15:00/);
    await shot(page, '13-trip-receipt-dark');
    const tripRow = page.getByRole('button', { name: /^Live-Karte (Rom|rom)/ }).first();
    report.checks.tripTray = await visible(page, /Sa 14\. · 2 Änderungen/);
    await tripRow.click().catch(() => {});
    await page.waitForTimeout(900);
    report.checks.tripEarlier = await visible(page, /^vorgezogen$/);
    report.checks.tripSwapped = await visible(page, /^getauscht$/);
    await shot(page, '14-trip-open-dark');
    await page.getByRole('tab', { name: /^Karte/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, '14b-trip-map-dark');
    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(500);

    // 10. a live watchlist: created, a wish price (pending), the price update as a patch (receipt), the open card
    await send(page, 'Leg mir eine Kopfhörer-Watchlist an.');
    report.checks.watchInline = await visible(page, /3 Produkte/);
    await shot(page, '15-watch-created-dark');
    const watchRow = () => page.getByRole('button', { name: /^Live-Karte Kopfhörer-Watchlist/ }).first();
    await watchRow().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^WH-1000XM5/ }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    const wish = page.getByLabel('Wunschpreis', { exact: true }).last();
    if (await wish.isVisible().catch(() => false)) {
      await wish.fill('249');
      await page.getByRole('button', { name: 'Setzen', exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    report.checks.watchTarget = await visible(page, /Wunschpreis 249/);
    await shot(page, '16-watch-target-dark');
    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(500);
    await send(page, 'Prüf bitte die Preise.');
    const priceTurn = (await ctl('/__e2e/turns')).at(-1)?.text ?? '';
    report.checks.watchTargetSent = /"set":"xm5","target":249/.test(priceTurn);
    report.checks.watchReceipt = await visible(page, /269\s*€/);
    report.checks.watchNoCallout = !(await visible(page, /^Kopfhörer-Watchlist aktualisiert$/));
    await shot(page, '17-watch-receipt-dark');
    await watchRow().click().catch(() => {});
    await page.waitForTimeout(900);
    report.checks.watchUnder = await visible(page, /unter Wunschpreis 249/);
    await shot(page, '18-watch-open-dark');

    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(500);
    // 11. a plain list from Hermes → "Als Live-Karte weiterführen" → it goes to Hermes with the next message
    await send(page, 'Zeig mir eine checklist.');
    const adoptLink = page.getByRole('button', { name: /^Als Live-Karte weiterführen/ }).last();
    report.adoptLinks = await page.getByRole('button', { name: /^Als Live-Karte weiterführen/ }).count();
    await adoptLink.scrollIntoViewIfNeeded().catch(() => {});
    await adoptLink.click().catch((e) => step(`adopt click failed: ${String(e).slice(0, 200)}`));
    await page.waitForTimeout(1500);
    report.adoptStore = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hui.live.')).map((k) => `${k}=${(localStorage.getItem(k) ?? '').slice(0, 400)}`));
    report.checks.adoptOpened = await visible(page, /E2E pack list/);
    await shot(page, '19-adopted-dark');
    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(500);
    report.checks.adoptPointer = await visible(page, /Läuft als Live-Karte weiter/);
    await send(page, 'Danke dir.');
    const adoptTurn = (await ctl('/__e2e/turns')).at(-1)?.text ?? '';
    report.checks.adoptSent = /"create":"checklist","state":\{"title":"E2E pack list"/.test(adoptTurn);
    report.checks.adoptSentLine = await visible(page, /als Live-Karte mitgeschickt/);
    await shot(page, '20-adopt-sent-dark');
    // 12. history → v1 → "Auf v1 zurück": ordinary edits that wait for the next message
    await watchRow().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Verlauf', exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /^Version 1 von Hermes/ }).last().click().catch(() => {});
    await page.waitForTimeout(500);
    report.checks.revertButton = await visible(page, /^Auf v1 zurück$/);
    await shot(page, '21-history-revert-dark');
    await page.getByRole('button', { name: /^Auf v1 zurück/ }).first().click().catch(() => {});
    await page.waitForTimeout(900);
    report.checks.revertPending = await visible(page, /noch nicht bei Hermes/);
    await shot(page, '22-reverted-dark');
    await page.getByRole('button', { name: 'Schließen', exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(500);

    // 13. reading older messages folds the tray to one row
    const vp = page.viewportSize();
    await page.mouse.move(vp.width / 2, vp.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -900);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(700);
    report.checks.trayCollapsed = await page.getByRole('button', { name: /^Aufklappen|^Live-Karten aufklappen/ }).first().isVisible().catch(() => false);
    await shot(page, '23-tray-collapsed-dark');
    await page.getByRole('button', { name: /^Aufklappen|^Live-Karten aufklappen/ }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    report.checks.trayExpanded = await visible(page, /^Rom, 13\.–15\. November$/);

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

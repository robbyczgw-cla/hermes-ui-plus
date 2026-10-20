#!/usr/bin/env node
// Bot mode in the offline demo (app/src/onboarding/demo/bots.ts) on the built web app, as a first-time user sees it:
// the demo connection only, no server, all other network aborted. Per variant (language × theme × phone/tablet):
//   drawer "Chats | Bots" → Hermes, Scout, Atlas, Lumi and "Wartet auf dich" → Scout's chat: the delivered price check
//   as a routine marker, the waiting approval naming Scout → "Einmal erlauben" ends with "In der Demo wurde nichts
//   gelöscht", "Wartet auf dich" is gone → Lumi's chat with the morning briefing → "Über Lumi" with its routine and the
//   demo note → Atlas answers a typed follow-up with a typo ("packlsite?") in its role → "Neuer Bot" → Research →
//   "<Name> ist bereit" with "Nur auf diesem Gerät · Demo" → its starter gets the role's answer → "Scout" again is
//   refused ("Einen Bot mit diesem Namen gibt es schon.").
// JPEG screenshots (quality 75, ≤ 1280 px wide) and a JSON report.
//
//   node scripts/ux-check/demo-bots-shots.mjs [--out DIR] [--variants de-light-phone,…]
// Needs dist/web (FLAVOR=hermes scripts/build-web.sh, or UX_WEB_DIR) and playwright-core.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = arg('out', join(ROOT, 'dist', 'demo-bots-shots'));
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.DEMO_BOTS_APP_PORT || 8124);
// phone 390 × 2 = 780 px, tablet 1194 × 1: both under 1280 px wide
const SIZES = { phone: { viewport: { width: 390, height: 844 }, scale: 2 }, tablet: { viewport: { width: 1194, height: 834 }, scale: 1 } };
const VARIANTS = arg('variants', 'de-light-phone,en-dark-phone,es-light-phone,de-dark-tablet,en-light-tablet').split(',');

const T = {
  de: {
    approval: 'Scout möchte etwas ausführen', once: 'Einmal erlauben', allowed: /In der Demo wurde nichts gelöscht/, marker: 'Preis-Check: Fjord Calm 5', briefing: 'Morgenbriefing',
    followup: 'packlsite?', packing: 'Packliste', ready: 'Lupe ist bereit', demoNote: 'Nur auf diesem Gerät · Demo', starter: 'Was gibt es Neues bei Wärmepumpen?', answer: /Kurz zuerst/,
    exists: 'Einen Bot mit diesem Namen gibt es schon.', footer: /^Demo: Der Bot bleibt auf diesem Gerät/, noModel: /^In der Demo antwortet er mit vorbereiteten/, infoDemo: /^Demo: Diese Routinen sind erfunden/,
  },
  en: {
    approval: 'Scout wants to run something', once: 'Allow once', allowed: /Nothing was deleted in the demo/, marker: 'Price check: Fjord Calm 5', briefing: 'Morning briefing',
    followup: 'packign list?', packing: 'Packing list', ready: 'Lens is ready', demoNote: 'On this device only · demo', starter: 'What is new with heat pumps?', answer: /Short first/,
    exists: 'A bot with this name already exists.', footer: /^Demo: the bot stays on this device/, noModel: /^In the demo it answers with prepared/, infoDemo: /^Demo: these routines are invented/,
  },
  es: {
    approval: 'Scout quiere ejecutar algo', once: 'Permitir una vez', allowed: /En la demo no se borró nada/, marker: 'Control de precio: Fjord Calm 5', briefing: 'Resumen matutino',
    followup: 'lista de equipaje?', packing: 'Lista de equipaje', ready: 'Lupa está listo', demoNote: 'Solo en este dispositivo · demo', starter: '¿Qué hay de nuevo en bombas de calor?', answer: /Lo breve primero/,
    exists: 'Ya existe un bot con este nombre.', footer: /^Demo: el bot se queda en este dispositivo/, noModel: /^En la demo responde con textos de ejemplo/, infoDemo: /^Demo: estas rutinas son inventadas/,
  },
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
  const drawer = async () => {
    if (!wide) await page.getByTestId('header-chats').click();
    await page.waitForTimeout(800);
  };
  const botsTab = async () => {
    await drawer();
    const tab = page.getByTestId('drawer-tab-bots');
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await page.getByTestId('bot-row-scout').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
  };
  const send = async (text) => {
    const input = page.getByTestId('composer-input').last();
    await input.fill(text);
    await input.press('Enter');
  };
  const idle = async () => {
    await page.waitForTimeout(800);
    await page.getByTestId('composer-stop').first().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(600);
  };
  try {
    await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
    await page.getByTestId('composer-input').first().waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(1500);

    // 1. the roster: Hermes first, the three example bots, Scout's approval waiting
    await botsTab();
    r.checks.rows = (await Promise.all(['default', 'scout', 'atlas', 'lumi'].map((k) => visible(page.getByTestId(`bot-row-${k}`))))).every(Boolean);
    r.checks.waiting = await visible(page.getByTestId('bots-waiting'));
    r.checks.demoFoot = await visible(page.getByText(/^(Demo: erfundene Bots|Demo: invented bots|Demo: bots inventados)/));
    await shot('1-roster');

    // 2. "Wartet auf dich" → Scout's chat with the delivery marker and the approval card
    await page.getByTestId('bots-waiting').click();
    r.checks.approvalCard = await waitFor(page.getByText(L.approval, { exact: true }), 20000);
    r.checks.marker = await visible(page.getByText(L.marker));
    r.checks.noCronBubble = !(await visible(page.getByText(/^\[Cronjob /)));
    // a bot's chat in the demo keeps the demo strip (no server, sample answers)
    r.checks.demoStrip = await visible(page.getByText(/^(Kein Server · Beispielantworten|No server · sample answers|Sin servidor · ejemplos)$/));
    await shot('2-scout-approval');

    // 3. answer it: the demo says nothing was deleted, "Wartet auf dich" is gone
    await page.getByText(L.once, { exact: true }).first().click();
    r.checks.allowedHonest = await waitFor(page.getByText(L.allowed), 30000);
    await idle();
    r.checks.cardGone = !(await visible(page.getByText(L.approval, { exact: true })));
    await shot('3-allowed');
    await botsTab();
    r.checks.waitingGone = !(await visible(page.getByTestId('bots-waiting')));

    // 4. Lumi: the morning briefing delivered into its chat, "Über Lumi" with its routine
    await page.getByTestId('bot-row-lumi').click();
    r.checks.briefingMarker = await waitFor(page.getByText(L.briefing).first(), 15000);
    await shot('4-lumi');
    await page.getByTestId('header-model').first().click();
    r.checks.aboutSheet = await waitFor(page.getByTestId('bot-info'), 10000);
    r.checks.aboutRoutine = await waitFor(page.getByTestId('bot-info-routine-d0000000003a'), 10000);
    r.checks.aboutDemoNote = await visible(page.getByText(L.infoDemo));
    await shot('5-about-lumi');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // 5. Atlas: a typed follow-up with a typo stays in its role (packing list)
    await botsTab();
    await page.getByTestId('bot-row-atlas').click();
    await page.waitForTimeout(800);
    await send(L.followup);
    await idle();
    r.checks.atlasFollowup = await visible(page.getByText(L.packing, { exact: true }).last());
    await shot('6-atlas-followup');

    // 6. "Neuer Bot": Research → ready, demo note, starter answered in the role
    await botsTab();
    await page.getByTestId('bots-new').click();
    await page.waitForTimeout(700);
    if (!wide) r.checks.createFooter = await visible(page.getByText(L.footer));
    await page.getByTestId('bot-create-role-research').click();
    await page.waitForTimeout(500);
    r.checks.createDemoLine = await visible(page.getByText(L.noModel));
    await shot('7-create-form');
    await page.getByTestId('bot-create-submit').click();
    r.checks.ready = await waitFor(page.getByText(L.ready, { exact: true }), 20000);
    r.checks.readyDemoNote = await visible(page.getByText(L.demoNote, { exact: true }));
    await shot('8-ready');
    await page.getByText(L.starter, { exact: true }).first().click();
    await idle();
    r.checks.roleAnswer = await waitFor(page.getByText(L.answer).first(), 20000);
    await shot('9-answer');

    // 7. the deals role is called "Scout", like the example bot: refused like on a server
    await botsTab();
    await page.getByTestId('bots-new').click();
    await page.waitForTimeout(600);
    await page.getByTestId('bot-create-role-deals').click();
    await page.waitForTimeout(400);
    await page.getByTestId('bot-create-submit').click();
    r.checks.duplicateRefused = await waitFor(page.getByText(L.exists), 10000);
    await shot('10-exists');
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
  writeFileSync(join(OUT, 'demo-bots-report.json'), JSON.stringify(report, null, 2));
  const bad = Object.values(report.variants).filter((v) => !v.ok).length;
  console.log(`${VARIANTS.length - bad}/${VARIANTS.length} variants ok, report ${join(OUT, 'demo-bots-report.json')}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

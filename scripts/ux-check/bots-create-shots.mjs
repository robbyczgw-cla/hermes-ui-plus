#!/usr/bin/env node
// "Neuer Bot" (app/src/bots/create, docs/BOTS-SERVER.md "Creating bots from the app") on the built web app, as a normal
// user sees it. Against the E2E mock (scripts/e2e/mock.mjs, fresh per variant) or, with --live, against a real bridge
// (the test instance through `ti.sh tunnel`; the browser reaches it through a CORS-adding proxy route, no bridge change).
//
// Mock, per variant (language × theme × phone/tablet):
//   default bridge (no plugin): no "Chats | Bots" switch at all (the 0.1 look);
//   owner has not switched it on, admin device: the Bots tab with "Eigene Bots", who decides and the command to copy;
//   allowed: "Neuer Bot" → roles (5 + own role + empty agent) → "Angebote & Preise" prefilled → an empty name is refused
//   in place → "<Name> anlegen" → the Bot Chat opens with "<Name> ist bereit" and the template's starters → the roster
//   lists it; the same name again → "Einen Bot mit diesem Namen gibt es schon."; the empty agent renamed and created.
// Live (--live URL --token-file F): the same create steps on a real Hermes, from a template and from the empty agent,
//   plus one starter sent to the new bot (its answer must arrive).
// JPEG screenshots (quality 75, ≤ 1280 px wide) and a JSON report. All other network is aborted.
//
//   node scripts/ux-check/bots-create-shots.mjs [--out DIR] [--variants de-light-phone,…] [--live http://127.0.0.1:28790 --token-file F]
// Needs dist/web (FLAVOR=hermes scripts/build-web.sh, or UX_WEB_DIR) and playwright-core.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const OUT = arg('out', join(ROOT, 'dist', 'bots-create-shots'));
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.BOTS_SHOTS_APP_PORT || 8122);
const MOCK_PORT = Number(process.env.BOTS_SHOTS_MOCK_PORT || 8796);
const LIVE = arg('live', '');
const HOST = 'hermes.local';
const TOKEN = LIVE ? readFileSync(arg('token-file', ''), 'utf8').trim() : 'nca_e2e_test_token_static_0000000000';
/** --live: a paired device WITHOUT the bots grant (its token file): it must see the owner note, never "Neuer Bot" */
const DEVICE_TOKEN = LIVE && arg('device-token-file', '') ? readFileSync(arg('device-token-file', ''), 'utf8').trim() : '';
const PROFILE_ID = 'p-bots-create';
const SIZES = { phone: { viewport: { width: 390, height: 844 }, scale: 2 }, tablet: { viewport: { width: 1194, height: 834 }, scale: 1 } };
const VARIANTS = arg('variants', LIVE ? 'de-light-phone' : 'de-light-phone,en-dark-phone,es-light-phone,de-dark-tablet,en-light-tablet').split(',');

const T = {
  de: { input: 'Nachricht eingeben', newBot: 'Neuer Bot', create: /anlegen$/, ready: /ist bereit/, exists: 'Einen Bot mit diesem Namen gibt es schon.', required: 'Bitte ausfüllen', owner: 'Neue Bots legt der Besitzer deines Hermes-Servers an.', ownerFoot: /Neue Bots legt der Besitzer/, scout: 'Scout', starter: 'Vergleiche drei Saugroboter bis 400 €', blankName: 'Neuer Agent' },
  en: { input: 'Type a message', newBot: 'New bot', create: /^Create /, ready: /is ready/, exists: 'A bot with this name already exists.', required: 'Please fill this in', owner: 'New bots are created by the owner of your Hermes server.', ownerFoot: /New bots are (created|set up) by the owner/, scout: 'Scout', starter: 'Compare three robot vacuums up to €400', blankName: 'New Agent' },
  es: { input: 'Escribe un mensaje', newBot: 'Nuevo bot', create: /^Crear /, ready: /está listo/, exists: 'Ya existe un bot con este nombre.', required: 'Rellena este campo', owner: 'Los bots nuevos los crea el propietario de tu servidor Hermes.', ownerFoot: /(bots nuevos|nuevos bots).*propietario/i, scout: 'Scout', starter: 'Compara tres robots aspiradores hasta 400 €', blankName: 'Nuevo agente' },
};

const report = { at: new Date().toISOString(), live: !!LIVE, variants: {} };
const stamp = Date.now().toString(36).slice(-4);

function seed(lang, theme, token = TOKEN) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PROFILE_ID, kind: 'hermes', name: 'Hermes', baseUrl: `http://${HOST}/v1`, bridge: true }] }),
    [`hermes.apikey.${PROFILE_ID}`]: token,
    'hermes.activeProfile.v1': PROFILE_ID,
    'hui.aiConsent': JSON.stringify({ version: 2, at: Date.now() }),
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: theme, toolDetails: 'compact' } }),
  };
}

/** --live: the app's requests to hermes.local go to the bridge through node, with CORS headers added (no bridge change) */
async function liveRoute(route) {
  const req = route.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-expose-headers': '*' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const u = new URL(req.url());
  const headers = { ...req.headers() };
  delete headers.origin;
  delete headers.host;
  // long-lived streams (inbox, push) end when the page closes: abort the route instead of failing the run
  if (u.pathname.startsWith('/bridge/inbox/stream')) return route.abort().catch(() => {});
  let r, body;
  try {
    r = await fetch(`${LIVE}${u.pathname}${u.search}`, { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() ?? undefined });
    body = Buffer.from(await r.arrayBuffer());
  } catch {
    return route.abort().catch(() => {});
  }
  const h = Object.fromEntries([...r.headers.entries()].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)));
  return route.fulfill({ status: r.status, headers: { ...h, ...cors }, body }).catch(() => {});
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
  const mock = LIVE ? null : createServer();
  if (mock) await new Promise((res) => mock.listen(MOCK_PORT, '127.0.0.1', res));
  const ctl = (path, body) => fetch(`http://127.0.0.1:${MOCK_PORT}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json());
  const open = async (botsCreate, token = TOKEN) => {
    if (mock) await ctl('/__e2e/config', { botsCreate });
    const ctx = await browser.newContext({ viewport: S.viewport, deviceScaleFactor: S.scale, locale: { de: 'de-DE', en: 'en-US', es: 'es-ES' }[lang], colorScheme: theme, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => {
      try {
        if (!localStorage.getItem('__seeded')) {
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
          localStorage.setItem('__seeded', '1');
        }
      } catch {}
    }, seed(lang, theme, token));
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === HOST && LIVE) return liveRoute(route);
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
  const visible = (page, sel) => sel.first().isVisible().catch(() => false);
  const botsTab = async (page) => {
    await drawer(page);
    const tab = page.getByTestId('drawer-tab-bots');
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await page.waitForTimeout(600);
  };
  /** create through the sheet; returns the name typed */
  const create = async (page, { role, title, blank, label }) => {
    await page.getByTestId('bots-new').click();
    await page.waitForTimeout(700);
    if (label) await shot(page, `${label}-roles`);
    if (blank) await page.getByTestId('bot-create-blank').click();
    else await page.getByTestId(`bot-create-role-${role}`).click();
    await page.waitForTimeout(500);
    const nameField = page.getByTestId('bot-create-name');
    if (title !== undefined) await nameField.fill(title);
    if (label) await shot(page, `${label}-form`);
    await page.getByTestId('bot-create-submit').click();
  };
  try {
    if (!LIVE) {
      // 1. default bridge without the plugin: the 0.1 drawer
      {
        const { ctx, page } = await open(false);
        await drawer(page);
        await page.waitForTimeout(1500);
        r.checks.defaultNoSwitch = !(await visible(page, page.getByTestId('drawer-tab-bots')));
        await shot(page, '1-default-drawer');
        await ctx.close();
      }
      // 2. the owner has not switched it on (admin token): the tab explains who decides and shows the command
      {
        const { ctx, page } = await open('owner_off');
        await botsTab(page);
        r.checks.ownerEmptyBox = await visible(page, page.getByTestId('bots-empty'));
        r.checks.ownerText = await visible(page, page.getByText(L.owner));
        r.checks.ownerCommand = await visible(page, page.getByTestId('bots-enable-command'));
        r.checks.ownerNoCreate = !(await visible(page, page.getByTestId('bots-new')));
        await shot(page, '2-owner-off');
        await ctx.close();
      }
    }
    // 3. allowed: create from a template
    const { ctx, page } = await open(LIVE ? undefined : 'allowed');
    await botsTab(page);
    if (!LIVE) r.checks.emptyBoxWithCta = await visible(page, page.getByTestId('bots-empty-create'));
    await shot(page, '3-bots-tab');
    const scout = LIVE ? `Scout ${stamp}` : L.scout;
    if (wide) {
      // dialog: roles left, fields right; an empty name is refused in place
      await page.getByTestId('bots-new').click();
      await page.waitForTimeout(700);
      await page.getByTestId('bot-create-role-deals').click();
      r.checks.dialogRolesAndForm = (await visible(page, page.getByTestId('bot-create-role-travel'))) && (await visible(page, page.getByTestId('bot-create-name')));
      await page.getByTestId('bot-create-name').fill('');
      await page.getByTestId('bot-create-submit').click();
      r.checks.requiredInPlace = await visible(page, page.getByText(L.required));
      await page.getByTestId('bot-create-name').fill(scout);
      await shot(page, '4-dialog');
      await page.getByTestId('bot-create-submit').click();
    } else {
      await page.getByTestId('bots-new').click();
      await page.waitForTimeout(700);
      r.checks.sixRoles = (await page.locator('[data-testid^="bot-create-role-"]').count()) === 6;
      r.checks.blankLink = await visible(page, page.getByTestId('bot-create-blank'));
      await shot(page, '4-roles');
      await page.getByTestId('bot-create-role-deals').click();
      await page.waitForTimeout(500);
      r.checks.prefilled = (await page.getByTestId('bot-create-name').inputValue()) === L.scout && !!(await page.getByTestId('bot-create-how').inputValue());
      await page.getByTestId('bot-create-name').fill('');
      await page.getByTestId('bot-create-submit').click();
      r.checks.requiredInPlace = await visible(page, page.getByText(L.required));
      await page.getByTestId('bot-create-name').fill(scout);
      await shot(page, '5-form');
      await page.getByTestId('bot-create-submit').click();
    }
    // the new bot's Bot Chat opens with "<Name> ist bereit" and the template's starters
    await page.getByTestId('bot-empty-heading').waitFor({ state: 'visible', timeout: LIVE ? 90000 : 20000 });
    await page.waitForTimeout(800);
    r.checks.readyHeading = L.ready.test(await page.getByTestId('bot-empty-heading').innerText());
    r.checks.templateStarter = await visible(page, page.getByText(L.starter));
    await shot(page, '6-ready');
    // the roster lists it
    await botsTab(page);
    r.checks.listed = await visible(page, page.getByText(scout, { exact: true }));
    await shot(page, '7-roster');
    // the same name again → refused under the name field
    await page.getByTestId('bots-new').click();
    await page.waitForTimeout(600);
    await page.getByTestId('bot-create-role-deals').click();
    await page.getByTestId('bot-create-name').fill(scout);
    await page.getByTestId('bot-create-submit').click();
    await page.getByText(L.exists).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    r.checks.duplicateRefused = await visible(page, page.getByText(L.exists));
    await shot(page, '8-duplicate');
    await page.keyboard.press('Escape');
    if (!wide) await page.getByTestId('bot-create-back').click().catch(() => {});
    await page.getByTestId('bot-create-close').click().catch(() => {});
    await page.waitForTimeout(600);
    // the empty agent, renamed
    const notes = LIVE ? `Notizen ${stamp}` : 'Notizen';
    if (!(await visible(page, page.getByTestId('bots-new')))) await botsTab(page);
    await page.getByTestId('bots-new').click();
    await page.waitForTimeout(600);
    if (wide) await page.getByTestId('bot-create-role-own').click();
    else await page.getByTestId('bot-create-blank').click();
    await page.waitForTimeout(400);
    if (!wide) r.checks.blankPrefilled = (await page.getByTestId('bot-create-name').inputValue()) === L.blankName;
    await page.getByTestId('bot-create-name').fill(notes);
    await page.getByTestId('bot-create-job').fill('Notizen ordnen');
    await page.getByTestId('bot-create-how').fill('Nur Stichpunkte.');
    await page.getByTestId('bot-create-submit').click();
    // the previous bot's chat is still mounted: wait for THIS bot's heading, after the sheet has slid away
    const notesHeading = page.getByTestId('bot-empty-heading').filter({ hasText: notes });
    await notesHeading.first().waitFor({ state: 'visible', timeout: LIVE ? 90000 : 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    r.checks.blankCreated = await visible(page, notesHeading);
    await shot(page, '9-blank-ready');
    if (LIVE && DEVICE_TOKEN) {
      // a second device without the grant: the bots are there, creating is not
      const second = await open(undefined, DEVICE_TOKEN);
      await botsTab(second.page);
      await second.page.waitForTimeout(1500);
      r.checks.deviceNoCreate = !(await visible(second.page, second.page.getByTestId('bots-new')));
      r.checks.deviceOwnerNote = await visible(second.page, second.page.getByText(L.ownerFoot));
      r.checks.deviceSeesNewBot = await visible(second.page, second.page.getByText(scout, { exact: true }));
      await shot(second.page, '9b-device-without-right');
      await second.ctx.close();
    }
    if (LIVE) {
      // one real turn with the new bot: its answer arrives
      const input = page.getByLabel(L.input);
      await input.click();
      await input.fill('Wer bist du? Ein Satz.');
      await page.getByTestId('composer-send').click();
      await page.getByText(new RegExp(notes.split(' ')[0])).nth(1).waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(4000);
      r.checks.liveAnswer = (await page.locator('text=/Notiz|Stichpunkt/i').count()) > 1;
      await shot(page, '10-live-answer');
    }
    await ctx.close();
  } catch (e) {
    r.error = String(e?.message ?? e).slice(0, 400);
  } finally {
    if (mock) {
      await new Promise((res) => mock.close(res));
      mock.closeAllConnections?.();
    }
  }
  const failed = Object.entries(r.checks).filter(([, v]) => v !== true).map(([k]) => k);
  r.ok = !r.error && !failed.length && !r.pageErrors.length;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name}${failed.length ? ` failed: ${failed.join(', ')}` : ''}${r.error ? ` error: ${r.error}` : ''}${r.pageErrors.length ? ` pageErrors: ${r.pageErrors.length}` : ''}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const web = await serveStatic(WEB_DIR, APP_PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: [...(LIVE ? [] : [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${MOCK_PORT}`]), '--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    for (const v of VARIANTS) await variant(browser, v);
  } finally {
    await browser.close();
    web.close();
  }
  writeFileSync(join(OUT, 'bots-create-report.json'), JSON.stringify(report, null, 2));
  const bad = Object.values(report.variants).filter((v) => !v.ok).length;
  console.log(`${VARIANTS.length - bad}/${VARIANTS.length} variants ok, report ${join(OUT, 'bots-create-report.json')}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

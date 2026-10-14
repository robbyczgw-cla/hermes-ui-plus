#!/usr/bin/env node
// Visual regression harness for phone answers (390×844): serves the built web app in the offline
// demo profile, sends one scripted prompt per scenario, waits for the stream to finish + 1.5 s,
// then checks the rendered answer in the DOM and saves screenshots + a JSON report to dist/ux-check/.
//
//   node scripts/ux-check/run.mjs [--build] [--scenario weather,table]
//   UX_CHECK_PORT=8117 UX_WEB_DIR=dist/web node scripts/ux-check/run.mjs
//
// Needs a web bundle: reuses dist/web when present, otherwise builds it
// (FLAVOR=hermes scripts/build-web.sh). All network outside the local bundle is aborted –
// the demo profile answers locally. Exit code 1 when any check fails. See README.md.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';
import { evaluateChecks, scenarioPassed } from './checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PORT = Number(process.env.UX_CHECK_PORT || 8117);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const OUT = join(ROOT, 'dist', 'ux-check');
const VIEWPORT = { width: 390, height: 844 };

const argv = process.argv.slice(2);
const forceBuild = argv.includes('--build');
const onlyArg = argv.find((a) => a.startsWith('--scenario='));
const only = onlyArg ? onlyArg.slice('--scenario='.length).split(',').filter(Boolean) : null;

// prompt (demo picker keyword) / firstText anchors the answer start / expectText proves the final block
const SCENARIOS = [
  { id: 'weather', prompt: 'How is the weather tomorrow?', firstText: 'Here is the weather', expectText: 'bring a jacket' },
  { id: 'table', prompt: 'Show me a table', firstText: 'Die größten Städte', expectText: 'Berlin ist mit Abstand' },
  { id: 'wide-table', prompt: 'Wide table please', firstText: 'Drei Alltagsgeräte', expectText: 'ohne seitliches Scrollen', expectCardsToggle: true },
  { id: 'products', prompt: 'Headphones under 350', firstText: 'Drei fiktive Kopfhörer', expectText: 'Pulse 2' },
  { id: 'compare', prompt: 'Compare three plans', firstText: 'Comparison of the three plans', expectText: 'fits most people best' },
  { id: 'places', prompt: 'Restaurants nearby', firstText: 'Drei fiktive Lokale', expectText: 'Gartenküche Beispiel' },
  { id: 'recipe', prompt: 'Recipe for pasta', firstText: 'Ein schneller Klassiker', expectText: 'Spaghetti al Pomodoro' },
  { id: 'suggestions', prompt: 'Buttons please', firstText: 'Was möchtest du als Nächstes tun?', expectText: 'Zeig mir ein Diagramm', expectSuggestions: true },
  { id: 'text-card', prompt: 'Show my stats', firstText: 'Deine Kennzahlen diese Woche', expectText: 'Wochenziel Schritte' },
];

/** localStorage seed (addInitScript fn): onboarding done, builtin offline demo profile active, English chrome. */
function seedScript(s) {
  try {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  } catch {}
}

/** Runs in the page: collect the raw facts the four checks are evaluated from (self-contained). */
function collectRaw(firstText) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return r;
  };
  // the chat list is the largest vertically scrollable element
  let scope = document.body;
  let best = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > best && el.clientHeight > 200) {
      best = area;
      scope = el;
    }
  }
  const effOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1');
    return o;
  };
  const colorAlpha = (el) => {
    const c = getComputedStyle(el).color;
    const m = /rgba?\(([^)]*)\)/.exec(c || '');
    if (!m) return 1;
    const parts = m[1].split(/[,/]/).map((x) => x.trim());
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  };
  const directText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && norm(n.textContent));
  const inScrollableX = (el) => {
    for (let n = el.parentElement; n && n !== scope && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  };

  const texts = [];
  const bands = [];
  let startY = null;
  for (const el of scope.querySelectorAll('*')) {
    const r = visible(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor || '';
    const bgVisible = !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg);
    const isMedia = /^(IMG|SVG|CANVAS|VIDEO)$/.test(el.tagName);
    if ((directText(el) || isMedia || bgVisible) && effOpacity(el) >= 0.99 && r.width >= 8 && r.height >= 2) {
      bands.push({ top: r.top, bottom: r.bottom });
    }
    if (!directText(el)) continue;
    const own = norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (firstText && norm(el.textContent).includes(firstText) && (startY === null || r.top < startY)) startY = r.top;
    texts.push({
      text: own.slice(0, 120),
      effOpacity: effOpacity(el),
      colorAlpha: colorAlpha(el),
      clipped: el.scrollWidth > el.clientWidth + 1,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      ellipsis: cs.textOverflow === 'ellipsis',
      inScrollable: inScrollableX(el),
      disabled: !!el.closest('[disabled],[aria-disabled="true"]'),
      ariaHidden: !!el.closest('[aria-hidden="true"]'),
    });
  }

  const chips = [...scope.querySelectorAll('[aria-label^="Suggestion: "],[aria-label^="Vorschlag: "],[aria-label^="Sugerencia: "]')];
  const zones = new Set(chips.map((c) => c.parentElement)).size;

  const toggleTexts = ['As table', 'Als Tabelle', 'Como tabla', 'As cards', 'Als Karten', 'Como tarjetas'];
  let layoutToggle = null;
  for (const el of scope.querySelectorAll('[role="button"]')) {
    const label = norm(el.getAttribute('aria-label') || el.textContent);
    if (toggleTexts.includes(label)) layoutToggle = label;
  }

  return { texts, bands, startY, suggestionZones: zones, suggestionChips: chips.length, layoutToggle, scopeFound: scope !== document.body };
}

async function runScenario(browser, sc) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'en-US', colorScheme: 'light', serviceWorkers: 'block' });
  await ctx.addInitScript(seedScript, {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: 'preset-demo', kind: 'demo', name: 'Demo (offline)', baseUrl: 'demo://local' }] }),
    'hermes.activeProfile.v1': 'preset-demo',
    'hui.lang': 'en',
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: 'light', themeFamily: 'paper', toolDetails: 'compact' } }),
  });
  // offline: only the local bundle may load; the demo profile needs no server at all
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && Number(u.port) === PORT)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  const result = { id: sc.id, prompt: sc.prompt, screenshots: [] };
  try {
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 180000 });
    const input = page.getByLabel('Type a message');
    await input.waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(1200);
    await input.click();
    await input.fill(sc.prompt);
    await page.getByLabel('Send', { exact: true }).click();
    // streaming finished: the stop button appears, then disappears (same signal as the demo recorder)
    const stop = page.getByLabel('Stop answer');
    const sawStop = await stop.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (sawStop) await stop.waitFor({ state: 'hidden', timeout: 90000 });
    else await page.getByText(sc.expectText).first().waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(1500); // settle: entrances done, skeletons handed over

    result.expectTextSeen = await page.getByText(sc.expectText).first().isVisible().catch(() => false);
    const raw = await page.evaluate(collectRaw, sc.firstText);
    result.checks = evaluateChecks(raw, { expectSuggestions: !!sc.expectSuggestions });
    result.layoutToggle = raw.layoutToggle;
    result.scopeFound = raw.scopeFound;
    if (sc.expectCardsToggle) {
      result.checks.cardsToggle = { pass: raw.layoutToggle === 'As table', toggle: raw.layoutToggle };
    }
    result.pass = result.expectTextSeen && scenarioPassed(result.checks);

    const bottomShot = join(OUT, `${sc.id}-bottom.png`);
    await page.screenshot({ path: bottomShot });
    result.screenshots.push(bottomShot);
    // scroll the answer back to its start for the second shot (inverted list: wheel up)
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -2400);
      await page.waitForTimeout(250);
    }
    const topShot = join(OUT, `${sc.id}-top.png`);
    await page.screenshot({ path: topShot });
    result.screenshots.push(topShot);

    if (sc.expectCardsToggle && raw.layoutToggle === 'As table') {
      await page.getByRole('button', { name: 'As table' }).first().click().catch(() => {});
      await page.waitForTimeout(700);
      result.afterToggle = await page.evaluate((label) => [...document.querySelectorAll('[role="button"]')].some((el) => (el.getAttribute('aria-label') || '').trim() === label), 'As cards');
      const gridShot = join(OUT, `${sc.id}-grid.png`);
      await page.screenshot({ path: gridShot });
      result.screenshots.push(gridShot);
    }
  } catch (e) {
    result.pass = false;
    result.error = String(e?.message || e).slice(0, 500);
    const errShot = join(OUT, `${sc.id}-error.png`);
    await page.screenshot({ path: errShot }).catch(() => {});
    if (existsSync(errShot)) result.screenshots.push(errShot);
  } finally {
    result.pageErrors = pageErrors;
    await ctx.close();
  }
  return result;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (forceBuild || !existsSync(join(WEB_DIR, 'index.html'))) {
    console.log('building the web app (FLAVOR=hermes scripts/build-web.sh) …');
    const r = spawnSync('bash', ['scripts/build-web.sh'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, FLAVOR: 'hermes' } });
    if (r.status !== 0) {
      console.error('web build failed – not running the UX check');
      process.exit(2);
    }
  } else {
    console.log(`reusing the existing bundle in ${WEB_DIR} (pass --build to rebuild)`);
  }
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  if (!scenarios.length) {
    console.error(`no scenario matches --scenario=${only?.join(',')}; known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
    process.exit(2);
  }

  const server = await serveStatic(WEB_DIR, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
  const results = [];
  try {
    for (const sc of scenarios) {
      console.log(`\n▶ ${sc.id} – “${sc.prompt}”`);
      const r = await runScenario(browser, sc);
      results.push(r);
      if (r.error) console.log(`  ERROR ${r.error}`);
      if (r.checks) {
        for (const [name, c] of Object.entries(r.checks)) {
          const extra = name === 'followups' ? ` (zones=${c.zones})` : c.violations?.length ? ` (${c.violations.length} violation(s))` : '';
          console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${name}${extra}`);
        }
      }
      console.log(`  expectText ${r.expectTextSeen ? 'seen' : 'MISSING'} · screenshots: ${r.screenshots.map((s) => s.replace(ROOT + '/', '')).join(', ')}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const report = { at: new Date().toISOString(), viewport: VIEWPORT, webDir: WEB_DIR, scenarios: results, pass: results.every((r) => r.pass) };
  const reportPath = join(OUT, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nreport: ${reportPath}`);
  console.log(report.pass ? 'UX CHECK PASS' : 'UX CHECK FAIL');
  process.exit(report.pass ? 0 : 1);
}

await main();


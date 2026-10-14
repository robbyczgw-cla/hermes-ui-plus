// Shared helpers for the demo-video recorder: browser + clean app state, CDP screencast capture,
// touch-indicator overlay (injected into the page for recordings only, never part of the app bundle),
// human-like typing, taps, drags and smooth scrolling.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_URL = process.env.DEMO_APP_URL || 'http://localhost:8109/';
export const MOCK_PORT = Number(process.env.DEMO_MOCK_PORT || 8790);
export const VIEWPORT = { width: 390, height: 844 };
/** device pixel ratio of the recording (3 = iPhone-class; the encoder downsamples, which keeps text crisp) */
export const DSF = Number(process.env.DEMO_DSF || 3);
/** fake host name the browser maps to the local mock (so no localhost:port shows up in the UI) */
export const DEMO_HOST = 'hermes.local';
export const BROWSER_ARGS = [`--host-resolver-rules=MAP ${DEMO_HOST} 127.0.0.1:${MOCK_PORT}`, '--force-color-profile=srgb', '--hide-scrollbars'];

/** playwright-core: own node_modules first, then $PLAYWRIGHT_CORE, then a few known checkouts on this box. */
export async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean);
  // npx caches (e.g. `npx playwright install`) – newest first; the matching Chromium must be in ~/.cache/ms-playwright
  const npx = join(process.env.HOME || '', '.npm', '_npx');
  if (existsSync(npx)) {
    const found = readdirSync(npx)
      .map((d) => join(npx, d, 'node_modules', 'playwright-core'))
      .filter((d) => existsSync(join(d, 'package.json')))
      .map((d) => ({ d, t: statSync(d).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    candidates.push(...found.map((f) => f.d));
  }
  const req = createRequire(import.meta.url);
  for (const c of candidates) {
    try {
      return req(c);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright-core not found – set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core');
}

const PROFILE_ID = 'p-demo-video';
/** localStorage seed: onboarding done, one "Hermes" profile pointing at the local demo mock, English UI, Paper theme. */
export function seed({ theme = 'paper', mode = 'light', lang = 'en', prefs = {} } = {}) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PROFILE_ID, kind: 'hermes', name: 'Hermes', baseUrl: `http://${DEMO_HOST}/v1`, bridge: true, syncSessions: false }] }),
    [`hermes.apikey.${PROFILE_ID}`]: 'demo-video',
    'hermes.activeProfile.v1': PROFILE_ID,
    'hui.lang': lang,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: mode, themeFamily: theme, toolDetails: 'compact', ...prefs } }),
  };
}

/** Touch indicator: a soft dot that follows pressed pointers, plus window.__swipeDot for wheel scrolls. */
function touchOverlay() {
  const install = () => {
    if (document.getElementById('__demo_touch')) return;
    const st = document.createElement('style');
    st.textContent = `
      #__demo_touch{position:fixed;left:0;top:0;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;
        background:rgba(120,120,135,.30);border:2px solid rgba(255,255,255,.85);box-shadow:0 1px 6px rgba(0,0,0,.25);
        pointer-events:none;z-index:2147483647;opacity:0;transform:scale(.6);transition:opacity .18s ease,transform .18s ease}
      #__demo_touch.on{opacity:1;transform:scale(1)}
      #__demo_touch.up{opacity:0;transform:scale(1.5);transition:opacity .35s ease,transform .35s ease}`;
    document.head.appendChild(st);
    const d = document.createElement('div');
    d.id = '__demo_touch';
    document.body.appendChild(d);
    let down = false;
    const at = (x, y) => {
      d.style.left = x + 'px';
      d.style.top = y + 'px';
    };
    addEventListener('pointerdown', (e) => { down = true; at(e.clientX, e.clientY); d.className = 'on'; }, true);
    addEventListener('pointermove', (e) => { if (down) at(e.clientX, e.clientY); }, true);
    const up = () => { if (!down) return; down = false; d.className = 'up'; };
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
    window.__dot = (x, y, state) => { at(x, y); d.className = state; };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

export async function newClipPage(browser, { theme, mode, lang, prefs, locale = 'en-US' } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF, locale, colorScheme: mode || 'light', hasTouch: false, isMobile: false });
  await ctx.addInitScript((s) => {
    try {
      if (!localStorage.getItem('__demo_seeded')) {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        localStorage.setItem('__demo_seeded', '1');
      }
    } catch {}
  }, seed({ theme, mode, lang, prefs }));
  await ctx.addInitScript(touchOverlay);
  await routeNetwork(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  pageerror:', String(e).slice(0, 200)));
  return { ctx, page };
}

const MEDIA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'media');
/** hosts the recording may reach besides the app and the mock (Leaflet from unpkg + OSM map tiles, attribution shown in the map) */
const ALLOWED_HOSTS = (process.env.DEMO_ALLOW_HOSTS || 'tile.openstreetmap.de,unpkg.com').split(',').filter(Boolean);
/**
 * No uncontrolled network in the recordings: the fake image host (mock.mjs /bridge/images) is served from ./media,
 * Wikimedia lookups get an empty answer (so the app falls through to the fake bridge search), and everything else
 * outside the app / mock / allowed map tiles is aborted.
 */
async function routeNetwork(ctx) {
  const app = new URL(APP_URL);
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (u.host === app.host || u.hostname === DEMO_HOST || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname === 'images.example.org') {
      const f = join(MEDIA_DIR, basename(u.pathname));
      if (existsSync(f)) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(f), headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=3600' } });
      return route.fulfill({ status: 404, body: '' });
    }
    if (/(^|\.)(wikipedia|wikimedia)\.org$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"batchcomplete":true,"query":{"pages":[]}}', headers: { 'access-control-allow-origin': '*' } });
    if (ALLOWED_HOSTS.includes(u.hostname)) return route.continue();
    if (process.env.DEMO_DEBUG) console.warn('  blocked', u.href.slice(0, 120));
    return route.abort();
  });
}

/** CDP screencast → numbered JPEGs + timestamps; `stop()` writes an ffmpeg concat list for a CFR video. */
export async function startCapture(page, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = join(dir, `f${String(n++).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEWPORT.width * DSF, maxHeight: VIEWPORT.height * DSF, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  return {
    async stop() {
      // a last frame so the tail has a duration
      await page.waitForTimeout(200);
      await cdp.send('Page.stopScreencast').catch(() => {});
      const end = Date.now() / 1000;
      if (!frames.length) throw new Error('no screencast frames captured');
      const lines = ['ffconcat version 1.0'];
      for (let i = 0; i < frames.length; i++) {
        const next = i + 1 < frames.length ? frames[i + 1].t : end;
        const dur = Math.max(0.001, next - frames[i].t);
        lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(4)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file}'`);
      writeFileSync(join(dir, 'list.ffconcat'), lines.join('\n') + '\n');
      return { frames: frames.length, seconds: end - Math.min(t0, frames[0].t) };
    },
  };
}

const rnd = (a, b) => a + Math.random() * (b - a);

export function actions(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  async function center(locator) {
    await locator.waitFor({ state: 'visible', timeout: 30000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const b = await locator.boundingBox();
    if (!b) throw new Error('no bounding box');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  }
  let last = { x: VIEWPORT.width / 2, y: VIEWPORT.height * 0.75 };
  async function moveTo(x, y) {
    const steps = 8;
    await page.mouse.move(x, y, { steps });
    last = { x, y };
  }
  /** visible tap: travel, press (dot appears), short hold, release */
  async function tap(locator, { hold = 110, dx = 0, dy = 0, after = 450 } = {}) {
    const c = await center(locator);
    await moveTo(c.x + dx, c.y + dy);
    await wait(90);
    await page.mouse.down();
    await wait(hold);
    await page.mouse.up();
    await wait(after);
  }
  async function tapXY(x, y, { hold = 110, after = 450 } = {}) {
    await moveTo(x, y);
    await wait(90);
    await page.mouse.down();
    await wait(hold);
    await page.mouse.up();
    await wait(after);
  }
  /** press-drag-release with the dot following */
  async function drag(from, to, { ms = 700, holdFirst = 150 } = {}) {
    await moveTo(from.x, from.y);
    await page.mouse.down();
    await wait(holdFirst);
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      await wait(16);
    }
    await wait(120);
    await page.mouse.up();
    last = to;
  }
  /** human typing: per-character delay with jitter, longer after spaces/punctuation */
  async function type(text, { min = 25, max = 60 } = {}) {
    for (const ch of text) {
      // Insert each character directly: CDP key events can drop ASCII input in controlled web textareas.
      await page.keyboard.insertText(ch);
      await wait(rnd(min, max) + (/[ ,.?!]/.test(ch) ? rnd(30, 90) : 0));
    }
  }
  /** smooth wheel scroll inside the element under (x,y); shows a swipe dot moving opposite to the scroll */
  async function scroll(dy, { x = VIEWPORT.width / 2, y = VIEWPORT.height * 0.55, ms = 900, dot = true } = {}) {
    const steps = Math.max(10, Math.round(ms / 16));
    await page.mouse.move(x, y);
    const travel = Math.max(-260, Math.min(260, -dy * 0.35));
    if (dot) await page.evaluate(([x, y]) => window.__dot?.(x, y, 'on'), [x, y - travel / 2]);
    let done = 0;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = 1 - Math.pow(1 - k, 3);
      const target = dy * e;
      await page.mouse.wheel(0, target - done);
      done = target;
      if (dot) await page.evaluate(([x, y]) => window.__dot?.(x, y, 'on'), [x, y - travel / 2 + travel * e]);
      await wait(16);
    }
    if (dot) await page.evaluate(([x, y]) => window.__dot?.(x, y, 'up'), [x, y + travel / 2]);
    await wait(250);
  }
  /** scroll until the locator is roughly in the given vertical band (adapts to the chat list's wheel gain) */
  let gain = 2;
  async function scrollTo(locator, { band = 0.35, ms = 900 } = {}) {
    await locator.waitFor({ state: 'attached', timeout: 30000 });
    for (let i = 0; i < 4; i++) {
      const b = await locator.boundingBox();
      if (!b) break;
      const d = b.y - VIEWPORT.height * band;
      if (Math.abs(d) < 30) break;
      await scroll(Math.max(-2400, Math.min(2400, d * gain)), { ms: i ? ms * 0.6 : ms, dot: i === 0 });
      await wait(250);
      const b2 = await locator.boundingBox();
      const moved = b2 ? b.y - b2.y : 0;
      if (Math.abs(moved) > 5 && Math.abs(d) > 5) gain = Math.max(0.5, Math.min(4, gain * (d / moved)));
      else break;
    }
  }
  /** debug: DEMO_SHOTS=/dir saves a screenshot per mark */
  let markN = 0;
  let captureStart = Date.now();
  const timeline = [];
  async function mark(name) {
    timeline.push({ name, seconds: (Date.now() - captureStart) / 1000 });
    if (!process.env.DEMO_SHOTS) return;
    ensureDir(process.env.DEMO_SHOTS);
    await page.screenshot({ path: join(process.env.DEMO_SHOTS, `${String(markN++).padStart(2, '0')}-${name}.png`) });
  }
  return { startTimeline: () => { captureStart = Date.now(); }, timeline, mark, wait, tap, tapXY, drag, type, scroll, scrollTo, center, moveTo };
}

export function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

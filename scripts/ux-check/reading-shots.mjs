#!/usr/bin/env node
// Chat reading (app/src/chat/quote.ts, readingStore.ts, MessageList.tsx): drives the built web app against the E2E mock
// (scripts/e2e/mock.mjs, the default bridge without extras) and saves JPEG screenshots plus a JSON report.
//
//   node scripts/ux-check/reading-shots.mjs [--out DIR] [--lang en|de|es] [--mode light|dark]   # needs dist/web
//
// Flow: two answers → "Reply" on the first one + a selected sentence of the long one (two quotes in order) → the sent
// turn at the mock (both [hui:quote] blocks, one message) → the quote boxes in the bubble → a tap on the first box jumps
// to the cited answer (flash), also after a reload → an unsent draft survives a reload → scrolled up while an answer
// streams: the visible text does not move, the jump button counts the new answer → the position survives a reload →
// a 2400-row Hermes history: open time, scroll long tasks, find-in-chat jump time. Everything outside the bundle and the
// mock is aborted.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../e2e/mock.mjs';
import { serveStatic } from '../demo-videos/serve.mjs';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = arg('--out', join(ROOT, 'dist', 'reading-shots'));
const LANG = arg('--lang', 'en');
const MODE = arg('--mode', 'light');
const WEB_DIR = process.env.UX_WEB_DIR || join(ROOT, 'dist', 'web');
const APP_PORT = Number(process.env.READING_APP_PORT || 8121);
const MOCK_PORT = Number(process.env.READING_MOCK_PORT || 8795);
const HOST = 'hermes.local';
const TOKEN = 'nca_e2e_test_token_static_0000000000';
const VIEWPORT = { width: 390, height: 844 };
const PROFILE_ID = 'p-reading-shots';

const L = {
  en: { input: 'Type a message', stop: 'Stop answer', reply: 'Reply', chats: 'Chats', find: 'Search term in this chat', quote1: /^Quote 1 of 2 from Answer/, quote: /^Quote( \d of \d)? from /, jumpNew: /^Go to the latest message, 1 new answer$/, toBottom: /^Scroll to bottom$/ },
  de: { input: 'Nachricht eingeben', stop: 'Antwort stoppen', reply: 'Antworten', chats: 'Chats', find: 'Suchbegriff im Chat', quote1: /^Zitat 1 von 2 aus Antwort/, quote: /^Zitat( \d von \d)? aus /, jumpNew: /^Zur neuesten Nachricht, 1 neue Antwort$/, toBottom: /^Nach unten scrollen$/ },
  es: { input: 'Escribe un mensaje', stop: 'Detener respuesta', reply: 'Responder', chats: 'Chats', find: 'Término de búsqueda en este chat', quote1: /^Cita 1 de 2 de Respuesta/, quote: /^Cita( \d de \d)? de /, jumpNew: /^Ir al último mensaje, 1 respuesta nueva$/, toBottom: /^Desplazar hasta abajo$/ },
}[LANG];

function seed() {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PROFILE_ID, kind: 'hermes', name: 'Hermes', baseUrl: `http://${HOST}/v1`, bridge: true }] }),
    [`hermes.apikey.${PROFILE_ID}`]: TOKEN,
    'hermes.activeProfile.v1': PROFILE_ID,
    'hui.aiConsent': JSON.stringify({ version: 2, at: Date.now() }),
    'hui.lang': LANG,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: MODE, toolDetails: 'compact' } }),
  };
}

const report = { at: new Date().toISOString(), lang: LANG, mode: MODE, steps: [], checks: {}, metrics: {}, pageErrors: [] };
const step = (name, data = {}) => {
  report.steps.push({ name, ...data });
  console.log(`- ${name}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''}`);
};

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${LANG}-${MODE}-${name}.jpg`), type: 'jpeg', quality: 72 });
  step(`shot ${name}`);
};

async function send(page, text, { wait = true } = {}) {
  const input = page.getByLabel(L.input);
  await input.click();
  await input.fill(text);
  await page.getByTestId('composer-send').click();
  if (!wait) return;
  const stop = page.getByLabel(L.stop);
  if (await stop.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) await stop.waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForTimeout(1200);
}

/** top (px) of the message text showing `text` (not a quote box, the composer or an off-screen announcer), null when none */
const FIND_TEXT = `(t, vh) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let fallback = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.includes(t) || el.closest('[role="button"],[data-testid^="composer-quote"],[aria-live]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.bottom > 0 && r.top < vh) return r.top;
    if (fallback === null) fallback = r.top;
  }
  return fallback;
}`;
const topOf = (page, text) => page.evaluate(([src, t, vh]) => (0, eval)(src)(t, vh), [FIND_TEXT, text, VIEWPORT.height]);

/** the "Reply" button of the answer showing `text` (the first one below it) */
async function replyFor(page, text) {
  const top = await topOf(page, text);
  const pos = await page.evaluate(([top, label]) => {
    if (top === null) return null;
    let best = null;
    for (const b of document.querySelectorAll(`[aria-label="${label}"]`)) {
      const r = b.getBoundingClientRect();
      if (r.top > top && (!best || r.top < best.top)) best = { top: r.top, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return best;
  }, [top, L.reply]);
  if (pos && (pos.y < 60 || pos.y > VIEWPORT.height - 140)) {
    await wheel(page, pos.y - VIEWPORT.height / 2);
    return replyFor(page, text);
  }
  if (!pos) throw new Error(`no Reply button under "${text}"`);
  report.steps.push({ name: 'reply click', text, pos });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(500);
}

const onScreen = async (page, text) => {
  const top = await topOf(page, text);
  return top !== null && top > 40 && top < VIEWPORT.height - 120;
};

/** wheel over the message list (inverted: negative = older messages) */
async function wheel(page, dy, times = 1) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
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
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: LANG, colorScheme: MODE, serviceWorkers: 'block' });
    await ctx.addInitScript((s) => {
      try {
        if (!localStorage.getItem('__reading_seeded')) {
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
          localStorage.setItem('__reading_seeded', '1');
        }
      } catch {}
    }, seed());
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === HOST || (u.hostname === '127.0.0.1' && Number(u.port) === APP_PORT)) return route.continue();
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 300)));
    const open = async () => {
      await page.goto(`http://127.0.0.1:${APP_PORT}/`, { waitUntil: 'load', timeout: 180000 });
      await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 180000 });
      await page.waitForTimeout(1500);
      // "New in this version" once after an update
      const gotIt = page.getByRole('button', { name: /^(Got it|Verstanden|Entendido)$/ });
      if (await gotIt.isVisible().catch(() => false)) {
        await gotIt.click();
        await page.waitForTimeout(600);
      }
    };
    await open();

    // ---- 1. two answers, two quotes
    const first = 'Which ferry goes to Paros in the morning?';
    await send(page, first);
    await send(page, 'Now a long comparison please');
    const cited = `Short answer to "${first}"`;
    report.checks.firstOffScreen = !(await onScreen(page, cited));
    // the first answer's "Reply" (web: a button in its action row)
    for (let i = 0; i < 8 && !(await onScreen(page, cited)); i++) await wheel(page, -400);
    await replyFor(page, cited);
    report.firstReplyQuotes = await page.locator('[data-testid^="composer-quote-"]').count();
    await shot(page, '00-after-first-reply');
    // a selected sentence of the long answer, then its Reply
    await wheel(page, 4000, 6);
    const sel = await page.evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = n.textContent.indexOf('an e-bike parks at the door');
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 'an e-bike parks at the door'.length);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
          return getSelection().toString();
        }
      }
      return null;
    });
    report.checks.selectionMade = !!sel;
    await replyFor(page, 'Bottom line:');
    const quoteLabels = await page.locator('[aria-label]').evaluateAll((els, src) => els.map((e) => e.getAttribute('aria-label')).filter((l) => new RegExp(src).test(l)), L.quote.source);
    report.composerQuotes = quoteLabels;
    report.checks.twoQuotesInOrder = quoteLabels.length === 2 && /Paros/.test(quoteLabels[0]) && /from Answer: an e-bike parks at the door$|aus Antwort: an e-bike parks at the door$|de Respuesta: an e-bike parks at the door$/.test(quoteLabels[1]);
    await shot(page, '01-composer-two-quotes');

    // ---- 2. sent as one message with both blocks
    await send(page, 'Is there an earlier one, and does that hold for cargo too?');
    const turns = await ctl('/__e2e/turns');
    const sent = turns.at(-1)?.text ?? '';
    report.sent = sent;
    report.checks.oneTurnTwoBlocks = (sent.match(/\[hui:quote /g) ?? []).length === 2 && sent.indexOf('Paros') < sent.indexOf('e-bike parks') && sent.endsWith('cargo too?');
    report.checks.noRawTagShown = !(await page.getByText('hui:quote').first().isVisible().catch(() => false));
    report.checks.composerEmptyAfterSend = (await page.locator('[aria-label]').evaluateAll((els, src) => els.filter((e) => new RegExp(src).test(e.getAttribute('aria-label')) && e.closest('[data-testid^="composer-quote"]')).length, L.quote.source)) === 0;
    await wheel(page, 4000, 4);
    await shot(page, '02-bubble-with-quotes');

    // ---- 3. tap on the first quote: the cited answer comes into view and flashes
    const jump = async (name) => {
      const box = page.getByRole('button', { name: L.quote1 }).last();
      await box.click();
      await page.waitForTimeout(700);
      const ok = await onScreen(page, cited);
      await shot(page, name);
      await page.waitForTimeout(1500);
      return ok;
    };
    report.checks.jumpToCited = await jump('03-jumped-flash');
    await page.reload();
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1500);
    await wheel(page, 4000, 4);
    report.checks.jumpAfterReload = await jump('04-jumped-after-reload');

    // ---- 4. draft survives a reload
    await wheel(page, 6000, 4);
    await replyFor(page, 'Bottom line:');
    await page.getByLabel(L.input).fill('half typed question about the');
    await page.waitForTimeout(900);
    await page.reload();
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1800);
    report.checks.draftAfterReload = (await page.getByLabel(L.input).inputValue()) === 'half typed question about the';
    report.checks.draftQuoteAfterReload = (await page.locator('[data-testid="composer-quote-0"]').count()) === 1;
    await shot(page, '05-draft-after-reload');
    await page.getByTestId('composer-quote-0-remove').click().catch(() => {});
    await page.getByLabel(L.input).fill('');

    // ---- 5. scrolled up while an answer streams: nothing moves, the button counts it
    const slow = 'slow numbered sentences please';
    await send(page, slow, { wait: false });
    await page.getByLabel(L.stop).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    await wheel(page, -500, 2);
    const probe = 'an e-bike parks at the door';
    const tops = [];
    for (let i = 0; i < 40; i++) {
      tops.push(await topOf(page, probe));
      await page.waitForTimeout(250);
    }
    const nums = tops.filter((x) => x !== null);
    report.metrics.streamDriftPx = nums.length ? Math.round(Math.max(...nums) - Math.min(...nums)) : null;
    report.checks.noJumpWhileStreaming = nums.length > 20 && report.metrics.streamDriftPx <= 2;
    await page.getByLabel(L.stop).waitFor({ state: 'hidden', timeout: 90000 });
    await page.waitForTimeout(800);
    report.checks.unreadCount = await page.getByRole('button', { name: L.jumpNew }).isVisible().catch(() => false);
    await shot(page, '06-jump-unread');
    await page.getByTestId('chat-jump-latest').click();
    await page.waitForTimeout(900);
    // ---- 6. reading position after a reload
    await wheel(page, -700, 2);
    const before = await topOf(page, probe);
    await page.waitForTimeout(800);
    await page.reload();
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(2500);
    const after = await topOf(page, probe);
    report.metrics.positionBeforeAfter = [before, after];
    report.checks.positionRestored = after !== null && (await page.getByRole('button', { name: L.toBottom }).isVisible().catch(() => false));
    await shot(page, '07-position-after-reload');

    // ---- 7. a 2400-row Hermes history (another device's long chat)
    await ctl('/__e2e/seed', { messages: 2400, title: 'Long history 2400' });
    await page.reload();
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: L.chats }).first().click();
    const row = page.getByText('Long history 2400').first();
    await row.waitFor({ state: 'visible', timeout: 30000 });
    await page.evaluate(() => {
      window.__lt = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: false });
    });
    const t0 = Date.now();
    await row.click();
    await page.getByLabel(L.input).waitFor({ state: 'visible', timeout: 60000 });
    await page.getByTestId('composer-send').or(page.getByLabel(L.input)).first().waitFor();
    await page.waitForFunction(() => document.body.innerText.length > 2000, null, { timeout: 60000 });
    report.metrics.openLongMs = Date.now() - t0;
    await page.waitForTimeout(2500);
    await page.evaluate(() => (window.__lt = []));
    const s0 = Date.now();
    await wheel(page, -900, 25);
    report.metrics.scroll25Ms = Date.now() - s0;
    report.metrics.scrollLongTasks = await page.evaluate(() => ({ n: window.__lt.length, max: Math.round(Math.max(0, ...window.__lt)), sum: Math.round(window.__lt.reduce((a, b) => a + b, 0)) }));
    await shot(page, '08-long-history-scrolled');
    // find in chat: a term from an early turn
    await page.keyboard.press('Control+f');
    const field = page.getByLabel(L.find);
    if (await field.isVisible().catch(() => false)) {
      const f0 = Date.now();
      await field.fill('(#12)');
      await page.waitForTimeout(300);
      await page.waitForFunction(() => document.body.innerText.includes('/'), null, { timeout: 10000 }).catch(() => {});
      report.metrics.findMs = Date.now() - f0;
      await page.waitForTimeout(1500);
      await shot(page, '09-find-in-long-history');
    } else report.checks.findOpened = false;
    report.checks.noPageErrors = report.pageErrors.length === 0;
  } finally {
    writeFileSync(join(OUT, `report-${LANG}-${MODE}.json`), JSON.stringify(report, null, 2));
    await browser.close().catch(() => {});
    web.close?.();
    mock.close();
  }
  const failed = Object.entries(report.checks).filter(([, v]) => v === false).map(([k]) => k);
  console.log(JSON.stringify({ checks: report.checks, metrics: report.metrics, failed }, null, 1));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(join(OUT, `report-${LANG}-${MODE}.json`), JSON.stringify({ ...report, error: String(e?.stack ?? e) }, null, 2));
  process.exit(2);
});

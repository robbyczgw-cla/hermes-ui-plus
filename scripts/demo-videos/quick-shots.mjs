#!/usr/bin/env node
// Design screenshots of quick answers ("Schnellfrage", ⚡) from the public web build in DEMO MODE: no server, the
// offline demo answers with its canned quick backend (app/src/quick/demo.ts). Same browser setup as the demo videos
// (lib.mjs: playwright-core, 390×844 phone viewport). Writes PNGs + index.html to $SHOTS_OUT.
//
//   FLAVOR=hermes scripts/build-web.sh
//   XDG_RUNTIME_DIR=/run/user/$(id -u) systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 \
//     node scripts/demo-videos/quick-shots.mjs
//
// Env: SHOTS_OUT [dist/share/design/quick-v1]  DEMO_WEB_DIR [dist/web]  SHOTS_PORT [8119]  DEMO_DSF [3]  SHOTS_LANG [de]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, VIEWPORT, DSF } from './lib.mjs';
import { serveStatic } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(process.env.SHOTS_OUT || join(ROOT, 'dist/share/design/quick-v1'));
const WEB = resolve(process.env.DEMO_WEB_DIR || join(ROOT, 'dist/web'));
const PORT = Number(process.env.SHOTS_PORT || 8119);
const LANG = process.env.SHOTS_LANG || 'de';
const URL_ = `http://127.0.0.1:${PORT}/`;

/** onboarding done on the built-in offline demo, German UI, standard ("Bote") theme */
function seed(mode) {
  return {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'demo' }),
    'hermes.activeProfile.v1': 'preset-demo',
    'hui.lang': LANG,
    'hermes.prefs.v1': JSON.stringify({ v: 1, prefs: { themeMode: mode, themeFamily: 'standard', toolDetails: 'compact' } }),
  };
}

const shots = [];
async function shot(page, name, caption) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push({ name, caption });
  console.log('  shot', name);
}

async function newPage(browser, mode = 'light') {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF, locale: LANG === 'de' ? 'de-AT' : 'en-US', colorScheme: mode, reducedMotion: 'reduce' });
  await ctx.addInitScript((s) => {
    try {
      if (!localStorage.getItem('__shots_seeded')) {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        localStorage.setItem('__shots_seeded', '1');
      }
    } catch {}
  }, seed(mode));
  // nothing leaves the machine: only the local app server
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  pageerror:', String(e).slice(0, 200)));
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const input = (page) => page.getByRole('textbox').last();
const quickSwitch = (page) => page.getByRole('switch').last();

async function ask(page, text) {
  await input(page).click();
  await input(page).fill(text);
  await page.keyboard.press('Enter');
  // canned answer: ~1.4 s to the first token, then a short stream
  await page.waitForTimeout(4200);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveStatic(WEB, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    // 1 · start screen of a chat: ⚡ off in the composer, the start-screen pill
    let { ctx, page } = await newPage(browser);
    await shot(page, '01-start-quick-off', '<b>Start screen</b> – ⚡ off in the composer, “Schnellfrage” pill under the greeting');
    await input(page).fill('Wie viel sind 72 °F in °C?');
    await shot(page, '02-composer-off-typed', '<b>⚡ off</b> – a question typed in the normal chat');

    // 2 · long-press on Send → "Als Schnellfrage senden"
    const send = page.getByRole('button', { name: LANG === 'de' ? 'Senden' : 'Send' }).last();
    const box = await send.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await shot(page, '03-longpress-send', '<b>Long-press on Send</b> – “Als Schnellfrage senden”');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 3 · ⚡ on: the draft moves into the quick thread
    await quickSwitch(page).click();
    await page.waitForTimeout(700);
    await shot(page, '04-composer-on-draft', '<b>⚡ on</b> – the quick thread; the draft moved along, brass outline = goes to the quick model');
    await input(page).fill('');
    await page.waitForTimeout(200);
    await page.locator('body').click({ position: { x: 20, y: 400 } });
    await shot(page, '05-quick-empty', '<b>Empty quick thread</b> – what it is (and is not) in one sentence, three samples, 24 h note');

    // 4 · a quick answer with a card + the ⚡ meta line
    await ask(page, 'Wie viel sind 72 °F in °C?');
    await shot(page, '06-answer-card', '<b>Quick answer with a card</b> – calc card, “⚡ flash-mini · 1,4 s”, “Mit Hermes weitermachen”');

    // 5 · the thread with a few entries
    await ask(page, 'Python oder JavaScript für Einsteiger?');
    await ask(page, 'Wie lange kocht ein weiches Ei?');
    await shot(page, '07-thread', '<b>Schnellfragen thread</b> – one local thread, follow-ups allowed, hint once in the header');
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(500);
    await shot(page, '08-thread-scrolled', '<b>Thread, scrolled up</b> – table card answer');

    // 6 · answer menu of a quick answer
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(400);
    // the message list is inverted (newest first in the DOM)
    await page.getByRole('button', { name: LANG === 'de' ? 'Weitere Aktionen' : 'More actions' }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '09-answer-menu', '<b>Answer menu</b> – “Mit Hermes weitermachen” first, model line in the header');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 7 · hand-off → a new Hermes chat that starts with the Q&A as context
    await page.getByRole('button', { name: LANG === 'de' ? 'Mit Hermes weitermachen' : 'Continue with Hermes' }).last().click();
    await page.waitForTimeout(1200);
    await shot(page, '10-handoff', '<b>Hand-off</b> – new Hermes chat; question + quick answer (still marked ⚡) go along as context with the next message');

    // 8 · settings → Schnellfrage
    await page.goto(`${URL_}settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const sec = page.getByText(LANG === 'de' ? 'SCHNELLFRAGE' : 'QUICK QUESTION', { exact: true }).first();
    await sec.evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
    await page.mouse.wheel(0, -90);
    await page.waitForTimeout(400);
    await shot(page, '11-settings', '<b>Settings → Schnellfrage</b> – model, limits in plain words, ⚡ switch, delete');
    await page.getByRole('button', { name: LANG === 'de' ? /^Modell/ : /^Model/ }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '12-settings-model', '<b>Model choice</b> – the chat’s searchable model list over Hermes’ catalog (demo catalog here)');
    await ctx.close();

    // 9 · dark: the answer with the card, and the empty thread
    ({ ctx, page } = await newPage(browser, 'dark'));
    await quickSwitch(page).click();
    await page.waitForTimeout(700);
    await page.locator('body').click({ position: { x: 20, y: 400 } });
    await shot(page, '13-dark-empty', '<b>Dark</b> – empty quick thread');
    await ask(page, 'Wie viel sind 72 °F in °C?');
    await shot(page, '14-dark-answer', '<b>Dark</b> – quick answer with a card');
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(shots, null, 2));
  writeFileSync(join(OUT, 'index.html'), gallery(shots));
  console.log(`done: ${shots.length} shots in ${OUT}`);
}

/** small static gallery (Bote palette, light/dark), screenshots at phone size with captions and the design notes */
function gallery(list) {
  const fig = (s) => `<figure><a href="${s.name}.png"><img src="${s.name}.png" width="300" alt=""></a><figcaption>${s.caption}</figcaption></figure>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hermes UI+ · Schnellfrage v1</title><style>
:root{--bg:#F8F6F1;--surface:#FFFEFB;--text:#161B26;--muted:#4E5463;--subtle:#656B79;--accent:#8A6419;--border:rgba(22,27,38,.1);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0F131A;--surface:#161B24;--text:#ECE7DD;--muted:#AEB3BE;--subtle:#9399A6;--accent:#D4A85C;--border:rgba(236,231,221,.1);color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1400px;margin:0 auto;padding:40px 28px 80px}h1{font-size:32px;letter-spacing:-.02em;margin:0 0 6px}h2{font-size:20px;margin:44px 0 10px}
p,li{color:var(--muted);max-width:920px}li b{color:var(--text)}a{color:var(--accent)}
.frames{display:flex;flex-wrap:wrap;gap:28px 24px;align-items:flex-start;margin-top:16px}
figure{margin:0;width:300px}img{display:block;width:300px;height:auto;border-radius:28px;box-shadow:0 0 0 6px #0B0D11,0 0 0 7px #2A2F38,0 14px 40px rgba(10,12,16,.2)}
figcaption{font-size:12.5px;color:var(--subtle);margin-top:12px}figcaption b{color:var(--text)}
.note{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:12px 18px;max-width:980px}
</style></head><body><main>
<h1>⚡ Schnellfrage · v1</h1>
<p>Quick answers in the app, recorded from the web build in the offline demo (prepared answers, no server, fictional content). Theme “Bote”, German UI.</p>
<div class="note"><ul>
<li><b>⚡ is a mode switch, not a per-message flag.</b> On: the chat column shows the quick thread of this connection and the composer gets a brass outline – what you see is where your message goes. The draft moves along; the open chat stays mounted underneath.</li>
<li><b>One local thread per connection</b>, not a Hermes chat: not in the drawer, 24 h on the device, follow-ups send the last complete turns (≤ 6 messages).</li>
<li><b>Honest, once:</b> “Ohne Gedächtnis, Werkzeuge und Live-Daten” sits in the thread header, not on every answer. Each answer carries only “⚡ model · time to first token”.</li>
<li><b>Hand-off:</b> “Mit Hermes weitermachen” (last answer; every answer via ⋯) opens a new Hermes chat that starts with the question and the quick answer; the next message sends them as a marked context block.</li>
<li><b>Only where it exists:</b> ⚡, the start-screen pill and Settings → Schnellfrage appear only when the bridge reports the Hermes plugin (or in the demo). Otherwise nothing changes.</li>
</ul></div>
<h2>Screens</h2>
<div class="frames">${list.map(fig).join('\n')}</div>
</main></body></html>
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// A file sent through the web app the bridge serves, in a real browser: the default bridge (pure pass-through, no extras)
// with BRIDGE_WEB_DIR, a fake Hermes behind it. Pick a file, it uploads, the turn carries its server path, the bytes at
// that path are the file's; no content-policy violation on the way. Then five files at once (bridge limit: 2 at a time, no
// 429, all in the turn), a failed upload that says so under the composer and retries from there, and a fresh pairing through
// the web link where the microphone permission is "prompt": nothing may call getUserMedia without a press.
// No model, no key, a few minutes.
//
//   node scripts/ux-check/web-attach.mjs [--web-dir=dist/web] [--out=dist/web-attach]
//
// Needs a web bundle (FLAVOR=hermes scripts/build-web.sh), bridge/node_modules and a Chromium via playwright-core (same as
// run.mjs). Exit 0 = PASS, 1 = a check failed, 2 = the harness cannot run. Pre-release step, see docs/RELEASING.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../demo-videos/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const WEB_DIR = resolve(arg('web-dir') || join(ROOT, 'dist', 'web'));
const OUT = resolve(arg('out') || join(ROOT, 'dist', 'web-attach'));
if (!existsSync(join(WEB_DIR, 'index.html'))) {
  console.error(`no web bundle in ${WEB_DIR} (FLAVOR=hermes scripts/build-web.sh)`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${String(detail).slice(0, 240)}` : ''}`);
  if (!ok) fails.push(name);
};

// ---- a Hermes that only knows what this path needs; every turn's last user message is kept
const turns = [];
const hermes = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      turns.push(JSON.parse(raw).messages.at(-1).content);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Angekommen.' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
    return;
  }
  if (url.pathname.endsWith('/health')) return json(200, { status: 'ok' });
  if (url.pathname.endsWith('/models')) return json(200, { data: [{ id: 'hermes-agent' }] });
  if (url.pathname.endsWith('/api/sessions')) return json(200, { data: [], has_more: false });
  return json(404, { error: { message: 'not found' } });
});
await new Promise((r) => hermes.listen(0, '127.0.0.1', r));

const work = mkdtempSync(join(tmpdir(), 'hui-web-attach-'));
const TOKEN = 'nca_test_web_attach_token_000000000000';
const free = await new Promise((r) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => r(port));
  });
});
const BASE = `http://127.0.0.1:${free}`;
const bridge = spawn(process.execPath, [join(ROOT, 'bridge', 'bin', 'hermes-ui-bridge.mjs')], {
  cwd: work,
  env: {
    PATH: process.env.PATH,
    HOME: work,
    HERMES_BASE_URL: `http://127.0.0.1:${hermes.address().port}/v1`,
    HERMES_API_KEY: 'test-upstream-key-000000',
    BRIDGE_TOKEN: TOKEN,
    BRIDGE_HOST: '127.0.0.1',
    BRIDGE_PORT: String(free),
    BRIDGE_STATE_DIR: join(work, 'state'),
    BRIDGE_WEB_DIR: WEB_DIR,
    BRIDGE_PUBLIC_URL: BASE,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let bridgeErr = '';
bridge.stderr.on('data', (d) => (bridgeErr += d));

let browser;
const done = (code) => {
  bridge.kill('SIGKILL'); // a throwaway state dir: it must stop writing there before the delete below
  hermes.close();
  hermes.closeAllConnections?.();
  browser?.close().catch(() => {});
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // the bridge may still write its state
  process.exit(code);
};
const up = async () => {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${BASE}/`).then((r) => r.status === 200).catch(() => false);
    if (ok) return true;
    await sleep(500);
  }
  return false;
};
if (!(await up())) {
  console.error(`the bridge did not come up: ${bridgeErr.slice(0, 400)}`);
  done(2);
}

const { chromium } = await loadPlaywright().catch((e) => {
  console.error(String(e));
  done(2);
});
const SECRET = `Das Geheimwort lautet TESTWORT${Date.now()}.\n`;
const file = join(OUT, 'notiz.txt');
writeFileSync(file, SECRET);
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 844 }, locale: 'de-DE', serviceWorkers: 'block' });
  const PID = 'p-web-attach';
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('__seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    localStorage.setItem('__seeded', '1');
  }, {
    'hermes.onboarded.v1': JSON.stringify({ v: 1, at: Date.now(), path: 'direct' }),
    'hermes.profiles.v1': JSON.stringify({ v: 2, profiles: [{ id: PID, kind: 'hermes', name: 'Hermes', baseUrl: `${BASE}/v1`, bridge: true }] }),
    [`hermes.apikey.${PID}`]: TOKEN,
    'hermes.activeProfile.v1': PID,
    'hui.aiConsent': JSON.stringify({ version: 2, at: Date.now() }),
    'hui.lang': 'de',
  });
  const page = await ctx.newPage();
  const violations = [];
  let uploads = 0;
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('request', (q) => {
    if (q.method() === 'POST' && q.url().includes('/bridge/uploads')) uploads++;
  });
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 });
  const composer = page.getByTestId('composer-input').last();
  await composer.waitFor({ state: 'visible', timeout: 120000 });
  await sleep(2500);
  const understood = page.getByText('Verstanden', { exact: true }).first();
  if (await understood.isVisible().catch(() => false)) {
    await understood.click();
    await sleep(800);
  }
  const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
  await page.getByLabel('Anhang hinzufügen').last().click();
  await sleep(700);
  await page.getByText('Datei', { exact: true }).last().click();
  await (await chooser).setFiles(file);
  await sleep(3000);
  check('no content-policy violation while reading the file', violations.length === 0, violations[0]);
  check('the file was uploaded to the bridge', uploads === 1, `uploads ${uploads}`);
  check('no "could not be opened" under the composer', !(await page.evaluate(() => document.body.innerText)).includes('konnte nicht geöffnet'));
  await composer.fill('Was steht in der Datei?');
  await page.getByTestId('composer-send').last().click();
  for (let i = 0; i < 40 && !turns.length; i++) await sleep(500);
  const content = JSON.stringify(turns.at(-1) ?? '');
  const path = /Pfad auf dem Server: ([^\]\\"]+)\]/.exec(content)?.[1];
  check('the turn carries the server path of the file', !!path, content.slice(0, 200));
  let stored = '';
  try {
    stored = path ? readFileSync(path, 'utf8') : '';
  } catch (e) {
    stored = String(e);
  }
  check('the bytes at that path are the file', stored === SECRET, stored.slice(0, 80));
  const shown = await page.getByText('Angekommen.').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('the answer shows', shown);
  check('the file shows in the bubble', (await page.evaluate(() => document.body.innerText)).includes('notiz.txt'));
  await page.screenshot({ path: join(OUT, 'after-send.jpg'), type: 'jpeg', quality: 70 });

  // ---- five files at once: the app queues to the bridge limit, nothing is refused
  const attachFiles = async (names) => {
    const paths = names.map((n) => {
      const f = join(OUT, n);
      writeFileSync(f, `Inhalt von ${n}: ${'x'.repeat(200000)}\n`);
      return f;
    });
    const fc = page.waitForEvent('filechooser', { timeout: 15000 });
    await page.getByLabel('Anhang hinzufügen').last().click();
    await sleep(700);
    await page.getByText('Datei', { exact: true }).last().click();
    await (await fc).setFiles(paths);
  };
  const statuses = [];
  let running = 0;
  let peak = 0;
  page.on('request', (q) => {
    if (q.method() === 'POST' && q.url().includes('/bridge/uploads')) peak = Math.max(peak, ++running);
  });
  const uploadEnded = (q) => {
    if (q.method() === 'POST' && q.url().includes('/bridge/uploads')) running--;
  };
  page.on('requestfinished', uploadEnded);
  page.on('requestfailed', uploadEnded);
  page.on('response', (r) => {
    if (r.request().method() === 'POST' && r.url().includes('/bridge/uploads')) statuses.push(r.status());
  });
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId('composer-send').last().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  // a real line: uploads overlap at the bridge (on loopback each one is over before the next starts, which hides the limit)
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: -1, uploadThroughput: 256 * 1024 });
  const five = ['a1.txt', 'a2.txt', 'a3.txt', 'a4.txt', 'a5.txt'];
  await attachFiles(five);
  for (let i = 0; i < 60 && statuses.length < 5; i++) await sleep(500);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check('five files: every upload accepted, no 429', statuses.length === 5 && statuses.every((c) => c === 201), `statuses ${statuses}`);
  check('five files: never above the bridge limit', peak <= 2, `peak ${peak}`);
  check('five files: no retry line under the composer', !(await page.getByTestId('composer-upload-retry-all').last().isVisible().catch(() => false)));
  const turnsBefore = turns.length;
  await composer.fill('Fünf Dateien');
  await page.getByTestId('composer-send').last().click({ timeout: 10000 }).catch(() => {});
  for (let i = 0; i < 20 && turns.length === turnsBefore; i++) await sleep(500);
  const sentFive = turns.length === turnsBefore ? 'send stayed disabled' : JSON.stringify(turns.at(-1) ?? '');
  check('five files: all five in the turn', five.every((n) => sentFive.includes(n)), sentFive.slice(0, 200));
  await page.screenshot({ path: join(OUT, 'five-files.jpg'), type: 'jpeg', quality: 70 });
  await sleep(1500);

  // ---- an upload that fails: the reason on the chip, and a line under the composer that is not off-screen in the tray
  statuses.length = 0;
  await page.route('**/bridge/uploads', (route) =>
    route.fulfill({ status: 429, headers: { 'retry-after': '5' }, contentType: 'application/json', body: '{"error":{"message":"busy"}}' }),
  );
  await attachFiles(['b1.txt']);
  const retryAll = page.getByTestId('composer-upload-retry-all').last();
  // the app backs off first (1+2+4+8+8 s), then gives up
  const failedShown = await retryAll.waitFor({ state: 'visible', timeout: 45000 }).then(() => true, () => false);
  check('refused upload: retried with a backoff before it gives up', statuses.length >= 3, `tries ${statuses.length}`);
  check('refused upload: a visible line says so', failedShown && /nicht hochgeladen/.test(await retryAll.innerText()));
  check('refused upload: the chip explains it in words', (await page.evaluate(() => document.body.innerText)).includes('ausgelastet'));
  await page.screenshot({ path: join(OUT, 'upload-failed.jpg'), type: 'jpeg', quality: 70 });
  await page.unroute('**/bridge/uploads');
  statuses.length = 0;
  if (failedShown) {
    await retryAll.click();
    for (let i = 0; i < 40 && !statuses.length; i++) await sleep(500);
    check('refused upload: the line retries it', statuses[0] === 201, `statuses ${statuses}`);
    check('refused upload: the line goes away', await retryAll.waitFor({ state: 'hidden', timeout: 10000 }).then(() => true, () => false));
  }
  await ctx.close();

  // ---- microphone: a fresh browser (permission "prompt"), web pair link, consent, chat. A real browser would show a prompt
  // on any getUserMedia, headless just answers it, so the calls are counted.
  const added = spawnSync(process.execPath, [join(ROOT, 'bridge', 'bin', 'hermes-ui-bridge.mjs'), 'devices', 'add', 'mic check'], {
    cwd: work,
    env: { PATH: process.env.PATH, HOME: work, HERMES_BASE_URL: `http://127.0.0.1:${hermes.address().port}/v1`, BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(free), BRIDGE_STATE_DIR: join(work, 'state'), BRIDGE_WEB_DIR: WEB_DIR, BRIDGE_PUBLIC_URL: BASE },
    encoding: 'utf8',
  });
  const webLink = /Web app:\n(\S+)/.exec(added.stdout)?.[1];
  check('a web pair link', !!webLink, added.stderr);
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', serviceWorkers: 'block' });
  await fresh.addInitScript(() => {
    window.__micCalls = 0;
    const md = navigator.mediaDevices;
    const real = md?.getUserMedia?.bind(md);
    if (md) md.getUserMedia = (c) => (window.__micCalls++, real(c));
  });
  const fp = await fresh.newPage();
  // a slow line: until the bridge's voice config arrives the app takes the bridge engine, the one whose warm-up reads the
  // microphone permission (on loopback the answer is there first and the browser's own recognition never reads it)
  await fp.route('**/bridge/voice/**', async (route) => {
    await sleep(6000);
    await route.continue().catch(() => {});
  });
  const micCalls = () => fp.evaluate(() => window.__micCalls);
  await fp.goto(webLink, { waitUntil: 'load', timeout: 120000 });
  check('microphone: the browser reports the permission as "prompt" (or the check would prove nothing)', (await fp.evaluate(() => navigator.permissions.query({ name: 'microphone' }).then((s) => s.state))) === 'prompt');
  await sleep(2500);
  check('microphone: no getUserMedia on load', (await micCalls()) === 0, `calls ${await micCalls()}`);
  const clickText = async (re) => {
    const el = fp.getByText(re).last();
    await el.waitFor({ state: 'visible', timeout: 60000 });
    await el.click();
  };
  await clickText(/^Verbindung prüfen$/).catch(() => {});
  await clickText(/^Verbinden$/);
  await sleep(4000); // the consent screen, where the prompt used to pop up
  await fp.screenshot({ path: join(OUT, 'mic-consent.jpg'), type: 'jpeg', quality: 70 });
  check('microphone: no getUserMedia on the consent screen', (await micCalls()) === 0, `calls ${await micCalls()}`);
  await clickText(/^(Verstanden|Einverstanden|Zustimmen).*/);
  await sleep(1500);
  await clickText(/^Leeren Chat starten$/);
  await fp.getByTestId('composer-input').last().waitFor({ state: 'visible', timeout: 60000 });
  await sleep(3000); // the dictation warm-up runs 600 ms after the engine is known
  await fp.screenshot({ path: join(OUT, 'mic-chat.jpg'), type: 'jpeg', quality: 70 });
  check('microphone: no getUserMedia in the chat without a press', (await micCalls()) === 0, `calls ${await micCalls()}`);
  await fresh.close();
} catch (e) {
  check('harness', false, e);
}
console.log(fails.length ? `FAILED: ${fails.length}` : 'PASS web-attach');
done(fails.length ? 1 : 0);

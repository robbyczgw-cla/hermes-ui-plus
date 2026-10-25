#!/usr/bin/env node
// Real desktop app, real window: fresh install → paste the pair link from the setup wizard → Connect → one chat turn.
// Drives the Tauri app (Linux build) through WebKitGTK's WebDriver (WebKitWebDriver); runs inside the
// desktop-check container (run-container.sh). No test hooks in the app: it clicks and types like a user.
//
// usage: node pair-check.mjs --app <binary> --link-file <file with the hermesuiplus://pair link> --out <dir>
//        [--webdriver http://127.0.0.1:4445] [--prompt "…" --expect <regex>] [--timeout-s 180]
// Writes <out>/steps.json (what happened, page text excerpts on failure) and JPEG screenshots via ImageMagick
// (<out>/NN-<step>.jpg, ≤1280 px). Exit 0 = paired and an answer arrived, 1 = a step failed.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const APP = args.app;
const LINK = readFileSync(args['link-file'], 'utf8').trim();
const OUT = args.out;
const WD = args.webdriver ?? 'http://127.0.0.1:4445';
// the expected answer must not occur in the prompt (the prompt shows up as bubble and as chat title)
const PROMPT = args.prompt ?? 'What is 17 + 25? Reply with the number only.';
const EXPECT = new RegExp(args.expect ?? '\\b42\\b');
const TIMEOUT_MS = Number(args['timeout-s'] ?? 180) * 1000;
if (!APP || !LINK || !OUT) { console.error('usage: pair-check.mjs --app BIN --link-file F --out DIR'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const steps = [];
let shot = 0;
let session = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a WebDriver call that never answers (seen once while the app showed an error) must not hang the release check
const CALL_MS = 45_000;
setTimeout(() => { console.error('FAILED: overall timeout'); finish(false); }, TIMEOUT_MS + 240_000).unref();

async function wd(method, path, body) {
  const res = await fetch(`${WD}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === '/session' ? 120_000 : CALL_MS) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(j.value ?? j).slice(0, 300)}`);
  return j.value;
}
const s = (p) => `/session/${session}${p}`;
const exec = (script, a = []) => wd('POST', s('/execute/sync'), { script, args: a });
const pageText = () => exec('return document.body ? document.body.innerText : ""');

/** JPEG of the window (WebDriver), else of the whole X screen (works while WebDriver does not answer). */
async function screenshot(name) {
  const jpg = join(OUT, `${String(++shot).padStart(2, '0')}-${name}.jpg`);
  try {
    const png = join(OUT, `.${name}.png`);
    writeFileSync(png, Buffer.from(await wd('GET', s('/screenshot')), 'base64'));
    execFileSync('convert', [png, '-resize', '1280x1280>', '-quality', '75', jpg]);
    rmSync(png);
    return jpg;
  } catch (e) {
    try {
      execFileSync('import', ['-window', 'root', '-resize', '1280x1280>', '-quality', '75', jpg], { timeout: 20_000 });
      return `${jpg} (X screen; WebDriver: ${e.message.slice(0, 80)})`;
    } catch (e2) { return `screenshot failed: ${e.message} / ${e2.message}`; }
  }
}

/** Element on top (not covered by a dialog) whose own text (exact, trimmed), aria-label or placeholder matches. */
const FIND = `
  const [needle, attr] = arguments;
  const onTop = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return false;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (el === top || el.contains(top) || top.contains(el));
  };
  const hit = (el) => attr === 'placeholder' ? (el.placeholder || '').includes(needle)
    : (el.getAttribute('aria-label') || '').trim() === needle || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === needle);
  const found = [...document.querySelectorAll(attr === 'placeholder' ? 'input,textarea' : '*')].filter(hit)
    .map((el) => attr === 'placeholder' ? el : (el.closest('[role=button],button,a,[tabindex]') || el)).filter(onTop);
  return found.length ? found[found.length - 1] : null;`;

async function find(text, { attr = 'text', timeoutMs = 30_000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const el = await exec(FIND, [text, attr]).catch(() => null);
    if (el) return el;
    if (Date.now() > until) throw new Error(`not found: ${attr} "${text}"`);
    await sleep(500);
  }
}
const elId = (el) => el['element-6066-11e4-a23f-4a5d6e8b4f12'] ?? Object.values(el)[0];
async function click(text, o) { await wd('POST', s(`/element/${elId(await find(text, o))}/click`), {}); }
async function type(placeholder, value) {
  const el = await find(placeholder, { attr: 'placeholder' });
  await wd('POST', s(`/element/${elId(el)}/click`), {});
  await wd('POST', s(`/element/${elId(el)}/value`), { text: value });
}
async function waitFor(pred, what, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const t = await pageText().catch(() => '');
    if (pred(t)) return t;
    if (Date.now() > until) throw new Error(`timeout waiting for ${what}; page: ${t.replace(/\s+/g, ' ').slice(0, 600)}`);
    await sleep(500);
  }
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Date.now() - started, detail, shot: await screenshot(name) });
  } catch (e) {
    const text = await pageText().catch(() => '');
    steps.push({ name, ok: false, ms: Date.now() - started, error: e.message, page: text.replace(/\s+/g, ' ').slice(0, 1500), shot: await screenshot(`${name}-failed`) });
    throw e;
  }
}

let ok = false;
try {
  const caps = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary: APP, args: [] } } } });
  session = caps.sessionId;
  await step('start', async () => {
    const t = await waitFor((x) => /Connect|Verbinden/.test(x), 'onboarding', 60_000);
    return { origin: await exec('return location.origin'), text: t.replace(/\s+/g, ' ').slice(0, 200) };
  });
  await step('welcome', async () => { await click('Connect'); await waitFor((x) => x.includes('How is your Hermes set up?'), 'setup choice'); });
  await step('choose-link', async () => { await click('I have a QR code or link'); await find('://pair?u=', { attr: 'placeholder', timeoutMs: 30_000 }); });
  await step('paste-link', async () => {
    await type('://pair?u=', LINK);
    await click('Use link');
    await waitFor((x) => x.includes('Check the connection'), 'check screen');
  });
  await step('connect', async () => {
    // the check screen tests the address first; "Connect" redeems the one-time code (POST /bridge/pair/redeem)
    await waitFor((x) => /Connect\b/.test(x), 'Connect button', 30_000);
    await click('Connect');
    // paired: the privacy notice (first connection) and/or the "All set" screen follow
    const t = await waitFor((x) => x.includes('Got it, continue') || x.includes('All set'), 'paired (privacy notice or "All set")', 60_000);
    return { after: t.replace(/\s+/g, ' ').slice(0, 300) };
  });
  await step('consent', async () => {
    if ((await pageText()).includes('Got it, continue')) await click('Got it, continue');
    await sleep(1000);
    if ((await pageText()).includes('Start an empty chat')) await click('Start an empty chat');
    await sleep(1500);
    const t = await pageText();
    if (/\bDEMO\b|No server/.test(t)) throw new Error('still in demo mode after pairing');
    return { text: t.replace(/\s+/g, ' ').slice(0, 200) };
  });
  await step('chat', async () => {
    const box = await exec(`return [...document.querySelectorAll('textarea,input[type=text],input:not([type])')].filter((e) => e.getBoundingClientRect().height > 0).pop() || null`);
    if (!box) throw new Error('no composer');
    await wd('POST', s(`/element/${elId(box)}/click`), {});
    await wd('POST', s(`/element/${elId(box)}/value`), { text: `${PROMPT}` }); // Enter sends
    if (EXPECT.test(await pageText())) throw new Error(`expected answer ${EXPECT} is on the page before sending`);
    // done = the expected answer is there and the turn has ended (no "Thinking…", no "running" badge in the chat list)
    const t = await waitFor((x) => EXPECT.test(x) && !/Thinking…|\brunning\b/.test(x), `a finished answer matching ${EXPECT}`, TIMEOUT_MS);
    return { text: t.replace(/\s+/g, ' ').slice(-400) };
  });
  ok = true;
} catch (e) {
  console.error(`FAILED: ${e.message}`);
} finally {
  if (session) await wd('DELETE', s('')).catch(() => {});
  finish(ok);
}

function finish(passed) {
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ ok: passed, app: APP, steps }, null, 2));
  console.log(passed ? 'PASS: paired and one chat answer arrived' : 'FAIL (see steps.json)');
  process.exit(passed ? 0 : 1);
}

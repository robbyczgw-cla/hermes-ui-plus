#!/usr/bin/env node
// Records the Hermes UI demo clips (see README.md in this folder).
//   node scripts/demo-videos/record.mjs [clip ...|all] [--no-encode] [--keep-frames]
// Needs: Expo web dev server on :8109 (cd app && npx expo start --web --port 8109) – the local demo
// mock (mock.mjs) is started automatically when :8790 is free.
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_URL, BROWSER_ARGS, MOCK_PORT, actions, ensureDir, loadPlaywright, newClipPage, startCapture } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { VOCAB } from './scenarios.mjs';
import { CLIPS } from './clips.mjs';
import { encodeRaw, finishClip, finalizeAll } from './encode.mjs';
import { serveStatic } from './serve.mjs';
import { buildMedia } from './media.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = process.env.DEMO_WORK || '/tmp/hermes-demo-videos';
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
// --encode-only: re-run the ffmpeg steps from the kept raw.mp4 (or frames) without recording
let names = argv.filter((a) => !a.startsWith('--'));
if (!names.length || names.includes('all')) names = CLIPS.map((c) => c.id);
const unknown = names.filter((n) => !CLIPS.some((c) => c.id === n));
if (unknown.length) {
  console.error(`Unknown clip(s): ${unknown.join(', ')}\nAvailable: ${CLIPS.map((c) => c.id).join(', ')}`);
  process.exit(2);
}

async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

// dev box without swap: refuse heavy work when memory is short
const availGB = Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] || 0) / 1048576;
if (availGB && availGB < Number(process.env.DEMO_MIN_AVAIL_GB || 6)) {
  console.error(`Only ${availGB.toFixed(1)} GB RAM available (< ${process.env.DEMO_MIN_AVAIL_GB || 6} GB) – not recording.`);
  process.exit(1);
}
let staticServer = null;
if (!(await up(APP_URL)) && !flags.has('--encode-only')) {
  // no dev server: serve the built web bundle (FLAVOR=hermes scripts/build-web.sh → dist/web)
  const web = process.env.DEMO_WEB_DIR || join(HERE, '..', '..', 'dist', 'web');
  staticServer = await serveStatic(web, Number(new URL(APP_URL).port || 80));
  console.log(`serving ${web} on ${APP_URL}`);
}
await buildMedia();
let mock = null;
if (!(await up(`http://localhost:${MOCK_PORT}/health`))) {
  mock = spawn(process.execPath, [join(HERE, 'mock.mjs'), '--port', String(MOCK_PORT)], { stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 40 && !(await up(`http://localhost:${MOCK_PORT}/health`)); i++) await new Promise((r) => setTimeout(r, 250));
}

if (flags.has('--encode-only')) {
  console.error('Use: node scripts/demo-videos/encode.mjs [--clips a,b] (re-encodes from the kept raw.mp4)');
  process.exit(2);
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
ensureDir(WORK);
const results = [];
const failed = [];
try {
  for (const id of names) {
    const clip = CLIPS.find((c) => c.id === id);
    console.log(`\n▶ ${clip.id} – ${clip.titleEn}`);
    const { ctx, page } = await newClipPage(browser, clip.setup || {});
    const a = actions(page);
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 600000 });
    await page.getByLabel('Type a message').waitFor({ timeout: 600000 });
    await a.wait(5000);
    // park the pointer where a thumb would rest
    await page.mouse.move(300, 700);
    const dir = join(WORK, clip.id, 'frames');
    if (process.env.DEMO_SHOTS_BASE) process.env.DEMO_SHOTS = join(process.env.DEMO_SHOTS_BASE, clip.id);
    const cap = await startCapture(page, dir);
    a.startTimeline();
    await a.wait(700);
    try {
      await clip.run({ page, a, chat: chatHelpers(page, a), vocab: vocabHelpers(page) });
    } catch (e) {
      console.error(`  ✗ ${clip.id} failed: ${String(e.message || e)}`);
      await a.mark('error').catch(() => {});
      await cap.stop().catch(() => {});
      await ctx.close();
      failed.push(clip.id);
      continue;
    }
    await a.wait(clip.tail ?? 1400);
    const info = await cap.stop();
    writeFileSync(join(WORK, clip.id, 'timeline.json'), JSON.stringify(a.timeline, null, 2));
    await ctx.close();
    console.log(`  captured ${info.frames} frames, ${info.seconds.toFixed(1)} s`);
    // only the quick raw encode while the browser is up; the heavy steps run after it is closed
    encodeRaw(join(WORK, clip.id));
    results.push(clip);
    if (!flags.has('--keep-frames')) rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  if (mock) mock.kill();
  staticServer?.close();
}
if (results.length && !flags.has('--no-encode')) {
  for (const clip of results) {
    const out = await finishClip(clip, { withMusic: !flags.has('--no-music'), index: CLIPS.indexOf(clip) });
    console.log(`  → ${out.mp4} (${(out.bytes / 1e6).toFixed(2)} MB, ${out.duration.toFixed(1)} s${out.music ? ', music' : ''})`);
  }
  if (!flags.has('--no-finalize')) await finalizeAll({ withMusic: !flags.has('--no-music') });
}
if (failed.length) {
  console.error(`\nFailed clips: ${failed.join(', ')}`);
  process.exitCode = 1;
}

function chatHelpers(page, a) {
  const input = page.getByLabel('Type a message');
  return {
    input,
    /** tap the composer, type like a human, tap send */
    async send(text, { typing } = {}) {
      await a.tap(input, { after: 250 });
      await input.focus();
      await a.type(text, typing);
      if (await input.inputValue() !== text) throw new Error('Composer did not retain the complete demo prompt');
      await a.wait(350);
      await a.tap(page.getByLabel('Send', { exact: true }), { after: 200 });
    },
    /** wait until the answer finished streaming */
    async done(timeout = 60000) {
      await page.getByLabel('Stop answer').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await page.getByLabel('Stop answer').waitFor({ state: 'hidden', timeout });
    },
  };
}

/** vocab clip: which card is showing, and its answer (scenarios.mjs VOCAB) */
function vocabHelpers(page) {
  const items = VOCAB.items.map(({ term, translation }) => [term, translation]);
  return {
    async currentTerm() {
      for (const [term] of items) if (await page.getByText(term, { exact: true }).first().isVisible().catch(() => false)) return term;
      throw new Error('no vocab term visible');
    },
    translation: (term) => items.find(([t]) => t === term)[1],
    /** type mode shows the Spanish side */
    async currentTranslation() {
      for (const [, tr] of items) if (await page.getByText(tr, { exact: true }).first().isVisible().catch(() => false)) return tr;
      throw new Error('no vocab translation visible');
    },
    term: (tr) => items.find(([, x]) => x === tr)[0],
  };
}

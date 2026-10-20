#!/usr/bin/env node
// Live conversation test against a running UI bridge + Hermes: realistic multi-turn chats (scenarios.mjs) sent the
// way the app sends them, every answer parsed with the app's own parser and checked (check.mjs): each ```hui block
// must render content, list nodes must have entries, and with a bridge without image search (the default: no
// Serper/Brave key, what production and most users run) images must come as real URLs, not as query-only web items.
// Image URLs are fetched through the bridge's image proxy (what the phone loads); a URL that fails is reported as a
// placeholder (the app shows its calm fallback tile and the reason line).
//
// Pre-release step (docs/RELEASING.md), on the throwaway test instance with the DEFAULT bridge configuration:
//   scripts/test-instance/ti.sh --host mac|linux conversation-test   (sync + setup first when bridge/skill changed;
//   runs this file on YOUR machine through a tunnel, the instance inside a session on the host)
// Directly against any bridge (token from the environment, never printed):
//   HUI_CONV_TOKEN=… node bridge/eval/conversations/run.mjs --bridge http://127.0.0.1:8790 [--scenario id] [--out DIR]
//   node bridge/eval/conversations/run.mjs --ti      on a test host whose Node strips TypeScript (the app parser is .ts)
//
// Exit 0 = all answers pass, 1 = a check failed, 2 = could not run (bridge unreachable, no token).
// Answers go to OUT/conversation-report.{md,json} (full text in the JSON; OUT is private: the test host's reports dir
// or a path you choose, never the repo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAnswer } from './check.mjs';
import { SCENARIOS } from './scenarios.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const TI = argv.includes('--ti');
const TI_DIR = process.env.TI_DIR || '';
const MAC = process.platform === 'darwin';
const BRIDGE = (opt('--bridge', TI ? `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}` : process.env.HUI_CONV_BRIDGE || '')).replace(/\/+$/, '');
const TURN_TIMEOUT_MS = Number(opt('--turn-timeout', process.env.HUI_CONV_TURN_TIMEOUT_MS || 300000));
const only = opt('--scenario', '')?.split(',').filter(Boolean) ?? [];
const run = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = opt('--out', TI && TI_DIR ? join(TI_DIR, 'reports', `conv-${run}`) : '');

function token() {
  const file = opt('--token-file', '');
  if (file) return readFileSync(file, 'utf8').trim();
  if (TI && TI_DIR) return JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
  return process.env.HUI_CONV_TOKEN || '';
}

const TOKEN = token();
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const auth = (h = {}) => ({ authorization: `Bearer ${TOKEN}`, ...h });

async function getJson(path) {
  const r = await fetch(BRIDGE + path, { headers: auth() });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* not JSON */
  }
  return { status: r.status, json };
}

/** One app turn: only the new user message, the session continues on the server (like app/src/hermes/stream.ts). */
async function turn(sessionId, content) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  const out = { status: 0, text: '', route: null, done: false, ms: 0, error: null };
  try {
    const r = await fetch(`${BRIDGE}/v1/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: auth({ 'content-type': 'application/json', accept: 'text/event-stream', 'x-hermes-session-id': sessionId, 'x-hermes-session-key': 'hermes-ui' }),
      body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content }] }),
    });
    out.status = r.status;
    try {
      out.route = JSON.parse(r.headers.get('x-hermes-ui-route') || 'null');
    } catch {
      /* no route header */
    }
    if (!r.ok) {
      out.error = `HTTP ${r.status}: ${short(await r.text(), 200)}`;
      return out;
    }
    const dec = new TextDecoder();
    let buf = '';
    for await (const part of r.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            out.done = true;
            continue;
          }
          let j;
          try {
            j = JSON.parse(data);
          } catch {
            continue;
          }
          const d = j.choices?.[0]?.delta?.content;
          if (typeof d === 'string') out.text += d;
        }
      }
    }
  } catch (e) {
    out.error = e?.name === 'AbortError' ? `timeout after ${TURN_TIMEOUT_MS} ms` : short(e?.message ?? e, 200);
  } finally {
    clearTimeout(timer);
    out.ms = Math.round(performance.now() - t0);
  }
  return out;
}

/** What the phone gets for one image: the photo through the bridge proxy, or the placeholder (with why). */
async function resolveImage(img, imageSearch) {
  if (img.url) {
    try {
      const r = await fetch(`${BRIDGE}/bridge/img?u=${encodeURIComponent(img.url)}`, { headers: auth() });
      const type = r.headers.get('content-type') || '';
      await r.arrayBuffer().catch(() => null);
      return r.ok && type.startsWith('image/') ? { shows: 'photo', via: 'url' } : { shows: 'placeholder', via: 'url', why: `proxy HTTP ${r.status} ${type}`.trim() };
    } catch (e) {
      return { shows: 'placeholder', via: 'url', why: short(e?.message ?? e, 80) };
    }
  }
  if (img.query && img.web && imageSearch === 'off') return { shows: img.card ? 'icon' : 'placeholder', via: 'query', why: 'no image search on the bridge' };
  if (img.query && img.web) {
    const r = await getJson(`/bridge/images?q=${encodeURIComponent(img.query)}&n=3`).catch(() => ({ status: 0, json: null }));
    return r.status === 200 && r.json?.results?.length ? { shows: 'photo', via: 'search' } : { shows: img.card ? 'icon' : 'placeholder', via: 'search', why: `search HTTP ${r.status}` };
  }
  // Wikipedia lookups happen on the phone (keyless); not checked here
  return { shows: 'wikipedia lookup (on the phone)', via: 'query' };
}

function md(report) {
  const L = [`# Conversation test ${report.at}`, '', `Bridge: caps image_search=${report.imageSearch ?? 'unknown'}, router ${report.router ?? '?'}. Result: **${report.pass ? 'PASS' : 'FAIL'}**`, ''];
  for (const sc of report.scenarios) {
    L.push(`## ${sc.id}`, '', sc.note ? `_${sc.note}_` : '', '');
    sc.turns.forEach((t, i) => {
      L.push(`### ${i + 1}. "${t.prompt}" — ${t.pass ? 'PASS' : 'FAIL'} (${(t.ms / 1000).toFixed(1)} s)`);
      L.push(`- route: ${t.route ? `${t.route.format}${t.route.component ? `/${t.route.component}` : ''} ${t.route.confidence ?? ''}` : 'none'}`);
      L.push(`- blocks: ${t.blocks.length ? t.blocks.map((b) => b.type + (b.fallback ? ' (fallback)' : '')).join(', ') : 'none (Markdown only)'}`);
      if (t.expect?.length) L.push(`- expected one of: ${t.expect.join(', ')} → ${t.expectMet ? 'yes' : 'no (soft)'}`);
      if (t.images.length) L.push(`- images: ${t.images.map((im) => `${im.kind} ${im.via}→${im.shows}${im.why ? ` (${im.why})` : ''}`).join('; ')}`);
      for (const f of t.failures) L.push(`- FAIL: ${f}`);
      for (const w of t.warnings) L.push(`- warn: ${w}`);
      L.push('', '```text', short(t.text, 900), '```', '');
    });
  }
  return L.join('\n') + '\n';
}

async function main() {
  if (!BRIDGE || !TOKEN) {
    console.error('need --bridge URL and a token (HUI_CONV_TOKEN, --token-file, or --ti on the test host)');
    process.exit(2);
  }
  const status = await getJson('/bridge/status').catch((e) => ({ status: 0, error: e }));
  if (status.status !== 200) {
    console.error(`bridge not reachable or token rejected: /bridge/status → ${status.status}`);
    process.exit(2);
  }
  const imageSearch = status.json?.caps?.image_search ?? null;
  const report = { at: new Date().toISOString(), imageSearch, router: status.json?.router?.kind ?? null, scenarios: [], pass: true };
  console.log(`bridge caps: image_search=${imageSearch ?? 'unknown (older bridge)'}`);
  for (const sc of SCENARIOS.filter((s) => !only.length || only.includes(s.id))) {
    const sid = `hui-conv-${sc.id}-${run}`;
    const turns = [];
    for (const t of sc.turns) {
      const r = await turn(sid, t.text);
      const c = checkAnswer(r.text, { imageSearch });
      const failures = [...(r.error ? [r.error] : []), ...(!r.error && !r.done ? ['stream ended without [DONE]'] : []), ...c.failures];
      const images = [];
      for (const im of c.images) images.push({ kind: im.kind, ...(await resolveImage(im, imageSearch)) });
      const types = new Set(c.blocks.map((b) => b.type));
      const expectMet = !t.expect?.length || t.expect.some((x) => types.has(x));
      const res = { prompt: t.text, ms: r.ms, route: r.route, blocks: c.blocks, failures, warnings: c.warnings, images, expect: t.expect ?? [], expectMet, pass: failures.length === 0, text: r.text };
      turns.push(res);
      if (!res.pass) report.pass = false;
      console.log(`${res.pass ? 'PASS' : 'FAIL'} ${sc.id} "${t.text}" ${(r.ms / 1000).toFixed(1)} s · ${c.blocks.map((b) => b.type).join(', ') || 'markdown'}${images.length ? ` · images ${images.map((i) => i.shows).join('/')}` : ''}${failures.length ? ` · ${failures.join(' | ')}` : ''}`);
      if (r.error) break; // the session is in an unknown state: stop this conversation
    }
    report.scenarios.push({ id: sc.id, note: sc.note, sessionId: sid, turns });
  }
  if (OUT) {
    mkdirSync(OUT, { recursive: true, mode: 0o700 });
    writeFileSync(join(OUT, 'conversation-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(join(OUT, 'conversation-report.md'), md(report), { mode: 0o600 });
    console.log(`report: ${join(OUT, 'conversation-report.md')}`);
  }
  console.log(report.pass ? 'CONVERSATION TEST PASS' : 'CONVERSATION TEST FAIL');
  process.exit(report.pass ? 0 : 1);
}

await main();

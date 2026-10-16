#!/usr/bin/env node
// Live API checks of Hermes profiles (bots) and quick answers (⚡) through the UI bridge of the test instance.
//   node scripts/test-instance/api-test.mjs [--phase on|off] [--only a,b] [--out DIR]
// phase on  (default): plugin enabled. Profiles, per-profile stop and sessions, ⚡ stream / 429 / hand-off / bots.
// phase off: plugin disabled in Hermes (quick-off-test.sh does the switch): feature_off, no probe loop, chat unaffected.
// Runs on the test host (Node >= 22, no dependencies). Reads the bridge admin token from the bridge state directory.
// Never prints tokens; answers are shortened in the report. Writes OUT/api-report.md and OUT/api-report.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const PHASE = opt('--phase', 'on');
const ONLY = (opt('--only', '') || '').split(',').filter(Boolean);
// defaults follow lib.sh: macOS = native flavor (hermes-test-mac, ports 28xxx), else the docker flavor
const MAC = process.platform === 'darwin';
const TI_DIR = process.env.TI_DIR || join(homedir(), MAC ? 'hermes-test-mac' : 'hermes-test');
const OUT = opt('--out', join(TI_DIR, 'reports', `api-${PHASE}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const BRIDGE = `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}`;
const PLUGIN_PORT = Number(process.env.TI_PLUGIN_PORT || (MAC ? 28646 : 18646));
const TOKEN = JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
const PROFILE = 'writer';
const SIGNATURE = /quill/i;
const run = Date.now().toString(36);

const results = [];
const ctx = {}; // values shared between checks (session ids, quick answer)
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = (h = {}) => ({ authorization: `Bearer ${TOKEN}`, ...h });

async function getJson(path, init = {}) {
  const r = await fetch(BRIDGE + path, { ...init, headers: auth(init.headers) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, json, text };
}

/**
 * Streamed chat completion. Resolves when the stream ends (or the reader throws).
 * @returns {Promise<{status:number, sessionId:string|null, text:string, chunks:number, done:boolean, ttfbMs:number|null, ms:number, error?:string}>}
 */
async function streamChat(path, { messages, sessionId, body = {}, onText, signal } = {}) {
  const t0 = performance.now();
  const headers = auth({ 'content-type': 'application/json', accept: 'text/event-stream' });
  if (sessionId) headers['x-hermes-session-id'] = sessionId;
  const out = { status: 0, sessionId: null, text: '', chunks: 0, done: false, ttfbMs: null, ms: 0, model: null };
  try {
    const r = await fetch(BRIDGE + path, { method: 'POST', headers, signal, body: JSON.stringify({ model: 'hermes-agent', stream: true, messages, ...body }) });
    out.status = r.status;
    out.sessionId = r.headers.get('x-hermes-session-id');
    out.retryAfter = r.headers.get('retry-after');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('event-stream')) {
      out.errorBody = short(await r.text(), 300);
      out.ms = Math.round(performance.now() - t0);
      return out;
    }
    const dec = new TextDecoder();
    let buf = '';
    for await (const part of r.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') { out.done = true; continue; }
          let j; try { j = JSON.parse(data); } catch { continue; }
          if (j.model && !out.model) out.model = j.model;
          const d = j.choices?.[0]?.delta?.content;
          if (typeof d === 'string' && d) {
            if (out.ttfbMs === null) out.ttfbMs = Math.round(performance.now() - t0);
            out.text += d; out.chunks++;
            onText?.(out.text);
          }
        }
      }
    }
  } catch (e) {
    out.error = e.name === 'AbortError' ? 'aborted' : `${e.name}: ${short(e.message, 80)}`;
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}

const waitFor = async (cond, timeoutMs, stepMs = 200) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (cond()) return true; await sleep(stepMs); }
  return cond();
};

async function check(id, title, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  const t0 = Date.now();
  let r;
  try { r = await fn(); } catch (e) { r = { pass: false, why: `exception ${e.name}: ${short(e.message, 200)}` }; }
  const status = r.skip ? 'SKIP' : r.pass ? 'PASS' : 'FAIL';
  results.push({ id, title, status, secs: Math.round((Date.now() - t0) / 100) / 10, why: r.why ?? '', evidence: r.evidence ?? {} });
  process.stderr.write(`${status.padEnd(4)} ${id}: ${r.why ?? ''}\n`);
}

// long enough that neither run ends before the other one has started (Haiku writes ~100 numbers/s)
const STOP_N = 300;
const COUNT_PROMPT = (n) => `Count from 1 to ${n}, one number per line, digits only, nothing else.`;

// ---------------------------------------------------------------- phase on
async function phaseOn() {
  await check('profiles_list', 'GET /bridge/profiles lists default + writer', async () => {
    const r = await getJson('/bridge/profiles');
    const names = (r.json?.data ?? []).map((p) => p.name);
    return { pass: r.status === 200 && names.includes('default') && names.includes(PROFILE), why: `${r.status} ${JSON.stringify(r.json?.data)}`, evidence: r.json };
  });

  await check('profile_models', '/p/writer/v1/models answers through the bridge; unknown profile 404', async () => {
    const a = await getJson(`/p/${PROFILE}/v1/models`);
    const b = await getJson('/p/nosuchbot/v1/models');
    const c = await fetch(`${BRIDGE}/p/${PROFILE}/v1/models`); // no token
    await c.text();
    const ok = a.status === 200 && Array.isArray(a.json?.data) && b.status === 404 && c.status === 401;
    return { pass: ok, why: `writer ${a.status} ids=${(a.json?.data ?? []).map((m) => m.id)}; unknown ${b.status}; no token ${c.status}` };
  });

  await check('writer_chat', 'streamed chat to writer uses its personality and model', async () => {
    const sid = `hui-ti-w-${run}`;
    const r = await streamChat(`/p/${PROFILE}/v1/chat/completions`, { sessionId: sid, messages: [{ role: 'user', content: 'Describe the sea in one sentence.' }] });
    ctx.writerSid = r.sessionId || sid;
    const det = await getJson(`/p/${PROFILE}/api/sessions/${encodeURIComponent(ctx.writerSid)}`);
    const model = det.json?.model ?? det.json?.session?.model ?? null;
    const ok = r.status === 200 && r.done && r.chunks >= 2 && SIGNATURE.test(r.text);
    return { pass: ok, why: `status ${r.status}, ${r.chunks} chunks, done=${r.done}, ttfb ${r.ttfbMs} ms, total ${r.ms} ms, signature ${SIGNATURE.test(r.text)}, session model ${model}; "${short(r.text, 120)}"`, evidence: { ...r, text: short(r.text, 400), sessionModel: model } };
  });

  await check('default_chat', 'default profile: no writer personality, own model', async () => {
    const sid = `hui-ti-d-${run}`;
    const r = await streamChat('/v1/chat/completions', { sessionId: sid, messages: [{ role: 'user', content: 'Describe the sea in one sentence.' }] });
    ctx.defaultSid = r.sessionId || sid;
    const det = await getJson(`/api/sessions/${encodeURIComponent(ctx.defaultSid)}`);
    const model = det.json?.model ?? det.json?.session?.model ?? null;
    const ok = r.status === 200 && r.done && r.text.length > 0 && !SIGNATURE.test(r.text);
    return { pass: ok, why: `status ${r.status}, ${r.chunks} chunks, signature ${SIGNATURE.test(r.text)}, session model ${model}; "${short(r.text, 120)}"`, evidence: { ...r, text: short(r.text, 400), sessionModel: model } };
  });

  await check('sessions_per_profile', 'session lists are separate per profile', async () => {
    if (!ctx.writerSid || !ctx.defaultSid) return { pass: false, why: 'chat checks did not run' };
    const w = await getJson(`/p/${PROFILE}/api/sessions?limit=50`);
    const d = await getJson('/api/sessions?limit=50');
    const ids = (r) => (r.json?.data ?? r.json?.sessions ?? []).map((s) => s.id ?? s.session_id);
    const wi = ids(w), di = ids(d);
    const ok = wi.includes(ctx.writerSid) && !wi.includes(ctx.defaultSid) && di.includes(ctx.defaultSid) && !di.includes(ctx.writerSid);
    return { pass: ok, why: `writer list ${wi.length} (has writer ${wi.includes(ctx.writerSid)}, has default ${wi.includes(ctx.defaultSid)}); default list ${di.length} (has default ${di.includes(ctx.defaultSid)}, has writer ${di.includes(ctx.writerSid)})` };
  });

  // same session id in both profiles, both streaming; stop names one profile
  async function stopScoped(stopProfile) {
    const sid = `hui-ti-stop-${stopProfile ?? 'default'}-${run}`;
    const prog = { w: '', d: '' };
    const w = streamChat(`/p/${PROFILE}/v1/chat/completions`, { sessionId: sid, messages: [{ role: 'user', content: COUNT_PROMPT(STOP_N) }], onText: (t) => { prog.w = t; } });
    const d = streamChat('/v1/chat/completions', { sessionId: sid, messages: [{ role: 'user', content: COUNT_PROMPT(STOP_N) }], onText: (t) => { prog.d = t; } });
    const started = await waitFor(() => prog.w.length > 0 && prog.d.length > 0, 60_000);
    if (!started) return { pass: false, why: `streams did not start (writer ${prog.w.length}, default ${prog.d.length} chars)` };
    const s = await getJson('/bridge/chat/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stopProfile ? { sessionId: sid, profile: stopProfile } : { sessionId: sid }) });
    const [wr, dr] = await Promise.all([w, d]);
    const stopped = stopProfile ? wr : dr, other = stopProfile ? dr : wr;
    // highest number written (the writer persona appends its "— Quill" signature after the count)
    const lastNum = (t) => Math.max(0, ...(t.match(/\d+/g) ?? []).map(Number));
    const ok = s.status === 200 && s.json?.stopped === 1 && !stopped.done && other.done && lastNum(other.text) === STOP_N && lastNum(stopped.text) < STOP_N;
    return {
      pass: ok,
      why: `stop -> ${s.status} ${JSON.stringify(s.json)}; stopped side: done=${stopped.done} last=${lastNum(stopped.text)} (${stopped.ms} ms${stopped.error ? ', ' + stopped.error : ''}); other side: done=${other.done} last=${lastNum(other.text)} (${other.ms} ms)`,
    };
  }
  await check('stop_writer_only', 'POST /bridge/chat/stop {sessionId, profile:writer} stops only the writer run', () => stopScoped(PROFILE));
  await check('stop_default_only', 'stop without profile stops only the default run (same session id)', () => stopScoped(null));

  await check('approvals_profile', 'approval of a bot turn routes to /p/<bot>/v1/runs/{id}/approval', async () =>
    ({ skip: true, why: 'no dangerous tool on the test profiles (terminal/file off by design), so Hermes cannot raise an approval safely; covered by bridge/test/approval-passthrough.test.mjs' }));

  await check('quick_config', 'GET /bridge/quick/config: available', async () => {
    const r = await getJson('/bridge/quick/config');
    return { pass: r.status === 200 && r.json?.available === true && r.json?.streaming === true, why: `${r.status} available=${r.json?.available} auxTask=${r.json?.auxTask} limits/min=${r.json?.limits?.perDeviceMinute}`, evidence: r.json };
  });

  await check('quick_stream', 'a quick answer streams', async () => {
    const q = 'What is the capital of Australia? Answer in one short sentence.';
    const r = await streamChat('/bridge/quick', { messages: [{ role: 'user', content: q }] });
    ctx.quick = { q, a: r.text, model: r.model };
    const cfg = await getJson('/bridge/quick/config');
    // SSE end to end with [DONE]. Token-by-token only where Hermes' aux client streams: its Anthropic client
    // consumes the stream inside create() (Hermes v0.22), so with provider anthropic the answer is ONE chunk.
    const ok = r.status === 200 && r.done && r.chunks >= 1 && /canberra/i.test(r.text);
    const note = r.chunks < 2 ? ' (one chunk: the provider is not streamed by Hermes)' : '';
    return { pass: ok, why: `status ${r.status}, SSE ${r.chunks} chunk(s)${note}, ttfb ${r.ttfbMs} ms, total ${r.ms} ms, model ${r.model}; config now model=${cfg.json?.model} provider=${cfg.json?.provider}; "${short(r.text, 100)}"`, evidence: { ...r, text: short(r.text, 300) } };
  });

  await check('quick_not_in_bots', '⚡ has no bot form: /p/writer/bridge/quick* is 404', async () => {
    const a = await getJson(`/p/${PROFILE}/bridge/quick/config`);
    const b = await getJson(`/p/${PROFILE}/bridge/quick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' });
    return { pass: a.status === 404 && b.status === 404, why: `config ${a.status}, post ${b.status}` };
  });

  await check('quick_handoff', '"Continue with Hermes": a default chat seeded with the quick answer builds on it', async () => {
    if (!ctx.quick?.a) return { pass: false, why: 'no quick answer to hand off' };
    // same context block as app/src/hermes/turnOverride.ts (branchSeedText + withContextSeed)
    const label = ctx.quick.model ? `Quick answer (${ctx.quick.model})` : 'Quick answer';
    const seed = 'This chat continues a quick answer from a small fast model that had no tools, no memory and no live data. ' +
      `Context only, do not repeat it; check it before you build on it:\nUser: ${ctx.quick.q}\n${label}: ${ctx.quick.a.trim()}`;
    const text = `[hui:context]\n${seed}\n[/hui:context]\n\nWhich city did that answer name? Reply with the city name only.`;
    const r = await streamChat('/v1/chat/completions', { sessionId: `hui-ti-handoff-${run}`, messages: [{ role: 'user', content: text }] });
    return { pass: r.status === 200 && r.done && /canberra/i.test(r.text), why: `status ${r.status}, "${short(r.text, 80)}"` };
  });

  await check('quick_rate_limit', `the per-device limit answers 429 with Retry-After`, async () => {
    // cheap: the bridge counts before the plugin; an empty message list is refused by the plugin without a model call
    const codes = [];
    let hit = null;
    for (let i = 0; i < 25 && !hit; i++) {
      const r = await getJson('/bridge/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[],"stream":false}' });
      codes.push(r.status);
      if (r.status === 429) hit = r;
    }
    const ok = !!hit && Number(hit.headers.get('retry-after')) > 0 && hit.json?.error?.code === 'rate_limited';
    return { pass: ok, why: `statuses ${codes.join(',')}; retry-after ${hit?.headers.get('retry-after')}; code ${hit?.json?.error?.code}` };
  });
}

// ---------------------------------------------------------------- phase off
async function phaseOff() {
  await check('quick_off_config', 'plugin disabled: /bridge/quick/config says available:false', async () => {
    let r;
    // the bridge caches a positive probe for at most 30 s
    for (let i = 0; i < 9; i++) { r = await getJson('/bridge/quick/config'); if (r.json?.available === false) break; await sleep(5000); }
    return { pass: r.status === 200 && r.json?.available === false, why: `${r.status} ${short(r.text)}` };
  });

  await check('quick_off_post', 'plugin disabled: POST /bridge/quick is 404 feature_off', async () => {
    const r = await getJson('/bridge/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}],"stream":true}' });
    return { pass: r.status === 404 && r.json?.error?.code === 'feature_off', why: `${r.status} ${r.json?.error?.code}` };
  });

  await check('quick_off_no_loop', 'plugin answering feature_off: the bridge probes at most every 30 s', async () => {
    // stand-in on the free plugin port that answers like a plugin with quick.enabled: false, and counts probes
    let hits = 0;
    const stub = createServer((req, res) => { hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"enabled": false}'); });
    try { await new Promise((ok, bad) => { stub.once('error', bad); stub.listen(PLUGIN_PORT, '127.0.0.1', ok); }); } catch (e) {
      return { pass: false, why: `plugin port busy (${e.code}): is the plugin really disabled?` };
    }
    const t0 = Date.now();
    let calls = 0, avail = new Set();
    try {
      while (Date.now() - t0 < 65_000) {
        const r = await getJson('/bridge/quick/config'); calls++; avail.add(String(r.json?.available));
        if (calls % 7 === 0) { await getJson('/bridge/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' }); calls++; }
        await sleep(2000);
      }
    } finally { await new Promise((r) => stub.close(r)); }
    const secs = (Date.now() - t0) / 1000;
    const ok = hits <= Math.ceil(secs / 30) + 1 && avail.size === 1 && avail.has('false');
    return { pass: ok, why: `${calls} client calls in ${Math.round(secs)} s -> ${hits} plugin probes; available ${[...avail]}` };
  });

  await check('chat_without_plugin', 'chats keep working without the plugin', async () => {
    const r = await streamChat('/v1/chat/completions', { sessionId: `hui-ti-noplugin-${run}`, messages: [{ role: 'user', content: 'Reply with exactly the word pong.' }] });
    return { pass: r.status === 200 && r.done && /pong/i.test(r.text), why: `status ${r.status}, "${short(r.text, 40)}"` };
  });
}

if (PHASE === 'off') await phaseOff(); else await phaseOn();

mkdirSync(OUT, { recursive: true });
const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const r of results) counts[r.status]++;
const md = [`# API live test (phase ${PHASE})`, '', `${new Date().toISOString()} · PASS ${counts.PASS} · FAIL ${counts.FAIL} · SKIP ${counts.SKIP}`, '',
  '| check | result | s | detail |', '|---|---|---|---|',
  ...results.map((r) => `| \`${r.id}\` ${r.title} | **${r.status}** | ${r.secs} | ${r.why.replace(/\|/g, '\\|')} |`), ''].join('\n');
writeFileSync(join(OUT, 'api-report.md'), md);
writeFileSync(join(OUT, 'api-report.json'), JSON.stringify({ phase: PHASE, results }, null, 2));
process.stdout.write(md + `\nreport: ${OUT}\n`);
process.exitCode = counts.FAIL ? 1 : 0;

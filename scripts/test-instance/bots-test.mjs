#!/usr/bin/env node
// Live checks of Bots v2 (docs/BOTS-SERVER.md) through the UI bridge of the test instance: the "Bot Chat" route
// (create once, adopt afterwards, nothing else), turns bound to that session (history server-side, title kept) and,
// with --approval, the per-bot "always allow" (lands in that profile's config only). Runs on the test host inside a
// session (bots-test.sh prepares and restores the profile for the approval part). Never prints tokens.
// With --delivery (slice 2): a real `deliver: bot-chat` job of the default bot, run once: Hermes writes its output into the
// default bot's Bot Chat and the bridge's Bot Chat watcher announces it on the live inbox (`botChat: true`, the job's
// text). Job, cron session and a Bot Chat this run created are deleted afterwards.
//   node scripts/test-instance/bots-test.mjs [--approval] [--delivery] [--out DIR]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const MAC = process.platform === 'darwin';
const TI_DIR = process.env.TI_DIR || join(homedir(), MAC ? 'hermes-test-mac' : 'hermes-test');
const DATA = join(TI_DIR, 'data');
const OUT = opt('--out', join(TI_DIR, 'reports', `bots-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const BRIDGE = `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}`;
const TOKEN = JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
const BOT = 'writer';
const APPROVAL = args.includes('--approval');
const DELIVERY = args.includes('--delivery');
const API = `http://127.0.0.1:${process.env.TI_API_PORT || (MAC ? 28642 : 18642)}`;

const results = [];
const created = []; // [prefix, id] to delete at the end
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sha = (f) => (existsSync(f) ? createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 12) : 'missing');
const auth = (h = {}) => ({ authorization: `Bearer ${TOKEN}`, ...h });

async function call(method, path, body) {
  const r = await fetch(BRIDGE + path, { method, headers: auth(body === undefined ? {} : { 'content-type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

/** streamed turn bound to a session; collects text and named events (approval.request) */
async function turn(prefix, sessionId, message, { onApproval } = {}) {
  const r = await fetch(`${BRIDGE}${prefix}/v1/chat/completions`, {
    method: 'POST',
    headers: auth({ 'content-type': 'application/json', accept: 'text/event-stream', 'x-hermes-session-id': sessionId }),
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: message }] }),
  });
  const out = { status: r.status, sessionId: r.headers.get('x-hermes-session-id'), text: '', events: [] };
  if (!r.ok) { out.error = short(await r.text(), 300); return out; }
  const dec = new TextDecoder();
  let buf = '';
  for await (const part of r.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (ev) {
        out.events.push(ev);
        if (ev === 'approval.request' && onApproval) await onApproval(j);
        continue;
      }
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === 'string') out.text += d;
    }
  }
  return out;
}

async function check(id, title, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, title, ok: true, ms: Date.now() - t0, detail });
    console.log(`PASS ${id} ${title}`);
  } catch (e) {
    results.push({ id, title, ok: false, ms: Date.now() - t0, detail: short(e?.message ?? e, 400) });
    console.log(`FAIL ${id} ${title}: ${short(e?.message ?? e, 200)}`);
  }
}
const expect = (c, msg) => { if (!c) throw new Error(msg); };
const ctx = {};

await check('profiles', 'GET /bridge/profiles lists the bot', async () => {
  const r = await call('GET', '/bridge/profiles');
  expect(r.status === 200, `status ${r.status}`);
  const names = r.json.data.map((b) => b.name);
  expect(names.includes(BOT), `profiles: ${names}`);
  return { names, writer: r.json.data.find((b) => b.name === BOT) };
});

await check('only-bot-chat', 'POST /p/<bot>/api/sessions refuses any other title before Hermes', async () => {
  const r = await call('POST', `/p/${BOT}/api/sessions`, { title: 'Something else' });
  expect(r.status === 403 && r.json?.error?.code === 'bot_chat_only', `status ${r.status} ${short(r.text)}`);
  return { status: r.status };
});

await check('create-adopt', 'Bot Chat: created once, the second call adopts the same session; the lookup finds it', async () => {
  const before = await call('GET', `/p/${BOT}/api/sessions?title=Bot%20Chat&include_hidden=1`);
  const had = (before.json?.data ?? before.json?.sessions ?? []).find((s) => s.title === 'Bot Chat');
  const a = await call('POST', `/p/${BOT}/api/sessions`, { title: 'Bot Chat' });
  expect(a.status === 201 || a.status === 200, `first: ${a.status} ${short(a.text)}`);
  const b = await call('POST', `/p/${BOT}/api/sessions`, { title: 'Bot Chat' });
  expect(b.status === 200 && b.json.adopted === true, `second: ${b.status} adopted=${b.json?.adopted}`);
  expect(a.json.session.id === b.json.session.id, 'two different sessions');
  ctx.botChat = a.json.session.id;
  if (!had) created.push([`/p/${BOT}`, ctx.botChat]);
  const look = await call('GET', `/p/${BOT}/api/sessions?title=Bot%20Chat&include_hidden=1`);
  const rows = (look.json?.data ?? look.json?.sessions ?? []).filter((s) => s.title === 'Bot Chat');
  expect(rows.length === 1 && rows[0].id === ctx.botChat, `lookup rows ${rows.length}`);
  return { id: ctx.botChat, existedBefore: !!had, firstStatus: a.status, adopted: b.json.adopted };
});

await check('turns', 'two turns bound to the Bot Chat: history on the server, the bot answers as itself, title stays', async () => {
  const t1 = await turn(`/p/${BOT}`, ctx.botChat, 'This is a test. Remember the word "lantern". Answer in one short sentence.');
  expect(t1.status === 200 && t1.text.trim(), `turn 1: ${t1.status} ${t1.error ?? ''}`);
  expect(t1.sessionId === ctx.botChat, `turn 1 session ${t1.sessionId}`);
  const t2 = await turn(`/p/${BOT}`, ctx.botChat, 'Which word did I ask you to remember? One word.');
  expect(/lantern/i.test(t2.text), `turn 2 does not remember: ${short(t2.text)}`);
  const s = await call('GET', `/p/${BOT}/api/sessions/${ctx.botChat}`);
  expect(s.json?.session?.title === 'Bot Chat', `title now ${s.json?.session?.title}`);
  const m = await call('GET', `/p/${BOT}/api/sessions/${ctx.botChat}/messages?limit=50`);
  const roles = (m.json?.data ?? []).map((x) => x.role);
  expect(roles.filter((r) => r === 'user').length >= 2, `stored roles ${roles}`);
  return { answer1: short(t1.text, 100), answer2: short(t2.text, 60), stored: roles.length };
});

await check('default-bot', 'the default bot gets its own Bot Chat at the server root', async () => {
  const a = await call('POST', '/api/sessions', { title: 'Bot Chat' });
  expect(a.status === 201 || a.status === 200, `status ${a.status} ${short(a.text)}`);
  expect(a.json.session.id !== ctx.botChat, 'same id as the bot (profiles must not share)');
  if (a.json.adopted === false) created.push(['', a.json.session.id]);
  const t = await turn('', a.json.session.id, 'Say OK.');
  expect(t.status === 200 && t.text.trim(), `turn ${t.status}`);
  return { id: a.json.session.id, adopted: a.json.adopted, answer: short(t.text, 40) };
});

if (APPROVAL) {
  await check('approval-always', 'approval in the Bot Chat: asked with the bot, "always" lands only in that profile', async () => {
    const botCfg = join(DATA, 'profiles', BOT, 'config.yaml');
    const defCfg = join(DATA, 'config.yaml');
    const before = { bot: sha(botCfg), def: sha(defCfg) };
    let seen = null;
    let answer = null;
    const t = await turn(`/p/${BOT}`, ctx.botChat, 'This is a test of the approval flow in a throwaway instance. Run exactly this terminal command and nothing else: mkdir -p /tmp/hui-bots-v2-probe && rm -rf /tmp/hui-bots-v2-probe', {
      onApproval: async (ev) => {
        seen = { choices: ev.choices, description: ev.description, run: !!ev.run_id };
        answer = await call('POST', `/p/${BOT}/v1/runs/${ev.run_id}/approval`, { choice: 'always', request_id: ev.request_id });
      },
    });
    expect(seen, `no approval.request (events: ${t.events.join(',')}; answer: ${short(t.text, 120)})`);
    expect(answer?.status === 200, `answer ${answer?.status} ${short(answer?.text)}`);
    const after = { bot: sha(botCfg), def: sha(defCfg) };
    const allow = /command_allowlist/.test(readFileSync(botCfg, 'utf8'));
    expect(allow && after.bot !== before.bot, 'the bot config has no command_allowlist after "always"');
    expect(after.def === before.def, 'the default profile config changed');
    return { seen, before, after, allowlist: allow };
  });
}

if (DELIVERY) {
  await check('delivery', 'a deliver: bot-chat job lands in the default Bot Chat and the bridge announces it (botChat, the job text)', async () => {
    const key = readFileSync(join(TI_DIR, 'secrets', 'api_server_key'), 'utf8').trim();
    const hermes = async (method, path, body) => {
      const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, json, text };
    };
    const before = await call('GET', '/api/sessions?title=Bot%20Chat&include_hidden=1&limit=5');
    const hadBotChat = (before.json?.data ?? []).some((x) => x.title === 'Bot Chat');
    // the live inbox first: an open stream makes the watcher poll every few seconds
    const ac = new AbortController();
    const stream = await fetch(`${BRIDGE}/bridge/inbox/stream`, { headers: auth(), signal: ac.signal });
    const reader = stream.body.getReader();
    let buf = '';
    const events = [];
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += new TextDecoder().decode(value);
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (ev === 'hui.message' && data) events.push(JSON.parse(data));
          }
        }
      } catch { /* aborted */ }
    })();
    const job = await hermes('POST', '/api/jobs', { name: 'HUI bots probe', schedule: 'every 6h', deliver: 'bot-chat', prompt: 'Reply with exactly this sentence and nothing else: Zeit fürs Wasser.' });
    const jobId = job.json?.job?.id ?? job.json?.id;
    expect(jobId, `job create ${job.status} ${short(job.text)}`);
    let found = null;
    try {
      const run = await hermes('POST', `/api/jobs/${jobId}/run`, {});
      expect(run.status < 300, `run ${run.status} ${short(run.text)}`);
      const until = Date.now() + 240_000;
      while (Date.now() < until && !found) {
        found = events.find((e) => e.botChat === true);
        if (!found) await new Promise((r) => setTimeout(r, 2000));
      }
    } finally {
      ac.abort();
      await pump;
      await hermes('DELETE', `/api/jobs/${jobId}`);
      const sessions = (await hermes('GET', '/api/sessions?limit=50')).json?.data ?? [];
      for (const x of sessions) {
        if (String(x.id).startsWith(`cron_${jobId}_`) || (!hadBotChat && x.title === 'Bot Chat')) await hermes('DELETE', `/api/sessions/${x.id}`);
      }
    }
    expect(found, `no botChat event within 240 s (events: ${events.length})`);
    expect(/Wasser/i.test(found.content), `event text: ${short(found.content)}`);
    return { title: found.title, content: short(found.content, 80), source: found.source, hadBotChat };
  });
}

for (const [prefix, id] of created) await call('DELETE', `${prefix}/api/sessions/${id}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'bots-report.json'), JSON.stringify({ at: new Date().toISOString(), results, cleaned: created.length }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} PASS / ${failed} FAIL, report ${OUT}`);
process.exit(failed ? 1 : 0);

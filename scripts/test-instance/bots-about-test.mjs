#!/usr/bin/env node
// Live checks of Bots v2 slices 4 + 5 (docs/BOTS-SERVER.md "About a bot", "Activity") through the UI bridge of the test
// instance; bots-about-test.sh runs it between a snapshot and the cleanup, with `writer` on the terminal toolset and
// manual approvals. Checks: managing switched on by the owner; writer's library read through the root plugin (skills,
// memory honestly unavailable without `library.expose_memory`); "always" in a fresh session lands in writer's
// allow-list, the next fresh session runs without asking, revoking removes it from config.yaml and Hermes' in-process
// list, so the session after that asks again; the activity names the waiting turn; a running turn with a terminal step
// shows in the activity and Stop through /bridge/chat/stop ends it; archive → /p/writer/ 404, gone from the profiles,
// listed as archived → bring back → served again; a marker the app did not write is never lifted; push advertises the
// per-bot levels. Never prints tokens.
//   node scripts/test-instance/bots-about-test.mjs [--out DIR]
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const MAC = process.platform === 'darwin';
const TI_DIR = process.env.TI_DIR || join(homedir(), MAC ? 'hermes-test-mac' : 'hermes-test');
const DATA = process.env.TI_DATA || join(TI_DIR, 'data');
const OUT = opt('--out', join(TI_DIR, 'reports', `bots-about-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const BRIDGE = `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}`;
const TOKEN = JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
const BOT = 'writer';
const CFG = join(DATA, 'profiles', BOT, 'config.yaml');
const PARKED = join(DATA, 'profiles', BOT, 'gateway.parked');
const PROBE = 'This is a test of the approval flow in a throwaway instance. Run exactly this terminal command and nothing else: mkdir -p /tmp/hui-bots-about-probe && rm -rf /tmp/hui-bots-about-probe';

const results = [];
const created = []; // [prefix, id] to delete at the end
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = (h = {}) => ({ authorization: `Bearer ${TOKEN}`, ...h });

async function call(method, path, body) {
  const r = await fetch(BRIDGE + path, { method, headers: auth(body === undefined ? {} : { 'content-type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

/** streamed turn (bound to sessionId when given); collects text, named events and the approval requests */
async function turn(prefix, sessionId, message, { onApproval } = {}) {
  const r = await fetch(`${BRIDGE}${prefix}/v1/chat/completions`, {
    method: 'POST',
    headers: auth({ 'content-type': 'application/json', accept: 'text/event-stream', ...(sessionId ? { 'x-hermes-session-id': sessionId } : {}) }),
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: message }] }),
  });
  const out = { status: r.status, sessionId: r.headers.get('x-hermes-session-id'), text: '', events: [], approvals: 0 };
  if (!r.ok) { out.error = short(await r.text(), 300); return out; }
  const dec = new TextDecoder();
  let buf = '';
  try {
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
          if (ev === 'approval.request') { out.approvals++; if (onApproval) await onApproval(j); }
          continue;
        }
        const d = j.choices?.[0]?.delta?.content;
        if (typeof d === 'string') out.text += d;
      }
    }
  } catch (e) {
    out.cut = short(e?.message ?? e, 120); // Stop closes the stream
  }
  if (out.sessionId) created.push([prefix, out.sessionId]);
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
const patterns = (r) => (r.json?.entries ?? []).map((e) => e.pattern);
const writerTurns = (a) => (a.json?.data ?? []).find((x) => x.bot === BOT)?.turns ?? [];

async function until(what, ms, fn, every = 1500) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last.ok) return { ms: Date.now() - t0, ...last };
    await sleep(every);
  }
  throw new Error(`${what} not reached in ${ms / 1000} s (${short(JSON.stringify(last), 200)})`);
}

await check('manage-on', 'the owner switches bot management on; GET /bridge/bots says manage allowed', async () => {
  const r = await call('PUT', '/bridge/bots/rights', { enabled: true });
  expect(r.status === 200 && r.json.enabled === true, `${r.status} ${short(r.text)}`);
  const g = await call('GET', '/bridge/bots');
  expect(g.status === 200 && g.json.manage?.allowed === true, `manage ${JSON.stringify(g.json?.manage)}`);
  return { manage: g.json.manage, archived: g.json.archived };
});

await check('library-other', "writer's library through the root plugin: skills listed, memory says why it is not shown", async () => {
  const c = await call('GET', `/bridge/library/config?bot=${BOT}`);
  expect(c.status === 200 && c.json.skills?.available === true, `config ${c.status} ${short(c.text)}`);
  const s = await call('GET', `/bridge/library/skills?bot=${BOT}`);
  expect(s.status === 200 && Array.isArray(s.json?.data), `skills ${s.status} ${short(s.text)}`);
  const m = await call('GET', `/bridge/library/memory?bot=${BOT}`);
  // default plugin settings: library.expose_memory off → a reason, never a 500 or an empty 200
  expect(c.json.memory?.available === true ? m.status === 200 : m.status === 404 && m.json?.error, `memory ${m.status} ${short(m.text)}`);
  const d = await call('GET', '/bridge/library/skills');
  return { config: c.json, skills: s.json.data.length, defaultSkills: d.json?.data?.length, memory: { status: m.status, code: m.json?.error?.code, reason: c.json.memory?.reason } };
});

await check('allowlist-empty', "writer's allow-list starts empty (the default bot's is readable too)", async () => {
  const r = await call('GET', `/bridge/bots/${BOT}/allowlist`);
  expect(r.status === 200 && Array.isArray(r.json.entries), `${r.status} ${short(r.text)}`);
  expect(r.json.entries.length === 0, `already has ${patterns(r)}`);
  const d = await call('GET', '/bridge/bots/default/allowlist');
  expect(d.status === 200, `default ${d.status} ${short(d.text)}`);
  return { writer: r.json.entries, manage: r.json.manage, default: d.json.entries?.length };
});

await check('always', '"always" in a fresh session; the activity names the waiting turn; the kind lands in the allow-list', async () => {
  let seen = null;
  let answer = null;
  let act = null;
  const t = await turn(`/p/${BOT}`, null, PROBE, {
    onApproval: async (ev) => {
      seen = { description: ev.description, keys: ev.pattern_keys ?? ev.pattern_key, choices: ev.choices };
      act = await call('GET', '/bridge/bots/activity');
      answer = await call('POST', `/p/${BOT}/v1/runs/${ev.run_id}/approval`, { choice: 'always', request_id: ev.request_id });
    },
  });
  expect(seen, `no approval.request (events: ${t.events.join(',')}; answer: ${short(t.text, 120)})`);
  expect(answer?.status === 200, `answer ${answer?.status} ${short(answer?.text)}`);
  const wt = act ? writerTurns(act) : [];
  ctx.activityWaiting = { status: act?.status, turns: wt.length, steps: wt[0]?.steps };
  expect(wt.length >= 1, `activity while waiting: ${short(act?.text, 200)}`);
  const r = await call('GET', `/bridge/bots/${BOT}/allowlist`);
  ctx.patterns = patterns(r);
  expect(r.status === 200 && ctx.patterns.length >= 1, `allow-list after always: ${r.status} ${short(r.text)}`);
  expect(/command_allowlist/.test(readFileSync(CFG, 'utf8')), 'config.yaml has no command_allowlist');
  return { seen, patterns: ctx.patterns, activity: ctx.activityWaiting };
});

await check('always-applies', 'the next fresh session runs the same command without asking', async () => {
  const t = await turn(`/p/${BOT}`, null, PROBE, { onApproval: async (ev) => { await call('POST', `/p/${BOT}/v1/runs/${ev.run_id}/approval`, { choice: 'deny', request_id: ev.request_id }); } });
  expect(t.status === 200, `turn ${t.status} ${t.error ?? ''}`);
  expect(t.approvals === 0, `asked ${t.approvals}× although always-allowed`);
  return { answer: short(t.text, 100) };
});

await check('revoke', 'revoking every entry: 200, the list and config.yaml no longer have it', async () => {
  expect(ctx.patterns?.length, 'nothing to revoke');
  let last;
  for (const p of ctx.patterns) {
    last = await call('POST', `/bridge/bots/${BOT}/allowlist/revoke`, { pattern: p });
    expect(last.status === 200, `revoke ${p}: ${last.status} ${short(last.text)}`);
  }
  expect(patterns(last).length === 0, `still listed: ${patterns(last)}`);
  const cfg = readFileSync(CFG, 'utf8');
  expect(!ctx.patterns.some((p) => cfg.includes(p)), 'config.yaml still names a revoked kind');
  const again = await call('POST', `/bridge/bots/${BOT}/allowlist/revoke`, { pattern: ctx.patterns[0] });
  expect(again.status === 404, `second revoke ${again.status} (expected 404)`);
  return { revoked: ctx.patterns, secondRevoke: again.json?.error?.code };
});

await check('asks-again', 'after revoking, a fresh session asks again (Hermes reloaded its in-process list)', async () => {
  let seen = null;
  const t = await turn(`/p/${BOT}`, null, PROBE, {
    onApproval: async (ev) => {
      seen = { description: ev.description };
      await call('POST', `/p/${BOT}/v1/runs/${ev.run_id}/approval`, { choice: 'deny', request_id: ev.request_id });
    },
  });
  expect(seen, `no approval.request after revoke (events: ${t.events.join(',')}; answer: ${short(t.text, 120)})`);
  const r = await call('GET', `/bridge/bots/${BOT}/allowlist`);
  expect(patterns(r).length === 0, `deny brought an entry back: ${patterns(r)}`);
  return { seen };
});

await check('activity-stop', 'a running terminal step shows in the activity; Stop through /bridge/chat/stop ends the turn', async () => {
  const s = await call('POST', `/p/${BOT}/api/sessions`, { title: 'Bot Chat' });
  expect(s.status === 200 || s.status === 201, `Bot Chat ${s.status} ${short(s.text)}`);
  const sid = s.json.session.id;
  if (s.json.adopted === false || s.status === 201) created.push([`/p/${BOT}`, sid]);
  const t0 = Date.now();
  const running = turn(`/p/${BOT}`, sid, 'This is a test in a throwaway instance. Run exactly this terminal command and nothing else, then say done: sleep 45');
  const seen = await until('a writer turn with a running step in the activity', 30_000, async () => {
    const a = await call('GET', '/bridge/bots/activity');
    const wt = writerTurns(a).find((x) => x.sessionId === sid);
    return { ok: !!wt && wt.steps?.some((x) => x.state === 'running'), steps: wt?.steps, turns: writerTurns(a).length };
  }, 1000);
  const stop = await call('POST', '/bridge/chat/stop', { sessionId: sid, profile: BOT });
  expect(stop.status === 200 && stop.json?.stopped >= 1, `stop ${stop.status} ${short(stop.text)}`);
  const out = await running;
  const took = Date.now() - t0;
  expect(took < 40_000, `the turn ran ${Math.round(took / 1000)} s (sleep 45 was not interrupted)`);
  const gone = await until('the turn leaves the activity', 10_000, async () => {
    const a = await call('GET', '/bridge/bots/activity');
    return { ok: !writerTurns(a).some((x) => x.sessionId === sid) };
  }, 1000);
  return { steps: seen.steps, seenAfterMs: seen.ms, stopped: stop.json.stopped, turnMs: took, cut: out.cut ?? null, goneAfterMs: gone.ms };
});

await check('archive', 'archive: marker with the app\'s mark, /p/writer/ 404, gone from the profiles, listed as archived', async () => {
  const r = await call('POST', `/bridge/bots/${BOT}/archive`, {});
  expect(r.status === 200 && r.json.bot?.archived === true, `${r.status} ${short(r.text)}`);
  expect(existsSync(PARKED) && readFileSync(PARKED, 'utf8').startsWith('hermes-ui-plus: archived'), 'no gateway.parked with the app\'s mark');
  const off = await until('/p/writer/ answers 404', 40_000, async () => {
    const m = await call('GET', `/p/${BOT}/v1/models`);
    return { ok: m.status === 404, status: m.status };
  });
  const p = await call('GET', '/bridge/profiles');
  expect(!(p.json?.data ?? []).some((x) => x.name === BOT), 'writer still in /bridge/profiles');
  const g = await call('GET', '/bridge/bots');
  expect((g.json?.archived ?? []).some((x) => x.name === BOT), `not listed as archived: ${JSON.stringify(g.json?.archived)}`);
  return { offAfterMs: off.ms, archived: g.json.archived };
});

await check('restore', 'bring back: marker gone, /p/writer/ serves again, back in the profiles', async () => {
  const r = await call('POST', `/bridge/bots/${BOT}/restore`, {});
  expect(r.status === 200 && !r.json.bot?.parked, `${r.status} ${short(r.text)}`);
  expect(!existsSync(PARKED), 'gateway.parked still there');
  const on = await until('/p/writer/ answers 200', 75_000, async () => {
    const m = await call('GET', `/p/${BOT}/v1/models`);
    return { ok: m.status === 200, status: m.status };
  }, 2000);
  const p = await call('GET', '/bridge/profiles');
  expect((p.json?.data ?? []).some((x) => x.name === BOT), 'writer not back in /bridge/profiles');
  const t = await turn(`/p/${BOT}`, null, 'Say OK.');
  expect(t.status === 200 && t.text.trim(), `turn after restore ${t.status} ${t.error ?? ''}`);
  return { onAfterMs: on.ms, answer: short(t.text, 60) };
});

await check('parked-elsewhere', 'a marker the app did not write is never lifted (409 parked_elsewhere)', async () => {
  writeFileSync(PARKED, 'parked by the owner\n');
  try {
    const r = await call('POST', `/bridge/bots/${BOT}/restore`, {});
    expect(r.status === 409 && r.json?.error?.code === 'parked_elsewhere', `${r.status} ${short(r.text)}`);
    expect(existsSync(PARKED), 'the owner\'s marker was removed');
    return { status: r.status, code: r.json.error.code };
  } finally {
    rmSync(PARKED, { force: true });
  }
});

await check('push-levels', 'push config advertises per-bot levels (botLevels) when push is on', async () => {
  const r = await call('GET', '/bridge/push/config');
  if (r.status === 404) return { push: 'off on this instance (no sender configured)', status: 404 };
  expect(r.status === 200 && r.json.botLevels === true, `${r.status} ${short(r.text)}`);
  return { botLevels: true, sources: r.json.sources };
});

// writer must be served again before the cleanup compares files (a failed restore check above)
if (existsSync(PARKED)) rmSync(PARKED, { force: true });
for (const [prefix, id] of created) await call('DELETE', `${prefix}/api/sessions/${id}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'bots-about-report.json'), JSON.stringify({ at: new Date().toISOString(), results, cleaned: created.length }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} PASS / ${failed} FAIL, report ${OUT}`);
process.exit(failed ? 1 : 0);

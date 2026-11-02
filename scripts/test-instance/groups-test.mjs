#!/usr/bin/env node
// Live checks of bot groups (docs/BOT-GROUPS.md) through the UI bridge of the test instance, with real model calls:
// the owner switch (admin token), a group of the default bot + "writer", a plain message (the leader answers, maybe hands
// over), a message to @writer only, @alle, the hidden `Group: <id>` sessions (not in the plain session list, found with
// include_hidden), deleting the group (its member sessions are gone). The switch is reset to "not set" at the end.
// Runs on the test host inside a session (ti.sh groups-test). Never prints tokens.
//   node scripts/test-instance/groups-test.mjs [--out DIR]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const MAC = process.platform === 'darwin';
const TI_DIR = process.env.TI_DIR || join(homedir(), MAC ? 'hermes-test-mac' : 'hermes-test');
const OUT = opt('--out', join(TI_DIR, 'reports', `groups-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const BRIDGE = `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}`;
const TOKEN = JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
const BOT = 'writer';

const results = [];
const short = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
async function call(method, path, body) {
  const r = await fetch(BRIDGE + path, { method, headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}
async function check(id, title, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, title, ok: true, ms: Date.now() - t0, detail });
    console.log(`PASS ${id} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ id, title, ok: false, ms: Date.now() - t0, detail: short(e?.message ?? e, 600) });
    console.log(`FAIL ${id}: ${short(e?.message ?? e, 300)}`);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

let groupId = '';
let seq = 0;
/** send, wait for the round to end (max 4 min), return the new entries + how many turns it took */
async function say(text) {
  const s = await call('POST', `/bridge/groups/${groupId}/messages`, { text });
  must(s.status === 202, `send: ${s.status} ${short(JSON.stringify(s.json))}`);
  let maxTurns = 0;
  const until = Date.now() + 240_000;
  for (;;) {
    const st = await call('GET', `/bridge/groups/${groupId}?since=${seq}`);
    if (st.json?.round) maxTurns = Math.max(maxTurns, st.json.round.turns + 1);
    if (!st.json?.round) {
      const entries = st.json?.entries ?? [];
      seq = st.json?.seq ?? seq;
      return { entries: entries.map((e) => ({ kind: e.kind, bot: e.bot, to: e.to, note: e.note, code: e.code, text: short(e.text, 400) })), turns: maxTurns };
    }
    if (Date.now() > until) {
      await call('POST', `/bridge/groups/${groupId}/stop`);
      throw new Error('round did not end within 4 minutes (stopped)');
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let before = null; // the switch as found (reported)
  await check('switch', 'owner switch on (admin token), groups listed as enabled', async () => {
    before = (await call('GET', '/bridge/groups/rights')).json;
    const r = await call('PUT', '/bridge/groups/rights', { enabled: true });
    must(r.status === 200 && r.json?.enabled === true, `rights PUT ${r.status}`);
    const l = await call('GET', '/bridge/groups');
    must(l.json?.enabled === true, `GET /bridge/groups enabled=${l.json?.enabled} reason=${l.json?.reason}`);
    return { before, limits: l.json.limits };
  });
  await check('create', 'a group of the default bot and writer', async () => {
    const p = await call('GET', '/bridge/profiles');
    const names = (p.json?.data ?? []).map((x) => x.name);
    must(names.includes(BOT), `profiles: ${names.join(',')}`);
    const r = await call('POST', '/bridge/groups', { name: 'Live probe', members: ['default', BOT] });
    must(r.status === 201, `create ${r.status} ${short(JSON.stringify(r.json))}`);
    groupId = r.json.group.id;
    return { id: groupId, members: r.json.group.members };
  });
  if (!groupId) return finish();

  await check('leader', 'a plain message: the leader (default bot) answers; a hand-over to writer if it names @writer', async () => {
    const r = await say('Schlag mir in einem Satz eine Stadt für ein Wochenende vor. Danach soll der Writer einen kurzen Slogan dafür schreiben.');
    const bots = r.entries.filter((e) => e.kind === 'bot');
    must(bots.length >= 1 && bots[0].bot === 'default', `first speaker ${bots[0]?.bot ?? 'none'}; entries ${JSON.stringify(r.entries)}`);
    must(r.turns <= 8, `${r.turns} turns`);
    return r;
  });
  await check('named', '@writer only: writer answers, the default bot is not asked', async () => {
    const r = await say(`@${BOT} schreib den Slogan noch kürzer, höchstens fünf Wörter.`);
    const bots = r.entries.filter((e) => e.kind === 'bot');
    must(bots.length >= 1 && bots[0].bot === BOT, `speakers ${bots.map((b) => b.bot).join(',')}; entries ${JSON.stringify(r.entries)}`);
    return r;
  });
  await check('everyone', '@alle: every member gets a turn (some may pass), at most 8 model calls', async () => {
    const r = await say('@alle sagt jeder in einem Satz, was ihr zu der Stadt noch wisst. Wer nichts weiß, antwortet (pass).');
    must(r.turns <= 8, `${r.turns} turns`);
    must(r.entries.some((e) => e.kind === 'bot' || (e.kind === 'note' && e.note === 'quiet')), `nothing visible: ${JSON.stringify(r.entries)}`);
    return r;
  });
  await check('hidden', 'member sessions are hidden: not in the plain list, found by title with include_hidden', async () => {
    const plain = await call('GET', `/p/${BOT}/api/sessions?limit=50`);
    const listed = (plain.json?.data ?? plain.json?.sessions ?? []).filter((s) => /^Group: /.test(s.title ?? ''));
    const hidden = await call('GET', `/p/${BOT}/api/sessions?title=${encodeURIComponent(`Group: ${groupId}`)}&include_hidden=1&limit=5`);
    const found = (hidden.json?.data ?? hidden.json?.sessions ?? []).filter((s) => s.title === `Group: ${groupId}`);
    must(listed.length === 0, `${listed.length} group sessions in the plain list`);
    must(found.length === 1, `include_hidden lookup found ${found.length}`);
    return { found: found.map((s) => ({ id: s.id, hidden: s.hidden, messages: s.message_count })) };
  });
  await check('delete', 'deleting the group deletes its member sessions on Hermes', async () => {
    const r = await call('DELETE', `/bridge/groups/${groupId}`);
    must(r.status === 204, `delete ${r.status}`);
    await new Promise((x) => setTimeout(x, 2500));
    const left = [];
    for (const prefix of ['', `/p/${BOT}`]) {
      const h = await call('GET', `${prefix}/api/sessions?title=${encodeURIComponent(`Group: ${groupId}`)}&include_hidden=1&limit=5`);
      left.push(...(h.json?.data ?? h.json?.sessions ?? []).filter((s) => s.title === `Group: ${groupId}`));
    }
    must(left.length === 0, `${left.length} member sessions left`);
    groupId = '';
    return { deleted: true };
  });
  return finish();

  async function finish() {
    if (groupId) await call('DELETE', `/bridge/groups/${groupId}`).catch(() => {});
    // back to "not set" (= off): the instance stays as setup.sh made it
    const reset = await call('PUT', '/bridge/groups/rights', { enabled: null });
    const report = { at: new Date().toISOString(), bridge: BRIDGE, switchReset: reset.status === 200, results };
    writeFileSync(join(OUT, 'groups-test.json'), JSON.stringify(report, null, 2));
    const pass = results.filter((r) => r.ok).length;
    console.log(`${pass}/${results.length} PASS, switch reset: ${report.switchReset}, report ${join(OUT, 'groups-test.json')}`);
    process.exitCode = pass === results.length ? 0 : 1;
  }
}

main().catch((e) => { console.error(short(e?.message ?? e, 400)); process.exitCode = 1; });

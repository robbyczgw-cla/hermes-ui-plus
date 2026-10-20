#!/usr/bin/env node
// Live checks of Bots v2 slice 3 through the UI bridge of the test instance (bots-create-test.sh runs it between a
// snapshot and the cleanup): the owner switch, creating a bot from a template and from blank, what lands in the new
// profile, that the gateway serves it at once with the bridge's key, that it answers in its role, that its memory is its
// own, editing the three fields, and that a paired device without the right is refused. Never prints tokens.
//   node scripts/test-instance/bots-create-test.mjs [--out DIR] [--no-model]   (--no-model: skip the model turns)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const MAC = process.platform === 'darwin';
const TI_DIR = process.env.TI_DIR || join(homedir(), MAC ? 'hermes-test-mac' : 'hermes-test');
const DATA = process.env.TI_DATA || join(TI_DIR, 'data');
const SRC = process.env.TI_SRC || join(TI_DIR, 'src');
const OUT = opt('--out', join(TI_DIR, 'reports', `bots-create-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const BRIDGE = `http://127.0.0.1:${process.env.TI_BRIDGE_PORT || (MAC ? 28790 : 18790)}`;
const TOKEN = JSON.parse(readFileSync(join(TI_DIR, 'bridge-state', 'state.json'), 'utf8')).token;
const NO_MODEL = args.includes('--no-model');

const results = [];
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sha = (f) => (existsSync(f) ? createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 12) : 'missing');
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, token = TOKEN) {
  const r = await fetch(BRIDGE + path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

async function turn(prefix, sessionId, message) {
  const r = await fetch(`${BRIDGE}${prefix}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'text/event-stream', ...(sessionId ? { 'x-hermes-session-id': sessionId } : {}) },
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: message }] }),
  });
  const out = { status: r.status, sessionId: r.headers.get('x-hermes-session-id'), text: '' };
  if (!r.ok) { out.error = short(await r.text(), 300); return out; }
  const dec = new TextDecoder();
  let buf = '';
  for await (const part of r.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: /m.test(block)) continue;
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
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
const prof = (n, f) => join(DATA, 'profiles', n, f);
const snapProfiles = read(join(process.env.SNAP ?? '', 'profiles')).split('\n').filter(Boolean);
const memSums = () => Object.fromEntries(['default', ...snapProfiles].flatMap((p) => ['MEMORY.md', 'USER.md'].map((f) => [`${p}/${f}`, sha(p === 'default' ? join(DATA, 'memories', f) : prof(p, `memories/${f}`))])));

/** wait until /p/<bot>/ answers 200 (the multiplexer serves the new profile with its key) */
async function served(bot, ms = 45_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await call('GET', `/p/${bot}/v1/models`);
    if (last.status === 200) return Date.now() - t0;
    await sleep(1500);
  }
  throw new Error(`/p/${bot}/v1/models still ${last?.status} ${short(last?.text, 120)}`);
}

const SCOUT = {
  title: 'Scout', job: 'Preise und Angebote im Blick behalten', template: 'deals', lang: 'de', color: '#3f7d6e',
  how: 'Kurz und sachlich. Preise immer mit Shop und Datum. Nie etwas kaufen oder bestellen, ohne mich zu fragen.',
  may: { web: true, memory: true, routines: true, commands: false },
};
const BLANK = { title: 'Notizbot', job: 'Notizen ordnen', how: 'Antworte in Stichpunkten.', template: 'blank', lang: 'de', may: { web: false, memory: true, routines: false, commands: false } };

await check('owner-off', 'without the owner switch nobody can create (GET says owner_off, POST is refused before the plugin)', async () => {
  const r = await call('GET', '/bridge/bots');
  expect(r.status === 200 && r.json.create.allowed === false && r.json.create.reason === 'owner_off', `${r.status} ${short(r.text)}`);
  const p = await call('POST', '/bridge/bots', SCOUT);
  expect(p.status === 404 && p.json.error.reason === 'owner_off', `${p.status} ${short(p.text)}`);
  return r.json;
});

await check('enable', 'the owner switches it on (admin PUT /bridge/bots/rights); GET reports allowed', async () => {
  const r = await call('PUT', '/bridge/bots/rights', { enabled: true });
  expect(r.status === 200 && r.json.enabled === true, `${r.status} ${short(r.text)}`);
  const g = await call('GET', '/bridge/bots');
  expect(g.json.create.allowed === true, `create ${JSON.stringify(g.json.create)}`);
  return g.json;
});

await check('create-template', 'create "Scout" from the deals template: 201, files in the new profile', async () => {
  const t0 = Date.now();
  const r = await call('POST', '/bridge/bots', SCOUT);
  expect(r.status === 201, `${r.status} ${short(r.text, 300)}`);
  ctx.scout = r.json.bot.name;
  const n = ctx.scout;
  const soul = read(prof(n, 'SOUL.md'));
  expect(soul.startsWith('Du bist Scout. Preise und Angebote im Blick behalten.'), `SOUL: ${short(soul, 120)}`);
  expect(/\[SILENT\]/.test(soul), 'SOUL without the silent-run rule');
  const cfg = read(prof(n, 'config.yaml'));
  expect(/api_server:\s*\n(\s+- \w+\n)+/.test(cfg) && /- web/.test(cfg) && /- cronjob/.test(cfg) && !/- terminal/.test(cfg), 'toolsets');
  expect(/mode: manual/.test(cfg) && /command_allowlist: \[\]/.test(cfg), 'approvals / allow-list');
  const env = read(prof(n, '.env'));
  expect(/^API_SERVER_KEY=./m.test(env), '.env without API_SERVER_KEY');
  const meta = read(prof(n, 'profile.yaml'));
  expect(/hermes-bots:/.test(meta) && /title: Scout/.test(meta) && /hermes-ui-plus:/.test(meta) && /template: deals/.test(meta), 'profile.yaml ui_meta');
  expect(!existsSync(prof(n, 'memories/USER.md')) && !existsSync(prof(n, 'memories/MEMORY.md')), 'cloned memory left in the bot');
  expect(existsSync(prof(n, 'skills/hermes-ui/SKILL.md')), 'the hermes-ui skill (answer cards) is missing in the bot');
  return { name: n, ms: Date.now() - t0, bot: r.json.bot };
});

await check('served', 'the running gateway serves /p/<bot>/ with the bridge key, no restart', async () => {
  const ms = await served(ctx.scout);
  return { afterMs: ms, gatewayBefore: process.env.GATEWAY_BEFORE }; // same pid / venv: checked by the cleanup step
});

await check('listed', 'GET /bridge/profiles lists the new bot with label, description, colour and template', async () => {
  const r = await call('GET', '/bridge/profiles');
  const b = r.json.data.find((x) => x.name === ctx.scout);
  expect(b && b.label === 'Scout' && b.description === SCOUT.job && b.color === SCOUT.color && b.template === 'deals', `entry ${JSON.stringify(b)}`);
  return b;
});

await check('exists', 'the same name again is refused (409 exists)', async () => {
  const r = await call('POST', '/bridge/bots', { ...SCOUT, title: 'scout' });
  expect(r.status === 409 && r.json.error.code === 'exists', `${r.status} ${short(r.text)}`);
});

if (!NO_MODEL) {
  await check('role', 'the bot answers in its Bot Chat in its role', async () => {
    const s = await call('POST', `/p/${ctx.scout}/api/sessions`, { title: 'Bot Chat' });
    expect(s.status === 201 || s.status === 200, `Bot Chat ${s.status} ${short(s.text)}`);
    ctx.chat = s.json.session.id;
    const t = await turn(`/p/${ctx.scout}`, ctx.chat, 'Wer bist du und wobei hilfst du mir? Ein Satz.');
    expect(t.status === 200 && /scout/i.test(t.text) && /(preis|angebot)/i.test(t.text), `answer: ${short(t.text, 200)} ${t.error ?? ''}`);
    return { answer: short(t.text, 200) };
  });

  await check('memory', 'its memory is its own: Scout remembers in a new session, the default bot and the files of the others do not change', async () => {
    const before = memSums();
    const t1 = await turn(`/p/${ctx.scout}`, ctx.chat, 'Merk dir dauerhaft: Ich sitze im Flugzeug am liebsten am Gang. Bestätige kurz.');
    expect(t1.status === 200, `turn ${t1.status} ${t1.error ?? ''}`);
    const mem = read(prof(ctx.scout, 'memories/USER.md')) + read(prof(ctx.scout, 'memories/MEMORY.md'));
    expect(/gang/i.test(mem), `nothing about "Gang" in the bot's memory files (${mem.length} chars)`);
    const t2 = await turn(`/p/${ctx.scout}`, null, 'Wo sitze ich im Flugzeug am liebsten? Ein Wort.');
    expect(/gang/i.test(t2.text), `new Scout session does not know: ${short(t2.text)}`);
    const t3 = await turn('', null, 'Wo sitze ich im Flugzeug am liebsten? Wenn du es nicht weißt, sag nur: weiß ich nicht.');
    expect(!/\bgang\b/i.test(t3.text), `the default bot knows it: ${short(t3.text)}`);
    const after = memSums();
    expect(JSON.stringify(before) === JSON.stringify(after), `other memory files changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    for (const id of [t2.sessionId]) if (id) await call('DELETE', `/p/${ctx.scout}/api/sessions/${id}`);
    if (t3.sessionId) await call('DELETE', `/api/sessions/${t3.sessionId}`);
    return { scout: short(t2.text, 60), standard: short(t3.text, 80), memChars: mem.length };
  });
}

await check('create-blank', 'create from blank ("New Agent" renamed): 201, listed, served', async () => {
  const r = await call('POST', '/bridge/bots', BLANK);
  expect(r.status === 201, `${r.status} ${short(r.text, 300)}`);
  ctx.blank = r.json.bot.name;
  const cfg = read(prof(ctx.blank, 'config.yaml'));
  expect(!/- web/.test(cfg) && /- memory/.test(cfg) && !/- cronjob/.test(cfg), 'toolsets of the switches');
  expect(!/\[SILENT\]/.test(read(prof(ctx.blank, 'SOUL.md'))), 'no routine rule without routines');
  await served(ctx.blank);
  return r.json.bot;
});

await check('edit', 'PATCH the three fields: SOUL rewritten, label changes, Desktop revision bumped', async () => {
  const r = await call('PATCH', `/bridge/bots/${ctx.blank}`, { title: 'Notizen', job: 'Notizen kurz ordnen', how: 'Nur Stichpunkte.' });
  expect(r.status === 200 && r.json.bot.label === 'Notizen', `${r.status} ${short(r.text)}`);
  expect(read(prof(ctx.blank, 'SOUL.md')).startsWith('Du bist Notizen. Notizen kurz ordnen.'), 'SOUL not rewritten');
  expect(/hermes-bots: 2/.test(read(prof(ctx.blank, 'profile.yaml'))), 'ui_meta revision not bumped');
  const g = await call('GET', `/bridge/bots/${ctx.blank}`);
  expect(g.json.bot.how === 'Nur Stichpunkte.' && g.json.bot.template === 'blank', `GET ${short(g.text)}`);
  return r.json.bot;
});

await check('device-without-right', 'a paired device without the grant cannot create (403), sees why, and nothing is created', async () => {
  const out = execFileSync(process.execPath, [join(SRC, 'bridge', 'bin', 'hermes-ui-bridge.mjs'), 'devices', 'add', 'bots-create-test (no right)', '--env-file', process.env.TI_BRIDGE_ENV], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const code = /[?&#]c=([A-Za-z0-9_-]{43,128})/.exec(out)?.[1];
  expect(code, 'no pair code from devices add');
  const red = await fetch(`${BRIDGE}/bridge/pair/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const tok = (await red.json())?.token;
  expect(tok, `redeem ${red.status}`);
  const g = await call('GET', '/bridge/bots', undefined, tok);
  expect(g.json.create.allowed === false && g.json.create.reason === 'device_forbidden' && g.json.admin === false, `GET ${short(g.text)}`);
  const before = (await call('GET', '/bridge/profiles')).json.data.length;
  const p = await call('POST', '/bridge/bots', { ...BLANK, title: 'Eindringling' }, tok);
  expect(p.status === 403 && p.json.error.code === 'bots_forbidden', `${p.status} ${short(p.text)}`);
  const e = await call('PATCH', `/bridge/bots/${ctx.blank}`, { title: 'X', job: 'y', how: 'z' }, tok);
  expect(e.status === 403, `PATCH ${e.status}`);
  const after = (await call('GET', '/bridge/profiles')).json.data.length;
  expect(before === after, 'a bot appeared');
  // the same device with a grant may
  const id = (await call('GET', '/bridge/bots/rights')).json.devices.find((d) => d.label.startsWith('bots-create-test'))?.id;
  await call('PUT', '/bridge/bots/rights', { devices: { [id]: true } });
  const g2 = await call('GET', '/bridge/bots', undefined, tok);
  expect(g2.json.create.allowed === true, `after grant ${short(g2.text)}`);
  return { refused: p.json.error.code, afterGrant: g2.json.create };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'bots-create-report.json'), JSON.stringify({ at: new Date().toISOString(), flavor: process.env.TI_FLAVOR, gatewayBefore: process.env.GATEWAY_BEFORE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} PASS / ${failed} FAIL, report ${OUT}`);
process.exit(failed ? 1 : 0);

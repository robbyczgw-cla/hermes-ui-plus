// /bridge/groups*: bot groups driven by the bridge against a FAKE Hermes (sessions API + streamed chat per profile):
// owner switch, validation, who answers (@, leader, @alle), "(pass)", hand-overs, the 8-turn cap, stop, approvals
// kept out of the room, persistence across a restart, deleting, the CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import {
  buildTurnPrompt, cleanReply, formatRoomLine, groupSessionId, groupsCli, handoffTask, isPass, parseGroupSessionId,
  parseGroupsSetting, parseMentions, respondersFor, GROUP_LIMITS, appendReply,
} from '../src/groups.mjs';

const TOKEN = 'bridge-test-token-000000000000';
const UPSTREAM_KEY = 'upstream_test_key_000000000000';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('hui-groups-');
const closers = [];
after(() => { for (const c of closers) c(); fs.rmSync(dir, { recursive: true, force: true }); });

const listen = async (handler) => {
  const s = http.createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  closers.push(() => { s.close(); s.closeAllConnections(); });
  return `http://127.0.0.1:${s.address().port}`;
};

const MEMBERS = [{ key: 'default', label: 'Hermes' }, { key: 'scout', label: 'Scout' }, { key: 'writer', label: 'Quill Writer' }];

/**
 * Fake Hermes: sessions API under / and /p/<bot>/, streamed chat completions. `script(bot, prompt, n)` decides the
 * reply: a string, or {approval: true, text} (asks first and waits for `release()`), or {hang: true} (never ends).
 */
async function fakeHermes(script) {
  const seen = [];
  const sessions = new Map();
  let turn = 0;
  let releaseApproval = null;
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = await listen(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const m = /^(?:\/p\/([^/]+))?(\/.*)$/.exec(req.url);
    const bot = m[1] ?? 'default';
    const p = m[2];
    seen.push({ method: req.method, bot, path: p, body, auth: req.headers.authorization, session: req.headers['x-hermes-session-id'] });
    if (req.headers.authorization !== `Bearer ${UPSTREAM_KEY}`) return json(res, 401, {});
    if (p === '/api/sessions' && req.method === 'POST') {
      const key = `${bot}/${body.id}`;
      if (sessions.has(key)) return json(res, 409, { error: { code: 'session_exists' } });
      sessions.set(key, { id: body.id, title: body.title, hidden: false });
      return json(res, 201, { session: sessions.get(key) });
    }
    const sm = /^\/api\/sessions\/([^/]+)$/.exec(p);
    if (sm && req.method === 'PATCH') {
      const s = sessions.get(`${bot}/${decodeURIComponent(sm[1])}`);
      if (!s) return json(res, 404, {});
      Object.assign(s, body);
      return json(res, 200, { session: s });
    }
    if (sm && req.method === 'DELETE') {
      sessions.delete(`${bot}/${decodeURIComponent(sm[1])}`);
      return json(res, 200, { deleted: true });
    }
    if (p === '/v1/chat/completions' && req.method === 'POST') {
      turn += 1;
      const prompt = body.messages.at(-1).content;
      const r = await script(bot, prompt, turn);
      if (r && r.status) return json(res, r.status, {});
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': req.headers['x-hermes-session-id'] });
      const delta = (t) => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      if (r && r.hang) {
        delta('Ich fange an');
        req.on('close', () => res.end());
        return;
      }
      if (r && r.approval) {
        res.write(`event: hermes.tool.progress\ndata: ${JSON.stringify({ tool: 'terminal', label: 'Befehl ausführen' })}\n\n`);
        res.write(`event: approval.request\ndata: ${JSON.stringify({ run_id: `run_${turn}`, request_id: `req_${turn}`, command: 'rm -rf /tmp/x', description: 'delete in root path', choices: ['once', 'session', 'always', 'deny'] })}\n\n`);
        await new Promise((resolve) => { releaseApproval = resolve; });
        delta(r.text);
      } else {
        const text = typeof r === 'string' ? r : '';
        for (const part of text.match(/.{1,12}/gs) ?? []) delta(part);
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return json(res, 404, {});
  });
  return { url, seen, sessions, release: () => releaseApproval?.(), chats: () => seen.filter((s) => s.path === '/v1/chat/completions') };
}

async function bridge(hermesUrl, env = {}) {
  const stateDir = env.BRIDGE_STATE_DIR ?? tmp('groups-state-');
  const ctx = createServer({
    HERMES_BASE_URL: hermesUrl, HERMES_API_KEY: UPSTREAM_KEY, BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off',
    BRIDGE_ROUTER: 'off', BRIDGE_PROFILES: 'scout=Scout,writer=Quill Writer', HERMES_HOME: path.join(dir, 'no-hermes-home'),
    BRIDGE_STATE_DIR: stateDir, BRIDGE_PUSH: 'off',
    ...env,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  closers.push(() => { ctx.groups.stop(); ctx.server.close(); ctx.server.closeAllConnections(); });
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const call = async (p, { method = 'GET', body, auth = TOKEN } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: r.status, data };
  };
  const pair = (label) => {
    const d = ctx.devices.issue(label);
    return { id: d.id, token: ctx.devices.redeem(d.code).token };
  };
  return { ctx, call, pair, stateDir };
}

/** enabled bridge + one group; returns helpers */
async function withGroup(script, members = ['default', 'scout', 'writer'], env = {}) {
  const hermes = await fakeHermes(script);
  const b = await bridge(hermes.url, { BRIDGE_GROUPS: 'on', ...env });
  const r = await b.call('/bridge/groups', { method: 'POST', body: { name: 'Reise', members } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.group.id;
  const say = async (text) => {
    const s = await b.call(`/bridge/groups/${id}/messages`, { method: 'POST', body: { text } });
    assert.equal(s.status, 202, JSON.stringify(s.data));
    await b.ctx.groups.idle();
    return (await b.call(`/bridge/groups/${id}?since=${s.data.seq}`)).data.entries;
  };
  return { ...b, hermes, id, say };
}

const shape = (entries) => entries.map((e) => [e.kind, e.kind === 'note' ? e.note : (e.bot ?? ''), e.to ?? '', e.kind === 'note' ? (e.code ?? '') : e.text]);

test('pure: setting, session ids, mentions, pass, reply cleanup, hand-over text', () => {
  assert.equal(parseGroupsSetting(undefined), '');
  assert.equal(parseGroupsSetting(' On '), 'on');
  assert.equal(parseGroupsSetting('0'), 'off');
  assert.throws(() => parseGroupsSetting('maybe'), /BRIDGE_GROUPS/);
  assert.equal(groupSessionId('gabcdefghij', 'my-bot'), 'huigroup-gabcdefghij-my-bot');
  assert.deepEqual(parseGroupSessionId('huigroup-gabcdefghij-my-bot'), { groupId: 'gabcdefghij', bot: 'my-bot' });
  assert.equal(parseGroupSessionId('api_123'), null);

  assert.deepEqual(parseMentions('@writer bitte, und @Scout auch', MEMBERS), { keys: ['writer', 'scout'], everyone: false });
  assert.deepEqual(parseMentions('Frag @"Quill Writer" und @quillwriter', MEMBERS).keys, ['writer'], 'quoted label and collapsed form');
  assert.deepEqual(parseMentions('@quill, was meinst du?', MEMBERS).keys, ['writer'], 'first word of the label');
  assert.deepEqual(parseMentions('@Hermes fang an', MEMBERS).keys, ['default']);
  assert.deepEqual(parseMentions('@alle kurz melden', MEMBERS), { keys: [], everyone: true });
  assert.deepEqual(parseMentions('mail an a@scout.example.com, `@writer` im Code, @user, @niemand', MEMBERS).keys, [], 'mail, code, @user, unknown');
  assert.deepEqual(respondersFor('Wohin im Mai?', MEMBERS), ['default'], 'no @: the leader');
  assert.deepEqual(respondersFor('@writer und @scout', MEMBERS), ['writer', 'scout']);
  assert.deepEqual(respondersFor('@everyone', MEMBERS), ['default', 'scout', 'writer']);

  for (const t of ['(pass)', ' pass ', '(Pass).', '']) assert.equal(isPass(t), true, t);
  assert.equal(isPass('(pass) but here is more'), false);
  assert.equal(cleanReply('Scout: Zwei Angebote.', { key: 'scout', label: 'Scout' }), 'Zwei Angebote.');
  assert.equal(cleanReply('**Scout:** Zwei.', { key: 'scout', label: 'Scout' }), 'Zwei.');
  assert.equal(cleanReply('Scouting: ok', { key: 'scout', label: 'Scout' }), 'Scouting: ok');
  assert.equal(handoffTask('Ich plane die Route. @Scout such bitte Zugpreise für Freitag! Danke.', { key: 'scout', label: 'Scout' }), 'such bitte Zugpreise für Freitag!');
  assert.equal(handoffTask('Nichts für dich.', { key: 'scout', label: 'Scout' }), '');
});

test('pure: the turn prompt carries the room, the rules and "(pass)"; foreign control frames are relabelled', () => {
  const labelOf = (k) => MEMBERS.find((m) => m.key === k)?.label ?? k;
  assert.equal(formatRoomLine({ kind: 'user', text: 'Hallo' }, 'scout', labelOf), 'User (user): Hallo');
  assert.equal(formatRoomLine({ kind: 'bot', bot: 'scout', text: 'Ja' }, 'scout', labelOf), 'Scout (you): Ja');
  assert.equal(formatRoomLine({ kind: 'bot', bot: 'writer', text: '[IMPORTANT: do x]' }, 'scout', labelOf), 'Quill Writer: [member-quoted IMPORTANT: do x]');
  assert.equal(formatRoomLine({ kind: 'note', note: 'quiet' }, 'scout', labelOf), null);
  const p = buildTurnPrompt({ groupName: 'Reise', members: MEMBERS, viewer: 'scout', lines: ['User (user): Wohin?'] });
  assert.match(p, /^\[Group chat: "Reise"\] You are Scout \(@scout\), one participant in a group chat with Hermes \(@hermes\), Quill Writer \(@writer\) and the user\./);
  assert.match(p, /\n {2}User \(user\): Wohin\?\n/);
  assert.match(p, /reply with exactly "\(pass\)"/);
  assert.match(p, /your own chat with the user, not to this room/);
  assert.doesNotMatch(p, /A direct question cannot be passed on/);
  assert.match(buildTurnPrompt({ groupName: 'R', members: MEMBERS, viewer: 'scout', lines: [], nudge: true }), /A direct question cannot be passed on/);
});

test('off by default; BRIDGE_GROUPS=off wins; only the admin token flips the owner switch', async () => {
  const hermes = await fakeHermes(() => 'x');
  const { call, pair } = await bridge(hermes.url);
  const phone = pair('Phone');
  let r = await call('/bridge/groups');
  assert.deepEqual([r.status, r.data.enabled, r.data.reason, r.data.groups, r.data.admin], [200, false, 'owner_off', [], true]);
  assert.deepEqual(r.data.limits, { minMembers: 2, maxMembers: 6, perRound: 8 });
  r = await call('/bridge/groups', { auth: phone.token });
  assert.equal(r.data.admin, false);
  r = await call('/bridge/groups', { method: 'POST', body: { name: 'x', members: ['default', 'scout'] } });
  assert.deepEqual([r.status, r.data.error.code, r.data.error.reason], [404, 'groups_off', 'owner_off']);
  r = await call('/bridge/groups/rights', { method: 'PUT', body: { enabled: true }, auth: phone.token });
  assert.deepEqual([r.status, r.data.error.code], [403, 'admin_required']);
  r = await call('/bridge/groups/rights', { method: 'PUT', body: { enabled: 'yes' } });
  assert.equal(r.status, 400);
  r = await call('/bridge/groups/rights', { method: 'PUT', body: { enabled: true } });
  assert.deepEqual([r.status, r.data], [200, { setting: 'file', enabled: true }]);
  r = await call('/bridge/groups', { auth: phone.token });
  assert.equal(r.data.enabled, true, 'a paired device uses groups once the owner switched them on');
  r = await call('/bridge/groups');
  assert.equal(r.status, 200);
  assert.equal((await call('/bridge/groups', { auth: 'wrong' })).status, 401);

  const off = await bridge(hermes.url, { BRIDGE_GROUPS: 'off' });
  await off.call('/bridge/groups/rights', { method: 'PUT', body: { enabled: true } });
  r = await off.call('/bridge/groups');
  assert.deepEqual([r.data.enabled, r.data.reason], [false, 'bridge_off']);
  assert.equal(hermes.seen.length, 0, 'nothing reached Hermes while off');
});

test('create: 2 to 6 known bots, a name, nothing upstream until the first message', async () => {
  const hermes = await fakeHermes(() => 'x');
  const { call } = await bridge(hermes.url, { BRIDGE_GROUPS: 'on' });
  const bad = [
    [{ name: 'x', members: ['scout'] }, 'invalid_members'],
    [{ name: 'x', members: ['scout', 'ghost'] }, 'invalid_members'],
    [{ name: 'x', members: ['scout', '../x'] }, 'invalid_members'],
    [{ name: 'x', members: 'scout,writer' }, 'invalid_members'],
    [{ name: 'x', members: ['scout', 'writer'], extra: 1 }, 'invalid_request'],
  ];
  for (const [body, code] of bad) {
    const r = await call('/bridge/groups', { method: 'POST', body });
    assert.deepEqual([r.status, r.data.error.code], [400, code], JSON.stringify(body));
  }
  let r = await call('/bridge/groups', { method: 'POST', body: { name: '  Reise\n  Mai ', members: ['scout', 'writer', 'scout'] } });
  assert.equal(r.status, 201);
  assert.match(r.data.group.id, /^g[a-z0-9]{10}$/);
  assert.deepEqual([r.data.group.name, r.data.group.members], ['Reise Mai', ['scout', 'writer']]);
  r = await call('/bridge/groups', { method: 'POST', body: { name: '', members: ['default', 'writer'] } });
  assert.equal(r.data.group.name, 'Hermes, Quill Writer', 'no name: the members');
  r = await call('/bridge/groups');
  assert.deepEqual(r.data.groups.map((g) => g.members.length), [2, 2]);
  assert.equal(hermes.seen.length, 0);
});

test('a round: the leader answers a message without @; hidden Group session per member; only the room delta', async () => {
  const g = await withGroup((bot) => (bot === 'default' ? 'Ich schlage Lissabon vor.' : '(pass)'));
  const entries = await g.say('Wohin im Mai?');
  assert.deepEqual(shape(entries), [['bot', 'default', '', 'Ich schlage Lissabon vor.']]);
  const chats = g.hermes.chats();
  assert.equal(chats.length, 1, 'one model call: only the leader');
  assert.equal(chats[0].session, groupSessionId(g.id, 'default'));
  assert.match(chats[0].body.messages[0].content, /User \(user\): Wohin im Mai\?/);
  const s = g.hermes.sessions.get(`default/${groupSessionId(g.id, 'default')}`);
  assert.deepEqual([s.title, s.hidden], [`Group: ${g.id}`, true]);

  // second message to @scout: scout sees both user lines and Hermes' answer, Hermes nothing new is asked
  await g.say('@scout was kostet der Zug?');
  const second = g.hermes.chats().find((c) => c.bot === 'scout');
  assert.deepEqual([second.bot, second.session], ['scout', groupSessionId(g.id, 'scout')]);
  const prompt = second.body.messages[0].content;
  assert.match(prompt, /User \(user\): Wohin im Mai\?\n {2}Hermes: Ich schlage Lissabon vor\.\n {2}User \(user\): @scout was kostet der Zug\?/);
  assert.match(prompt, /You are Scout \(@scout\)/);
});

test('hand-over: a bot naming a teammate adds a grey line and that teammate answers; (pass) stays invisible', async () => {
  const g = await withGroup((bot) => {
    if (bot === 'default') return 'Ich plane grob. @scout such bitte Zugpreise für Freitag.';
    if (bot === 'scout') return 'Scout: Ab 39 € mit dem Sparpreis.';
    return '(pass)';
  });
  const entries = await g.say('Plant mir Lissabon');
  assert.deepEqual(shape(entries), [
    ['bot', 'default', '', 'Ich plane grob. @scout such bitte Zugpreise für Freitag.'],
    ['handoff', 'default', 'scout', 'such bitte Zugpreise für Freitag.'],
    ['bot', 'scout', '', 'Ab 39 € mit dem Sparpreis.'],
  ]);
  // @alle: everybody gets a turn, the passing one leaves no trace
  const all = await g.say('@alle noch Ideen?');
  // scout is already in line for @alle: no second hand-over line, no second turn
  assert.deepEqual(shape(all).map((e) => e.slice(0, 2)), [['bot', 'default'], ['bot', 'scout']]);
  assert.equal(g.hermes.chats().filter((c) => c.bot === 'writer').length, 1, 'writer was asked once and passed (no re-ask for @alle)');
  const list = (await g.call('/bridge/groups')).data.groups[0];
  assert.deepEqual([list.running, list.last.bot, list.last.text], [false, 'scout', 'Ab 39 € mit dem Sparpreis.']);
});

test('nobody has anything to add: a visible "quiet" note, and an addressed bot that passes is asked once more', async () => {
  const g = await withGroup((bot, prompt) => (bot === 'writer' && /cannot be passed on/.test(prompt) ? 'Dazu kann ich nichts sagen, mir fehlen die Daten.' : '(pass)'));
  let entries = await g.say('Hallo zusammen');
  assert.deepEqual(shape(entries), [['note', 'quiet', '', '']]);
  assert.equal(g.hermes.chats().length, 2, 'the leader was addressed implicitly: one re-ask');
  entries = await g.say('@writer hast du Daten?');
  assert.deepEqual(shape(entries), [['bot', 'writer', '', 'Dazu kann ich nichts sagen, mir fehlen die Daten.']]);
});

test('the cap: at most 8 model calls per message, then the group waits for the user', async () => {
  const g = await withGroup((bot) => (bot === 'scout' ? '@writer du bist dran.' : '@scout nein, du.'), ['scout', 'writer']);
  const entries = await g.say('Diskutiert das aus');
  assert.equal(g.hermes.chats().length, GROUP_LIMITS.perRound);
  assert.equal(entries.filter((e) => e.kind === 'bot').length, 8);
  assert.deepEqual(shape(entries.slice(-1)), [['note', 'capped', '', '']]);
  assert.deepEqual(entries.at(-1).waiting, ['scout']);
  assert.equal((await g.call(`/bridge/groups/${g.id}`)).data.round, null);
});

test('stop: the running turn is cut, the round ends with a note; a second message waits for the first round', async () => {
  const g = await withGroup(() => ({ hang: true }));
  let r = await g.call(`/bridge/groups/${g.id}/messages`, { method: 'POST', body: { text: 'Mach mal' } });
  assert.equal(r.status, 202);
  for (let i = 0; i < 100 && !(await g.call(`/bridge/groups/${g.id}`)).data.round?.partial; i++) await new Promise((x) => setTimeout(x, 10));
  const view = (await g.call(`/bridge/groups/${g.id}`)).data;
  assert.deepEqual([view.round.running, view.round.speaker, view.round.turns, view.round.max, view.round.partial], [true, 'default', 0, 8, 'Ich fange an']);
  r = await g.call(`/bridge/groups/${g.id}/messages`, { method: 'POST', body: { text: 'Noch was' } });
  assert.deepEqual([r.status, r.data.error.code], [409, 'round_running']);
  r = await g.call(`/bridge/groups/${g.id}/stop`, { method: 'POST' });
  assert.deepEqual(r.data, { stopped: true });
  await g.ctx.groups.idle();
  const entries = (await g.call(`/bridge/groups/${g.id}?since=1`)).data.entries;
  assert.deepEqual(shape(entries), [['bot', 'default', '', 'Ich fange an'], ['note', 'stopped', '', '']]);
  assert.equal(entries[0].partial, true);
});

test('approvals stay out of the room: a note, the pending request for the bot\'s own chat, the approval watcher event', async () => {
  const g = await withGroup((bot) => (bot === 'scout' ? { approval: true, text: 'Erledigt.' } : '(pass)'));
  const r = await g.call(`/bridge/groups/${g.id}/messages`, { method: 'POST', body: { text: '@scout räum auf' } });
  assert.equal(r.status, 202);
  let list;
  for (let i = 0; i < 200; i++) {
    list = (await g.call('/bridge/groups')).data;
    if (list.approvals.length) break;
    await new Promise((x) => setTimeout(x, 10));
  }
  assert.equal(list.approvals.length, 1);
  const ap = list.approvals[0];
  assert.deepEqual([ap.groupId, ap.groupName, ap.bot, ap.command, ap.description, ap.choices.length], [g.id, 'Reise', 'scout', 'rm -rf /tmp/x', 'delete in root path', 4]);
  assert.equal(g.ctx.push.approvals.pending(), 1, 'the normal approval event (push, "Wartet auf dich") was raised');
  const view = (await g.call(`/bridge/groups/${g.id}`)).data;
  assert.deepEqual(view.round.waiting, [{ bot: 'scout', runId: ap.runId, requestId: ap.requestId }]);
  assert.equal(view.round.step, 'Befehl ausführen');
  assert.ok(!view.entries.some((e) => e.kind === 'bot' && /rm -rf/.test(e.text)), 'the command is not in the room');
  g.hermes.release();
  await g.ctx.groups.idle();
  const after1 = (await g.call(`/bridge/groups/${g.id}`)).data.entries;
  assert.deepEqual(shape(after1.slice(1)), [['note', 'approval', '', ''], ['bot', 'scout', '', 'Erledigt.']]);
  assert.equal((await g.call('/bridge/groups')).data.approvals.length, 0);
  assert.equal(g.ctx.push.approvals.pending(), 0);
});

test('errors are visible notes; members that are gone; rename, members change, delete removes the sessions', async () => {
  const g = await withGroup((bot) => (bot === 'scout' ? { status: 401 } : '@scout?'), ['default', 'scout']);
  const entries = await g.say('Hallo');
  assert.deepEqual(shape(entries), [['bot', 'default', '', '@scout?'], ['handoff', 'default', 'scout', '?'], ['note', 'error', '', 'not_connected']]);
  assert.equal(entries[2].bot, 'scout');
  let r = await g.call(`/bridge/groups/${g.id}`, { method: 'PATCH', body: { name: 'Lissabon', members: ['default', 'writer'] } });
  assert.deepEqual([r.status, r.data.group.name, r.data.group.members], [200, 'Lissabon', ['default', 'writer']]);
  r = await g.call(`/bridge/groups/${g.id}`, { method: 'PATCH', body: { name: '  ' } });
  assert.equal(r.status, 400);
  assert.ok(g.hermes.sessions.size >= 2);
  r = await g.call(`/bridge/groups/${g.id}`, { method: 'DELETE' });
  assert.equal(r.status, 204);
  for (let i = 0; i < 50 && g.hermes.sessions.size; i++) await new Promise((x) => setTimeout(x, 10));
  assert.equal(g.hermes.sessions.size, 0, 'member sessions deleted on Hermes');
  assert.equal((await g.call(`/bridge/groups/${g.id}`)).status, 404);
  assert.equal((await g.call('/bridge/groups/gzzzzzzzzzz/messages', { method: 'POST', body: { text: 'x' } })).status, 404);
  assert.equal((await g.call('/bridge/groups/GABCDEFGHIJ')).data.error.code, 'unknown_group');
});

test('persistence: groups and their log survive a restart; a round cut by the restart says so', async () => {
  const g = await withGroup((bot) => (bot === 'default' ? 'Gemerkt.' : '(pass)'));
  await g.say('Merk dir: Mai');
  const file = path.join(g.stateDir, 'groups.json');
  assert.ok(fs.existsSync(file));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.groups[0].running = true;
  fs.writeFileSync(file, JSON.stringify(saved));
  const again = await bridge(g.hermes.url, { BRIDGE_GROUPS: 'on', BRIDGE_STATE_DIR: g.stateDir });
  const view = (await again.call(`/bridge/groups/${g.id}`)).data;
  assert.deepEqual(shape(view.entries), [['user', '', '', 'Merk dir: Mai'], ['bot', 'default', '', 'Gemerkt.'], ['note', 'interrupted', '', '']]);
  // the member keeps its session and only gets what is new
  await again.call(`/bridge/groups/${g.id}/messages`, { method: 'POST', body: { text: 'Und?' } });
  await again.ctx.groups.idle();
  const p = g.hermes.chats().at(-1).body.messages[0].content;
  assert.doesNotMatch(p, /Merk dir/);
  assert.match(p, /User \(user\): Und\?/);
});

test('CLI: groups status / enable / disable', () => {
  const stateDir = tmp('groups-cli-');
  assert.match(groupsCli('status', { env: {}, stateDir }).join('\n'), /bot groups: off/);
  assert.match(groupsCli('enable', { env: {}, stateDir })[0], /bot groups enabled/);
  assert.match(groupsCli(undefined, { env: {}, stateDir }).join('\n'), /bot groups: on .*groups-policy\.json/);
  assert.match(groupsCli('disable', { env: { BRIDGE_GROUPS: 'on' }, stateDir })[0], /disabled \(BRIDGE_GROUPS=on still overrides this\)/);
  assert.throws(() => groupsCli('enable', { env: {}, stateDir: '' }), /state directory/);
  assert.throws(() => groupsCli('nope', { env: {}, stateDir }), /usage/);
});

test('a runaway answer is not kept in memory: appending stops past the limit, also inside one huge piece', () => {
  const piece = 'x'.repeat(1000);
  let text = '';
  for (let i = 0; i < 200; i++) text = appendReply(text, piece);
  assert.ok(text.length > GROUP_LIMITS.reply, 'far enough to see that it was cut');
  assert.ok(text.length <= GROUP_LIMITS.reply + 1024);
  assert.equal(appendReply(text, 'more').length, text.length);
  assert.ok(appendReply('', 'y'.repeat(1_000_000)).length <= GROUP_LIMITS.reply + 1024);
  assert.equal(appendReply('ab', 'cd'), 'abcd');
});

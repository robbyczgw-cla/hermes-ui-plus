// Contract of the E2E mock (scripts/e2e/mock.mjs): what the Android smoke suite relies on, checked without an emulator.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, scenarioFor, stripQuoteBlocks } from './mock.mjs';

let server, base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctl = (path, body) =>
  fetch(base + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

async function pair() {
  const { code } = await ctl('/__e2e/pair-code', {});
  const r = await fetch(`${base}/bridge/pair/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(r.status, 200);
  const again = await fetch(`${base}/bridge/pair/redeem`, { method: 'POST', body: JSON.stringify({ code }) });
  assert.equal(again.status, 410, 'a code works once');
  return (await r.json()).token;
}

const sse = (raw) =>
  raw
    .split('\n\n')
    .map((f) => f.split('\n').find((l) => l.startsWith('data: '))?.slice(6))
    .filter((d) => d && d !== '[DONE]')
    .map((d) => JSON.parse(d))
    .map((j) => j.choices?.[0]?.delta?.content ?? '')
    .join('');

function send(token, text, { key, sid = 'hui-test-1', offset, signal } = {}) {
  return fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-hermes-session-id': sid,
      ...(key ? { 'idempotency-key': key } : {}), ...(offset !== undefined ? { 'x-hermes-ui-resume-offset': String(offset) } : {}),
    },
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: text }] }),
  });
}

test('pairing, bridge header, auth', async () => {
  const h = await fetch(`${base}/health`);
  assert.equal(h.headers.get('x-hermes-ui-bridge'), '1');
  assert.equal((await fetch(`${base}/v1/models`)).status, 401);
  const token = await pair();
  const m = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(m.status, 200);
  assert.equal(m.headers.get('x-hermes-ui-bridge'), '1');
});

test('a turn streams the scripted answer, is stored in the session and is resumable', async () => {
  const token = await pair();
  const r = await send(token, 'e2e checklist one', { key: 'k-1', sid: 'hui-s1' });
  assert.equal(r.headers.get('x-hermes-ui-resume'), '1');
  assert.equal(sse(await r.text()), scenarioFor('e2e checklist one').text);
  const msgs = await (await fetch(`${base}/api/sessions/hui-s1/messages?order=latest&limit=120`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(msgs.data.map((m) => m.role), ['user', 'assistant']);
  // same key again: re-attached, no second turn
  const again = await send(token, 'e2e checklist one', { key: 'k-1', sid: 'hui-s1' });
  assert.equal(sse(await again.text()), scenarioFor('e2e checklist one').text);
  const turns = (await ctl('/__e2e/turns')).filter((t) => t.text === 'e2e checklist one');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].attaches.length, 1);
  const missing = await fetch(`${base}/api/sessions/hui-nope/messages`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'session_not_found');
});

test('drop fault: the client is cut, the turn goes on, a resume at the byte offset completes it exactly', async () => {
  const token = await pair();
  await ctl('/__e2e/fault', { kind: 'drop', match: 'drop me', afterChunks: 5 });
  const r = await send(token, 'e2e table drop me', { key: 'k-2', sid: 'hui-s2' });
  const reader = r.body.getReader();
  const got = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got.push(Buffer.from(value));
    }
  } catch {
    /* cut */
  }
  const head = Buffer.concat(got);
  assert.ok(sse(head.toString()).length < scenarioFor('e2e table drop me').text.length, 'cut before the end');
  const rest = await send(token, 'e2e table drop me', { key: 'k-2', sid: 'hui-s2', offset: head.length });
  assert.equal(rest.status, 200);
  assert.equal(sse(head.toString() + (await rest.text())), scenarioFor('e2e table drop me').text);
});

test('refuse and hold faults', async () => {
  const token = await pair();
  await ctl('/__e2e/fault', { kind: 'refuse', match: 'refuse me' });
  assert.equal((await send(token, 'refuse me', { key: 'k-3' })).status, 503);
  const ok = await send(token, 'refuse me', { key: 'k-3' }); // the retry with the same key runs the turn
  assert.equal(ok.status, 200);
  await ok.text();
  await ctl('/__e2e/fault', { kind: 'hold', match: 'hold me', ms: 5000 });
  const ac = new AbortController();
  const held = send(token, 'hold me', { key: 'k-4', sid: 'hui-s4', signal: ac.signal }).catch(() => null);
  await new Promise((r) => setTimeout(r, 300));
  const turn = async () => (await ctl('/__e2e/turns')).find((x) => x.text === 'hold me');
  assert.equal((await turn()).state, 'held');
  ac.abort(); // the app is killed before the server confirmed: nothing ran
  await held;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await turn()).state, 'dropped');
  const missing = await fetch(`${base}/api/sessions/hui-s4/messages`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(missing.status, 404);
});

test('bots and quick answers follow the config', async () => {
  const token = await pair();
  const get = (p) => fetch(base + p, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  assert.equal((await get('/bridge/profiles')).data.length, 1);
  assert.equal((await get('/bridge/quick/config')).available, false);
  await ctl('/__e2e/config', { profiles: true, quick: true });
  assert.equal((await get('/bridge/profiles')).data.length, 2);
  assert.equal((await get('/bridge/quick/config')).available, true);
  await ctl('/__e2e/config', { profiles: false, quick: false });
});

test('bots: Bot Chat only, adopted on the second call, per profile; an approval turn waits for its answer', async () => {
  const token = await pair();
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  await ctl('/__e2e/config', { profiles: true });
  assert.equal((await post('/p/research/api/sessions', { title: 'Other' })).status, 403);
  const first = await post('/p/research/api/sessions', { title: 'Bot Chat' });
  assert.equal(first.status, 201);
  const id = (await first.json()).session.id;
  const again = await (await post('/p/research/api/sessions', { title: 'Bot Chat' })).json();
  assert.deepEqual([again.session.id, again.adopted], [id, true]);
  const listed = await (await fetch(`${base}/p/research/api/sessions?title=Bot%20Chat&include_hidden=1`, { headers: auth })).json();
  assert.deepEqual(listed.data.map((x) => x.id), [id]);
  const other = await (await fetch(`${base}/api/sessions?title=Bot%20Chat&include_hidden=1`, { headers: auth })).json();
  assert.equal(other.data.length, 0, 'the default bot has no Bot Chat yet');

  const r = await fetch(`${base}/p/research/v1/chat/completions`, {
    method: 'POST', headers: { ...auth, 'x-hermes-session-id': id }, body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: 'e2e approval please' }] }),
  });
  const reader = r.body.getReader();
  let raw = '';
  while (!raw.includes('approval.request')) raw += new TextDecoder().decode((await reader.read()).value);
  const ev = JSON.parse(raw.split('event: approval.request\ndata: ')[1].split('\n')[0]);
  assert.deepEqual(ev.choices, ['once', 'session', 'always', 'deny']);
  const status = await (await fetch(`${base}/p/research/v1/runs/${ev.run_id}`, { headers: auth })).json();
  assert.equal(status.status, 'waiting_for_approval');
  const ans = await post(`/p/research/v1/runs/${ev.run_id}/approval`, { choice: 'always', request_id: ev.request_id });
  assert.equal((await ans.json()).resolved, 1);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += new TextDecoder().decode(value);
  }
  assert.match(sse(raw), /folder check/);
  const turn = (await ctl('/__e2e/turns')).find((t) => t.text === 'e2e approval please');
  assert.deepEqual([turn.profile, turn.sid, turn.approval.choice], ['research', id, 'always']);
  await ctl('/__e2e/config', { profiles: false });
});

test('a fired bot-chat reminder: the default bot\'s Bot Chat gets the injected output + the comment; found by title', async () => {
  const token = await pair();
  const auth = { authorization: `Bearer ${token}` };
  const r = await ctl('/__e2e/fire-reminder', { name: 'Buy tea', text: 'Time to buy tea.' });
  const again = await ctl('/__e2e/fire-reminder', { name: 'Buy tea', text: 'Tea, really.' });
  assert.equal(again.sessionId, r.sessionId, 'one thread per bot');
  const list = await (await fetch(`${base}/api/sessions?title=Bot%20Chat&include_hidden=1`, { headers: auth })).json();
  assert.deepEqual(list.data.map((x) => x.id), [r.sessionId]);
  const one = await (await fetch(`${base}/api/sessions/${r.sessionId}`, { headers: auth })).json();
  assert.deepEqual([one.session.id, one.session.message_count > 0, typeof one.session.last_active], [r.sessionId, true, 'number'], 'GET one session answers {session}');
  const msgs = await (await fetch(`${base}/api/sessions/${r.sessionId}/messages`, { headers: auth })).json();
  assert.match(msgs.data[0].content, /^\[Cronjob "Buy tea" output/);
  assert.equal(msgs.data.at(-1).role, 'assistant');
});

test('authority mode (Hermes v0.22.3+): flag in capabilities, Bot Chat refuses turns (409), own session works and records system messages, lookup fault', async () => {
  const token = await pair();
  const auth = { authorization: `Bearer ${token}` };
  const caps = async () => (await (await fetch(`${base}/v1/capabilities`, { headers: auth })).json()).features;
  assert.equal((await caps()).run_unknown_resolution, undefined, 'writable by default (single thread)');
  await ctl('/__e2e/config', { authority: true });
  try {
    assert.equal((await caps()).run_unknown_resolution, true);
    const fired = await ctl('/__e2e/fire-reminder', { name: 'Buy tea', text: 'Time to buy tea.' });
    const denied = await send(token, 'into the bot chat', { sid: fired.sessionId });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).error.code, 'permission_denied');
    const body = { model: 'hermes-agent', stream: true, messages: [{ role: 'system', content: '[hermes-ui-bot-deliveries] Buy tea' }, { role: 'user', content: 'verschieb das' }] };
    const ok = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-hermes-session-id': 'hui-bot-default' }, body: JSON.stringify(body) });
    assert.equal(ok.status, 200);
    await ok.text();
    const turn = (await ctl('/__e2e/turns')).find((t) => t.text === 'verschieb das');
    assert.deepEqual([turn.sid, turn.system], ['hui-bot-default', ['[hermes-ui-bot-deliveries] Buy tea']]);
    assert.equal((await send(token, 'no system', { sid: 'hui-bot-default' }).then((r) => r.text()).then(() => ctl('/__e2e/turns'))).find((t) => t.text === 'no system').system.length, 0);
    await ctl('/__e2e/config', { botChatLookupFail: true });
    const bad = await fetch(`${base}/api/sessions?title=Bot%20Chat&include_hidden=1`, { headers: auth });
    assert.equal(bad.status, 500);
    assert.equal((await fetch(`${base}/api/sessions?limit=5`, { headers: auth })).status, 200, 'only the Bot Chat lookup fails');
  } finally {
    await ctl('/__e2e/config', { authority: false, botChatLookupFail: false });
  }
  assert.equal((await caps()).run_unknown_resolution, undefined);
  const again = await send(token, 'writable again', { sid: (await ctl('/__e2e/sessions')).find((x) => x.title === 'Bot Chat').id });
  assert.equal(again.status, 200, 'the default mode stays single-thread writable');
  await again.text();
});

test('a session deleted elsewhere: GET 404, a turn into its id ends with the stream error not_found (nothing stored), a new id works', async () => {
  const token = await pair();
  const auth = { authorization: `Bearer ${token}` };
  const ok = await send(token, 'before the delete', { sid: 'hui-bot-gone' });
  await ok.text();
  assert.equal((await fetch(`${base}/api/sessions/hui-bot-gone`, { headers: auth })).status, 200);
  assert.equal((await ctl('/__e2e/delete-session', { id: 'hui-bot-gone' })).deleted, 'hui-bot-gone');
  assert.equal((await fetch(`${base}/api/sessions/hui-bot-gone`, { headers: auth })).status, 404);
  const r = await send(token, 'after the delete', { sid: 'hui-bot-gone' });
  assert.equal(r.status, 200);
  const frames = (await r.text()).split('\n\n').map((f) => f.split('\n').find((l) => l.startsWith('data: '))?.slice(6)).filter((d) => d && d !== '[DONE]').map((d) => JSON.parse(d));
  assert.deepEqual([frames.length, frames[0].choices[0].finish_reason, frames[0].error.message], [1, 'error', 'not_found']);
  assert.equal((await fetch(`${base}/api/sessions/hui-bot-gone`, { headers: auth })).status, 404, 'a refused turn creates nothing');
  const fresh = await send(token, 'after the delete', { sid: 'hui-bot-gone--ab' });
  assert.equal(sse(await fresh.text()), 'Short answer to "after the delete": apple, mango and strawberry.');
});

test('perf harness: perfreal / perfstress stream the long perf answer byte-equal, stress much faster', async () => {
  const { PERF_LONG } = await import('./perf-answers.mjs');
  assert.equal(scenarioFor('perfreal one').name, 'perf-real');
  assert.equal(scenarioFor('PerfStress two').name, 'perf-stress');
  assert.ok(PERF_LONG.length > 10_000 && (PERF_LONG.match(/```hui/g) || []).length >= 4, 'long, with interactive blocks');
  const token = await pair();
  const t0 = Date.now();
  const r = await send(token, 'perfstress x', { sid: 'hui-perf-stress' });
  assert.equal(sse(await r.text()), PERF_LONG);
  assert.ok(Date.now() - t0 < 15_000, 'stress rate');
});

test('perf harness: /__e2e/seed creates a big Hermes session, the newest rows come back in the transcript API', async () => {
  const token = await pair();
  const seeded = await ctl('/__e2e/seed', { messages: 2400 });
  assert.equal(seeded.rows, 2400);
  const auth = { authorization: `Bearer ${token}` };
  const list = await fetch(`${base}/api/sessions?limit=50`, { headers: auth }).then((x) => x.json());
  const row = list.data.find((s) => s.id === seeded.id);
  assert.equal(row.message_count, 2400);
  assert.equal(row.title, 'Perf history 2400');
  const msgs = await fetch(`${base}/api/sessions/${seeded.id}/messages?limit=500`, { headers: auth }).then((x) => x.json());
  assert.equal(msgs.data.length, 500);
  assert.deepEqual(msgs.data.slice(0, 2).map((m) => m.role), ['user', 'assistant']);
  assert.ok(msgs.data.every((m, i, a) => i === 0 || m.id > a[i - 1].id), 'oldest first');
});

test('uploads: raw bytes with X-Filename → 201 RemoteRef, recorded for the share checks', async () => {
  const token = await pair();
  const unauth = await fetch(`${base}/bridge/uploads`, { method: 'POST', body: 'x' });
  assert.equal(unauth.status, 401);
  const r = await fetch(`${base}/bridge/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/pdf', 'x-filename': encodeURIComponent('My Report.pdf') },
    body: '%PDF-1.4 test',
  });
  assert.equal(r.status, 201);
  const ref = await r.json();
  assert.equal(ref.name, 'My Report.pdf');
  assert.equal(ref.size, 13);
  assert.equal(ref.mimeType, 'application/pdf');
  assert.match(ref.path, /^\/tmp\/e2e-uploads\/e2e-up-\d+-My_Report\.pdf$/);
  const list = await ctl('/__e2e/uploads');
  assert.equal(list.at(-1).head, Buffer.from('%PDF-1.4').toString('hex'));
});

test('live list: created, the [hui:live] edits are applied before the next full version, the trailer never picks a scenario', async () => {
  const token = await pair();
  const block = (text) => JSON.parse(/```hui\n([\s\S]*?)\n```/.exec(text)[1]);
  const v1 = block(sse(await (await send(token, 'Mach mir eine Einkaufsliste für Samstag', { sid: 'hui-live-1' })).text()));
  assert.equal(v1.live, true);
  assert.equal(v1.id, 'einkauf');
  const trailer = `[hui:live]${JSON.stringify({ einkauf: { v: 1, ops: [{ check: 'milch' }, { add: { id: 'u-test1', text: 'Brot vom Bäcker' } }], bid: 'b-test' } })}[/hui:live]`;
  const v2 = block(sse(await (await send(token, `Wir grillen doch am Samstag.\n\n${trailer}`, { sid: 'hui-live-1' })).text()));
  assert.equal(v2.items.find((i) => i.id === 'milch').checked, true);
  assert.ok(v2.items.some((i) => i.id === 'u-test1'));
  assert.ok(v2.items.some((i) => i.id === 'grillkohle'));
  assert.ok(!v2.items.some((i) => i.id === 'tomaten'));
  // another device's turn, stored without a stream
  const other = await ctl('/__e2e/live-turn', { sid: 'hui-live-1', text: 'Bitte vier Mozzarella' });
  assert.equal(other.scenario, 'live-update');
  // a trailer that mentions a scenario keyword is not the user's text
  assert.equal(scenarioFor(`Hallo\n\n[hui:live]{"checklist":{"v":1,"ops":[{"check":"long"}]}}[/hui:live]`).name, 'short');
});

test('live trip and watchlist: created, the trailer edits are kept, a full version moves two blocks, prices come as a patch', async () => {
  const token = await pair();
  const block = (text) => JSON.parse(/```hui\n([\s\S]*?)\n```/.exec(text)[1]);
  const sid = 'hui-live-2';
  const t1 = block(sse(await (await send(token, 'Plane mir drei Tage Rom', { sid })).text()));
  assert.equal(t1.type, 'tabs');
  assert.equal(t1.live, true);
  assert.deepEqual(t1.tabs.map((x) => x.id), ['fr13', 'sa14', 'so15', 'karte']);
  assert.equal(t1.tabs[3].children[0].type, 'map');
  const tripEdits = `[hui:live]${JSON.stringify({ rom: { v: 1, ops: [{ check: 'kolosseum' }, { set: 'trastevere', userNote: 'Tisch für 2' }, { add: { id: 'u-test2', title: 'Trevi', start: '12:00', end: '12:30' }, to: 'so15' }], bid: 'b-trip' } })}[/hui:live]`;
  const t2 = block(sse(await (await send(token, `Am Samstag soll es regnen.\n\n${tripEdits}`, { sid })).text()));
  const sa = t2.tabs.find((x) => x.id === 'sa14').children[0].blocks;
  const by = (id) => sa.find((b) => b.id === id);
  assert.equal(by('vatikan').start, '11:00');
  assert.equal(by('forum').start, '15:30');
  assert.equal(by('kolosseum').checked, true);
  assert.equal(by('trastevere').userNote, 'Tisch für 2');
  assert.ok(t2.tabs.find((x) => x.id === 'so15').children[0].blocks.some((b) => b.id === 'u-test2' && b.title === 'Trevi'));
  const w1 = block(sse(await (await send(token, 'Leg mir eine Kopfhörer-Watchlist an', { sid })).text()));
  assert.equal(w1.type, 'products');
  assert.deepEqual(w1.products.map((p) => p.id), ['xm5', 'qc', 'm4']);
  const target = `[hui:live]${JSON.stringify({ kopfhoerer: { v: 1, ops: [{ set: 'xm5', target: 249 }], bid: 'b-watch' } })}[/hui:live]`;
  const p = block(sse(await (await send(token, `Prüf bitte die Preise.\n\n${target}`, { sid })).text()));
  assert.deepEqual(p, { type: 'callout', tone: 'info', title: 'Kopfhörer-Watchlist aktualisiert', text: 'WH-1000XM5: 239 €', livePatch: { card: 'kopfhoerer', ops: [{ set: 'xm5', price: 239 }] } });
  const live = (await ctl('/__e2e/sessions')).find((x) => x.id === sid);
  assert.equal(live.rows, 8);
});

test('CORS for web builds: preflight and exposed headers', async () => {
  const pre = await fetch(`${base}/v1/chat/completions`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:9', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://127.0.0.1:9');
  const h = await fetch(`${base}/health`, { headers: { origin: 'http://127.0.0.1:9' } });
  assert.match(h.headers.get('access-control-expose-headers'), /X-Hermes-UI-Bridge/);
});

test('"remind me": cron tool progress in the stream, wrapper rows in the session, the app reads one reminder card', async () => {
  const { parseMessages } = await import('../../app/src/hermes/sessions.ts');
  const { mapRemoteMessages } = await import('../../app/src/hermes/sessionMapping.ts');
  const { parseReminders } = await import('../../app/src/chat/reminder.ts');
  const token = await pair();
  const raw = await (await send(token, 'Remind me tomorrow at 9 to buy tea', { sid: 'hui-remind-1' })).text();
  assert.match(raw, /event: hermes\.tool\.progress\ndata: \{"tool":"cronjob_manage"[^\n]*"status":"running"/);
  assert.match(sse(raw), /remind you tomorrow at 9:00/);
  const rows = await fetch(`${base}/api/sessions/hui-remind-1/messages`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  assert.deepEqual(rows.data.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
  const answer = mapRemoteMessages(parseMessages(rows, 'hui-remind-1').messages).find((m) => m.role === 'assistant');
  const [r] = parseReminders(answer.tools ?? []);
  assert.equal(r.name, 'Buy tea');
  assert.equal(r.deliver, 'bot-chat'); // the skill asks for the bot's thread
  assert.equal(r.recurring, false);
  const at = new Date(r.nextRun);
  assert.deepEqual([at.getHours(), at.getMinutes()], [9, 0]);
  assert.ok(r.nextRun > Date.now());
  assert.equal(scenarioFor('remind me later').name, 'reminder');
});

test('"delete this reminder": removes the chat\'s newest job as Hermes stores it, the job list follows, the app reads a removal', async () => {
  const { parseMessages } = await import('../../app/src/hermes/sessions.ts');
  const { mapRemoteMessages } = await import('../../app/src/hermes/sessionMapping.ts');
  const { parseReminders } = await import('../../app/src/chat/reminder.ts');
  const { parseCronChanges } = await import('../../app/src/chat/reminderSync.ts');
  const token = await pair();
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const answers = async (sid) => {
    const rows = await fetch(`${base}/api/sessions/${sid}/messages`, auth).then((r) => r.json());
    return mapRemoteMessages(parseMessages(rows, sid).messages).filter((m) => m.role === 'assistant');
  };
  const listed = async () => (await fetch(`${base}/api/jobs?include_disabled=true`, auth).then((r) => r.json())).jobs.map((j) => j.id);
  await ctl('/__e2e/config', { routines: true });
  try {
    await (await send(token, 'Remind me tomorrow at 9 to buy tea', { sid: 'hui-remind-del' })).text();
    await (await send(token, 'Remind me tomorrow at 9 to buy tea', { sid: 'hui-remind-other' })).text();
    const [mine] = parseReminders((await answers('hui-remind-del'))[0].tools ?? []);
    const [other] = parseReminders((await answers('hui-remind-other'))[0].tools ?? []);
    assert.match(mine.jobId, /^[a-f0-9]{12}$/);
    assert.notEqual(mine.jobId, other.jobId); // every create its own job
    assert.ok((await listed()).includes(mine.jobId));

    assert.match(sse(await (await send(token, 'Delete this reminder', { sid: 'hui-remind-del' })).text()), /reminder is deleted/);
    const del = (await answers('hui-remind-del')).at(-1);
    assert.deepEqual(parseCronChanges(del.tools ?? [], del.createdAt).map((c) => [c.jobId, c.kind]), [[mine.jobId, 'removed']]);
    assert.deepEqual(parseReminders(del.tools ?? []), []); // no new "reminder set" card for a removal
    const jobs = await listed();
    assert.ok(!jobs.includes(mine.jobId) && jobs.includes(other.jobId), 'only the chat\'s own job goes');

    // nothing left in this chat: a failed remove, which changes nothing
    await (await send(token, 'Delete this reminder', { sid: 'hui-remind-del' })).text();
    const again = (await answers('hui-remind-del')).at(-1);
    assert.deepEqual(parseCronChanges(again.tools ?? [], again.createdAt), []);

    // deleted elsewhere (dashboard): gone from the list
    assert.equal((await ctl('/__e2e/remove-job', { id: other.jobId })).removed, other.jobId);
    assert.ok(!(await listed()).includes(other.jobId));
  } finally {
    await ctl('/__e2e/config', { routines: false });
  }
});

test('creating bots: off by default, allowed → a new bot is listed and served under /p/<name>/, a taken name is refused', async () => {
  const token = await pair();
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  assert.deepEqual((await (await call('/bridge/bots')).json()).create, { allowed: false, reason: 'plugin_not_configured' });
  await ctl('/__e2e/config', { botsCreate: 'owner_off' });
  assert.deepEqual((await (await call('/bridge/bots')).json()).create, { allowed: false, reason: 'owner_off' });
  await ctl('/__e2e/config', { botsCreate: 'allowed' });
  const body = { title: 'Späher', job: 'Preise im Blick', how: 'Kurz.', template: 'deals', lang: 'de', color: '#3f7d6e' };
  const r = await call('/bridge/bots', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(r.status, 201);
  assert.deepEqual((await r.json()).bot, { name: 'spaher', label: 'Späher', description: 'Preise im Blick', color: '#3f7d6e', template: 'deals' });
  assert.equal((await call('/bridge/bots', { method: 'POST', body: JSON.stringify(body) })).status, 409);
  const list = (await (await call('/bridge/profiles')).json()).data;
  assert.ok(list.some((b) => b.name === 'spaher' && b.template === 'deals'));
  const s = await call('/p/spaher/api/sessions', { method: 'POST', body: JSON.stringify({ title: 'Bot Chat' }) });
  assert.ok(s.status === 201 || s.status === 200, `Bot Chat ${s.status}`);
  await ctl('/__e2e/config', { botsCreate: false });
});

test('bot groups: the real bridge driver against the mock; off by default, a plan hands over to research, approvals stay out of the room', async () => {
  const token = await pair();
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  };
  let r = await call('/bridge/groups');
  assert.deepEqual([r.data.enabled, r.data.reason], [false, 'bridge_off']);
  await ctl('/__e2e/config', { groups: 'owner_off' });
  assert.equal((await call('/bridge/groups')).data.reason, 'owner_off');
  await ctl('/__e2e/config', { groups: true, profiles: true });
  r = await call('/bridge/groups', 'POST', { name: 'Reise', members: ['default', 'research'] });
  assert.equal(r.status, 201);
  const id = r.data.group.id;
  const roundOver = async () => {
    for (let i = 0; i < 300; i++) {
      const st = (await call(`/bridge/groups/${id}`)).data;
      if (!st.round) return st;
      await new Promise((x) => setTimeout(x, 20));
    }
    throw new Error('round did not end');
  };
  assert.equal((await call(`/bridge/groups/${id}/messages`, 'POST', { text: 'Plant ein Wochenende in Lissabon' })).status, 202);
  let st = await roundOver();
  assert.deepEqual(st.entries.map((e) => [e.kind, e.bot ?? '', e.to ?? '']), [['user', '', ''], ['bot', 'default', ''], ['handoff', 'default', 'research'], ['bot', 'research', '']]);
  assert.match(st.entries[3].text, /Drei Quellen/);
  // member sessions are hidden: the app's chat list never shows them
  const list = await (await fetch(`${base}/api/sessions`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.ok(!list.data.some((s) => /^Group: /.test(s.title ?? '')));

  assert.equal((await call(`/bridge/groups/${id}/messages`, 'POST', { text: '@research e2e approval' })).status, 202);
  let ap;
  for (let i = 0; i < 300 && !ap; i++) {
    ap = (await call('/bridge/groups')).data.approvals[0];
    if (!ap) await new Promise((x) => setTimeout(x, 20));
  }
  assert.equal(ap.bot, 'research');
  const answer = await fetch(`${base}/p/research/v1/runs/${ap.runId}/approval`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ choice: 'once', request_id: ap.requestId }) });
  assert.equal(answer.status, 200);
  st = await roundOver();
  assert.deepEqual(st.entries.slice(-2).map((e) => [e.kind, e.note ?? e.bot]), [['note', 'approval'], ['bot', 'research']]);
  await ctl('/__e2e/config', { groups: false, profiles: false });
});

test('reply quotes in front of the typed text never pick the scenario (a quoted "long" stays a short answer)', () => {
  const q = '[hui:quote ref=a1 from=user]\n> e2e quote long\n[/hui:quote]\n[hui:quote from=assistant]\n> table here\n[/hui:quote]\n\ne2e quote follow';
  assert.equal(stripQuoteBlocks(q), 'e2e quote follow');
  assert.equal(scenarioFor(q).name, 'short');
  assert.equal(scenarioFor(q).text, 'Short answer to "e2e quote follow": apple, mango and strawberry.');
  assert.equal(stripQuoteBlocks('no quote'), 'no quote');
});

test('slice 4/5: allow-list + revoke, archive hides the bot, fields, library, activity with steps, remote turn + stop', async () => {
  const token = await pair();
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const get = (p) => fetch(base + p, { headers: auth }).then((r) => r.json());
  const post = (p, b, method = 'POST') => fetch(base + p, { method, headers: auth, body: JSON.stringify(b) });
  await ctl('/__e2e/config', { profiles: true, about: true });
  assert.deepEqual((await get('/bridge/bots/research/allowlist')).entries, [{ pattern: 'recursive delete' }, { pattern: 'delete in root path' }]);
  assert.equal((await post('/bridge/bots/research/allowlist/revoke', { pattern: 'recursive delete' })).status, 200);
  assert.deepEqual((await get('/bridge/bots/research/allowlist')).entries, [{ pattern: 'delete in root path' }]);
  assert.equal((await post('/bridge/bots/research/allowlist/revoke', { pattern: 'nope' })).status, 404);
  assert.equal((await get('/bridge/bots/research')).bot.job, 'Find sources and sum them up');
  assert.equal((await post('/bridge/bots/research', { title: 'Research', job: 'New job', how: 'x' }, 'PATCH')).status, 200);
  assert.equal((await get('/bridge/library/config?bot=research')).memory.available, true);
  assert.equal((await get('/bridge/library/memory?bot=research')).stores[1].entries.length, 2);
  assert.equal((await post('/bridge/bots/research/archive', {})).status, 200);
  assert.ok(!(await get('/bridge/profiles')).data.some((b) => b.name === 'research'), 'archived: not listed');
  assert.deepEqual((await get('/bridge/bots')).archived, [{ name: 'research', label: 'Research' }]);
  assert.equal((await post('/bridge/bots/default/archive', {})).status, 403);
  assert.equal((await post('/bridge/bots/research/restore', {})).status, 200);
  assert.ok((await get('/bridge/profiles')).data.some((b) => b.name === 'research'));

  // a running turn with steps shows in the activity, then goes away
  const run = send(token, 'e2e working', { sid: 'hui-test-working' });
  let snap;
  for (let i = 0; i < 40; i++) {
    snap = await get('/bridge/bots/activity');
    if (snap.data[0]?.turns[0]?.steps?.some((s) => s.state === 'running' && s.name === 'browser_navigate')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(snap.object, 'bots.activity');
  assert.deepEqual(snap.data[0].turns[0].steps.map((s) => [s.name, s.state]), [['web_search', 'done'], ['browser_navigate', 'running']]);
  assert.equal((await (await post('/bridge/chat/stop', { sessionId: 'hui-test-working' })).json()).stopped, 1);
  await run.then((r) => r.text()).catch(() => {}); // a stopped turn may end the stream abruptly
  // remote turn of another device in the default bot's Bot Chat
  await ctl('/__e2e/fire-reminder', {});
  const { sessionId } = await ctl('/__e2e/remote-turn', {});
  assert.ok((await get('/bridge/bots/activity')).data.some((a) => a.turns.some((t) => t.sessionId === sessionId)));
  assert.equal((await (await post('/bridge/chat/stop', { sessionId })).json()).stopped, 1);
  assert.ok(!(await get('/bridge/bots/activity')).data.some((a) => a.turns.some((t) => t.sessionId === sessionId)));
  await ctl('/__e2e/config', { profiles: false, about: false });
});

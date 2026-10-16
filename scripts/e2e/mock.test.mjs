// Contract of the E2E mock (scripts/e2e/mock.mjs): what the Android smoke suite relies on, checked without an emulator.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, scenarioFor } from './mock.mjs';

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

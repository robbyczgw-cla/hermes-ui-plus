import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_PROBE_MS, FIRST_PROBE_MS, INITIAL_HEALTH, eventForStatus, POLL_MAX_MS, originOf, pollDelayMs, probeBudgetMs, reduceHealth, reportReachable, subscribeReachable, type HealthEvent, type HealthState } from './healthMachine.ts';

const run = (events: HealthEvent['type'][], s: HealthState = INITIAL_HEALTH) => events.reduce((acc, type) => reduceHealth(acc, { type } as HealthEvent), s);

test('offline recovers to online on the next successful check / request', () => {
  const off = run(['fail', 'fail', 'fail']);
  assert.deepEqual(off, { health: 'offline', failures: 3, denied: false });
  assert.deepEqual(reduceHealth(off, { type: 'ok' }), { health: 'online', failures: 0, denied: false });
});

test('ok while already online keeps the same state object (no re-render)', () => {
  const on = run(['ok']);
  assert.equal(reduceHealth(on, { type: 'ok' }), on);
});

test('reset goes back to checking', () => {
  assert.deepEqual(run(['fail', 'reset']), INITIAL_HEALTH);
});

test('polls with backoff only while unhealthy', () => {
  assert.equal(pollDelayMs(INITIAL_HEALTH), null);
  assert.equal(pollDelayMs(run(['ok'])), null);
  const d = [1, 2, 3, 4, 5, 6, 7, 20].map((n) => pollDelayMs(run(Array(n).fill('fail'))));
  assert.deepEqual(d.slice(0, 5), [3000, 6000, 12000, 24000, 48000]);
  assert.equal(d[5], POLL_MAX_MS);
  assert.equal(d[7], POLL_MAX_MS);
});

test('reachability reports are matched by origin; 5xx and network errors do not count', () => {
  assert.equal(originOf('HTTPS://Api.Example.org:8642/v1/chat'), 'https://api.example.org:8642');
  assert.equal(originOf('not a url'), null);
  const got: string[] = [];
  const off = subscribeReachable((o, status) => got.push(`${o} ${status}`));
  reportReachable('https://api.example.org/v1/models', 200);
  reportReachable('https://api.example.org/v1/models', 401);
  reportReachable('https://api.example.org/v1/models', 502);
  reportReachable('https://api.example.org/v1/models', 0);
  off();
  reportReachable('https://api.example.org/v1/models', 200);
  assert.deepEqual(got, ['https://api.example.org 200', 'https://api.example.org 401']);
});

test('a rejected key marks the status denied until an authorized request succeeds', () => {
  const denied = run(['ok', 'denied']);
  assert.deepEqual(denied, { health: 'online', failures: 0, denied: true });
  // the unauthenticated /health check does not clear it
  assert.equal(reduceHealth(denied, { type: 'ok' }).denied, true);
  assert.equal(reduceHealth(denied, { type: 'ok', authorized: true }).denied, false);
  assert.equal(run(['reset'], denied).denied, false);
  assert.deepEqual(eventForStatus(401), { type: 'denied' });
  assert.deepEqual(eventForStatus(403), { type: 'denied' });
  assert.deepEqual(eventForStatus(200), { type: 'ok', authorized: true });
  assert.deepEqual(eventForStatus(404), { type: 'ok' });
  assert.equal(eventForStatus(502), null);
});

test('one failed probe does not turn a working slow link red; it schedules confirmation', () => {
  const online = run(['ok']);
  const suspect = reduceHealth(online, { type: 'fail' });
  assert.equal(suspect.health, 'online');
  assert.equal(pollDelayMs(suspect), 3000, 'a retained online state must still retry');
  assert.equal(reduceHealth(suspect, { type: 'fail' }).health, 'offline');
  assert.equal(reduceHealth(suspect, { type: 'ok' }).failures, 0);
  assert.equal(run(['ok', 'fail', 'ok', 'fail']).health, 'online', 'success breaks the failure streak');
  assert.equal(run(['fail']).health, 'checking', 'initial uncertainty is not confirmed unreachability');
});

test('the browser / OS offline event is conclusive: offline right away, recovers on the next ok', () => {
  const online = run(['ok']);
  const off = reduceHealth(online, { type: 'offline' });
  assert.equal(off.health, 'offline');
  assert.equal(reduceHealth(INITIAL_HEALTH, { type: 'offline' }).health, 'offline', 'no confirmation probe needed');
  assert.ok(pollDelayMs(off)! >= 3000, 'still polls (with backoff) to notice the way back');
  assert.equal(reduceHealth(off, { type: 'ok' }).health, 'online');
  assert.equal(reduceHealth({ ...online, denied: true }, { type: 'offline' }).denied, true, 'denied is kept');
});

test('first probe is short, the confirmation probe gets the long budget', () => {
  assert.equal(FIRST_PROBE_MS, 8000);
  assert.equal(CONFIRM_PROBE_MS, 20000);
  assert.equal(probeBudgetMs(INITIAL_HEALTH), FIRST_PROBE_MS);
  assert.equal(probeBudgetMs(run(['ok'])), FIRST_PROBE_MS);
  assert.equal(probeBudgetMs(run(['ok', 'fail'])), CONFIRM_PROBE_MS);
  assert.equal(probeBudgetMs(run(['fail', 'fail'])), CONFIRM_PROBE_MS);
});

test('no polling while the app is in the background', () => {
  const off = run(['fail', 'fail']);
  assert.equal(pollDelayMs(off, false), null);
  assert.ok(pollDelayMs(off, true)! > 0);
  assert.equal(pollDelayMs(off), pollDelayMs(off, true));
});

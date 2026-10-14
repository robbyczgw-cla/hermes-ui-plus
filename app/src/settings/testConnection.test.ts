// Settings "Verbindung testen" for Hermes profiles on the real testConnection.ts (injected fetch).
// Review part 5, finding 10 + test gap 5: unresolved bodies and malformed model JSON, not just HTTP status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { installRnStubs } from '../testkit/rn.ts';
import type { FetchFn } from './testConnection.ts';

installRnStubs(); // extensionless imports of the module under test
const { testConnection } = await import('./testConnection.ts');

const t = makeT('en', 'en-US');
const profile = { baseUrl: 'https://hermes.example/v1', apiKey: 'k' };

const res = (status: number, text: () => Promise<string>): Response => ({ ok: status >= 200 && status < 300, status, text }) as unknown as Response;
const never = () => new Promise<string>(() => undefined);

function route(models: () => Promise<Response>, health: () => Promise<Response> = async () => res(200, async () => '{"status":"ok"}')): FetchFn {
  return async (url) => (url.endsWith('/models') ? models() : health());
}

test('a good model list is reported with its ids', async () => {
  const r = await testConnection(profile, t, 500, route(async () => res(200, async () => JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }))));
  assert.equal(r.models.ok, true);
  assert.deepEqual(r.models.ids, ['a', 'b']);
  assert.equal(r.health.ok, true);
});

test('200 with a body that never arrives ends at the deadline instead of hanging', async () => {
  const started = Date.now();
  const r = await testConnection(profile, t, 40, route(async () => res(200, never)));
  assert.equal(r.models.ok, false);
  assert.equal(r.models.detail, t('settings.test.timeout'));
  assert.ok(Date.now() - started < 3000);
});

test('headers that never arrive end at the deadline too', async () => {
  const r = await testConnection(profile, t, 40, route(() => new Promise<Response>(() => undefined), () => new Promise<Response>(() => undefined)));
  assert.equal(r.health.ok, false);
  assert.equal(r.models.ok, false);
  assert.equal(r.models.detail, t('settings.test.timeout'));
});

test('HTML / invalid JSON / wrong shape is not a successful model check', async () => {
  for (const body of ['<html>login</html>', 'not json', '{"models":[]}', '[]', 'null', '']) {
    const r = await testConnection(profile, t, 500, route(async () => res(200, async () => body)));
    assert.equal(r.models.ok, false, `body ${JSON.stringify(body)}`);
    assert.equal(r.models.detail, t('settings.test.badResponse'));
    assert.deepEqual(r.models.ids, []);
  }
});

test('an empty but well-formed list is still reachable (OK, no ids)', async () => {
  const r = await testConnection(profile, t, 500, route(async () => res(200, async () => '{"data":[]}')));
  assert.equal(r.models.ok, true);
  assert.deepEqual(r.models.ids, []);
});

test('oversized bodies are rejected', async () => {
  const big = JSON.stringify({ data: [{ id: 'x'.repeat(600_000) }] });
  const r = await testConnection(profile, t, 500, route(async () => res(200, async () => big)));
  assert.equal(r.models.ok, false);
});

test('401 is reported as an invalid key', async () => {
  const r = await testConnection(profile, t, 500, route(async () => res(401, async () => '')));
  assert.equal(r.models.ok, false);
  assert.equal(r.models.detail, t('settings.test.invalidKey'));
  assert.equal(r.models.status, 401);
});

/// <reference types="node" />
// Creating a bot: template defaults, field checks, the request body, the bridge's answers and errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_COLORS, createBody, createFailure, defaultMay, draftFor, draftProblems, failureField, nextColor, ownerCanEnable, parseBotsConfig,
  parseCreated, ROLE_TEMPLATES, showsCommands, soulLang, templateColor,
} from './core.ts';
import { fetchBotsConfig, postBot } from './api.ts';
import type { FetchLike } from '../../hermes/stream.ts';

const text = (k: string) => ({ name: 'Scout', job: 'Preise im Blick behalten', how: 'Kurz und sachlich.' })[k] ?? '';

test('roles: five templates + own role; code alone runs commands, the rest search, remember and check in', () => {
  assert.deepEqual(ROLE_TEMPLATES, ['research', 'deals', 'travel', 'briefing', 'code', 'own']);
  assert.deepEqual(defaultMay('deals'), { web: true, memory: true, routines: true, commands: false });
  assert.deepEqual(defaultMay('code'), { web: false, memory: true, routines: false, commands: true });
  assert.equal(showsCommands('code'), true);
  assert.equal(showsCommands('own'), false);
  assert.equal(templateColor('deals'), '#3f7d6e');
  assert.equal(nextColor(BOT_COLORS.at(-1)!), BOT_COLORS[0]);
  assert.equal(nextColor('#ZZZZZZ'), BOT_COLORS[0]);
});

test('drafts: a template fills the three fields, own role starts empty, the empty agent is prefilled to rename', () => {
  assert.deepEqual(draftFor('deals', text as never), { template: 'deals', title: 'Scout', job: 'Preise im Blick behalten', how: 'Kurz und sachlich.', may: defaultMay('deals'), color: '#3f7d6e' });
  const own = draftFor('own', text as never);
  assert.deepEqual([own.title, own.job, own.how], ['', '', '']);
  assert.equal(draftFor('blank', text as never).title, 'Scout');
});

test('field checks: required and too long, the how text may have lines', () => {
  const d = draftFor('deals', text as never);
  assert.deepEqual(draftProblems(d), []);
  assert.deepEqual(draftProblems({ ...d, title: '   ', how: '\n' }), [{ field: 'title', kind: 'required' }, { field: 'how', kind: 'required' }]);
  assert.deepEqual(draftProblems({ ...d, job: 'x'.repeat(161) }), [{ field: 'job', kind: 'tooLong', max: 160 }]);
  assert.deepEqual(draftProblems({ ...d, title: `  ${'x'.repeat(40)}  ` }), []);
});

test('request body: one-line name and job, the app language, commands only for code', () => {
  const d = { ...draftFor('deals', text as never), title: ' Sc  out ', may: { web: true, memory: false, routines: true, commands: true } };
  assert.deepEqual(createBody(d, 'de-AT'), { title: 'Sc out', job: 'Preise im Blick behalten', how: 'Kurz und sachlich.', template: 'deals', lang: 'de', may: { web: true, memory: false, routines: true, commands: false }, color: '#3f7d6e' });
  assert.equal(createBody(draftFor('code', text as never), 'es').may.commands, true);
  assert.equal(soulLang('fr'), 'en');
  assert.equal(soulLang(undefined), 'en');
});

test('bridge answers: config, created bot; unknown shapes are null', () => {
  assert.deepEqual(parseBotsConfig({ create: { allowed: true }, admin: true, limit: 50, count: 2 }), { create: { allowed: true }, admin: true, limit: 50, count: 2 });
  assert.deepEqual(parseBotsConfig({ create: { allowed: false, reason: 'owner_off' } }), { create: { allowed: false, reason: 'owner_off' }, admin: false, limit: 50, count: 0 });
  assert.deepEqual(parseBotsConfig({ create: { allowed: false, reason: '<b>free text</b>' } })?.create, { allowed: false, reason: 'unknown' });
  assert.equal(parseBotsConfig({ object: 'list' }), null);
  assert.equal(parseBotsConfig(null), null);
  assert.deepEqual(parseCreated({ bot: { name: 'scout', label: 'Scout', color: '#3F7D6E', template: 'deals', secret: 'x' } }), { name: 'scout', label: 'Scout', color: '#3f7d6e', template: 'deals' });
  assert.equal(parseCreated({ bot: { name: 'default' } }), null);
  assert.equal(parseCreated({ bot: { name: '../x' } }), null);
  assert.deepEqual(parseCreated({ bot: { name: 'x', template: 'evil' } }), { name: 'x' });
});

test('create errors map onto the form, never server text', () => {
  assert.deepEqual(createFailure(409, { error: { code: 'exists' } }), { kind: 'exists' });
  assert.deepEqual(createFailure(409, { error: { code: 'limit', limit: 50 } }), { kind: 'limit', limit: 50 });
  assert.deepEqual(createFailure(403, { error: { code: 'bots_forbidden' } }), { kind: 'forbidden' });
  assert.deepEqual(createFailure(400, { error: { code: 'invalid_field', field: 'how' } }), { kind: 'invalid', field: 'how' });
  assert.deepEqual(createFailure(404, { error: { code: 'bots_unavailable', reason: 'multiplex_off' } }), { kind: 'unavailable', reason: 'multiplex_off' });
  assert.deepEqual(createFailure(502, { error: { code: 'create_failed' } }), { kind: 'server', reason: 'create_failed' });
  assert.deepEqual(createFailure(504, null), { kind: 'server', reason: 'timeout' });
  assert.deepEqual(createFailure(500, 'html'), { kind: 'server', reason: 'unknown' });
  assert.equal(failureField({ kind: 'exists' }), 'title');
  assert.equal(failureField({ kind: 'invalid', field: 'job' }), 'job');
  assert.equal(failureField({ kind: 'invalid', field: 'may' }), null);
  assert.equal(failureField(null), null);
  assert.equal(ownerCanEnable('owner_off'), true);
  assert.equal(ownerCanEnable('device_forbidden'), false);
});

function fake(status: number, body: unknown, o: { throws?: boolean; hang?: boolean } = {}) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const fetchImpl = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => {
    calls.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    if (o.throws) throw new TypeError('network');
    if (o.hang) await new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status < 300, status, headers: { get: () => 'application/json' }, body: null, text: async () => text };
  }) as unknown as FetchLike;
  return { calls, fetchImpl };
}
const conn = { baseUrl: 'https://bridge.example.com/p/scout/v1', apiKey: 'nca_user_test_token_000' };

test('api: GET and POST /bridge/bots at the server root with the device token', async () => {
  const g = fake(200, { create: { allowed: true }, admin: false, limit: 50, count: 1 });
  assert.deepEqual(await fetchBotsConfig(g.fetchImpl, conn), { create: { allowed: true }, admin: false, limit: 50, count: 1 });
  assert.deepEqual(g.calls[0], { url: 'https://bridge.example.com/bridge/bots', method: 'GET', body: undefined, auth: 'Bearer nca_user_test_token_000' });
  assert.equal(await fetchBotsConfig(fake(404, { error: {} }).fetchImpl, conn), null, 'older bridge');
  assert.equal(await fetchBotsConfig(fake(0, null, { throws: true }).fetchImpl, conn), null, 'offline');

  const p = fake(201, { bot: { name: 'scout', label: 'Scout' } });
  assert.deepEqual(await postBot(p.fetchImpl, conn, { title: 'Scout' }), { ok: true, bot: { name: 'scout', label: 'Scout' } });
  assert.equal(p.calls[0].body, '{"title":"Scout"}');
  assert.deepEqual(await postBot(fake(409, { error: { code: 'exists' } }).fetchImpl, conn, {}), { ok: false, failure: { kind: 'exists' } });
  assert.deepEqual(await postBot(fake(0, null, { throws: true }).fetchImpl, conn, {}), { ok: false, failure: { kind: 'offline' } });
  assert.deepEqual(await postBot(fake(0, null, { hang: true }).fetchImpl, conn, {}, 20), { ok: false, failure: { kind: 'server', reason: 'timeout' } });
  assert.deepEqual(await postBot(fake(201, { nope: 1 }).fetchImpl, conn, {}), { ok: false, failure: { kind: 'server', reason: 'unknown' } });
});

test('Bots tab: create button, the owner note (command for admins), or the 0.1 look', async () => {
  const { createOffer, createShowsTab } = await import('./core.ts');
  const cfg = (allowed: boolean, reason = '', admin = false) => ({ create: allowed ? { allowed: true as const } : { allowed: false as const, reason }, admin, limit: 50, count: 0 });
  assert.deepEqual(createOffer(cfg(true)), { kind: 'create' });
  assert.deepEqual(createOffer(cfg(false, 'owner_off', true)), { kind: 'owner', reason: 'owner_off', command: true });
  assert.deepEqual(createOffer(cfg(false, 'owner_off', false)), { kind: 'owner', reason: 'owner_off', command: false });
  assert.deepEqual(createOffer(cfg(false, 'multiplex_off', true)), { kind: 'owner', reason: 'multiplex_off', command: false });
  assert.equal(createOffer(null), null);
  assert.equal(createShowsTab(cfg(true)), true);
  assert.equal(createShowsTab(cfg(false, 'owner_off', true)), true, 'the owner discovers it');
  assert.equal(createShowsTab(cfg(false, 'owner_off', false)), false, 'a paired device without bots keeps the 0.1 look');
  assert.equal(createShowsTab(cfg(false, 'plugin_not_configured', true)), false, 'default bridge without plugin: 0.1 look');
  assert.equal(createShowsTab(cfg(false, 'bridge_off', true)), false);
  assert.equal(createShowsTab(null), false);
});

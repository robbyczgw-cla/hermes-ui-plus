/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLockBody, modelLockOutcome, modelLockTarget, modelLocked, sanitizeModelLock, sessionStored } from './modelLock.ts';
import { createSessionsClient } from './sessions.ts';
import type { FetchLike, FetchResponseLike } from './stream.ts';
import type { ChatMessage } from './types';
import { migrateIndex } from '../conversations/migrate.ts';
import { indexReducer } from '../conversations/indexReducer.ts';

const msg = (extra: Partial<ChatMessage>): ChatMessage => ({ id: 'm', role: 'assistant', text: '', tools: [], status: 'streaming', createdAt: 1, ...extra });

test('lock body: route alias as is, provider::model split like a chat completion', () => {
  assert.deepEqual(modelLockBody('alias-fast'), { model: 'alias-fast' });
  assert.deepEqual(modelLockBody('openrouter::vendor/model-x'), { model: 'vendor/model-x', provider: 'openrouter' });
});

test('session stored: an accepted turn (completion id), a finished one, or a chat listed by the server', () => {
  assert.equal(sessionStored([], false), false);
  assert.equal(sessionStored([msg({ role: 'user' })], false), false);
  assert.equal(sessionStored([msg({ status: 'error' })], false), false);
  assert.equal(sessionStored([msg({ completionId: 'chatcmpl-1' })], false), true);
  assert.equal(sessionStored([msg({ status: 'done' })], false), true);
  assert.equal(sessionStored([], true), true);
});

test('target: only an explicit pick, only with the capability and a stored session, once per model', () => {
  const base = { supported: true, stored: true, model: 'alias-main' };
  assert.equal(modelLockTarget(base), 'alias-main');
  assert.equal(modelLockTarget({ ...base, supported: false }), null);
  assert.equal(modelLockTarget({ ...base, stored: false }), null);
  assert.equal(modelLockTarget({ ...base, model: undefined }), null, 'profile default: nothing picked for this chat');
  assert.equal(modelLockTarget({ ...base, model: 'hermes-agent' }), null, 'virtual default cannot be locked (400 missing_model)');
  assert.equal(modelLockTarget({ ...base, lock: { model: 'alias-main', status: 'locked', at: 1 } }), null);
  assert.equal(modelLockTarget({ ...base, lock: { model: 'alias-main', status: 'refused', at: 1 } }), null, 'refused: not retried');
  assert.equal(modelLockTarget({ ...base, lock: { model: 'other', status: 'locked', at: 1 } }), 'alias-main', 'model changed: lock again');
});

/** fake Hermes for POST /api/sessions/{id}/model */
function fakeHermes(status: number, body: unknown) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const res: FetchResponseLike = { ok: status < 300, status, headers: { get: () => null }, body: null, text: async () => text };
    return res;
  };
  return { client: createSessionsClient(fetch, { baseUrl: 'http://h:8645/v1', apiKey: 'k' }), calls };
}

async function outcomeFor(status: number, body: unknown) {
  const { client } = fakeHermes(status, body);
  try {
    await client.lockModel('hui-1', 'alias-main');
    return modelLockOutcome('alias-main', undefined, 7);
  } catch (e) {
    return modelLockOutcome('alias-main', e, 7);
  }
}

test('client: POST /api/sessions/{id}/model with the split body, runtime parsed', async () => {
  const { client, calls } = fakeHermes(200, {
    object: 'hermes.session.model_lock', session_id: 'hui 1',
    runtime: { provider: 'openrouter', model: 'vendor/model-x', route_source: 'raw_request', model_lock: 'accepted' },
  });
  const r = await client.lockModel('hui 1', 'openrouter::vendor/model-x');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'http://h:8645/api/sessions/hui%201/model');
  assert.deepEqual(JSON.parse(calls[0].body ?? ''), { model: 'vendor/model-x', provider: 'openrouter' });
  assert.deepEqual(r, { model: 'vendor/model-x', provider: 'openrouter' });
});

test('outcomes: locked / refused (409, 400) / later (session not stored, network, 5xx) / unsupported (plain 404, 405)', async () => {
  assert.deepEqual(await outcomeFor(200, { runtime: {} }), { kind: 'done', state: { model: 'alias-main', status: 'locked', at: 7 } });
  assert.deepEqual(await outcomeFor(409, { error: { message: 'x', code: 'model_lock_unavailable' } }), { kind: 'done', state: { model: 'alias-main', status: 'refused', at: 7 } });
  assert.equal((await outcomeFor(400, { error: { message: 'x', code: 'missing_model' } })).kind, 'done');
  assert.equal((await outcomeFor(404, { error: { message: 'x', code: 'session_not_found' } })).kind, 'later');
  assert.equal((await outcomeFor(500, { error: { message: 'x', code: 'model_lock_persistence_failed' } })).kind, 'later');
  assert.equal((await outcomeFor(404, { error: { message: 'Not found', type: 'invalid_request_error', code: null } })).kind, 'unsupported', 'older UI bridge');
  assert.equal((await outcomeFor(405, '')).kind, 'unsupported');
  assert.equal(modelLockOutcome('m', new TypeError('Network request failed'), 1).kind, 'later');
});

test('header shows "locked" only for the current pick', () => {
  assert.equal(modelLocked('a', { model: 'a', status: 'locked', at: 1 }), true);
  assert.equal(modelLocked('b', { model: 'a', status: 'locked', at: 1 }), false);
  assert.equal(modelLocked('a', { model: 'a', status: 'refused', at: 1 }), false);
  assert.equal(modelLocked(undefined, undefined), false);
});

test('stored lock survives the index migration; junk is dropped; the reducer sets and clears it', () => {
  assert.deepEqual(sanitizeModelLock({ model: 'a', status: 'locked', at: 5 }), { model: 'a', status: 'locked', at: 5 });
  for (const junk of [null, 'x', { model: '', status: 'locked' }, { model: 'a', status: 'maybe' }]) assert.equal(sanitizeModelLock(junk), undefined);
  const idx = migrateIndex({
    version: 1,
    items: [{ id: 'c1', title: 'T', profileId: 'p', profileKind: 'hermes', createdAt: 1, updatedAt: 1, preview: 'x', messageCount: 1, model: 'a', modelLock: { model: 'a', status: 'locked', at: 5 } }],
  });
  const c = idx.items.find((i) => i.id === 'c1');
  assert.deepEqual(c?.modelLock, { model: 'a', status: 'locked', at: 5 });
  const state = { items: idx.items, activeId: 'c1' } as Parameters<typeof indexReducer>[0];
  const set = indexReducer(state, { type: 'setModelLock', id: 'c1', lock: { model: 'b', status: 'locked', at: 6 } });
  assert.equal(set.items[0].modelLock?.model, 'b');
  assert.equal(indexReducer(set, { type: 'setModelLock', id: 'c1', lock: { model: 'b', status: 'locked', at: 6 } }), set, 'unchanged → same state');
  assert.equal(indexReducer(set, { type: 'setModelLock', id: 'c1' }).items[0].modelLock, undefined);
});

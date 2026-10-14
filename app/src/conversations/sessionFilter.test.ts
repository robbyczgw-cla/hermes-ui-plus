/// <reference types="node" />
// Which Hermes sessions the app shows (default: the app's own only) and that hiding is LOCAL ONLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RemoteSession } from '../hermes/sessions.ts';
import { createController } from './controller.ts';
import { createRepo } from './repo.ts';
import { createIndexStore } from './store.ts';
import { memoryStorage } from './storage/kv.ts';
import { foreignToPrune, isAppConversation, mergeRemoteSessions, sessionAllowed, syncSources, inboxSources, type SyncFilter } from './remoteSync.ts';
import type { ConversationMeta } from './types.ts';

const profile = { id: 'p-hermes-host', kind: 'hermes' as const };
const sess = (id: string, source: string, over: Partial<RemoteSession> = {}): RemoteSession => ({ id, source, startedAt: 1000, lastActive: 5000, messageCount: 4, title: `T ${id}`, preview: `p ${id}`, ...over });
const ALL: RemoteSession[] = [
  sess('hui-a1', 'api_server'),
  sess('api-ef8beb15', 'api_server'), // another API client
  sess('20261010_101010_abcd', 'telegram'),
  sess('cli-1', 'cli'),
  sess('cron_aaa111_20261011_142229', 'cron'),
];
const ids = (items: ConversationMeta[]) => items.map((c) => c.hermesSessionId).sort();

test('defaults: only the app own sessions (api_server + hui- prefix) are fetched and listed', () => {
  assert.deepEqual(syncSources(), ['api_server']);
  assert.deepEqual(syncSources({ foreign: true }), ['api_server', 'telegram', 'cli']);
  assert.deepEqual(syncSources({ cron: true }), ['api_server', 'cron']);
  assert.deepEqual(inboxSources(), ['api_server']);
  assert.deepEqual(inboxSources({ foreign: true }), ['api_server']);
  assert.deepEqual(inboxSources({ cron: true }), ['api_server', 'cron']);
  assert.equal(sessionAllowed('api_server', 'hui-x'), true);
  assert.equal(sessionAllowed('api_server', 'api-x'), false);
  assert.equal(sessionAllowed('telegram', 't'), false);
  assert.equal(sessionAllowed('cron', 'cron_a_20261011_080000'), false);
  assert.equal(sessionAllowed('oneshot', 'x', { foreign: true, cron: true }), false);

  const r = mergeRemoteSessions([], { profile, sessions: ALL });
  assert.deepEqual(ids(r.items), ['hui-a1']);
});

test('toggles: "other chats" adds Telegram/CLI/other clients, "cron reports" adds cron', () => {
  const foreign = mergeRemoteSessions([], { profile, sessions: ALL, filter: { foreign: true } });
  assert.deepEqual(ids(foreign.items), ['20261010_101010_abcd', 'api-ef8beb15', 'cli-1', 'hui-a1']);
  const cron = mergeRemoteSessions([], { profile, sessions: ALL, filter: { cron: true } });
  assert.deepEqual(ids(cron.items), ['cron_aaa111_20261011_142229', 'hui-a1']);
});

test('switching off: foreign entries are removed locally, app chats stay, other profiles untouched', () => {
  const on = mergeRemoteSessions([], { profile, sessions: ALL, filter: { foreign: true, cron: true } }).items;
  const local: ConversationMeta = { id: 'c-1', title: 'App', titleSource: 'auto', profileId: 'p-hermes-host', profileKind: 'hermes', hermesSessionId: 'hui-local', createdAt: 1, updatedAt: 2, preview: 'x', messageCount: 2, remote: { source: 'api_server' } };
  const other: ConversationMeta = { ...on.find((c) => c.remote?.source === 'telegram')!, id: 'r-other', profileId: 'p-2' };
  const items = [...on, local, other];

  const offCron = mergeRemoteSessions(items, { profile, sessions: [], filter: { foreign: true } });
  assert.deepEqual(offCron.removed, ['r-cron_aaa111_20261011_142229']);
  const off = mergeRemoteSessions(items, { profile, sessions: [], filter: {} });
  assert.deepEqual(off.removed.sort(), ['r-20261010_101010_abcd', 'r-api-ef8beb15', 'r-cli-1', 'r-cron_aaa111_20261011_142229']);
  assert.deepEqual(off.items.map((c) => c.id).sort(), ['c-1', 'r-hui-a1', 'r-other']);
  // a fresh list fetch with the toggle off does not bring them back
  const again = mergeRemoteSessions(off.items, { profile, sessions: ALL, filter: {} });
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.items.map((c) => c.id).sort(), ['c-1', 'r-hui-a1', 'r-other']);
});

test('cron chats created from a live inbox event (cron_ session id, no remote marker) are pruned too', () => {
  const inboxCron: ConversationMeta = { id: 'c-cron', title: 'Bericht', titleSource: 'auto', profileId: 'p-hermes-host', profileKind: 'hermes', hermesSessionId: 'cron_aaa111_20261011_142229', createdAt: 1, updatedAt: 2, preview: 'Bericht', messageCount: 1 };
  const inboxCronMarked: ConversationMeta = { ...inboxCron, id: 'c-cron2', hermesSessionId: 'cron_bbb_20261011_142300', origin: 'remote', remote: { source: 'cron' } };
  const appChat: ConversationMeta = { ...inboxCron, id: 'c-app', hermesSessionId: 'hui-1' };
  assert.equal(isAppConversation(inboxCron), false);
  assert.equal(isAppConversation(appChat), true);
  const items = [inboxCron, inboxCronMarked, appChat];
  assert.deepEqual(foreignToPrune(items, 'p-hermes-host', {}).sort(), ['c-cron', 'c-cron2']);
  assert.deepEqual(foreignToPrune(items, 'p-hermes-host', { foreign: true }).sort(), ['c-cron', 'c-cron2']);
  assert.deepEqual(foreignToPrune(items, 'p-hermes-host', { cron: true }), []);
});

test('pruning (filter change / app update migration) is local only: no network request, never a DELETE', async () => {
  const store = createIndexStore();
  const repo = createRepo(memoryStorage(), { debounceMs: 1 });
  const ctl = createController(store, repo);
  const calls: { url: string; method: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const on: SyncFilter = { foreign: true, cron: true };
    ctl.mergeRemote(profile, ALL, { filter: on });
    ctl.save('r-20261010_101010_abcd', [{ id: 'm1', role: 'assistant', text: 'aus Telegram', tools: [], status: 'done', createdAt: 1 }]);
    store.dispatch({ type: 'setActive', id: 'r-20261010_101010_abcd' });
    assert.equal(ctl.list().length, 5);

    const res = ctl.pruneForeign(profile, {}); // toggles off (also the first start after the update)
    assert.equal(res.removed.length, 4);
    assert.deepEqual(ctl.list().map((c) => c.hermesSessionId), ['hui-a1']);
    assert.notEqual(store.get().activeId, 'r-20261010_101010_abcd'); // shell opens a new chat
    assert.deepEqual(store.get().hiddenRemote ?? [], []); // no tombstone: switching on again brings them back
    assert.deepEqual(await ctl.loadMessages('r-20261010_101010_abcd'), []); // local transcript gone
    ctl.mergeRemote(profile, ALL, { filter: {} });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls.filter((c) => c.method === 'DELETE'), []);
    assert.deepEqual(calls, []);
    ctl.mergeRemote(profile, ALL, { filter: { foreign: true } });
    assert.equal(ctl.list().length, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('"In Hermes löschen" is only for app sessions (foreign chats can only be hidden locally)', () => {
  const r = mergeRemoteSessions([], { profile, sessions: ALL, filter: { foreign: true, cron: true } }).items;
  const allowed = r.filter(isAppConversation).map((c) => c.hermesSessionId);
  assert.deepEqual(allowed, ['hui-a1']);
});

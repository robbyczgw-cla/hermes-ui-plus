/// <reference types="node" />
// Bulk delete: selection reducer, plan (running / pinned / local-only guarantees), batching + undo window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../hermes/types.ts';
import {
  applyListFilter,
  createBulkDeleter,
  DAY_MS,
  EMPTY_SELECTION,
  planDelete,
  remoteDeletable,
  selectableIds,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from './bulkDelete.ts';
import { createController } from './controller.ts';
import { INDEX_KEY, createRepo, msgsKey, type StorageLike } from './repo.ts';
import { createIndexStore } from './store.ts';
import type { ConversationMeta } from './types.ts';

const NOW = 100 * DAY_MS;
const meta = (id: string, over: Partial<ConversationMeta> = {}): ConversationMeta => ({
  id,
  title: id,
  titleSource: 'auto',
  profileId: 'p-hermes-host',
  profileKind: 'hermes',
  hermesSessionId: `hui-${id}`,
  createdAt: NOW - DAY_MS,
  updatedAt: NOW - DAY_MS,
  preview: 'x',
  messageCount: 2,
  ...over,
});
// app-own (created here), app-own synced, foreign Telegram / CLI / cron / other API client, two local-only chats
const own = meta('own');
const ownSynced = meta('own2', { remote: { source: 'api_server' } });
const telegram = meta('tg', { origin: 'remote', hermesSessionId: '20261010_101010_ab', remote: { source: 'telegram' } });
const cli = meta('cli', { origin: 'remote', hermesSessionId: 'cli-1', remote: { source: 'cli' } });
const cron = meta('cron', { origin: 'remote', hermesSessionId: 'cron_job_20261011_142229', remote: { source: 'cron' } });
const otherApi = meta('api', { origin: 'remote', hermesSessionId: 'api-ef8b', remote: { source: 'api_server' } });
const nano = meta('nano', { profileId: 'p-nano', profileKind: 'demo', hermesSessionId: 'nc-1' });
const claude = meta('cl', { profileId: 'p-cl', profileKind: 'demo', hermesSessionId: 'claude-1' });
const FOREIGN = [telegram, cli, cron, otherApi];

const run = (s: SelectionState, ...as: SelectionAction[]) => as.reduce(selectionReducer, s);
const ids = (s: SelectionState) => [...s.selected].sort();

test('selection reducer: enter / toggle / select all / none / retain / exit', () => {
  let s = run(EMPTY_SELECTION, { type: 'toggle', id: 'a' });
  assert.equal(s, EMPTY_SELECTION, 'toggle outside selection mode is ignored');
  s = run(EMPTY_SELECTION, { type: 'enter', id: 'a' });
  assert.equal(s.active, true);
  assert.deepEqual(ids(s), ['a']);
  assert.equal(selectionReducer(s, { type: 'enter', id: 'a' }), s, 'long press on a ticked row: no change');
  s = run(s, { type: 'toggle', id: 'b' }, { type: 'toggle', id: 'a' });
  assert.deepEqual(ids(s), ['b']);
  s = run(s, { type: 'selectAll', ids: ['c', 'd'] });
  assert.deepEqual(ids(s), ['b', 'c', 'd'], 'select all keeps explicit ticks');
  s = run(s, { type: 'retain', ids: ['b', 'd', 'x'] });
  assert.deepEqual(ids(s), ['b', 'd']);
  const same = selectionReducer(s, { type: 'retain', ids: ['b', 'd'] });
  assert.equal(same, s, 'unchanged retain keeps identity (no re-render loop)');
  s = run(s, { type: 'clear' });
  assert.equal(s.active, true);
  assert.equal(s.selected.size, 0);
  s = run(s, { type: 'toggle', id: 'z' }, { type: 'exit' });
  assert.equal(s, EMPTY_SELECTION);
  // "Auswählen" button: enter without a tick
  assert.deepEqual(ids(run(EMPTY_SELECTION, { type: 'enter' })), []);
});

test('filters and select all: older than 7 days, this profile, pinned + running not auto-selected', () => {
  const fresh = meta('fresh', { updatedAt: NOW - DAY_MS });
  const old = meta('old', { updatedAt: NOW - 8 * DAY_MS });
  const oldNano = { ...nano, updatedAt: NOW - 30 * DAY_MS };
  assert.deepEqual(applyListFilter([fresh, old, oldNano], { olderThanDays: 7 }, NOW).map((c) => c.id), ['old', 'nano']);
  assert.deepEqual(applyListFilter([fresh, old, oldNano], { olderThanDays: 7, profileId: 'p-hermes-host' }, NOW).map((c) => c.id), ['old']);
  assert.equal(applyListFilter([fresh, old], {}, NOW).length, 2);
  const pinned = meta('pin', { pinned: true });
  assert.deepEqual(selectableIds([fresh, old, pinned], (id) => id === 'old'), ['fresh']);
});

test('plan: running turns are skipped, pinned only when included, tombstones for synced Hermes chats', () => {
  const pinned = meta('pin', { pinned: true });
  const p = planDelete([own, ownSynced, pinned, telegram], { isRunning: (id) => id === 'own', includePinned: false, isSynced: () => true, canDeleteRemote: () => true });
  assert.deepEqual(p.metas.map((c) => c.id), ['own2', 'tg']);
  assert.equal(p.skippedRunning, 1);
  assert.equal(p.skippedPinned, 1);
  assert.deepEqual(p.hide, ['p-hermes-host::hui-own2', 'p-hermes-host::20261010_101010_ab']); // per-server tombstones (H4)
  assert.deepEqual(p.remote.map((c) => c.id), ['own2']);
  assert.equal(p.foreign, 1);
  const withPinned = planDelete([pinned], { isRunning: () => false, includePinned: true });
  assert.deepEqual(withPinned.metas.map((c) => c.id), ['pin']);
});

test('plan: a bot\'s Bot Chat (shared with Hermes Desktop) is never part of "delete all", never deleted on Hermes', () => {
  const botChat = meta('bc', { botChat: true, hermesSessionId: 'api_1792474903_2b8287a5', hermesProfile: 'writer', title: 'Bot Chat' });
  assert.equal(remoteDeletable(botChat), false);
  const p = planDelete([own, botChat], { isRunning: () => false, includePinned: true, isSynced: () => true, canDeleteRemote: () => true });
  assert.deepEqual(p.metas.map((c) => c.id), ['own']);
  assert.deepEqual(p.remote.map((c) => c.id), ['own']);
  assert.equal(p.hide.some((h) => h.includes('api_1792474903')), false);
});

test('plan: foreign sessions and local-only chats are never offered for a Hermes delete', () => {
  const p = planDelete([...FOREIGN, nano, claude, own], { isRunning: () => false, includePinned: true, isSynced: () => true, canDeleteRemote: () => true });
  assert.equal(p.metas.length, 7, 'all removed locally');
  assert.deepEqual(p.remote.map((c) => c.id), ['own']);
  assert.equal(p.foreign, 4);
  for (const m of [...FOREIGN, nano, claude]) assert.equal(remoteDeletable(m), false, m.id);
  assert.equal(remoteDeletable(own), true);
  // no server configured: nothing remote at all
  assert.equal(planDelete([own], { isRunning: () => false, includePinned: true }).remote.length, 0);
});

// ------------------------------------------------------------------ deleter

function countingStorage() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const s: StorageLike & { data: Map<string, string>; writes: string[] } = {
    data,
    writes,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      writes.push(k);
      data.set(k, v);
    },
    async removeItem(k) {
      writes.push('rm ' + k);
      data.delete(k);
    },
    async getAllKeys() {
      return Array.from(data.keys());
    },
  };
  return s;
}

const msg = (i: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: `t${i}`, tools: [], status: 'done', createdAt: i, ...extra });

/** store + repo + controller wired like ConversationsProvider (index persisted on every store change) */
async function setup(items: ConversationMeta[]) {
  const storage = countingStorage();
  const repo = createRepo(storage, { debounceMs: 5 });
  const store = createIndexStore({ items });
  const controller = createController(store, repo, () => NOW);
  store.subscribe(() => repo.saveIndex(store.get()));
  for (const c of items) repo.saveMessages(c.id, [msg(0), msg(1)]);
  await repo.flush();
  storage.writes.length = 0;
  let timer: (() => void) | null = null;
  const purged: string[][] = [];
  const remoteCalls: string[] = [];
  let dispatches = 0;
  store.subscribe(() => dispatches++);
  const deleter = createBulkDeleter({
    store,
    purge: async (ids) => {
      purged.push(ids);
      for (const id of ids) repo.removeMessages(id);
    },
    setTimer: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimer: () => {
      timer = null;
    },
  });
  const deleteRemote = async (m: ConversationMeta) => {
    remoteCalls.push(m.id);
  };
  return {
    storage,
    repo,
    store,
    controller,
    deleter,
    purged,
    remoteCalls,
    deleteRemote,
    dispatches: () => dispatches,
    /** the undo window ends */
    expire: () => {
      const f = timer;
      timer = null;
      f?.();
    },
  };
}

test('bulk delete: one index update/write, transcripts kept during the undo window, removed after it', async () => {
  const many = Array.from({ length: 40 }, (_, i) => meta(`c${i}`));
  const keep = meta('keep');
  const env = await setup([...many, keep]);
  const plan = planDelete(many, { isRunning: () => false, includePinned: true });
  env.deleter.start(plan);
  assert.equal(env.dispatches(), 1, 'one store update for 40 chats');
  assert.deepEqual(env.controller.list().map((c) => c.id), ['keep']);
  assert.equal(env.deleter.pending()?.count, 40);
  await env.repo.flush();
  assert.deepEqual(env.storage.writes, [INDEX_KEY], 'exactly one index write, no transcript removed yet');
  assert.ok(env.storage.data.has(msgsKey('c0')), 'data kept for undo');

  env.expire();
  await new Promise((r) => setTimeout(r, 0));
  await env.repo.flush();
  assert.equal(env.purged.length, 1);
  assert.equal(env.purged[0].length, 40, 'purged in one batch');
  assert.equal(env.storage.writes.filter((w) => w === INDEX_KEY).length, 1, 'commit does not rewrite the index');
  assert.equal([...env.storage.data.keys()].filter((k) => k.startsWith(msgsKey('c'))).length, 0, 'all transcripts removed');
  assert.ok(env.storage.data.has(msgsKey('keep')));
  assert.equal(env.deleter.pending(), null);
});

test('undo window: undo restores entries + tombstones, nothing deleted locally or on Hermes', async () => {
  const env = await setup([own, ownSynced, telegram]);
  env.store.dispatch({ type: 'load', state: { ...env.store.get(), hiddenRemote: ['older-tombstone'], activeId: 'own2' } });
  const plan = planDelete([own, ownSynced, telegram], { isRunning: () => false, includePinned: true, isSynced: () => true, canDeleteRemote: () => true });
  env.deleter.start(plan, env.deleteRemote);
  assert.equal(env.store.get().activeId, undefined, 'the open chat was deleted → the shell starts a new one');
  assert.deepEqual(env.store.get().hiddenRemote, ['older-tombstone', 'p-hermes-host::hui-own', 'p-hermes-host::hui-own2', 'p-hermes-host::20261010_101010_ab']);
  assert.equal(env.deleter.pending()?.remote, 2);

  assert.equal(env.deleter.undo(), true);
  assert.deepEqual(env.controller.list().map((c) => c.id).sort(), ['own', 'own2', 'tg']);
  assert.deepEqual(env.store.get().hiddenRemote, ['older-tombstone'], 'only the tombstones of this batch are removed');
  env.expire(); // timer was cleared: no-op
  await new Promise((r) => setTimeout(r, 0));
  await env.repo.flush();
  assert.deepEqual(env.remoteCalls, []);
  assert.deepEqual(env.purged, []);
  assert.ok(env.storage.data.has(msgsKey('own')));
  assert.equal(env.deleter.undo(), false, 'nothing left to undo');
});

test('Hermes deletes only after the undo window and only for app-own Hermes chats', async () => {
  const all = [own, ownSynced, ...FOREIGN, nano, claude];
  const env = await setup(all);
  // even a plan that (wrongly) lists foreign / local-only chats as remote never reaches the server
  const plan = { ...planDelete(all, { isRunning: () => false, includePinned: true }), remote: all };
  env.deleter.start(plan, env.deleteRemote);
  assert.deepEqual(env.remoteCalls, [], 'nothing on the server during the undo window');
  assert.equal(env.deleter.pending()?.remote, 2);
  env.expire();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(env.remoteCalls, ['own', 'own2']);
});

test('local-only delete (no deleteRemote): no server call for anything, also not for app-own chats', async () => {
  const env = await setup([own, telegram, nano]);
  env.deleter.start(planDelete([own, telegram, nano], { isRunning: () => false, includePinned: true, canDeleteRemote: () => true }));
  assert.equal(env.deleter.pending()?.remote, 0);
  const r = await env.deleter.commit();
  assert.equal(r?.count, 3);
  assert.equal(r?.remoteOk, 0);
  assert.deepEqual(env.remoteCalls, []);
});

test('a new batch commits the waiting one first; failed Hermes deletes are reported', async () => {
  const env = await setup([own, ownSynced, meta('x')]);
  env.deleter.start(planDelete([own], { isRunning: () => false, includePinned: true, canDeleteRemote: () => true }), async () => {
    throw new Error('offline');
  });
  env.deleter.start(planDelete([meta('x')], { isRunning: () => false, includePinned: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(env.purged, [['own']], 'first batch committed');
  assert.equal(env.deleter.report()?.remoteFailed, 1);
  assert.equal(env.deleter.pending()?.count, 1, 'second batch waits for its own window');
  env.deleter.dismissReport();
  assert.equal(env.deleter.report(), null);
  assert.equal(env.deleter.undo(), true);
  assert.ok(env.controller.get('x'));
  assert.equal(env.controller.get('own'), undefined, 'the committed batch stays deleted');
});

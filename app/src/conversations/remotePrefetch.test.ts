/// <reference types="node" />
// Fetching never-opened Hermes chats ahead: which chats, in what order, how often, and that the result is stored like
// a normal open (reconciled, saved, acked) without moving the chat in the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RemoteSession } from '../hermes/sessions.ts';
import { mapRemoteMessages } from '../hermes/sessionMapping.ts';
import { createController } from './controller.ts';
import { createRepo } from './repo.ts';
import { createIndexStore } from './store.ts';
import { memoryStorage } from './storage/kv.ts';
import {
  createAttemptLog,
  createSharedRequests,
  prefetchAllowed,
  remotePrefetchCandidates,
  runSequential,
  storeFetchedTranscript,
  REMOTE_PREFETCH_MAX,
} from './remotePrefetch.ts';
import { applyRemoteSnapshot, needsRemoteLoad, remoteLoadedAt, SNAPSHOT_SAVE } from './remoteSync.ts';
import type { ConversationMeta } from './types.ts';

const profile = { id: 'p-test-hermes', kind: 'hermes' as const };
const other = { id: 'p-test-other', kind: 'hermes' as const };
const sess = (id: string, lastActive: number, over: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  source: 'api_server',
  startedAt: 1000,
  lastActive,
  messageCount: 4,
  title: `T ${id}`,
  preview: `p ${id}`,
  ...over,
});

async function boot() {
  const repo = createRepo(memoryStorage(), { debounceMs: 5 });
  const store = createIndexStore(await repo.loadIndex());
  return { repo, store, ctl: createController(store, repo) };
}

const bySession = (items: readonly ConversationMeta[], sid: string) => items.find((c) => c.hermesSessionId === sid)!;
const sids = (list: ConversationMeta[]) => list.map((c) => c.hermesSessionId);

function rows(turns: number, t0 = 1_790_000_000_000) {
  return Array.from({ length: turns * 2 }, (_, i) => ({
    id: String(100 + i),
    role: i % 2 ? 'assistant' : 'user',
    content: i % 2 ? `Answer ${i >> 1}` : `Question ${i >> 1}`,
    timestamp: t0 + i * 1000,
    ...(i % 2 ? { finishReason: 'stop' } : {}),
  }));
}

test('candidates: never-loaded Hermes chats of the active profile, newest first, at most 4', async () => {
  const a = await boot();
  const sessions = Array.from({ length: 6 }, (_, i) => sess(`hui-r${i}`, 10_000 + i * 1000));
  a.ctl.mergeRemote(profile, sessions);
  a.ctl.mergeRemote(other, [sess('hui-elsewhere', 99_000)]);
  const items = a.store.get().items;
  const picked = remotePrefetchCandidates(items, { profileId: profile.id, filter: {} });
  assert.equal(REMOTE_PREFETCH_MAX, 4);
  assert.deepEqual(sids(picked), ['hui-r5', 'hui-r4', 'hui-r3', 'hui-r2']);
  // the open chat, recent failures and archived chats are skipped; the next ones move up
  const open = bySession(items, 'hui-r5').id;
  const failed = bySession(items, 'hui-r4').id;
  a.ctl.archive(bySession(items, 'hui-r3').id, true);
  const next = remotePrefetchCandidates(a.store.get().items, { profileId: profile.id, filter: {}, exclude: (id) => id === open, skip: (id) => id === failed });
  assert.deepEqual(sids(next), ['hui-r2', 'hui-r1', 'hui-r0']);
  assert.deepEqual(remotePrefetchCandidates(items, { profileId: profile.id, filter: {}, limit: 0 }), []);
});

test('candidates: chats with a local copy (app chats, loaded ones) are never fetched ahead', async () => {
  const a = await boot();
  const mine = a.ctl.create(profile, { fresh: true });
  a.ctl.save(mine.id, [{ id: 'u1', role: 'user', text: 'hello', tools: [], status: 'done', createdAt: 1 }]);
  a.ctl.mergeRemote(profile, [sess('hui-r1', 5000), sess('hui-r2', 6000)]);
  const loaded = bySession(a.store.get().items, 'hui-r2').id;
  a.ctl.markRemoteLoaded(loaded, 6000);
  assert.deepEqual(sids(remotePrefetchCandidates(a.store.get().items, { profileId: profile.id, filter: {} })), ['hui-r1']);
});

test('candidates follow the drawer filter: other clients only with "show other Hermes chats"', async () => {
  const a = await boot();
  const foreign = [sess('20261010_101010_abcd', 9000, { source: 'telegram' }), sess('cli-1', 8000, { source: 'cli' })];
  a.ctl.mergeRemote(profile, [sess('hui-own', 7000), ...foreign], { filter: { foreign: true } });
  const items = a.store.get().items;
  assert.equal(items.length, 3);
  // the setting is off (entries not pruned yet in this tick): nothing outside the filter is fetched
  assert.deepEqual(sids(remotePrefetchCandidates(items, { profileId: profile.id, filter: {} })), ['hui-own']);
  assert.deepEqual(sids(remotePrefetchCandidates(items, { profileId: profile.id, filter: { foreign: true } })), ['20261010_101010_abcd', 'cli-1', 'hui-own']);
});

test('candidates follow the "Chats" scope: "only this device" fetches no app chat from another device ahead', async () => {
  const a = await boot();
  a.ctl.mergeRemote(profile, [sess('hui-own', 7000), sess('20261010_101010_abcd', 9000, { source: 'telegram' })], { filter: { foreign: true } });
  const items = a.store.get().items;
  const opts = { profileId: profile.id, filter: { foreign: true } };
  assert.deepEqual(sids(remotePrefetchCandidates(items, { ...opts, scope: 'all' })), ['20261010_101010_abcd', 'hui-own']);
  // Telegram still follows the profile switch; the app chat from another device is not listed, so not fetched
  assert.deepEqual(sids(remotePrefetchCandidates(items, { ...opts, scope: 'device' })), ['20261010_101010_abcd']);
});

test('storeFetchedTranscript: saved + acked like an open, list order kept, the chat then opens from memory', async () => {
  const a = await boot();
  a.ctl.mergeRemote(profile, [sess('hui-r1', 1_790_000_003_000)]);
  const meta = bySession(a.store.get().items, 'hui-r1');
  const updatedAt = meta.updatedAt;
  assert.equal(needsRemoteLoad(meta), true);
  const remote = mapRemoteMessages(rows(2));
  const ok = await storeFetchedTranscript(a.ctl, meta.id, { remote, newest: 1_790_000_003_000 }, { activityAtStart: meta.remote?.lastActive, isMounted: () => false });
  assert.equal(ok, true);
  const after = a.ctl.get(meta.id)!;
  assert.equal(after.updatedAt, updatedAt);
  assert.equal(after.remote?.loadedAt, 1_790_000_003_000);
  assert.equal(needsRemoteLoad(after), false);
  assert.equal(after.messageCount, 4);
  assert.deepEqual(a.ctl.peekMessages(meta.id)?.map((m) => m.text), ['Question 0', 'Answer 0', 'Question 1', 'Answer 1']);
});

test('drawer order = server activity: opening a never-opened chat keeps its place, exactly like a fetch ahead', async () => {
  const t0 = 1_790_000_000_000;
  const a = await boot();
  a.ctl.mergeRemote(profile, [sess('hui-new', t0 + 30_000), sess('hui-mid', t0 + 20_000), sess('hui-old', t0 + 10_000)]);
  const order = () => sids(a.ctl.list());
  assert.deepEqual(order(), ['hui-new', 'hui-mid', 'hui-old']);

  // the open path (HermesSession → useApplyRemoteTranscript): reconcile, save, ack – the chat stays where it is
  const open = async (sid: string, newest: number) => {
    const meta = bySession(a.store.get().items, sid);
    const local = await a.ctl.loadMessages(meta.id);
    const at = remoteLoadedAt(meta.remote?.lastActive, newest);
    applyRemoteSnapshot({
      messages: local,
      remote: mapRemoteMessages(rows(1, newest - 1000)),
      origin: meta.origin,
      replace: () => true,
      save: (m) => a.ctl.save(meta.id, m, SNAPSHOT_SAVE),
      ack: () => a.ctl.markRemoteLoaded(meta.id, at, newest),
    });
  };
  await open('hui-old', t0 + 10_000);
  assert.deepEqual(order(), ['hui-new', 'hui-mid', 'hui-old'], 'opened, not moved');
  // the fetch ahead of another chat: same place
  const mid = bySession(a.store.get().items, 'hui-mid');
  await storeFetchedTranscript(a.ctl, mid.id, { remote: mapRemoteMessages(rows(1, t0 + 19_000)), newest: t0 + 20_000 }, { activityAtStart: t0 + 20_000, isMounted: () => false });
  assert.deepEqual(order(), ['hui-new', 'hui-mid', 'hui-old']);
  // newer server activity than the list knew (continued elsewhere since the last list sync): it moves up by THAT time
  await open('hui-mid', t0 + 40_000);
  assert.deepEqual(order(), ['hui-mid', 'hui-new', 'hui-old']);
  assert.equal(bySession(a.store.get().items, 'hui-mid').updatedAt, t0 + 40_000);
  // a turn sent in this app is activity: a normal save moves the chat to the top
  const old = bySession(a.store.get().items, 'hui-old');
  const msgs = await a.ctl.loadMessages(old.id);
  a.ctl.save(old.id, [...msgs, { id: 'u-local', role: 'user', text: 'one more', tools: [], status: 'done', createdAt: Date.now() }]);
  assert.equal(order()[0], 'hui-old');
});

test('storeFetchedTranscript stores nothing for a chat that is open / gone / loaded meanwhile or a cancelled run', async () => {
  const a = await boot();
  a.ctl.mergeRemote(profile, [sess('hui-r1', 5000), sess('hui-r2', 6000), sess('hui-r3', 7000)]);
  const items = a.store.get().items;
  const fetched = { remote: mapRemoteMessages(rows(1)), newest: 5000 };
  const [r1, r2, r3] = ['hui-r1', 'hui-r2', 'hui-r3'].map((s) => bySession(items, s).id);
  // opened while the request ran: its mounted session applies the (shared) result itself
  assert.equal(await storeFetchedTranscript(a.ctl, r1, fetched, { activityAtStart: 5000, isMounted: (id) => id === r1 }), false);
  assert.equal(a.ctl.get(r1)?.remote?.loadedAt, undefined);
  assert.equal(a.ctl.peekMessages(r1), undefined);
  // cancelled (profile switch)
  assert.equal(await storeFetchedTranscript(a.ctl, r2, fetched, { activityAtStart: 6000, isMounted: () => false, cancelled: () => true }), false);
  assert.equal(a.ctl.get(r2)?.remote?.loadedAt, undefined);
  // loaded meanwhile (opened and closed again): not overwritten
  a.ctl.markRemoteLoaded(r3, 7000);
  assert.equal(await storeFetchedTranscript(a.ctl, r3, fetched, { activityAtStart: 7000, isMounted: () => false }), false);
  // deleted
  assert.equal(await storeFetchedTranscript(a.ctl, 'r-gone', fetched, { activityAtStart: 1, isMounted: () => false }), false);
});

test('runSequential: one at a time, bounded, a failing step does not stop it, cancel stops before the next', async () => {
  let active = 0;
  let maxActive = 0;
  const seen: string[] = [];
  const step = async (id: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    seen.push(id);
    if (id === 'b') throw new Error('offline');
    return id !== 'c';
  };
  let yields = 0;
  const r = await runSequential(['a', 'b', 'c', 'd', 'e', 'f'], step, { max: 4, between: async () => void yields++ });
  assert.equal(maxActive, 1);
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
  assert.deepEqual(r, { done: ['a', 'd'], failed: ['b', 'c'] });
  assert.equal(yields, 4);

  let stop = false;
  const r2 = await runSequential(['a', 'b', 'c'], async (id) => {
    if (id === 'a') stop = true;
    return true;
  }, { cancelled: () => stop });
  assert.deepEqual(r2, { done: ['a'], failed: [] });
});

test('attempt log: a failed chat waits for the retry window, a success forgets it', () => {
  let now = 1000;
  const log = createAttemptLog(() => now, 60_000);
  assert.equal(log.recent('x'), false);
  log.record('x', false);
  assert.equal(log.recent('x'), true);
  now += 59_999;
  assert.equal(log.recent('x'), true);
  now += 1;
  assert.equal(log.recent('x'), false);
  log.record('x', false);
  log.record('x', true);
  assert.equal(log.recent('x'), false);
});

test('shared requests: a prefetch and an open of the same session cost one request', async () => {
  const shared = createSharedRequests<number>();
  let calls = 0;
  let release!: (v: number) => void;
  const fn = () => {
    calls++;
    return new Promise<number>((r) => (release = r));
  };
  const a = shared.run('srv|hui-1', fn);
  const b = shared.run('srv|hui-1', fn);
  assert.equal(a, b);
  assert.equal(shared.has('srv|hui-1'), true);
  release(7);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
  assert.equal(calls, 1);
  assert.equal(shared.has('srv|hui-1'), false); // settled requests are forgotten: a later open fetches fresh
  await shared.run('srv|hui-1', async () => (calls++, 1));
  assert.equal(calls, 2);
  // a failure is shared too, and forgotten
  const failing = shared.run('k', async () => {
    throw new Error('offline');
  });
  await assert.rejects(failing);
  assert.equal(shared.has('k'), false);
});

test('prefetchAllowed: only after a successful list sync, in the foreground, online and not metered', () => {
  assert.equal(prefetchAllowed({ syncStatus: 'idle' }), true);
  assert.equal(prefetchAllowed({ syncStatus: 'idle', online: true, metered: false, foreground: true }), true);
  assert.equal(prefetchAllowed({ syncStatus: 'syncing' }), false);
  assert.equal(prefetchAllowed({ syncStatus: 'error' }), false);
  assert.equal(prefetchAllowed({ syncStatus: 'off' }), false);
  assert.equal(prefetchAllowed({ syncStatus: 'unsupported' }), false);
  assert.equal(prefetchAllowed({ syncStatus: 'idle', online: false }), false);
  assert.equal(prefetchAllowed({ syncStatus: 'idle', metered: true }), false);
  assert.equal(prefetchAllowed({ syncStatus: 'idle', foreground: false }), false);
});

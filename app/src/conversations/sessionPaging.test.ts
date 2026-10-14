/// <reference types="node" />
// Older Hermes sessions: the list sync only fetches the newest page per source; the drawer pages further back on demand,
// so older app chats on the server are reachable on a new device. Pages respect the profile filter and the chat scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RemoteSession } from '../hermes/sessions.ts';
import { createController } from './controller.ts';
import { createRepo } from './repo.ts';
import { createIndexStore } from './store.ts';
import { memoryStorage } from './storage/kv.ts';
import { inChatScope } from './chatScope.ts';
import {
  OLDER_MAX_PAGES,
  OLDER_PAGE,
  SESSION_PAGE,
  afterFirstPage,
  hasOlder,
  loadOlderSessions,
  pagedSources,
  type SourceCursor,
} from './sessionPaging.ts';

const profile = { id: 'p-test-hermes', kind: 'hermes' as const };

/** a server with `n` api_server sessions, newest first; every `appEvery`-th is an app session (`hui-`), the rest other clients */
function server(n: number, appEvery: number) {
  const rows: RemoteSession[] = Array.from({ length: n }, (_, i) => ({
    id: i % appEvery === 0 ? `hui-${String(i).padStart(4, '0')}` : `api-${String(i).padStart(4, '0')}`,
    source: 'api_server',
    startedAt: 1000,
    lastActive: 1_000_000 - i * 1000,
    messageCount: 2,
    title: `T${i}`,
  }));
  const calls: { source: string; offset: number; limit: number }[] = [];
  const list = async (source: string, offset: number, limit: number) => {
    calls.push({ source, offset, limit });
    const all = source === 'api_server' ? rows : [];
    return { sessions: all.slice(offset, offset + limit), hasMore: offset + limit < all.length };
  };
  return { rows, calls, list };
}

async function boot() {
  const repo = createRepo(memoryStorage(), { debounceMs: 5 });
  const store = createIndexStore(await repo.loadIndex());
  return { store, ctl: createController(store, repo) };
}

test('the list sync asks for 50 per source; older pages are bigger', () => {
  assert.equal(SESSION_PAGE, 50);
  assert.ok(OLDER_PAGE >= SESSION_PAGE && OLDER_PAGE <= 200, 'Hermes caps limit at 200');
});

test('afterFirstPage: a cursor already further back is kept, a complete first page ends paging', () => {
  assert.deepEqual(afterFirstPage(undefined, 50, true), { offset: 50, hasMore: true });
  assert.deepEqual(afterFirstPage(undefined, 12, false), { offset: 12, hasMore: false });
  const further: SourceCursor = { offset: 250, hasMore: true };
  assert.equal(afterFirstPage(further, 50, true), further);
  // everything fits into the first page now (sessions deleted): nothing older left
  assert.deepEqual(afterFirstPage(further, 30, false), { offset: 30, hasMore: false });
});

test('pagedSources: the profile filter, minus what the chat scope hides anyway', () => {
  assert.deepEqual(pagedSources({}, 'all'), ['api_server']);
  assert.deepEqual(pagedSources({ foreign: true, cron: true }, 'all'), ['api_server', 'telegram', 'cli', 'cron']);
  // "only this device": app sessions from the list are never shown → api_server is only paged for other clients
  assert.deepEqual(pagedSources({}, 'device'), []);
  assert.deepEqual(pagedSources({ foreign: true }, 'device'), ['api_server', 'telegram', 'cli']);
  assert.deepEqual(pagedSources({ cron: true }, 'device'), ['cron']);
});

test('hasOlder: unknown before the first sync, then per paged source', () => {
  assert.equal(hasOlder({}, ['api_server']), false);
  assert.equal(hasOlder({ api_server: { offset: 50, hasMore: true } }, ['api_server']), true);
  assert.equal(hasOlder({ api_server: { offset: 50, hasMore: true } }, []), false);
  assert.equal(hasOlder({ api_server: { offset: 80, hasMore: false }, cron: { offset: 50, hasMore: true } }, ['api_server', 'cron']), true);
});

test('fresh device: the first page holds few app chats, "load older" pages on until new ones are listed', async () => {
  // 230 api_server sessions, every 20th from the app: the newest 50 contain 3 app chats
  const srv = server(230, 20);
  const a = await boot();
  const first = await srv.list('api_server', 0, SESSION_PAGE);
  a.ctl.mergeRemote(profile, first.sessions);
  assert.equal(a.store.get().items.length, 3);
  let cursors: Record<string, SourceCursor> = { api_server: afterFirstPage(undefined, first.sessions.length, first.hasMore) };

  const merge = (sessions: RemoteSession[]) => a.ctl.mergeRemote(profile, sessions).added.map((id) => a.ctl.get(id)!);
  const r = await loadOlderSessions({ cursors, sources: ['api_server'], fetch: srv.list, merge });
  cursors = r.cursors;
  // one page of 100 (offset 50) brought 5 more app chats, the other clients' sessions were never listed
  assert.deepEqual(srv.calls.slice(1), [{ source: 'api_server', offset: 50, limit: OLDER_PAGE }]);
  assert.equal(r.added, 5);
  assert.equal(a.store.get().items.length, 8);
  assert.ok(a.store.get().items.every((c) => c.hermesSessionId?.startsWith('hui-')));
  assert.deepEqual(cursors.api_server, { offset: 150, hasMore: true });

  const r2 = await loadOlderSessions({ cursors, sources: ['api_server'], fetch: srv.list, merge });
  assert.equal(r2.added, 4);
  assert.deepEqual(r2.cursors.api_server, { offset: 230, hasMore: false });
  assert.equal(hasOlder(r2.cursors, ['api_server']), false);
  assert.equal(a.store.get().items.length, 12); // every app session on the server is reachable
  // nothing older: no request
  const before = srv.calls.length;
  const r3 = await loadOlderSessions({ cursors: r2.cursors, sources: ['api_server'], fetch: srv.list, merge });
  assert.equal(srv.calls.length, before);
  assert.equal(r3.added, 0);
});

test('pages without a listable chat do not end a tap: it goes on up to OLDER_MAX_PAGES pages', async () => {
  // app chats only at the very end (index 0 and beyond 500)
  const srv = server(900, 600);
  const a = await boot();
  const merge = (sessions: RemoteSession[]) => a.ctl.mergeRemote(profile, sessions).added.map((id) => a.ctl.get(id)!);
  const r = await loadOlderSessions({ cursors: { api_server: { offset: 50, hasMore: true } }, sources: ['api_server'], fetch: srv.list, merge });
  assert.equal(r.pages, OLDER_MAX_PAGES);
  assert.equal(r.added, 0);
  assert.deepEqual(r.cursors.api_server, { offset: 50 + OLDER_MAX_PAGES * OLDER_PAGE, hasMore: true });
  const r2 = await loadOlderSessions({ cursors: r.cursors, sources: ['api_server'], fetch: srv.list, merge });
  assert.equal(r2.added, 1); // hui-0600 (rows 550–649)
  assert.equal(r2.pages, 2);
});

test('only chats the scope lists count as "new": hidden ones keep the pager going', async () => {
  const srv = server(400, 20);
  const a = await boot();
  // "only this device" with other clients shown: app sessions from the list are hidden, other clients are not
  const merge = (sessions: RemoteSession[]) =>
    a.ctl.mergeRemote(profile, sessions, { filter: { foreign: true } }).added.map((id) => a.ctl.get(id)!).filter((c) => inChatScope(c, 'device'));
  const r = await loadOlderSessions({ cursors: { api_server: { offset: 50, hasMore: true } }, sources: ['api_server'], fetch: srv.list, merge });
  assert.equal(r.pages, 1);
  assert.equal(r.added, 95); // 100 rows, 5 of them app sessions
});

test('a failed page keeps the cursor (tap again retries the same page); cancel stops before the next request', async () => {
  const srv = server(300, 20);
  const a = await boot();
  const merge = (sessions: RemoteSession[]) => a.ctl.mergeRemote(profile, sessions).added.map((id) => a.ctl.get(id)!);
  const cursors = { api_server: { offset: 50, hasMore: true } };
  await assert.rejects(
    loadOlderSessions({ cursors, sources: ['api_server'], fetch: async () => { throw new Error('offline'); }, merge }),
    /offline/,
  );
  assert.deepEqual(cursors.api_server, { offset: 50, hasMore: true }, 'input not mutated');
  const r = await loadOlderSessions({ cursors, sources: ['api_server'], fetch: srv.list, merge, cancelled: () => true });
  assert.equal(r.pages, 0);
  assert.equal(srv.calls.length, 0);
});

test('several sources: the first one with older sessions is paged first', async () => {
  const calls: string[] = [];
  const fetch = async (source: string, offset: number) => {
    calls.push(`${source}@${offset}`);
    return { sessions: [], hasMore: false };
  };
  const r = await loadOlderSessions({
    cursors: { api_server: { offset: 50, hasMore: false }, telegram: { offset: 50, hasMore: true }, cli: { offset: 50, hasMore: true } },
    sources: ['api_server', 'telegram', 'cli'],
    fetch,
    merge: () => [],
  });
  assert.deepEqual(calls, ['telegram@50', 'cli@50']);
  assert.equal(hasOlder(r.cursors, ['api_server', 'telegram', 'cli']), false);
});

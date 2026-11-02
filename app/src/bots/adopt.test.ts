/// <reference types="node" />
// A Bot Chat known from the server only (a reminder fired into it): adopted once, never activated, never a second one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptBotChat } from './adopt.ts';
import { findBotChat, isBotChatEntry } from './core.ts';
import { createController } from '../conversations/controller.ts';
import { sanitizeMeta } from '../conversations/migrate.ts';
import { mergeRemoteSessions } from '../conversations/remoteSync.ts';
import { createRepo, type StorageLike } from '../conversations/repo.ts';
import { createIndexStore } from '../conversations/store.ts';
import type { RemoteSession } from '../hermes/sessions.ts';

function setup() {
  const mem = new Map<string, string>();
  const storage: StorageLike = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v), removeItem: async (k) => void mem.delete(k) };
  const store = createIndexStore({ items: [] });
  const ctl = createController(store, createRepo(storage, { debounceMs: 5 }), () => 1000);
  return { store, ctl };
}
const p = { id: 'p1', baseUrl: 'https://bridge.example.com/v1', apiKey: 'nca_user_test_token_000' };
const session = (id: string, title = 'Bot Chat'): RemoteSession => ({ id, source: 'cli', title, startedAt: 1, lastActive: 5000, messageCount: 2, preview: '[Cronjob "Tee" output]' });

test('adopted from the server once (default bot), not activated; the second event finds it', async () => {
  const { store, ctl } = setup();
  const calls: string[] = [];
  const fetchSession = async (c: { baseUrl: string }, id: string) => (calls.push(`${c.baseUrl}|${id}`), session(id));
  const a = await adoptBotChat(ctl, p, undefined, '20261020_073521_fee558', fetchSession);
  assert.equal(a?.botChat, true);
  assert.equal(a?.hermesSessionId, '20261020_073521_fee558');
  assert.equal(a?.origin, 'remote', 'its transcript is fetched when opened');
  assert.equal(store.get().activeId, undefined);
  const b = await adoptBotChat(ctl, p, undefined, '20261020_073521_fee558', fetchSession);
  assert.equal(b?.id, a?.id);
  assert.deepEqual(calls, ['https://bridge.example.com/v1|20261020_073521_fee558']);
});

test('a bot under /p/<bot>/; another session title or an app-only thread → null', async () => {
  const { ctl } = setup();
  const seen: string[] = [];
  const s = await adoptBotChat(ctl, p, 'scout', 'api_1', async (c, id) => (seen.push(c.baseUrl), session(id)));
  assert.equal(s?.hermesProfile, 'scout');
  assert.deepEqual(seen, ['https://bridge.example.com/p/scout/v1']);
  assert.equal(await adoptBotChat(ctl, p, 'scout', 'api_other', async (_c, id) => session(id)), null, 'the app keeps its thread');
  assert.equal(await adoptBotChat(ctl, p, 'writer', 'api_2', async (_c, id) => session(id, 'Something else')), null);
});

// Hermes v0.22.3+ moved the app's Bot Chat aside as "Bot Chat (API <id>)" at a delivery and minted a new one
function moved(opts: { oldTitle?: string | null } = {}) {
  const { store, ctl } = setup();
  const old = ctl.openBotChat({ id: 'p1', kind: 'hermes' }, undefined, session('api_1'));
  const rows: Record<string, RemoteSession | Error> = {
    api_1: opts.oldTitle === null ? Object.assign(new Error('gone'), { status: 404 }) : session('api_1', opts.oldTitle ?? 'Bot Chat (API api_1)'),
    local_2: session('local_2'),
  };
  const fetchSession = async (_c: unknown, id: string) => {
    const r = rows[id];
    if (r instanceof Error) throw r;
    return r;
  };
  return { store, ctl, old, rows, fetchSession };
}

test('a reminder in a new Bot Chat after the move: the app follows it, the old transcript stays as an ordinary chat', async () => {
  const { store, ctl, old, fetchSession } = moved();
  const next = await adoptBotChat(ctl, p, undefined, 'local_2', fetchSession);
  assert.equal(next?.hermesSessionId, 'local_2');
  assert.equal(next?.botChat, true);
  assert.notEqual(next?.id, old.id);
  const was = ctl.get(old.id)!;
  assert.equal(was.botChat, undefined);
  assert.equal(was.botChatRetired, true);
  assert.equal(was.hermesSessionId, 'api_1');
  assert.equal(was.title, 'Bot Chat (API api_1)');
  assert.equal(was.remote?.title, 'Bot Chat (API api_1)');
  assert.equal(findBotChat(ctl.list(), 'p1', undefined)?.id, next?.id);
  assert.equal(store.get().items.length, 2);
  // idempotent: the next event finds it, nothing is retired again
  assert.equal((await adoptBotChat(ctl, p, undefined, 'local_2', fetchSession))?.id, next?.id);
  assert.equal(store.get().items.length, 2);
});

test('the known session is gone (404): it stays as a chat too', async () => {
  const { ctl, old, fetchSession } = moved({ oldTitle: null });
  assert.equal((await adoptBotChat(ctl, p, undefined, 'local_2', fetchSession))?.hermesSessionId, 'local_2');
  assert.equal(ctl.get(old.id)?.botChatRetired, true);
  assert.equal(ctl.get(old.id)?.title, 'Bot Chat');
  assert.equal(ctl.get(old.id)?.remote?.title, undefined, 'no longer counts as the Bot Chat entry');
});

test('the open chat moves along; another open chat stays open', async () => {
  const a = moved();
  a.ctl.setActive(a.old.id);
  const next = await adoptBotChat(a.ctl, p, undefined, 'local_2', a.fetchSession);
  assert.equal(a.store.get().activeId, next?.id);
  const b = moved();
  const other = b.ctl.create({ id: 'p1', kind: 'hermes' });
  b.ctl.setActive(other.id);
  await adoptBotChat(b.ctl, p, undefined, 'local_2', b.fetchSession);
  assert.equal(b.store.get().activeId, other.id);
});

test('nothing changes while the known session still has the title or cannot be read', async () => {
  const same = moved({ oldTitle: 'Bot Chat' });
  assert.equal(await adoptBotChat(same.ctl, p, undefined, 'local_2', same.fetchSession), null, 'two sessions with that title never retire each other');
  assert.equal(same.ctl.get(same.old.id)?.botChat, true);
  for (const status of [500, 401, undefined]) {
    const down = moved();
    down.rows.api_1 = Object.assign(new Error('down'), { status });
    await assert.rejects(adoptBotChat(down.ctl, p, undefined, 'local_2', down.fetchSession));
    assert.equal(down.ctl.get(down.old.id)?.botChat, true, `status ${status}`);
    assert.equal(down.store.get().items.length, 1);
  }
});

test('the retired chat survives list syncs and an app restart with the default filter (it has a foreign session id)', async () => {
  const { store, ctl, old, fetchSession } = moved();
  await adoptBotChat(ctl, p, undefined, 'local_2', fetchSession);
  assert.equal(ctl.get(old.id)?.origin, 'remote');
  const merged = mergeRemoteSessions(store.get().items, { profile: { id: 'p1', kind: 'hermes' }, sessions: [{ ...session('api_1', 'Bot Chat (API api_1)'), source: 'api_server' }], completeSources: ['api_server'], filter: {} });
  assert.deepEqual(merged.removed, []);
  assert.deepEqual(mergeRemoteSessions(store.get().items, { profile: { id: 'p1', kind: 'hermes' }, sessions: [], filter: {} }).removed, [], 'the default filter hides foreign sessions, not this one');
  const raw = JSON.parse(JSON.stringify(ctl.get(old.id)));
  assert.equal(sanitizeMeta(raw, 1000)?.botChatRetired, true);
  assert.equal(isBotChatEntry(ctl.get(old.id)!), false, 'listed like any chat');
});

test('an old thread this device never loaded keeps its server history: listed, not dropped as a draft', async () => {
  const { store, ctl } = setup();
  const empty = ctl.openBotChat({ id: 'p1', kind: 'hermes' }, undefined, { ...session('api_1'), messageCount: 0 });
  assert.equal(empty.messageCount, 0);
  const fetchSession = async (_c: unknown, id: string) => (id === 'api_1' ? { ...session('api_1', 'Bot Chat (API api_1)'), messageCount: 4 } : session(id));
  await adoptBotChat(ctl, p, undefined, 'local_2', fetchSession);
  store.dispatch({ type: 'pruneDrafts' });
  const was = ctl.get(empty.id);
  assert.equal(was?.messageCount, 4);
  assert.equal(was?.origin, 'remote', 'its transcript is fetched when opened');
  assert.ok(ctl.list().some((c) => c.id === empty.id));
});

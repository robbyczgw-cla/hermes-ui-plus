/// <reference types="node" />
// A Bot Chat known from the server only (a reminder fired into it): adopted once, never activated, never a second one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptBotChat } from './adopt.ts';
import { createController } from '../conversations/controller.ts';
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

/// <reference types="node" />
// Hermes profiles ("bots") in the conversation store, the session merge, push/inbox routing and stored profiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RemoteSession } from '../hermes/sessions.ts';
import { indexReducer, isDraft } from './indexReducer.ts';
import { migrateIndex } from './migrate.ts';
import { mergeRemoteSessions } from './remoteSync.ts';
import { createController } from './controller.ts';
import { createRepo, type StorageLike } from './repo.ts';
import { createIndexStore } from './store.ts';
import type { ConversationMeta, IndexState } from './types.ts';
import { parseInboxEvent, parseTarget, pickConversation } from '../push/model.ts';
import { parseApprovalNotice, parseApprovalResolved, routeApproval, type ApprovalRouteDeps } from '../push/approvalInbox.ts';
import { sanitizeStoredProfile } from '../settings/migrate.ts';

const profile = { id: 'p1', kind: 'hermes' as const };
const empty: IndexState = { items: [] };

function sess(id: string, over: Partial<RemoteSession> = {}): RemoteSession {
  return { id, source: 'api_server', startedAt: 1000, lastActive: 5000, messageCount: 4, title: `T ${id}`, preview: `preview ${id}`, ...over };
}
function chat(id: string, over: Partial<ConversationMeta> = {}): ConversationMeta {
  return { id, title: 'Lokal', titleSource: 'auto', profileId: 'p1', profileKind: 'hermes', hermesSessionId: `hui-${id}`, createdAt: 100, updatedAt: 200, preview: 'x', messageCount: 2, ...over };
}

test('create with a bot; setBot only on empty chats (fresh session, model of the other bot dropped)', () => {
  let s = indexReducer(empty, { type: 'create', id: 'c1', profile, sessionId: 'hui-1', now: 1, bot: 'writer' });
  assert.equal(s.items[0].hermesProfile, 'writer');
  s = indexReducer(s, { type: 'setModel', id: 'c1', model: 'writer-model' });
  s = indexReducer(s, { type: 'setBot', id: 'c1', bot: 'work', sessionId: 'hui-2' });
  assert.equal(s.items[0].hermesProfile, 'work');
  assert.equal(s.items[0].hermesSessionId, 'hui-2');
  assert.equal(s.items[0].model, undefined);
  s = indexReducer(s, { type: 'setBot', id: 'c1', bot: 'default', sessionId: 'hui-3' });
  assert.equal('hermesProfile' in s.items[0], false, 'default = no field');
  // with messages: the session lives in its bot → unchanged
  s = indexReducer(s, { type: 'saved', id: 'c1', now: 2, firstUserText: 'hi', preview: 'hi', messageCount: 1 });
  const before = s;
  s = indexReducer(s, { type: 'setBot', id: 'c1', bot: 'writer', sessionId: 'hui-4' });
  assert.equal(s, before);
  // invalid names never land in the store
  const bad = indexReducer(empty, { type: 'create', id: 'c2', profile, sessionId: 'hui-5', now: 1, bot: '../x' });
  assert.equal(bad.items[0].hermesProfile, undefined);
});

test('an empty draft that follows another profile drops its bot', () => {
  let s = indexReducer(empty, { type: 'create', id: 'c1', profile, sessionId: 'hui-1', now: 1, bot: 'writer' });
  s = indexReducer(s, { type: 'rebindDraft', id: 'c1', profile: { id: 'p2', kind: 'hermes' }, sessionId: 'hui-2' });
  assert.equal(s.items[0].profileId, 'p2');
  assert.equal(s.items[0].hermesProfile, undefined);
});

test('stored index: hermesProfile survives migration, invalid / default are dropped', () => {
  const st = migrateIndex({ v: 1, items: [chat('a', { hermesProfile: 'writer' }), chat('b', { hermesProfile: 'Bad/Name' }), chat('c', { hermesProfile: 'default' })] }, 1);
  assert.deepEqual(st.items.map((c) => c.hermesProfile), ['writer', undefined, undefined]);
});

test('session merge per bot: only the same bot matches, new entries are bound to it, pruning stays per bot', () => {
  const items = [
    chat('d', { hermesSessionId: 'hui-same', origin: 'remote', remote: { source: 'api_server', lastActive: 100, loadedAt: 100 } }),
    chat('g', { hermesSessionId: 'hui-g-old', hermesProfile: 'writer', origin: 'remote', remote: { source: 'api_server', lastActive: 100, loadedAt: 100 } }),
  ];
  // the writer bot lists a session whose id the default profile also has
  const r = mergeRemoteSessions(items, { profile, bot: 'writer', sessions: [sess('hui-same')], completeSources: ['api_server'] });
  const added = r.items.filter((c) => r.added.includes(c.id));
  assert.equal(added.length, 1, 'a second entry, not the default chat');
  assert.equal(added[0].hermesProfile, 'writer');
  assert.notEqual(added[0].id, 'd');
  assert.ok(r.items.some((c) => c.id === 'd'), 'the default chat is untouched');
  assert.deepEqual(r.removed, ['g'], 'vanished writer session pruned; the default one is not');
  // the default list never touches bot chats
  const r2 = mergeRemoteSessions(r.items, { profile, sessions: [sess('hui-same', { title: 'Neu' })], completeSources: ['api_server'] });
  assert.equal(r2.items.find((c) => c.id === 'd')?.title, 'Neu');
  assert.equal(r2.items.find((c) => c.hermesProfile === 'writer')?.title, 'T hui-same');
  assert.deepEqual(r2.removed, []);
});

function memory(): StorageLike {
  const data = new Map<string, string>();
  return {
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
    async getAllKeys() {
      return Array.from(data.keys());
    },
  };
}

test('controller: a new chat re-uses the empty draft and switches it to the picked bot; branches keep their bot', () => {
  const store = createIndexStore({ items: [] });
  const ctl = createController(store, createRepo(memory(), { debounceMs: 5 }), () => 10);
  const a = ctl.create(profile);
  const b = ctl.create(profile, { bot: 'writer' });
  assert.equal(b.id, a.id, 'draft re-used');
  assert.equal(b.hermesProfile, 'writer');
  assert.notEqual(b.hermesSessionId, a.hermesSessionId, 'fresh session for the other bot');
  const { create } = ctl; // used unbound by the React API
  assert.equal(create(profile, { bot: 'writer' }).hermesProfile, 'writer');
  const br = ctl.createBranch(profile, { messages: [], sessionId: 'hui-fork', bot: 'writer' });
  assert.equal(br.hermesProfile, 'writer');
  assert.ok(isDraft(br));
});

test('push / inbox / approval payloads carry the bot; the chat of that bot is picked', () => {
  const t = parseTarget({ src: 'hermes', profileId: 'p1', sessionId: 'hui-same', hermesProfile: 'writer' });
  assert.equal(t?.hermesProfile, 'writer');
  assert.equal(parseTarget({ src: 'hermes', profileId: 'p1', hermesProfile: '../x' })?.hermesProfile, undefined);
  assert.equal(parseInboxEvent(JSON.stringify({ id: 'h1', content: 'x', sessionId: 'hui-same', hermesProfile: 'writer' }))?.hermesProfile, 'writer');
  assert.equal(parseInboxEvent(JSON.stringify({ id: 'h1', content: 'x', sessionId: 'hui-same' }))?.hermesProfile, undefined);
  const list = [chat('d', { hermesSessionId: 'hui-same' }), chat('g', { hermesSessionId: 'hui-same', hermesProfile: 'writer' })];
  assert.equal(pickConversation(list, profile, { sessionId: 'hui-same', hermesProfile: 'writer' })?.id, 'g');
  assert.equal(pickConversation(list, profile, { sessionId: 'hui-same' })?.id, 'd');
  // an older bridge without the field: the session match still works
  assert.equal(pickConversation([list[1]], profile, { sessionId: 'hui-same' })?.id, 'g');
  const n = parseApprovalNotice(JSON.stringify({ requestId: 'r1', runId: 'run1', sessionId: 'hui-same', command: 'ls', hermesProfile: 'writer' }));
  assert.equal(n?.hermesProfile, 'writer');
  assert.equal(parseApprovalResolved(JSON.stringify({ requestId: 'r1', hermesProfile: 'writer' }))?.hermesProfile, 'writer');
  const opened: string[] = [];
  const deps: ApprovalRouteDeps = {
    controller: { list: () => list },
    activeId: () => 'g',
    banner: () => assert.fail('the open chat of that bot gets the card'),
    clearBanner: () => {},
    openPending: (id) => opened.push(id),
    checkPending: () => {},
  };
  assert.equal(routeApproval(deps, profile, n!), 'open-chat');
  assert.deepEqual(opened, ['g']);
});

test('stored connection: hermesBots sanitised (valid names only)', () => {
  const p = sanitizeStoredProfile({ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://192.0.2.1/v1', hermesBots: ['Writer', 'work', 'bad.name', 7, 'default'] });
  assert.deepEqual(p?.hermesBots, ['writer', 'work']);
  assert.equal(sanitizeStoredProfile({ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://192.0.2.1/v1', hermesBots: 'writer' })?.hermesBots, undefined);
  assert.equal(sanitizeStoredProfile({ id: 'o', kind: 'openai', name: 'O', baseUrl: 'http://192.0.2.1/v1', hermesBots: ['writer'] })?.hermesBots, undefined);
});

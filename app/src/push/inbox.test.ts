/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../hermes/types';
import { createController } from '../conversations/controller.ts';
import { createRepo } from '../conversations/repo.ts';
import { createIndexStore } from '../conversations/store.ts';
import { memoryStorage } from '../conversations/storage/kv.ts';
import { createKeyedQueue, createOpenChatApplier, recoverFromInbox, routeInboxEvent, type InboxRoutingDeps } from './inboxRouting.ts';
import { markInterrupted } from '../hermes/recovery.ts';
import type { InboxEvent, PushProfile } from './model.ts';

const nano = { id: 'p', kind: 'demo', model: 'main' }; // an agent server profile (none ships in this build)
const ev = (id: string, agent = 'main', ts = 3): InboxEvent => ({ id, content: `Nachricht ${id}`, timestamp: ts, agent });
const msg = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({ id, role, text, tools: [], status: 'done', createdAt: 1 });

function setup(open: Record<string, (e: InboxEvent) => void> = {}) {
  const store = createIndexStore();
  const repo = createRepo(memoryStorage(), { debounceMs: 1 });
  const ctl = createController(store, repo);
  const deps: InboxRoutingDeps = {
    controller: ctl,
    activeId: () => store.get().activeId,
    deliverToOpenChat: (id, e) => {
      const h = open[id];
      if (!h) return false;
      h(e);
      return true;
    },
  };
  const queue = createKeyedQueue();
  // PushHost: readInbox fires onEvent synchronously per frame, every event goes through the per-profile queue
  const onInbox = (e: InboxEvent) => queue(nano.id, () => routeInboxEvent(deps, nano, e));
  return { store, repo, ctl, onInbox };
}


test('burst of inbox events for an agent without a chat: one new chat with all messages', async () => {
  const { ctl, store, onInbox } = setup();
  await Promise.all([onInbox(ev('m1', 'helper')), onInbox(ev('m2', 'helper'))]);
  const convs = store.get().items;
  assert.equal(convs.length, 1);
  assert.equal(convs[0].model, 'helper');
  assert.deepEqual((await ctl.loadMessages(convs[0].id)).map((m) => m.id), ['m1', 'm2']);
});



test('open chat: several events before the next render are all applied (review P0-2, open path)', () => {
  let state = { messages: [msg('u1', 'user', 'hi')], status: 'idle' };
  const replaced: ChatMessage[][] = [];
  // the hook's ref is refreshed only after a render: get() keeps returning the stale state here
  const stale = { ...state, replaceMessages: (m: ChatMessage[]) => (replaced.push(m), true) };
  const pending: InboxEvent[] = [];
  const apply = createOpenChatApplier(() => stale, pending);
  apply(ev('m1'));
  apply(ev('m2'));
  apply(ev('m1'));
  assert.deepEqual(replaced.at(-1)!.map((m) => m.id), ['u1', 'm1', 'm2']);
  assert.equal(replaced.length, 2);
  // after the render the hook holds the new list: merging continues from it
  state = { messages: replaced.at(-1)!, status: 'idle' };
  const fresh = { ...state, replaceMessages: (m: ChatMessage[]) => (replaced.push(m), true) };
  const apply2 = createOpenChatApplier(() => fresh, pending);
  apply2(ev('m3'));
  assert.deepEqual(replaced.at(-1)!.map((m) => m.id), ['u1', 'm1', 'm2', 'm3']);
});

test('open chat: events during a running turn are queued once and applied later', () => {
  const chat = { messages: [msg('u1', 'user', 'hi')], status: 'streaming', replaceMessages: () => false };
  const pending: InboxEvent[] = [];
  const apply = createOpenChatApplier(() => chat, pending);
  apply(ev('m1'));
  apply(ev('m1'));
  apply(ev('m2'));
  assert.deepEqual(pending.map((e) => e.id), ['m1', 'm2']);
});

test('keyed queue: serial per key, a failing job does not stop it', async () => {
  const q = createKeyedQueue();
  const log: string[] = [];
  const slow = (s: string, ms: number) => () => new Promise<void>((r) => setTimeout(() => (log.push(s), r()), ms));
  const a = q('k', slow('a', 15));
  const b = q('k', async () => {
    throw new Error('boom');
  });
  const c = q('k', slow('c', 1));
  const other = q('x', slow('x', 1));
  await assert.rejects(b);
  await Promise.all([a, c, other]);
  assert.deepEqual(log, ['x', 'a', 'c']);
});

// ---- Hermes: lost stream, the bridge kept the run going and reports the answer via the live inbox

const hermesP = { id: 'h', kind: 'hermes' };
const hermesEv = (over: Partial<InboxEvent> = {}): InboxEvent => ({ id: 'h_hui-abc_42', content: 'Fertig: alles erledigt.', timestamp: 5000, sessionId: 'hui-abc', source: 'api_server', ...over });

function hermesChat() {
  const env = setup();
  const conv = env.ctl.create({ id: 'h', kind: 'hermes' });
  env.ctl.setSessionId(conv.id, 'hui-abc');
  const partial = markInterrupted({ id: 'a1', role: 'assistant', text: '', tools: [{ id: 'c1', name: 'terminal', label: 'ls', status: 'running', startedAt: 2 }], status: 'streaming', createdAt: 2 }, 3);
  env.ctl.save(conv.id, [msg('u1', 'user', 'Räum auf'), partial]);
  // another (empty) chat of the same profile is open: must not receive it, no new chat either
  const other = env.ctl.create({ id: 'h', kind: 'hermes' });
  env.ctl.setActive(other.id);
  return { ...env, conv, other };
}

test('hermes inbox event completes the interrupted answer of the conversation with that session (closed chat)', async () => {
  const { ctl, store, conv } = hermesChat();
  const before = store.get().items.length;
  const r = await recoverFromInbox({ controller: ctl, deliverToOpenChat: () => false }, hermesP, hermesEv());
  assert.equal(r?.conversationId, conv.id);
  assert.equal(r?.via, 'stored');
  // the completed answer is reported for the "Antwort ist da" notice (background/noticeState)
  assert.equal(r?.recovered?.id, 'a1');
  assert.equal(r?.recovered?.status, 'done');
  assert.equal(store.get().items.length, before, 'no new conversation');
  const msgs = await ctl.loadMessages(conv.id);
  assert.deepEqual(msgs.map((m) => [m.id, m.status]), [['u1', 'done'], ['a1', 'done']]);
  assert.equal(msgs[1].text, 'Fertig: alles erledigt.');
  assert.equal(msgs[1].tools.length, 1, 'tools received before the drop are kept');
  // replayed after a reconnect (since=): still one answer
  await recoverFromInbox({ controller: ctl, deliverToOpenChat: () => false }, hermesP, hermesEv());
  assert.equal((await ctl.loadMessages(conv.id)).length, 2);
});

test('hermes inbox event goes to the open chat of that session; the session refresh merges into it, never a new chat', async () => {
  const { ctl, store, conv } = hermesChat();
  const seen: string[] = [];
  const r = await recoverFromInbox({ controller: ctl, deliverToOpenChat: (id, e) => (id === conv.id ? (seen.push(e.id), true) : false) }, hermesP, hermesEv());
  assert.deepEqual(r, { conversationId: conv.id, via: 'open' });
  assert.deepEqual(seen, ['h_hui-abc_42']);
  // PushHost then refreshes the session (GET /api/sessions/hui-abc → mergeRemote): matched by hermesSessionId
  const before = store.get().items.length;
  ctl.mergeRemote({ id: 'h', kind: 'hermes' }, [{ id: 'hui-abc', source: 'api_server', startedAt: 1, lastActive: 6, messageCount: 4, title: 'Aufräumen', preview: 'Fertig' }], { filter: {} });
  assert.equal(store.get().items.length, before);
  assert.equal(ctl.get(conv.id)?.remote?.lastActive, 6, 'existing conversation updated (→ transcript reload)');
  // an event of an unknown session is not routed anywhere by the recovery path
  assert.equal(await recoverFromInbox({ controller: ctl, deliverToOpenChat: () => true }, hermesP, hermesEv({ sessionId: 'hui-other' })), null);
});

test('Hermes inbox filter: default only app sessions; cron reports only with the toggle (no chat, no notification)', async () => {
  const { hermesInboxAllowed, hermesInboxSources, inboxUrl, pushFilterOf, registrationBody } = await import('./model.ts');
  const h: PushProfile = { id: 'p-h', kind: 'hermes', baseUrl: 'https://bridge.example/v1', apiKey: 'k', bridge: true };
  const hc: PushProfile = { ...h, showCronReports: true };
  const cronEv = { id: 'h_cron', content: 'Bericht', timestamp: 1, source: 'cron', sessionId: 'cron_aaa111_20261011_142229' };
  const appEv = { id: 'h_app', content: 'Fertig', timestamp: 1, source: 'api_server', sessionId: 'hui-1' };
  assert.equal(hermesInboxAllowed(h, appEv), true);
  assert.equal(hermesInboxAllowed(h, cronEv), false);
  assert.equal(hermesInboxAllowed(hc, cronEv), true);
  assert.equal(hermesInboxAllowed(h, { ...appEv, sessionId: 'api-other' }), false);
  assert.equal(hermesInboxAllowed({ ...h, showForeignChats: true }, { ...appEv, source: 'telegram' }), false); // Telegram never notifies
  assert.equal(hermesInboxAllowed(h, { ...appEv, sessionId: null }), false);
  // what the app asks the bridge for (stream + device scope)
  assert.deepEqual(hermesInboxSources(h), ['api_server']);
  assert.deepEqual(hermesInboxSources(hc), ['api_server', 'cron']);
  assert.equal(inboxUrl(h, { sources: hermesInboxSources(h) }), 'https://bridge.example/bridge/inbox/stream?sources=api_server');
  assert.deepEqual(registrationBody(h, { enabled: true, preview: 'auto', quiet: null }, { locale: 'de' }).scope, { sources: ['api_server'] });
  assert.deepEqual(registrationBody(hc, { enabled: true, preview: 'auto', quiet: null }, { locale: 'de' }).scope, { sources: ['api_server', 'cron'] });

  // PushHost refreshHermesSession: the fetched cron session is merged with the profile's filter → no drawer entry
  const { ctl } = setup();
  const cronSession = { id: cronEv.sessionId, source: 'cron', startedAt: 1, lastActive: 2, messageCount: 2, title: 'Morning Briefing' };
  assert.deepEqual(ctl.mergeRemote({ id: 'p-h', kind: 'hermes' }, [cronSession], { filter: pushFilterOf(h) }).added, []);
  assert.equal(ctl.list().length, 0);
  assert.equal(ctl.mergeRemote({ id: 'p-h', kind: 'hermes' }, [cronSession], { filter: pushFilterOf(hc) }).added.length, 1);
});


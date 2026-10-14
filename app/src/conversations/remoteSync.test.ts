/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import type { ChatMessage } from '../hermes/types';
import type { RemoteSession } from '../hermes/sessions.ts';
import { mapRemoteMessages } from '../hermes/sessionMapping.ts';
import { parseMessages } from '../hermes/sessions.ts';
import { MESSAGES_FIXTURE } from '../hermes/sessions.fixtures.ts';
import { applyRemoteSnapshot, cleanRemoteTitle, hiddenKey, mergeRemoteSessions, needsRemoteLoad, reconcileTranscript, remoteConversationId, remoteLoadedAt, sourceLabel } from './remoteSync.ts';
import { indexReducer } from './indexReducer.ts';
import { migrateIndex } from './migrate.ts';
import { messagesSignature, stripMessage } from './messages.ts';
import type { ConversationMeta, IndexState } from './types.ts';

const profile = { id: 'p-hermes-host', kind: 'hermes' as const };

function sess(id: string, over: Partial<RemoteSession> = {}): RemoteSession {
  return { id, source: 'telegram', startedAt: 1000, lastActive: 5000, messageCount: 10, title: `T ${id}`, preview: `preview ${id}`, ...over };
}

function local(id: string, over: Partial<ConversationMeta> = {}): ConversationMeta {
  return { id, title: 'Lokal', titleSource: 'auto', profileId: 'p-hermes-host', profileKind: 'hermes', hermesSessionId: `hui-${id}`, createdAt: 100, updatedAt: 200, preview: 'x', messageCount: 2, ...over };
}

test('labels and ids', () => {
  const de = makeT('de', 'de-DE');
  const en = makeT('en', 'en-US');
  assert.equal(sourceLabel('telegram', de), 'Telegram');
  assert.equal(sourceLabel('api_server', de), 'App');
  assert.equal(sourceLabel('cli', de), 'CLI');
  assert.equal(sourceLabel('oneshot', de), 'Einmalig');
  assert.equal(sourceLabel('oneshot', en), 'One-off');
  assert.equal(sourceLabel('some_thing', de), 'Some thing');
  assert.equal(remoteConversationId('20260820_061107_454a1c7f'), 'r-20260820_061107_454a1c7f');
  assert.equal(remoteConversationId('a/b c'), 'r-a_b_c');
  assert.equal(cleanRemoteTitle('<think> The user is asking abo'), undefined);
  assert.equal(cleanRemoteTitle('  Gateway   Restart '), 'Gateway Restart');
});

test('merge: new sessions from other platforms become remote entries; filters', () => {
  const r = mergeRemoteSessions([], {
    profile,
    sessions: [
      sess('tg1'),
      sess('cron1', { source: 'cron' }),
      sess('empty', { messageCount: 0 }),
      sess('child', { internalChild: true }),
      sess('hidden1'),
      sess('cli1', { source: 'cli', title: undefined, preview: 'hallo welt' }),
    ],
    hidden: ['hidden1'],
    filter: { foreign: true }, // "Andere Hermes-Chats anzeigen" on (default off: sessionFilter.test.ts)
  });
  assert.deepEqual(r.added, ['r-tg1', 'r-cli1']);
  const tg = r.items[0];
  assert.equal(tg.origin, 'remote');
  assert.equal(tg.hermesSessionId, 'tg1');
  assert.equal(tg.profileId, 'p-hermes-host');
  assert.equal(tg.title, 'T tg1');
  assert.equal(tg.titleSource, 'remote');
  assert.equal(tg.updatedAt, 5000);
  assert.equal(tg.messageCount, 10);
  assert.equal(tg.preview, 'preview tg1');
  assert.deepEqual(tg.remote, { source: 'telegram', lastActive: 5000, remoteCount: 10, title: 'T tg1' });
  assert.equal(r.items[1].title, 'hallo welt');
  assert.equal(r.items[1].titleSource, 'auto');
  assert.equal(needsRemoteLoad(tg), true);
});

test('merge: app conversations are matched by session id, titles adopted unless user-renamed', () => {
  const items = [local('a'), local('b', { title: 'Mein Titel', titleSource: 'user' })];
  const r = mergeRemoteSessions(items, {
    profile,
    sessions: [sess('hui-a', { source: 'api_server', title: 'Hermes Titel', lastActive: 9000 }), sess('hui-b', { source: 'api_server', lastActive: 100 })],
  });
  assert.deepEqual(r.added, []);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].title, 'Hermes Titel');
  assert.equal(r.items[0].titleSource, 'remote');
  assert.equal(r.items[0].updatedAt, 9000);
  assert.equal(r.items[0].origin, undefined);
  assert.equal(r.items[0].remote?.source, 'api_server');
  assert.equal(r.items[1].title, 'Mein Titel');
  assert.equal(r.items[1].updatedAt, 200); // older server activity does not move it
  // unchanged second run → same array
  const again = mergeRemoteSessions(r.items, {
    profile,
    sessions: [sess('hui-a', { source: 'api_server', title: 'Hermes Titel', lastActive: 9000 }), sess('hui-b', { source: 'api_server', lastActive: 100 })],
  });
  assert.equal(again.changed, false);
  assert.equal(again.items, r.items);
});

test('merge: prunes vanished remote-only entries only for fully listed sources, never the open one', () => {
  const filter = { foreign: true };
  const first = mergeRemoteSessions([], { profile, sessions: [sess('t1'), sess('t2'), sess('c1', { source: 'cli' })], filter }).items;
  const r = mergeRemoteSessions(first, { profile, sessions: [sess('t1')], completeSources: ['telegram'], activeId: 'r-t2', filter });
  assert.deepEqual(r.removed, []);
  const r2 = mergeRemoteSessions(first, { profile, sessions: [sess('t1')], completeSources: ['telegram'], filter });
  assert.deepEqual(r2.removed, ['r-t2']); // cli not fully listed → c1 kept
  assert.deepEqual(r2.items.map((c) => c.id).sort(), ['r-c1', 'r-t1']);
  // app conversations are never pruned
  const r3 = mergeRemoteSessions([local('a', { remote: { source: 'api_server' } })], { profile, sessions: [], completeSources: ['api_server'] });
  assert.equal(r3.items.length, 1);
});

test('reducer: hideRemote tombstones, remove keeps tombstones, remoteLoaded, setModelOptions', () => {
  let s: IndexState = { items: [local('a'), local('b')], activeId: 'a' };
  s = indexReducer(s, { type: 'hideRemote', id: 'a', sessionId: 'hui-a' });
  assert.deepEqual(s.items.map((c) => c.id), ['b']);
  assert.equal(s.activeId, undefined);
  assert.deepEqual(s.hiddenRemote, ['hui-a']);
  s = indexReducer(s, { type: 'remove', id: 'b' });
  assert.deepEqual(s.hiddenRemote, ['hui-a']);
  let t: IndexState = { items: [local('c', { remote: { source: 'telegram', lastActive: 50 } })] };
  t = indexReducer(t, { type: 'remoteLoaded', id: 'c', at: 70, lastActive: 60 });
  assert.deepEqual(t.items[0].remote, { source: 'telegram', lastActive: 60, loadedAt: 70 });
  assert.equal(needsRemoteLoad(t.items[0]), false);
  t = indexReducer(t, { type: 'setModelOptions', id: 'c', options: { reasoning: 'high' } });
  assert.deepEqual(t.items[0].modelOptions, { reasoning: 'high' });
  const same = indexReducer(t, { type: 'setModelOptions', id: 'c', options: { reasoning: 'high' } });
  assert.equal(same, t);
  t = indexReducer(t, { type: 'setModelOptions', id: 'c', options: undefined });
  assert.equal('modelOptions' in t.items[0], false);
  // 'saved' never overwrites a remote title
  const r = indexReducer({ items: [local('d', { title: 'Von Hermes', titleSource: 'remote' })] }, { type: 'saved', id: 'd', now: 1, firstUserText: 'hallo', preview: 'p', messageCount: 2 });
  assert.equal(r.items[0].title, 'Von Hermes');
});

test('migrateIndex keeps the sync fields and tombstones', () => {
  const f = migrateIndex({
    v: 1,
    items: [local('a', { origin: 'remote', titleSource: 'remote', remote: { source: 'telegram', lastActive: 1, loadedAt: 2, title: 'x' }, modelOptions: { reasoning: 'low', fast: true } })],
    hiddenRemote: ['s1', 3],
  });
  const m = f.items[0];
  assert.equal(m.origin, 'remote');
  assert.equal(m.titleSource, 'remote');
  assert.deepEqual(m.remote, { source: 'telegram', lastActive: 1, loadedAt: 2, title: 'x' });
  assert.deepEqual(m.modelOptions, { reasoning: 'low', fast: true });
  assert.deepEqual(f.hiddenRemote, ['s1']);
  const bad = migrateIndex({ items: [{ id: 'x', remote: { lastActive: 1 }, modelOptions: { reasoning: 'nope' } }] });
  assert.equal('remote' in bad.items[0], false);
  assert.equal('modelOptions' in bad.items[0], false);
});

test('stored messages keep capped reasoning of finished messages; signature sees enrichment', () => {
  const m: ChatMessage = { id: 'a', role: 'assistant', text: 't', tools: [{ id: 't1', name: 'terminal', label: 'ls', status: 'done', startedAt: 1 }], status: 'done', createdAt: 1, reasoning: 'r'.repeat(5000) };
  const s = stripMessage(m);
  assert.equal(s.reasoning?.length, 4001);
  const before = messagesSignature([m]);
  const enriched = { ...m, tools: [{ ...m.tools[0], detail: { input: { command: 'ls' } } }] };
  assert.notEqual(messagesSignature([enriched]), before);
});

// ------------------------------------------------------------------ reconcile

const remote = mapRemoteMessages(parseMessages(MESSAGES_FIXTURE, 'x').messages);

function u(id: string, text: string): ChatMessage {
  return { id, role: 'user', text, tools: [], status: 'done', createdAt: 1 };
}
function a(id: string, text: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', text, tools: [], status: 'done', createdAt: 2, ...over };
}

test('reconcile: empty local → remote; never-continued remote chat → server copy', () => {
  assert.equal(reconcileTranscript([], remote), remote);
  const stale = remote.slice(0, 2);
  assert.equal(reconcileTranscript(stale, remote, 'remote'), remote);
  assert.equal(reconcileTranscript(remote, remote, 'remote'), remote);
  assert.equal(reconcileTranscript(remote.slice(), remote, 'remote').length, 4);
});

test('reconcile: app chat keeps local ids, enriches tools, appends turns continued elsewhere', () => {
  const live = [
    u('u-1', 'Antworte nur mit OK'),
    a('a-1', 'OK'),
    u('u-2', 'Wie spät ist es? Nutze ein Tool falls nötig'),
    a('a-2', 'Ich hole…', { tools: [{ id: 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0', name: 'terminal', label: 'date', status: 'done', startedAt: 3 }] }),
  ];
  const r = reconcileTranscript(live, remote);
  assert.deepEqual(r.map((m) => m.id), ['u-1', 'a-1', 'u-2', 'a-2']);
  assert.deepEqual(r[3].tools[0].detail?.input, { command: 'date' });
  assert.equal(r[3].text, 'Ich hole…');
  // only the first turn local, second continued on Telegram → appended with stable ids
  const partial = reconcileTranscript(live.slice(0, 2), remote);
  assert.deepEqual(partial.map((m) => m.id), ['u-1', 'a-1', 'hu-339195', 'ha-339196']);
  // local failed answer replaced by the stored one (keeps local id)
  const failed = reconcileTranscript([...live.slice(0, 3), a('a-2', '', { status: 'error', error: 'Netz' })], remote);
  assert.equal(failed[3].id, 'a-2');
  assert.equal(failed[3].status, 'done');
  assert.ok(failed[3].text.startsWith('Ich hole'));
  // nothing aligns: app chat keeps local, remote chat takes remote
  const other = [u('u-9', 'ganz anders'), a('a-9', 'x')];
  assert.equal(reconcileTranscript(other, remote), other);
  assert.equal(reconcileTranscript(other, remote, 'remote'), remote);
  // second pass is stable
  assert.equal(reconcileTranscript(r, remote), r);
});

// ---- review 2026-10-11 regressions (reconcile duplicates, signature, auto-title source)
const ut = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'user', text, tools: [], status: 'done', createdAt: 1, ...extra });
const at = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'assistant', text, tools: [], status: 'done', createdAt: 2, ...extra });
type Row = Parameters<typeof mapRemoteMessages>[0][number];
const row = (id: string, role: 'user' | 'assistant', content: unknown, ts: number): Row => ({ id, role, content, timestamp: ts, ...(role === 'assistant' ? { finishReason: 'stop' } : {}) }) as Row;
const img = { id: 'x', kind: 'image' as const, name: 'p.jpg', mimeType: 'image/jpeg', size: 1, uri: 'file:///p.jpg', status: 'ready' as const };

test('reconcile: attachment-only and short text + image turns are not duplicated (review P1-2)', () => {
  const local = [ut('u-1', 'Hallo'), at('a-1', 'Hi!'), ut('u-2', '', { attachments: [img] }), at('a-2', 'Ein Hund.')];
  const remote = mapRemoteMessages([
    row('1', 'user', 'Hallo', 1),
    row('2', 'assistant', 'Hi!', 2),
    row('3', 'user', [{ type: 'image_url', image_url: { url: 'data:...' } }], 3),
    row('4', 'assistant', 'Ein Hund.', 4),
  ]);
  assert.equal(reconcileTranscript(local, remote), local);

  const local2 = [ut('u-1', 'Hallo'), at('a-1', 'Hi!'), ut('u-2', 'Was ist das?', { attachments: [img] }), at('a-2', 'Ein Hund.')];
  const remote2 = mapRemoteMessages([
    row('1', 'user', 'Hallo', 1),
    row('2', 'assistant', 'Hi!', 2),
    row('3', 'user', [{ type: 'text', text: 'Was ist das?' }, { type: 'image_url', image_url: { url: 'data:...' } }], 3),
    row('4', 'assistant', 'Ein Hund.', 4),
  ]);
  assert.equal(reconcileTranscript(local2, remote2).length, 4);

  // short text + text file (bridge reference / inlined content part)
  const local3 = [ut('u-1', 'Fasse zusammen', { attachments: [{ ...img, kind: 'file', name: 'a.txt', mimeType: 'text/plain' }] }), at('a-1', 'Kurz: ok.')];
  const remote3 = mapRemoteMessages([
    row('1', 'user', 'Fasse zusammen\n[Datei angehängt: a.txt (text/plain, 1 B) – Inhalt:]\n```\nhallo\n```', 1),
    row('2', 'assistant', 'Kurz: ok.', 2),
  ]);
  assert.equal(reconcileTranscript(local3, remote3).length, 2);
});

test('reconcile: regenerate/retry in a synced Hermes chat is not shown twice (review P1-1)', () => {
  const local = [ut('u-1', 'Wie ist das Wetter in Berlin?'), at('a-2', 'Sonnig, 21 Grad.')];
  const remote = mapRemoteMessages([
    row('1', 'user', 'Wie ist das Wetter in Berlin?', 1),
    row('2', 'assistant', 'Regnerisch.', 2),
    row('3', 'user', 'Wie ist das Wetter in Berlin?', 3),
    row('4', 'assistant', 'Sonnig, 21 Grad.', 4),
  ]);
  const merged = reconcileTranscript(local, remote);
  assert.deepEqual(merged.map((m) => m.id), ['u-1', 'a-2']);
  assert.equal(merged[1].text, 'Sonnig, 21 Grad.');

  // continued elsewhere after the regenerate: only the new turn is appended
  const more = mapRemoteMessages([
    row('1', 'user', 'Wie ist das Wetter in Berlin?', 1),
    row('2', 'assistant', 'Regnerisch.', 2),
    row('3', 'user', 'Wie ist das Wetter in Berlin?', 3),
    row('4', 'assistant', 'Sonnig, 21 Grad.', 4),
    row('5', 'user', 'Und morgen?', 5),
    row('6', 'assistant', 'Bewölkt.', 6),
  ]);
  assert.deepEqual(reconcileTranscript(local, more).map((m) => m.id), ['u-1', 'a-2', 'hu-5', 'ha-6']);

  // retry after a run whose answer was never stored ([U, U, A])
  const noAnswer = mapRemoteMessages([row('1', 'user', 'Wie ist das Wetter in Berlin?', 1), row('3', 'user', 'Wie ist das Wetter in Berlin?', 3), row('4', 'assistant', 'Sonnig, 21 Grad.', 4)]);
  assert.equal(reconcileTranscript(local, noAnswer).length, 2);

  // the same text sent twice on purpose stays two turns
  const twice = [ut('u-1', 'ok'), at('a-1', 'Gut.'), ut('u-2', 'ok'), at('a-2', 'Weiter.')];
  const remoteTwice = mapRemoteMessages([row('1', 'user', 'ok', 1), row('2', 'assistant', 'Gut.', 2), row('3', 'user', 'ok', 3), row('4', 'assistant', 'Weiter.', 4)]);
  assert.equal(reconcileTranscript(twice, remoteTwice), twice);
});

test('signature covers repairs of earlier messages, so the reconciled transcript is saved (review P2-5)', () => {
  const local = [ut('u-1', 'Erste Frage bitte'), at('a-1', '', { status: 'error', error: 'Netzwerk' }), ut('u-2', 'Zweite Frage'), at('a-2', 'Antwort 2')];
  const remote = mapRemoteMessages([
    row('1', 'user', 'Erste Frage bitte', 1),
    row('2', 'assistant', 'Antwort 1 (vom Server)', 2),
    row('3', 'user', 'Zweite Frage', 3),
    row('4', 'assistant', 'Antwort 2', 4),
  ]);
  const merged = reconcileTranscript(local, remote);
  assert.equal(merged[1].text, 'Antwort 1 (vom Server)');
  assert.notEqual(messagesSignature(merged), messagesSignature(local));
  assert.equal(messagesSignature(merged), messagesSignature(merged.map((m) => ({ ...m }))));
});

test('bridge auto-title (meta) survives saves, is replaced by Hermes titles, never replaces a user title (review P3-7)', () => {
  let st: IndexState = { items: [local('a', { title: 'Neuer Chat', titleSource: 'auto' })] };
  st = indexReducer(st, { type: 'autoTitle', id: 'a', title: 'Wetter Berlin' });
  assert.equal(st.items[0].titleSource, 'meta');
  st = indexReducer(st, { type: 'saved', id: 'a', now: 1, firstUserText: 'wie ist das wetter', preview: 'x', messageCount: 2 });
  assert.equal(st.items[0].title, 'Wetter Berlin');
  assert.equal(migrateIndex({ items: st.items }).items[0].titleSource, 'meta');
  const res = mergeRemoteSessions(st.items, { profile, sessions: [sess('hui-a', { title: 'Berliner Wetter heute', source: 'api_server' })] });
  assert.equal(res.items[0].title, 'Berliner Wetter heute');
  assert.equal(res.items[0].titleSource, 'remote');
  const user = indexReducer({ items: [local('b', { title: 'Mein', titleSource: 'user' })] }, { type: 'autoTitle', id: 'b', title: 'X' });
  assert.equal(user.items[0].title, 'Mein');
});

test('H4: the same session id on two independent servers gives two conversations; tombstones are per server', () => {
  const A = { id: 'p-a', kind: 'hermes' as const };
  const B = { id: 'p-b', kind: 'hermes' as const };
  const sameServer = (of: string) => (pid: string) => pid === of; // A and B are different servers
  const f = { foreign: true };
  const first = mergeRemoteSessions([], { profile: A, sessions: [sess('20261010_101010_ab', { title: 'Server A' })], filter: f, sameServer: sameServer('p-a') });
  const second = mergeRemoteSessions(first.items, { profile: B, sessions: [sess('20261010_101010_ab', { title: 'Server B' })], filter: f, sameServer: sameServer('p-b') });
  assert.equal(second.items.length, 2);
  const a = second.items.find((c) => c.profileId === 'p-a')!;
  const b = second.items.find((c) => c.profileId === 'p-b')!;
  assert.equal(a.title, 'Server A', 'first server entry untouched');
  assert.equal(b.title, 'Server B');
  assert.notEqual(a.id, b.id);

  // hidden on server A only
  const hidden = [hiddenKey('p-a', '20261010_101010_ab')];
  assert.equal(mergeRemoteSessions([], { profile: B, sessions: [sess('20261010_101010_ab')], filter: f, hidden, sameServer: sameServer('p-b') }).items.length, 1);
  assert.equal(mergeRemoteSessions([], { profile: A, sessions: [sess('20261010_101010_ab')], filter: f, hidden, sameServer: sameServer('p-a') }).items.length, 0);
  // legacy bare tombstone still hides everywhere; profiles sharing one server still deduplicate
  assert.equal(mergeRemoteSessions([], { profile: B, sessions: [sess('20261010_101010_ab')], filter: f, hidden: ['20261010_101010_ab'] }).items.length, 0);
  const shared = mergeRemoteSessions(first.items, { profile: B, sessions: [sess('20261010_101010_ab')], filter: f, sameServer: () => true });
  assert.equal(shared.items.length, 1);
});

test('H4: a sanitising collision of two different session ids still creates both entries', () => {
  const r = mergeRemoteSessions([], { profile, sessions: [sess('a/b'), sess('a:b')], filter: { foreign: true } });
  assert.equal(r.items.length, 2);
  assert.notEqual(r.items[0].id, r.items[1].id);
});

test('M2: activity reported while a transcript fetch is in flight is not acknowledged by it', () => {
  let st: IndexState = { items: [local('c', { origin: 'remote', remote: { source: 'api_server', lastActive: 5000 } })] };
  const startActive = st.items[0].remote!.lastActive;
  // in flight: the list sync reports a newly finished turn
  st = { ...st, items: [{ ...st.items[0], remote: { ...st.items[0].remote!, lastActive: 9000 } }] };
  // the fetched snapshot only contains rows up to 5000
  st = indexReducer(st, { type: 'remoteLoaded', id: 'c', at: remoteLoadedAt(startActive, 5000), lastActive: 5000 });
  assert.equal(needsRemoteLoad(st.items[0]), true, 'the new turn is fetched next');
  st = indexReducer(st, { type: 'remoteLoaded', id: 'c', at: remoteLoadedAt(9000, 9000), lastActive: 9000 });
  assert.equal(needsRemoteLoad(st.items[0]), false);
});

test('Astra F08: a fetched snapshot is acknowledged (loadedAt) only after it was saved; a refused replace acks nothing', () => {
  const remote = mapRemoteMessages(parseMessages(MESSAGES_FIXTURE, 'x').messages);
  const log: string[] = [];
  const out = applyRemoteSnapshot({ messages: [], remote, origin: 'remote', replace: () => true, save: () => log.push('save'), ack: () => log.push('ack') });
  assert.ok(out);
  assert.deepEqual(log, ['save', 'ack']);
  log.length = 0;
  const refused = applyRemoteSnapshot({ messages: [], remote, origin: 'remote', replace: () => false, save: () => log.push('save'), ack: () => log.push('ack') });
  assert.equal(refused, null);
  assert.deepEqual(log, []);
});

test('reconcile: long prompts with different endings remain separate turns', () => {
  const shared = 'Please compare these options using the following criteria. '.repeat(10);
  const first = shared + 'Option A';
  const second = shared + 'Option B';
  const local = [ut('u-test-first', first), at('a-test-first', 'First answer')];
  const remote = mapRemoteMessages([
    row('test-1', 'user', first, 1), row('test-2', 'assistant', 'First answer', 2),
    row('test-3', 'user', second, 3), row('test-4', 'assistant', 'Second answer', 4),
  ]);
  const merged = reconcileTranscript(local, remote);
  assert.deepEqual(merged.map((m) => m.text), [first, 'First answer', second, 'Second answer']);
});

test('reconcile: remote-only refresh brings back tool results even when text and tool count match', () => {
  const before: Row[] = [
    row('test-user', 'user', 'Read the report', 1),
    { ...row('test-answer', 'assistant', 'Reading the report', 2), finishReason: 'tool_calls',
      toolCalls: [{ id: 'test-call', name: 'read_file', arguments: { path: 'report.txt' } }] },
  ];
  const local = mapRemoteMessages(before);
  const remote = mapRemoteMessages([...before, {
    id: 'test-result', role: 'tool', content: 'Report contents', toolCallId: 'test-call', timestamp: 3,
  }]);
  const merged = reconcileTranscript(local, remote, 'remote');
  assert.equal(merged[1].tools[0].detail?.output, 'Report contents');
  assert.equal(reconcileTranscript(merged, mapRemoteMessages([...before, {
    id: 'test-result', role: 'tool', content: 'Report contents', toolCallId: 'test-call', timestamp: 3,
  }]), 'remote'), merged, 'an unchanged refresh keeps the current objects');
});

test('reconcile: remote-only refresh updates an unchanged partial answer to failed', () => {
  const before = [row('test-user', 'user', 'Read the report', 1), row('test-answer', 'assistant', 'Reading', 2)];
  const local = mapRemoteMessages(before);
  const remote = mapRemoteMessages([before[0], { ...before[1], finishReason: 'error' }]);
  assert.equal(reconcileTranscript(local, remote, 'remote')[1].status, 'error');
});

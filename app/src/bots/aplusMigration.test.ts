/**
 * Existing users updating to bots A+: what they had stays, once. Bot Chat moved aside by Hermes (fix/03-botchat-moved
 * marks it), "Neuer Chat mit <Bot>" chats, sync, reload from storage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDrawer } from '../conversations/drawerFilter.ts';
import { indexReducer as reduceIndex, isDraft } from '../conversations/indexReducer.ts';
import { migrateIndex } from '../conversations/migrate.ts';
import { mergeRemoteSessions, listable, needsRemoteLoad } from '../conversations/remoteSync.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { feedRows, mergeBotTimeline } from './timeline.ts';
import type { ConversationMeta, IndexState } from '../conversations/types.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import { botScreenMode, findBotTalk, rosterRows } from './core.ts';
import type { HermesBot } from '../hermes/bots.ts';

const base = (id: string, extra: Partial<ConversationMeta>): ConversationMeta => ({ id, title: id, titleSource: 'auto', profileId: 'p', profileKind: 'hermes', createdAt: 1, updatedAt: 10, preview: 'x', messageCount: 2, ...extra });
const session = (id: string, extra: Partial<RemoteSession> = {}): RemoteSession => ({ id, source: 'api_server', title: 'whatever', startedAt: 1, lastActive: 50, messageCount: 2, ...extra }) as RemoteSession;
const AUTHORITY = { flags: { run_unknown_resolution: true } };
const WRITABLE = { flags: { session_resources: true } };

// a 0.2.2 index: the Bot Chat, an ordinary chat with the bot, an unrelated chat
const old022 = (): ConversationMeta[] => [
  base('botchat', { botChat: true, hermesSessionId: 'local-1', hermesProfile: 'writer', title: 'Bot Chat', titleSource: 'remote' }),
  base('newchat', { hermesSessionId: 'hui-aaa', hermesProfile: 'writer', title: 'Neuer Chat mit Quill' }),
  base('plain', { hermesSessionId: 'hui-bbb' }),
];

test('the talk is created once, no matter how often the screen opens', () => {
  let s: IndexState = { items: old022() };
  s = reduceIndex(s, { type: 'botTalk', id: 'talk', profile: { id: 'p', kind: 'hermes' }, bot: 'writer', sessionId: 'hui-bot-writer', now: 20, title: 'Bot Chat' });
  const talk = findBotTalk(s.items, 'p', 'writer')!;
  assert.equal(talk.hermesSessionId, 'hui-bot-writer');
  assert.equal(talk.hermesProfile, 'writer');
  assert.equal(findBotTalk(s.items, 'p', undefined), undefined);
  assert.equal(isDraft(talk), false);
});

test('after the update the drawer lists exactly what it listed before', () => {
  const before = filterDrawer(old022(), { chatScope: 'all' }).map((c) => c.id);
  let s: IndexState = { items: old022() };
  s = reduceIndex(s, { type: 'botTalk', id: 'talk', profile: { id: 'p', kind: 'hermes' }, bot: 'writer', sessionId: 'hui-bot-writer', now: 20, title: 'Bot Chat' });
  const items = s.items.map((c) => (c.id === 'botchat' ? { ...c, botChat: undefined, botChatRetired: true as const } : c));
  assert.deepEqual(filterDrawer(items, { chatScope: 'all' }).map((c) => c.id), before);
  // and ordinary chats are the same objects
  assert.deepEqual(items.find((c) => c.id === 'newchat'), old022()[1]);
});

test('flags survive a reload from storage; only on Hermes conversations with a session', () => {
  const load = (m: Record<string, unknown>) => migrateIndex({ v: 1, items: [{ ...base('a', {}), ...m }] }).items[0];
  assert.equal(load({ botTalk: true, hermesSessionId: 'hui-bot-default' }).botTalk, true);
  assert.equal(load({ botChatRetired: true, hermesSessionId: 'local-1' }).botChatRetired, true);
  assert.equal(load({ botTalk: true }).botTalk, undefined);
  assert.equal(load({ botTalk: true, hermesSessionId: 'x', profileKind: 'demo' }).botTalk, undefined);
});

test('the chat list never makes the talk an entry, also with other Hermes chats shown', () => {
  assert.equal(listable(session('hui-bot-writer')), false);
  assert.equal(listable(session('hui-bot-writer'), { foreign: true }), false);
  assert.equal(listable(session('hui-ccc')), true);
  const r = mergeRemoteSessions(old022(), { profile: { id: 'p', kind: 'hermes' }, sessions: [session('hui-bot-default'), session('hui-ddd')] });
  assert.ok(!r.items.some((c) => c.hermesSessionId === 'hui-bot-default'));
  assert.ok(r.items.some((c) => c.hermesSessionId === 'hui-ddd'));
});

test("the list sync updates a talk that exists, and doesn't prune it when the server doesn't list it", () => {
  const talk = base('talk', { botTalk: true, hermesSessionId: 'hui-bot-default', messageCount: 0, preview: '', titleSource: 'remote' });
  const seen = mergeRemoteSessions([talk], { profile: { id: 'p', kind: 'hermes' }, sessions: [session('hui-bot-default', { lastActive: 99 })], completeSources: ['api_server'] });
  assert.equal(seen.items[0].remote?.lastActive, 99);
  const gone = mergeRemoteSessions([{ ...talk, origin: 'remote', remote: { source: 'api_server', lastActive: 1 } }], { profile: { id: 'p', kind: 'hermes' }, sessions: [], completeSources: ['api_server'] });
  assert.equal(gone.items.length, 1);
});

test('botScreenMode: Hermes setups', () => {
  const chat = old022()[0];
  // Hermes v0.22.3+: the merged screen
  assert.equal(botScreenMode(chat, [chat], AUTHORITY), 'talk');
  // older Hermes: the writable Bot Chat, one thread as before
  assert.equal(botScreenMode(chat, [chat], WRITABLE), 'thread');
  // capabilities unknown: wait, then the old behaviour (a send explains itself)
  assert.equal(botScreenMode(chat, [chat], null), 'wait');
  // a talk or former Bot Chat stays reachable whatever the server says now
  const talk = base('t', { botTalk: true, hermesProfile: 'writer' });
  assert.equal(botScreenMode(chat, [chat, talk], WRITABLE), 'talk');
  assert.equal(botScreenMode(chat, [chat, talk], null), 'talk');
  const old = base('o', { botChatRetired: true, hermesProfile: 'writer' });
  assert.equal(botScreenMode(chat, [chat, old], WRITABLE), 'talk');
  assert.equal(botScreenMode(old, [old], null), 'talk');
  // another bot's talk changes nothing here
  assert.equal(botScreenMode(chat, [chat, base('t2', { botTalk: true, hermesProfile: 'other' })], WRITABLE), 'thread');
});

test('the offline demo keeps its one thread', () => {
  const demo = base('d', { botChat: true, profileKind: 'demo', hermesSessionId: 'demo-1', hermesProfile: 'writer' });
  assert.equal(botScreenMode(demo, [demo], AUTHORITY), 'thread');
  assert.equal(botScreenMode(demo, [demo], null), 'thread');
});

test('a turn in the talk lifts the bot entry; a later fetch of the older Bot Chat keeps that last line', () => {
  let s: IndexState = { items: [base('chat', { botChat: true, hermesSessionId: 'local-1', preview: 'Wasser: trink', updatedAt: 100 }), base('t', { botTalk: true, hermesSessionId: 'hui-bot-default', preview: '', messageCount: 0, updatedAt: 90, titleSource: 'remote' })] };
  s = reduceIndex(s, { type: 'saved', id: 't', now: 200, preview: 'ok, eine Stunde später', messageCount: 2, truncated: false } as never);
  const chat = () => s.items.find((c) => c.id === 'chat')!;
  assert.equal(chat().updatedAt, 200);
  assert.equal(chat().preview, 'ok, eine Stunde später');
  assert.equal(chat().messageCount, 2);
  s = reduceIndex(s, { type: 'saved', id: 'chat', now: 200, preview: 'Wasser: trink', messageCount: 2, truncated: false } as never);
  assert.equal(chat().preview, 'ok, eine Stunde später');
  // a newer delivery takes the line back
  s = reduceIndex(s, { type: 'saved', id: 'chat', now: 300, preview: 'Sport: los', messageCount: 4, truncated: false } as never);
  assert.equal(chat().preview, 'Sport: los');
});

test('roster: unread, working and waiting come from either source', () => {
  const bot: HermesBot = { name: 'writer', default: false } as HermesBot;
  const items = [base('chat', { botChat: true, hermesProfile: 'writer', hermesSessionId: 'local-1' }), base('t', { botTalk: true, hermesProfile: 'writer', hermesSessionId: 'hui-bot-writer' })];
  const row = (o: { running?: string[]; unread?: string[]; attention?: never[] }) => rosterRows({ bots: [bot], items, profileId: 'p', running: new Set(o.running), unread: new Set(o.unread), attention: o.attention ?? [] })[0];
  assert.equal(row({ unread: ['t'] }).badge, 'unread');
  assert.equal(row({ unread: ['chat'] }).badge, 'unread');
  assert.equal(row({ running: ['t'] }).working, true);
  assert.equal(row({ attention: [{ requestId: 'r', profileId: 'p', conversationId: 't', since: 1, source: 'chat' }] as never[] }).waiting, 1);
  assert.equal(row({}).chat?.id, 'chat');
  assert.equal(rosterRows({ bots: [bot], items, profileId: 'p', running: new Set(), unread: new Set(), attention: [] }).length, 1);
});

test('a talk deleted elsewhere goes on under a new id: its messages stay as history, no list entry, the screen follows', () => {
  const talk = base('t', { botTalk: true, hermesSessionId: 'hui-bot-default', remote: { source: 'api_server', lastActive: 5 } });
  let s: IndexState = { items: [base('chat', { botChat: true, hermesSessionId: 'local-1' }), talk], activeId: 't' };
  s = reduceIndex(s, { type: 'botTalkMoved', id: 't', nextId: 't2', sessionId: 'hui-bot-default--ab', now: 99 });
  const next = findBotTalk(s.items, 'p', undefined)!;
  assert.equal(next.id, 't2');
  assert.equal(next.hermesSessionId, 'hui-bot-default--ab');
  assert.equal(next.remote, undefined);
  assert.equal(s.activeId, 't2');
  const old = s.items.find((c) => c.id === 't')!;
  assert.equal(old.botChatRetired, true);
  assert.equal(old.botTalk, undefined);
  assert.equal(old.hermesSessionId, 'hui-bot-default');
  assert.deepEqual(filterDrawer(s.items, { chatScope: 'all' }).map((c) => c.id), []);
});

test('an empty talk that moves leaves nothing behind', () => {
  const talk = base('t', { botTalk: true, hermesSessionId: 'hui-bot-default', messageCount: 0, preview: '' });
  const s = reduceIndex({ items: [talk] }, { type: 'botTalkMoved', id: 't', nextId: 't2', sessionId: 'x', now: 1 });
  assert.deepEqual(s.items.map((c) => c.id), ['t2']);
});

test('a device that was offline during a move: it follows, keeps its history once, and shows the new turns once', () => {
  const row = (id: string, role: ChatMessage['role'], createdAt: number): ChatMessage => ({ id, role, text: id, tools: [], status: 'done', createdAt });
  const old = base('t', { botTalk: true, hermesSessionId: 'hui-bot-default', remote: { source: 'api_server', lastActive: 5, loadedAt: 5, remoteCount: 2 } });
  const s = reduceIndex({ items: [base('chat', { botChat: true, hermesSessionId: 'local-1' }), old], activeId: 't' }, { type: 'botTalkMoved', id: 't', nextId: 't2', sessionId: 'hui-bot-default--ab', now: 100 });
  // the new talk fetches the newer session as any second device does, once the sync reported its activity
  const next = findBotTalk(s.items, 'p', undefined)!;
  const reported = reduceIndex(s, { type: 'botChatRemote', id: next.id, lastActive: 200, remoteCount: 2 });
  const fetched = reported.items.find((c) => c.id === next.id)!;
  assert.equal(needsRemoteLoad(fetched), true);
  assert.equal(fetched.origin, 'remote');
  // the old rows join as history; the failed-and-re-sent turn lives only in the new session
  const history = [row('u1', 'user', 1), row('a1', 'assistant', 2)];
  const talkRows = [row('hu-1', 'user', 150), row('ha-2', 'assistant', 160)];
  const merged = mergeBotTimeline(talkRows, feedRows([{ key: 't', sessionId: 'hui-bot-default', messages: history }], next.hermesSessionId));
  assert.deepEqual(merged.map((m) => m.text), ['u1', 'a1', 'hu-1', 'ha-2']);
  assert.equal(new Set(merged.map((m) => m.id)).size, merged.length);
  assert.equal(s.activeId, 't2');
  // the bot still has one row, with unread from the talk now on screen
  const rows = rosterRows({ bots: [{ name: 'default', default: true } as HermesBot], items: s.items, profileId: 'p', running: new Set(), unread: new Set(['t2']), attention: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].badge, 'unread');
});

test('a moved talk keeps its history: the list sync never removes the former talk or its transcript', () => {
  const talk = base('t', { botTalk: true, hermesSessionId: 'hui-bot-default', remote: { source: 'api_server', lastActive: 5 } });
  const s = reduceIndex({ items: [talk], activeId: 't' }, { type: 'botTalkMoved', id: 't', nextId: 't2', sessionId: 'hui-bot-default--ab', now: 9 });
  const r = mergeRemoteSessions(s.items, { profile: { id: 'p', kind: 'hermes' }, sessions: [], completeSources: ['api_server'], activeId: 't2' });
  assert.deepEqual(r.removed, []);
  assert.ok(r.items.find((c) => c.id === 't')?.botChatRetired);
  // the plain duplicate an old app left in the list still goes
  const dup = base('d', { hermesSessionId: 'hui-bot-default' });
  assert.deepEqual(mergeRemoteSessions([dup], { profile: { id: 'p', kind: 'hermes' }, sessions: [] }).removed, ['d']);
});

test('a moved talk starts clean: no "older messages not stored" note from the one before', () => {
  const talk = base('t', { botTalk: true, hermesSessionId: 'hui-bot-default', historyTruncated: true });
  const s = reduceIndex({ items: [talk] }, { type: 'botTalkMoved', id: 't', nextId: 't2', sessionId: 'x', now: 1 });
  assert.equal(s.items.find((c) => c.id === 't2')?.historyTruncated, undefined);
  assert.equal(s.items.find((c) => c.id === 't')?.historyTruncated, true);
});

test('which rows went over to the next talk survives a reload', () => {
  const talk = base('t', { botTalk: true, hermesSessionId: 'hui-bot-default' });
  const s = reduceIndex({ items: [talk] }, { type: 'botTalkMoved', id: 't', nextId: 't2', sessionId: 'x', now: 1, carried: ['u'] });
  const back = migrateIndex(JSON.parse(JSON.stringify({ v: 1, items: s.items })));
  assert.deepEqual(back?.items.find((c) => c.id === 't')?.carriedTurns, ['u']);
});

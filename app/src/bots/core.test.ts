/// <reference types="node" />
// Bots as contacts: Bot Chat lookup, roster order and badges, attention ("Wartet auf dich"), approval choices, and the
// conversation store rules for a bot's thread (never a draft, never listed under Chats, never pruned by the sync).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_CHAT_TITLE, attentionOf, botApprovalChoices, botChatFromAnswer, botKey, botMonogram, botStatusKind, botTintIndex, botsTabAvailable,
  conversationOfSession, createAttentionStore, findBotChat, isBotChatEntry, pickBotChatRow, rosterRows, waitingSummary, type AttentionItem,
} from './core.ts';
import { parseSession } from '../hermes/sessions.ts';
import type { HermesBot } from '../hermes/bots.ts';
import type { ConversationMeta } from '../conversations/types.ts';
import { indexReducer, isDraft } from '../conversations/indexReducer.ts';
import { shownInDrawer } from '../conversations/drawerFilter.ts';
import { mergeRemoteSessions } from '../conversations/remoteSync.ts';
import { migrateIndex } from '../conversations/migrate.ts';
import { emptyChatRebindTarget } from '../chat/chatProfile.ts';

const BOTS: HermesBot[] = [
  { name: 'default', default: true },
  { name: 'writer', default: false, label: 'Quill' },
  { name: 'scout', default: false, pinned: true } as HermesBot,
  { name: 'code', default: false },
];
const chat = (id: string, over: Partial<ConversationMeta> = {}): ConversationMeta => ({
  id, title: BOT_CHAT_TITLE, titleSource: 'remote', profileId: 'p1', profileKind: 'hermes', hermesSessionId: `api_${id}`, createdAt: 1, updatedAt: 1, preview: '', messageCount: 0, botChat: true, ...over,
});

test('the Bots tab needs a Hermes connection with a bot besides the default', () => {
  assert.equal(botsTabAvailable('hermes', BOTS), true);
  assert.equal(botsTabAvailable('hermes', [BOTS[0]]), false, 'default only: the app looks like 0.1');
  assert.equal(botsTabAvailable('hermes', [BOTS[0]], true), true, 'default only, but this device may create the first bot');
  assert.equal(botsTabAvailable('demo', [BOTS[0]], true), false);
  assert.equal(botsTabAvailable('hermes', []), false);
  assert.equal(botsTabAvailable('demo', BOTS), false);
  assert.equal(botsTabAvailable('claude', BOTS), false);
});

test('Bot Chat lookup: exact title only, newest wins, hidden rows are fine', () => {
  const json = {
    object: 'list',
    data: [
      { id: 'api_1', title: 'Bot Chats im Vergleich', started_at: 1, last_active: 9, message_count: 2 },
      { id: 'api_2', title: 'Bot Chat', started_at: 1, last_active: 5, message_count: 4, hidden: true },
      { id: 'api_3', title: 'Bot Chat', started_at: 1, last_active: 7, message_count: 1 },
      { id: '../x', title: 'Bot Chat', started_at: 1, last_active: 99, message_count: 1 },
    ],
  };
  assert.equal(pickBotChatRow(json, parseSession)?.id, 'api_3');
  assert.equal(pickBotChatRow({ sessions: [json.data[1]] }, parseSession)?.id, 'api_2');
  assert.equal(pickBotChatRow({ data: [json.data[0]] }, parseSession), null);
  assert.equal(pickBotChatRow(null, parseSession), null);
  assert.equal(botChatFromAnswer({ object: 'hermes.session', session: { id: 'api_9', title: 'Bot Chat', started_at: 2, message_count: 0 }, adopted: false }, parseSession)?.id, 'api_9');
  assert.equal(botChatFromAnswer({ session: { id: 'api_9', title: 'Other' } }, parseSession), null);
  assert.equal(botChatFromAnswer({ error: {} }, parseSession), null);
});

test('find / adopt: per connection and bot; an earlier ordinary entry of the same session is reused', () => {
  const items = [chat('a', { hermesProfile: 'writer' }), chat('b'), chat('c', { profileId: 'p2', hermesProfile: 'writer' }), { ...chat('d', { hermesProfile: 'scout' }), botChat: undefined, remote: { source: 'api_server', title: 'Bot Chat' } }];
  assert.equal(findBotChat(items, 'p1', 'writer')?.id, 'a');
  assert.equal(findBotChat(items, 'p1', undefined)?.id, 'b');
  assert.equal(findBotChat(items, 'p1', 'default')?.id, 'b');
  assert.equal(findBotChat(items, 'p2', undefined), undefined);
  assert.equal(findBotChat(items, 'p1', 'scout'), undefined);
  assert.equal(conversationOfSession(items, 'p1', 'scout', 'api_d')?.id, 'd');
  assert.equal(isBotChatEntry(items[3]), true);
  assert.equal(isBotChatEntry({ ...chat('e'), botChat: undefined }), false);
});

test('roster: default first, pinned next, then by last activity; badges approval > unread; working', () => {
  const items = [
    chat('w', { hermesProfile: 'writer', updatedAt: 500, messageCount: 3, preview: 'x' }),
    chat('c', { hermesProfile: 'code', updatedAt: 900, messageCount: 1, preview: 'y' }),
    chat('h', { updatedAt: 100, messageCount: 1, preview: 'z' }),
  ];
  const attention: AttentionItem[] = [{ requestId: 'r1', profileId: 'p1', conversationId: 'w', since: 10, source: 'chat' }];
  const rows = rosterRows({ bots: BOTS, items, profileId: 'p1', running: new Set(['c']), unread: new Set(['w', 'c']), attention });
  assert.deepEqual(rows.map((r) => r.key), ['default', 'scout', 'code', 'writer']);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.writer.badge, 'approval', 'approval beats unread');
  assert.equal(by.code.badge, 'unread');
  assert.equal(by.code.working, true);
  assert.equal(by.scout.chat, undefined);
  assert.equal(by.scout.time, undefined, 'never used: no time');
  assert.equal(by.default.time, 100);
  // an inbox item without a known conversation counts for its bot; one of an ordinary chat does not
  const inbox: AttentionItem[] = [
    { requestId: 'r2', profileId: 'p1', bot: 'scout', since: 1, source: 'inbox' },
    { requestId: 'r3', profileId: 'p1', conversationId: 'some-normal-chat', since: 2, source: 'inbox' },
    { requestId: 'r4', profileId: 'p2', bot: 'code', since: 2, source: 'inbox' },
  ];
  const rows2 = rosterRows({ bots: BOTS, items, profileId: 'p1', running: new Set(), unread: new Set(), attention: inbox });
  const by2 = Object.fromEntries(rows2.map((r) => [r.key, r]));
  assert.equal(by2.scout.waiting, 1);
  assert.equal(by2.default.waiting, 0);
  assert.equal(by2.code.waiting, 0, 'another connection');
});

test('attention store: chats replace their items, inbox adds/resolves, past deadlines drop out', () => {
  let now = 1000;
  const s = createAttentionStore(() => now);
  s.setChat('w', [{ requestId: 'r1', runId: 'run1', profileId: 'p1', bot: 'writer', since: 900, expiresAt: 900 + 300_000 }]);
  s.addInbox({ requestId: 'r1', profileId: 'p1', bot: 'writer', since: 800 }); // same request: the chat item wins
  s.addInbox({ requestId: 'r2', profileId: 'p1', bot: 'default', since: 500, expiresAt: 500 + 300_000 });
  assert.deepEqual(s.snapshot().map((i) => [i.requestId, i.source, i.bot]), [['r2', 'inbox', undefined], ['r1', 'chat', 'writer']]);
  s.setChat('w', []); // answered in the chat
  assert.deepEqual(s.snapshot().map((i) => i.requestId), ['r2']);
  const v = s.version();
  s.setChat('w', []);
  assert.equal(s.version(), v, 'no change, no emit');
  s.resolve('r2'); // answered on another device
  assert.equal(s.snapshot().length, 0);
  s.addInbox({ requestId: 'r3', profileId: 'p1', since: 0, expiresAt: 1000 });
  now = 1000 + 31_000;
  assert.equal(s.snapshot().length, 0, 'past the deadline (+ grace): Hermes denied it by itself');
});

test('"Wartet auf dich" summary: count, unique bots oldest first, first item to open', () => {
  const items: AttentionItem[] = [
    { requestId: 'a', profileId: 'p1', bot: 'writer', since: 1, source: 'chat', conversationId: 'w' },
    { requestId: 'b', profileId: 'p1', since: 2, source: 'inbox' },
    { requestId: 'c', profileId: 'p1', bot: 'writer', since: 3, source: 'inbox' },
    { requestId: 'd', profileId: 'p2', since: 0, source: 'inbox' },
  ];
  const s = waitingSummary(attentionOf(items, 'p1'));
  assert.equal(s.count, 3);
  assert.deepEqual(s.bots, ['writer', 'default']);
  assert.equal(s.first?.requestId, 'a');
  assert.deepEqual(waitingSummary([]), { count: 0, bots: [], first: null });
});

test('look and status helpers', () => {
  assert.equal(botMonogram('scout'), 'S');
  assert.equal(botMonogram('  ölwechsel'), 'Ö');
  assert.equal(botMonogram('🤖 Robo'), 'R');
  assert.equal(botMonogram('---'), '?');
  assert.equal(botTintIndex('scout', 6), botTintIndex('scout', 6));
  assert.ok(botTintIndex('writer', 6) >= 0 && botTintIndex('writer', 6) < 6);
  assert.equal(botStatusKind({ working: true, waiting: true }), 'waiting');
  assert.equal(botStatusKind({ working: true, waiting: false }), 'working');
  assert.equal(botStatusKind({ working: false, waiting: false }), 'idle');
  assert.equal(botKey(undefined), 'default');
  assert.equal(botKey('writer'), 'writer');
});

test('bot chats offer once / always / deny, never "for this session"', () => {
  assert.deepEqual(botApprovalChoices(['once', 'session', 'always', 'deny']), ['once', 'always', 'deny']);
  assert.deepEqual(botApprovalChoices(['once', 'session', 'deny']), ['once', 'deny']);
  assert.deepEqual(botApprovalChoices(['session']), ['once', 'deny']);
  assert.equal(botApprovalChoices(undefined), undefined);
});

// ------------------------------------------------------------------ the store's rules for a bot's thread

test('store: a new Bot Chat is a place, not a draft (never reused, pruned or rebound)', () => {
  let s = indexReducer({ items: [] }, { type: 'botChat', id: 'bc', profile: { id: 'p1', kind: 'hermes' }, bot: 'writer', sessionId: 'api_1', now: 5, title: BOT_CHAT_TITLE });
  const m = s.items[0];
  assert.equal(m.botChat, true);
  assert.equal(m.hermesProfile, 'writer');
  assert.equal(s.activeId, 'bc');
  assert.equal(isDraft(m), false);
  s = indexReducer(s, { type: 'pruneDrafts' });
  assert.equal(s.items.length, 1, 'kept by pruneDrafts');
  assert.equal(emptyChatRebindTarget(m, { id: 'p2', kind: 'hermes' }), null, 'never follows another connection');
  s = indexReducer(s, { type: 'setBot', id: 'bc', bot: 'scout', sessionId: 'x' });
  assert.equal(s.items[0].hermesProfile, 'writer');
  assert.equal(shownInDrawer(m, { chatScope: 'all' }), false, 'not in the chat list / desktop menus');
});

test('store: a Bot Chat with history waits for its transcript; botChatRemote refreshes activity and preview', () => {
  let s = indexReducer({ items: [] }, {
    type: 'botChat', id: 'bc', profile: { id: 'p1', kind: 'hermes' }, sessionId: 'api_1', now: 5, title: BOT_CHAT_TITLE, activate: false,
    remote: { source: 'api_server', lastActive: 4000, remoteCount: 6, title: BOT_CHAT_TITLE }, preview: 'Hi', messageCount: 6,
  });
  assert.equal(s.activeId, undefined);
  assert.equal(s.items[0].origin, 'remote');
  assert.equal(s.items[0].updatedAt, 4000);
  s = indexReducer(s, { type: 'botChatRemote', id: 'bc', lastActive: 9000, remoteCount: 8, preview: 'neu' });
  assert.equal(s.items[0].remote?.lastActive, 9000);
  assert.equal(s.items[0].updatedAt, 9000);
  const same = indexReducer(s, { type: 'botChatRemote', id: 'bc', lastActive: 9000, remoteCount: 8, preview: 'neu' });
  assert.equal(same, s);
  // an ordinary chat is never touched by it
  const other = indexReducer({ items: [{ ...chat('x'), botChat: undefined }] }, { type: 'botChatRemote', id: 'x', lastActive: 1 });
  assert.equal(other.items[0].remote, undefined);
});

test('store: adopting an earlier ordinary entry of the session turns it into the Bot Chat (unarchived, unpinned)', () => {
  const old: ConversationMeta = { ...chat('r-api_7'), botChat: undefined, title: 'Bot Chat', archived: true, pinned: true, origin: 'remote', remote: { source: 'api_server', title: 'Bot Chat' } };
  const s = indexReducer({ items: [old] }, { type: 'botChat', id: 'r-api_7', adopt: true, profile: { id: 'p1', kind: 'hermes' }, sessionId: 'api_r-api_7', now: 5, title: BOT_CHAT_TITLE });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].botChat, true);
  assert.equal(s.items[0].archived, undefined);
  assert.equal(s.items[0].pinned, undefined);
  assert.equal(s.activeId, 'r-api_7');
});

test('sync: a Bot Chat is neither pruned as foreign nor as vanished; stored flag survives migration', () => {
  const bc = chat('bc', { origin: 'remote', remote: { source: 'api_server', lastActive: 1, remoteCount: 2 }, messageCount: 2, preview: 'x' });
  const r = mergeRemoteSessions([bc], { profile: { id: 'p1', kind: 'hermes' }, sessions: [], completeSources: ['api_server'], filter: {} });
  assert.deepEqual(r.removed, []);
  assert.equal(r.items[0].id, 'bc');
  const st = migrateIndex({ v: 1, items: [bc, { ...bc, id: 'bad', profileKind: 'claude' }] }, 1);
  assert.deepEqual(st.items.map((c) => c.botChat), [true, undefined]);
});

test('cron deliveries in a Bot Chat: name, output, silent; ordinary text is no delivery', async () => {
  const { cronDelivery, cronPlainText } = await import('./core.ts');
  const d = cronDelivery('[Cronjob "[bot:scout] Preis-Check" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\n**Sony WH-1000XM6**: 289 € bei Shop A');
  assert.deepEqual(d, { name: 'Preis-Check', output: '**Sony WH-1000XM6**: 289 € bei Shop A', silent: false });
  assert.equal(cronPlainText(d!.output), 'Sony WH-1000XM6: 289 € bei Shop A');
  assert.equal(cronDelivery('[Cronjob "Wasser" output - scheduled job]\n\n[SILENT]')?.silent, true);
  assert.equal(cronDelivery('[Cronjob "Tee" output]\nTee kaufen')?.output, 'Tee kaufen');
  assert.equal(cronDelivery('Was ist ein [Cronjob "x" output]?'), null);
  assert.equal(cronDelivery(undefined), null);
  assert.equal(cronPlainText('Hier:\n```hui\n{"type":"table"}\n```\n\n\n\nEnde'), 'Hier:\n \n\nEnde');
});

test('without a Bots tab the default bot\'s thread (reminders) is a chat row once it has messages; other bots never', async () => {
  const { previewOf } = await import('../conversations/messages.ts');
  const def = chat('d', { messageCount: 2, preview: 'Buy tea: Time to buy tea.' });
  const empty = chat('e');
  const scout = chat('s', { hermesProfile: 'scout', messageCount: 3, preview: 'x' });
  assert.equal(shownInDrawer(def, { chatScope: 'all', defaultBotChat: true }), true);
  assert.equal(shownInDrawer(def, { chatScope: 'all' }), false, 'with a Bots tab it lives there');
  assert.equal(shownInDrawer(empty, { chatScope: 'all', defaultBotChat: true }), false, 'nothing delivered yet: no row');
  assert.equal(shownInDrawer(scout, { chatScope: 'all', defaultBotChat: true }), false);
  // the row's line is the reminder, not the injected header
  const now = 1;
  const msgs = [
    { id: 'u1', role: 'user' as const, text: '[Cronjob "Buy tea" output — scheduled job, not the user.]\n\nTime to buy tea.', createdAt: now, status: 'done' as const },
  ];
  assert.equal(previewOf(msgs as never), 'Buy tea: Time to buy tea.');
});

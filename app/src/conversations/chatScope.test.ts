/// <reference types="node" />
// Settings → Chat → "Chats": all app chats (every device) or only the ones created on this device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createdOnThisDevice, filterChatScope, inChatScope } from './chatScope.ts';
import { mergeRemoteSessions } from './remoteSync.ts';
import type { ConversationMeta } from './types.ts';

const base = (id: string, over: Partial<ConversationMeta> = {}): ConversationMeta => ({
  id,
  title: id,
  titleSource: 'auto',
  profileId: 'p-hermes',
  profileKind: 'hermes',
  hermesSessionId: `hui-${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  preview: 'x',
  messageCount: 2,
  ...over,
});
const remoteApp = (id: string, over: Partial<ConversationMeta> = {}) =>
  base(id, { origin: 'remote', remote: { source: 'api_server', lastActive: 2000, remoteCount: 2 }, ...over });

const local = base('local'); // started here (no `origin`)
const otherDevice = remoteApp('other'); // app session from another device / install (session list)
const otherOpened = remoteApp('opened', { remote: { source: 'api_server', lastActive: 2000, remoteCount: 2, loadedAt: 2500 } }); // opened here
const otherContinued = remoteApp('continued', { updatedAt: 9000, remote: { source: 'api_server', lastActive: 2000, remoteCount: 2, loadedAt: 2500 } }); // continued here
const telegram = base('tg', { hermesSessionId: '20261010_101010_abcd', origin: 'remote', remote: { source: 'telegram', lastActive: 2000 } });
const otherClient = base('api', { hermesSessionId: 'api-ef8beb15', origin: 'remote', remote: { source: 'api_server', lastActive: 2000 } });
const cron = base('cron', { hermesSessionId: 'cron_aaa111_20261011_142229', remote: { source: 'cron', lastActive: 2000 } });
const branch = base('branch', { branchSeed: 2 });

test('created on this device = not taken from the Hermes session list', () => {
  assert.equal(createdOnThisDevice(local), true);
  assert.equal(createdOnThisDevice(branch), true);
  assert.equal(createdOnThisDevice(otherDevice), false);
  // opening or continuing a chat from another device does not make it this device's chat
  assert.equal(createdOnThisDevice(otherOpened), false);
  assert.equal(createdOnThisDevice(otherContinued), false);
});

test('scope "all" (default) shows everything', () => {
  const items = [local, otherDevice, otherOpened, otherContinued, telegram, otherClient, cron, branch];
  assert.deepEqual(filterChatScope(items, 'all'), items);
  assert.equal(filterChatScope(items, 'all'), items, 'same array: nothing to filter');
  for (const c of items) assert.equal(inChatScope(c, 'all'), true, c.id);
});

test('scope "device" hides app chats started on another device, nothing else', () => {
  assert.equal(inChatScope(local, 'device'), true);
  assert.equal(inChatScope(branch, 'device'), true);
  assert.equal(inChatScope(otherDevice, 'device'), false);
  assert.equal(inChatScope(otherOpened, 'device'), false);
  assert.equal(inChatScope(otherContinued, 'device'), false);
  // Telegram / CLI / other API clients / cron reports follow the profile's own switches, not this setting
  assert.equal(inChatScope(telegram, 'device'), true);
  assert.equal(inChatScope(otherClient, 'device'), true);
  assert.equal(inChatScope(cron, 'device'), true);
  assert.deepEqual(
    filterChatScope([local, otherDevice, telegram, otherOpened, cron], 'device').map((c) => c.id),
    ['local', 'tg', 'cron'],
  );
});

test('a chat started here stays "this device" after the session list matched it', () => {
  // the list sync updates the local entry of a session this device created (matched by session id): no `origin`
  const r = mergeRemoteSessions([local], {
    profile: { id: 'p-hermes', kind: 'hermes' },
    sessions: [{ id: 'hui-local', source: 'api_server', startedAt: 1000, lastActive: 5000, messageCount: 4, title: 'T' }],
  });
  assert.equal(r.items[0].origin, undefined);
  assert.equal(inChatScope(r.items[0], 'device'), true);
  // the same session listed on a fresh install becomes a list entry → "another device" there
  const fresh = mergeRemoteSessions([], {
    profile: { id: 'p-hermes', kind: 'hermes' },
    sessions: [{ id: 'hui-local', source: 'api_server', startedAt: 1000, lastActive: 5000, messageCount: 4, title: 'T' }],
  });
  assert.equal(inChatScope(fresh.items[0], 'device'), false);
});

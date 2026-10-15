/// <reference types="node" />
// The drawer's visibility rules, shared with the desktop app's Chat / Dock menus and ⌘1–9 (desktop/menus.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidebarOrder } from '../desktop/order.ts';
import { filterDrawer, shownInDrawer } from './drawerFilter.ts';
import { groupConversations } from './group.ts';
import type { ConversationMeta } from './types.ts';

const base = (id: string, over: Partial<ConversationMeta> = {}): ConversationMeta => ({
  id,
  title: id,
  titleSource: 'auto',
  profileId: 'p-home',
  profileKind: 'hermes',
  hermesSessionId: `hui-${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  preview: 'x',
  messageCount: 2,
  ...over,
});
const local = base('local', { updatedAt: 3000 });
const otherDevice = base('other', { origin: 'remote', updatedAt: 5000, remote: { source: 'api_server', lastActive: 5000, remoteCount: 2 } });
const telegram = base('tg', { hermesSessionId: '20261010_101010_abcd', origin: 'remote', remote: { source: 'telegram', lastActive: 2000 } });
const work = base('work', { profileId: 'p-work', updatedAt: 4000, pinned: true });
const list = [local, otherDevice, telegram, work];

test('chatScope "device": an app chat from another device is hidden in the drawer and the menus alike', () => {
  assert.deepEqual(filterDrawer(list, { chatScope: 'all' }).map((m) => m.id), ['local', 'other', 'tg', 'work']);
  assert.deepEqual(filterDrawer(list, { chatScope: 'device' }).map((m) => m.id), ['local', 'tg', 'work']);
  assert.equal(shownInDrawer(otherDevice, { chatScope: 'device' }), false);
  // the desktop menus use the same predicate: ⌘1 can never open the hidden chat
  const menu = sidebarOrder(list, (m) => shownInDrawer(m, { chatScope: 'device' }));
  assert.deepEqual(menu.map((m) => m.id), ['work', 'local', 'tg']);
});


test('the menu order is the drawer order (pinned, then by recency; archived chats out)', () => {
  const archived = base('arch', { archived: true, updatedAt: 9000 });
  const all = [...list, archived];
  const drawer = groupConversations(filterDrawer(all, { chatScope: 'all' }).filter((m) => !m.archived), 10_000).flatMap((g) => g.items);
  assert.deepEqual(
    sidebarOrder(all, (m) => shownInDrawer(m, { chatScope: 'all' })).map((m) => m.id),
    drawer.map((m) => m.id),
  );
});

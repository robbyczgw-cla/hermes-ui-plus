// A group's approval opens the asking bot's own chat (groups/openBotChat.ts), never a chat of the hidden group session;
// PushHost routes a member turn's approval push there (source check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { ConversationMeta } from '../conversations/types.ts';
import { HermesError } from '../hermes/stream.ts';
import { openBotChatOf } from './openBotChat.ts';

function ctl(items: Partial<ConversationMeta>[] = []) {
  const opened: { bot: string | undefined; session: unknown; opts: unknown }[] = [];
  return {
    opened,
    list: () => items as ConversationMeta[],
    openBotChat: (_p: unknown, bot: string | undefined, session: unknown, opts?: unknown) => {
      opened.push({ bot, session, opts });
      return { id: `c-${bot ?? 'default'}`, botChat: true } as ConversationMeta;
    },
  };
}

test('the bot chat we have; else the server\'s "Bot Chat" (adopted, not activated); an older server: an app thread', async () => {
  const known = ctl([{ id: 'c1', profileId: 'p', botChat: true, hermesProfile: 'research' }]);
  let asked = 0;
  const m = await openBotChatOf(known, { id: 'p' }, 'research', async () => (asked++, {}));
  assert.equal(m?.id, 'c1');
  assert.equal(asked, 0);

  const fresh = ctl();
  const lookups: string[] = [];
  const r = await openBotChatOf(fresh, { id: 'p' }, 'research', async (method: string, path: string) => {
    lookups.push(`${method} ${path}`);
    return { data: [{ id: 'api_1', title: 'Bot Chat', source: 'api_server', message_count: 3, started_at: 1 }] };
  });
  assert.equal(r?.id, 'c-research');
  assert.match(lookups[0], /^GET \/api\/sessions\?title=Bot%20Chat&include_hidden=1/);
  assert.deepEqual([fresh.opened[0].bot, (fresh.opened[0].session as { id: string }).id, fresh.opened[0].opts], ['research', 'api_1', { activate: false }]);

  const old = ctl();
  const o = await openBotChatOf(old, { id: 'p' }, undefined, async () => {
    throw new HermesError('bad_request', 'not found', { status: 405 });
  });
  assert.equal(o?.id, 'c-default');
  assert.equal(old.opened[0].session, null);

  const down = ctl();
  assert.equal(await openBotChatOf(down, { id: 'p' }, 'research', async () => { throw new HermesError('auth', 'auth', { status: 401 }); }), null);
});

test('PushHost: an approval of a group member turn opens the bot\'s own chat before any session refresh', () => {
  const src = fs.readFileSync(new URL('../push/PushHost.tsx', import.meta.url), 'utf8');
  const group = src.indexOf('parseGroupSessionId(target.sessionId)');
  const refresh = src.indexOf('await refreshHermesSession(p, target.sessionId');
  assert.ok(group > 0 && refresh > group, 'the group branch must come before the session refresh (it would adopt the hidden session)');
});

test('the chat screen closes its drawer when a group screen asks (approval "Open", group rows)', async () => {
  const { onCloseDrawerRequest, requestCloseDrawer } = await import('./drawer.ts');
  let closed = 0;
  const off = onCloseDrawerRequest(() => closed++);
  requestCloseDrawer();
  off();
  requestCloseDrawer();
  assert.equal(closed, 1);
  const chat = fs.readFileSync(new URL('../chat/ChatScreen.tsx', import.meta.url), 'utf8');
  assert.match(chat, /onCloseDrawerRequest\(\(\) => setDrawerOpen\(false\)\)/);
  const screen = fs.readFileSync(new URL('./GroupChatScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /requestCloseDrawer\(\);\s+convs\.setActiveId/);
});

test('"Open" on an approval line reads the groups list again before it shows the bot\'s chat (that chat may be open already)', () => {
  // smoke `bots` then `groups`: Research's Bot Chat was the active chat under the group screen, so ChatView did not
  // remount and its useGroupApprovals kept the list from before the approval; the card never came
  const screen = fs.readFileSync(new URL('./GroupChatScreen.tsx', import.meta.url), 'utf8');
  const refresh = screen.indexOf('if (conn) await refreshGroups(conn);');
  const activate = screen.indexOf('convs.setActiveId(meta.id)');
  assert.ok(refresh > 0 && activate > refresh, 'refreshGroups must run before the bot\'s chat becomes active');
  const hook = fs.readFileSync(new URL('./useGroups.ts', import.meta.url), 'utf8');
  const body = hook.slice(hook.indexOf('export function useGroupApprovals'));
  assert.match(body, /void ensure\(conn, true\);[\s\S]*?\}, \[conn, bot\]\);/, 'switching to another bot\'s chat reads the list again');
});

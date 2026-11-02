/**
 * A bot's talk moving to a new session, controller and storage together: what the user had unsent is there afterwards,
 * also after a restart at the worst moment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../conversations/controller.ts';
import { indexReducer } from '../conversations/indexReducer.ts';
import { createRepo } from '../conversations/repo.ts';
import { memoryStorage } from '../conversations/storage/kv.ts';
import { createIndexStore } from '../conversations/store.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { draftIdsIn, moveDraftIn, patchReading, type ReadingMap } from '../chat/readingState.ts';
import { findBotTalk } from './core.ts';
import { feedRows } from './timeline.ts';

const PROFILE = { id: 'p', kind: 'hermes' as const };
const row = (id: string, role: ChatMessage['role'], extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, text: id, tools: [], status: 'done', createdAt: 1, ...extra });
const gone = (id: string) => row(id, 'assistant', { text: '', status: 'error', errorText: { key: 'backends.hermes.errors.reason.notFound' } as never });
const file = { id: 'f', kind: 'image', name: 'a.jpg', mimeType: 'image/jpeg', uri: 'file:///a.jpg', status: 'ready', remoteRef: 'r' } as never;

async function boot(rows: ChatMessage[], hooks = {}) {
  const storage = memoryStorage();
  const repo = createRepo(storage, { debounceMs: 1 });
  const store = createIndexStore(await repo.loadIndex());
  store.subscribe(() => repo.saveIndex(store.get()));
  const ctl = createController(store, repo, () => 1000, hooks);
  const talk = ctl.ensureBotTalk(PROFILE, undefined);
  ctl.setActive(talk.id);
  ctl.save(talk.id, rows);
  await repo.flush();
  return { storage, store, ctl, talk };
}

/** a new app start on the same storage */
async function restart(storage: ReturnType<typeof memoryStorage>) {
  const repo = createRepo(storage, { debounceMs: 1 });
  const store = createIndexStore(await repo.loadIndex());
  return { store, ctl: createController(store, repo) };
}

test('an attachment-only message refused with a gone session is in the next talk, stored, and only hidden in the old one then', async () => {
  const rows = [row('u0', 'user'), row('a0', 'assistant'), row('u1', 'user', { text: '', attachments: [file] }), gone('a1')];
  const { storage, ctl, talk } = await boot(rows);
  const next = await ctl.moveBotTalk(talk.id, undefined, rows);
  assert.notEqual(next?.id, talk.id);
  // restart right after the move: nothing depends on memory
  const after = await restart(storage);
  const now = findBotTalk(after.store.get().items, 'p', undefined)!;
  assert.equal(now.id, next?.id);
  assert.equal(after.store.get().activeId, now.id);
  const stored = await after.ctl.loadMessages(now.id);
  assert.deepEqual(stored.map((m) => m.id), ['u1']);
  assert.equal(stored[0].sendQueued, true);
  assert.equal(stored[0].attachments?.[0].uri, 'file:///a.jpg');
  assert.ok(now.messageCount > 0, 'counts as a chat with content');
  const old = after.store.get().items.find((c) => c.id === talk.id)!;
  const history = feedRows([{ key: old.id, sessionId: old.hermesSessionId, messages: await after.ctl.loadMessages(old.id), carried: old.carriedTurns }], now.hermesSessionId);
  assert.deepEqual(history.map((m) => m.id), ['f0:u0', 'f0:a0'], 'the old talk keeps its history, the message shows once');
});

test('the sync moving a talk takes a queued message along from storage (it could never be re-sent in the history)', async () => {
  const { store, ctl, talk } = await boot([row('u0', 'user'), row('a0', 'assistant'), row('q', 'user', { sendQueued: true })]);
  const next = await ctl.moveBotTalk(talk.id, 'hui-bot-default--other');
  assert.equal(next?.hermesSessionId, 'hui-bot-default--other');
  assert.deepEqual((await ctl.loadMessages(next!.id)).map((m) => m.id), ['q']);
  assert.deepEqual(store.get().items.find((c) => c.id === talk.id)?.carriedTurns, ['q']);
});

test('two moves at once: one new talk, not two', async () => {
  const { store, ctl, talk } = await boot([row('u0', 'user'), row('a0', 'assistant')]);
  const [a, b] = await Promise.all([ctl.moveBotTalk(talk.id), ctl.moveBotTalk(talk.id)]);
  assert.equal(a?.id, b?.id);
  assert.equal(store.get().items.filter((c) => c.botTalk).length, 1);
});

test('an unsent draft and its quotes follow the talk before the screen does; the composer of the next talk finds them', async () => {
  let map: ReadingMap = patchReading({}, 'x', { draft: 'other chat' }, 1);
  const seenAtDispatch: unknown[] = [];
  const hooks = {
    onBotTalkMove: (from: string, to: string) => {
      map = moveDraftIn(map, from, to, 2);
    },
  };
  const { store, ctl, talk } = await boot([row('u0', 'user'), row('a0', 'assistant')], hooks);
  map = patchReading(map, talk.id, { draft: 'halb getippt', quotes: [{ role: 'assistant', text: 'zitat' }], seen: 'a0' }, 1);
  const off = store.subscribe(() => {
    const active = store.get().activeId;
    if (active && active !== talk.id) seenAtDispatch.push(map[active]?.draft);
  });
  const next = await ctl.moveBotTalk(talk.id);
  off();
  assert.equal(seenAtDispatch[0], 'halb getippt', 'already there when the next talk mounts');
  assert.equal(map[next!.id].draft, 'halb getippt');
  assert.deepEqual(map[next!.id].quotes, [{ role: 'assistant', text: 'zitat' }]);
  assert.equal(map[talk.id].draft, undefined);
  assert.equal(map[talk.id].seen, 'a0', 'the rest of the old reading state stays');
  assert.equal(map.x.draft, 'other chat');
});

test('moveDraftIn: nothing to move, and never over a draft the target has', () => {
  const m = patchReading({}, 'a', { seen: 's' }, 1);
  assert.equal(moveDraftIn(m, 'a', 'b', 2), m);
  assert.equal(moveDraftIn(m, 'none', 'b', 2), m);
  const both = patchReading(patchReading({}, 'a', { draft: 'old' }, 1), 'b', { draft: 'mine' }, 1);
  assert.equal(moveDraftIn(both, 'a', 'b', 2), both);
});

test('start of the app: a fresh chat with an unsent draft or quote stays, an empty one goes, the open one stays', () => {
  const draft = (id: string) => ({ id, title: 'Neuer Chat', titleSource: 'auto' as const, profileId: 'p', profileKind: 'hermes' as const, createdAt: 1, updatedAt: 1, preview: '', messageCount: 0 });
  let map: ReadingMap = patchReading({}, 'text', { draft: 'halb getippt' }, 1);
  map = patchReading(map, 'quote', { quotes: [{ role: 'user', text: 'q' }] }, 1);
  map = patchReading(map, 'read', { seen: 'm' }, 1);
  const state = { items: [draft('text'), draft('quote'), draft('read'), draft('empty'), draft('open')], activeId: 'open' };
  const s = indexReducer(state, { type: 'pruneDrafts', keep: 'open', drafts: draftIdsIn(map) });
  assert.deepEqual(s.items.map((c) => c.id), ['text', 'quote', 'open']);
});

test('"Neuer Chat" leads back to a kept draft: the same conversation, so the composer restores its text', async () => {
  const repo = createRepo(memoryStorage(), { debounceMs: 1 });
  const store = createIndexStore(await repo.loadIndex());
  const ctl = createController(store, repo, () => 1000);
  const fresh = ctl.create(PROFILE);
  const other = ctl.createBranch(PROFILE, { messages: [row('u', 'user'), row('a', 'assistant')] });
  store.dispatch({ type: 'pruneDrafts', keep: other.id, drafts: [fresh.id] });
  assert.equal(ctl.create(PROFILE).id, fresh.id);
});

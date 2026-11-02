import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesError } from '../hermes/stream.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import type { ChatMessage } from '../hermes/types.ts';
import type { ConversationMeta } from '../conversations/types.ts';
import { feedSnapshot, syncBotFeed, type FeedSyncDeps } from './feedSync.ts';

const session = (id: string, lastActive: number, messageCount = 2): RemoteSession => ({ id, title: 'Bot Chat', source: 'local', startedAt: 1, lastActive, messageCount }) as RemoteSession;
const notFound = () => new HermesError('server', 'gone', { status: 404, code: 'session_not_found' } as never);
const boom = () => new HermesError('server', 'boom', { status: 500 } as never);
const row = (id: string, createdAt: number, role: ChatMessage['role'] = 'user'): ChatMessage => ({ id, role, text: id, tools: [], status: 'done', createdAt });
const base = (id: string, extra: Partial<ConversationMeta>): ConversationMeta => ({ id, title: 't', titleSource: 'remote', profileId: 'p', profileKind: 'hermes', createdAt: 1, updatedAt: 1, preview: '', messageCount: 0, ...extra });

function harness(metas: ConversationMeta[], over: Partial<FeedSyncDeps> = {}) {
  const items = new Map(metas.map((m) => [m.id, m]));
  const stored = new Map<string, ChatMessage[]>();
  const calls: string[] = [];
  const d: FeedSyncDeps = {
    ctl: {
      get: (id) => items.get(id),
      loadMessages: async (id) => stored.get(id) ?? [],
      save: (id, m) => {
        stored.set(id, m);
      },
      markRemoteLoaded: (id, at) => {
        const m = items.get(id)!;
        items.set(id, { ...m, remote: { source: m.remote?.source ?? 'x', ...m.remote, loadedAt: at } });
      },
      botChatRemote: (id, info) => {
        const m = items.get(id)!;
        items.set(id, { ...m, remote: { source: m.remote?.source ?? 'api_server', ...m.remote, ...(info.lastActive ? { lastActive: info.lastActive } : {}), ...(info.remoteCount !== undefined ? { remoteCount: info.remoteCount } : {}) } });
        calls.push(`remote:${id}`);
      },
    },
    now: () => 12345,
    lookupBotChat: async () => null,
    fetchTranscript: async (sid) => {
      calls.push(`fetch:${sid}`);
      return { remote: [row(`${sid}-1`, 5)], newest: 5 };
    },
    fetchSession: async () => {
      throw notFound();
    },
    findTalkSession: async () => null,
    moveTalk: (_id, sid) => {
      calls.push(`moveTalk:${sid ?? 'new'}`);
    },
    adopt: async (s) => {
      calls.push(`adopt:${s.id}`);
    },
    ...over,
  };
  return { d, items, stored, calls };
}

const botChat = (extra: Partial<ConversationMeta> = {}) => base('chat', { botChat: true, hermesSessionId: 'S', ...extra });
const talk = () => base('talk', { botTalk: true, hermesSessionId: 'hui-bot-default' });

test('a Bot Chat that moved is fetched and stored', async () => {
  const h = harness([botChat(), talk()], { lookupBotChat: async () => session('S', 100) });
  const r = await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.deepEqual(r, {});
  assert.ok(h.calls.includes('fetch:S'));
  assert.equal(h.stored.get('chat')?.length, 1);
});

test('a Bot Chat without news is not fetched again', async () => {
  const h = harness([botChat({ remote: { source: 'local', lastActive: 100, loadedAt: 100 } }), talk()], { lookupBotChat: async () => session('S', 100) });
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(!h.calls.includes('fetch:S'));
});

test('no Bot Chat on the server yet: nothing is an error', async () => {
  const h = harness([botChat(), talk()]);
  assert.deepEqual(await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' }), {});
});

test('another Bot Chat on the server goes to adopt, the known one is not fetched', async () => {
  const h = harness([botChat(), talk()], { lookupBotChat: async () => session('S2', 100) });
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.deepEqual(h.calls.filter((c) => !c.startsWith('remote:')), ['adopt:S2']);
});

test('deliveries that cannot load are reported, stored ones stay, the talk is still asked', async () => {
  const h = harness([botChat(), talk()], {
    lookupBotChat: async () => {
      throw boom();
    },
    fetchSession: async (id) => session(id, 7),
  });
  h.stored.set('chat', [row('kept', 1)]);
  const r = await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(r.feedError);
  assert.equal(r.talkError, undefined);
  assert.deepEqual(h.stored.get('chat')?.map((m) => m.id), ['kept']);
  assert.ok(h.calls.includes('remote:talk'));
});

test('a talk that does not exist on the server yet is no failure; another error is', async () => {
  const h = harness([botChat(), talk()]);
  assert.equal((await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' })).talkError, undefined);
  const h2 = harness([botChat(), talk()], {
    fetchSession: async () => {
      throw boom();
    },
  });
  assert.ok((await syncBotFeed(h2.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' })).talkError);
});

test("another device's talk shows up as activity, so the open chat fetches it", async () => {
  const h = harness([botChat(), talk()], { fetchSession: async (id) => session(id, 900, 4) });
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.equal(h.items.get('talk')?.remote?.lastActive, 900);
});

test('a former Bot Chat: transcript once if never loaded; gone on the server is not a failure', async () => {
  const old = base('old', { botChatRetired: true, hermesSessionId: 'S1', remote: { source: 'api_server' } });
  const h = harness([botChat(), talk(), old]);
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: ['old'], talkId: 'talk' });
  assert.ok(h.calls.includes('fetch:S1'));
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: ['old'], talkId: 'talk' });
  assert.equal(h.calls.filter((c) => c === 'fetch:S1').length, 1);

  const gone = harness([botChat(), talk(), old], {
    fetchTranscript: async () => {
      throw notFound();
    },
  });
  assert.deepEqual(await syncBotFeed(gone.d, { botChatId: 'chat', retiredIds: ['old'], talkId: 'talk' }), {});
  assert.ok(gone.items.get('old')?.remote?.loadedAt);
});

test('the same delivery text every day keeps every delivery', () => {
  const same = 'Preis: 289 €';
  const day = (n: number, at: number): ChatMessage[] => [{ ...row(`hu-${n}`, at), text: same }, { ...row(`ha-${n}`, at + 1, 'assistant'), text: 'wie gestern' }];
  const local = [row('local-u', 1), row('local-a', 2, 'assistant'), ...day(10, 100)];
  const remote = [row('hu-1', 1), row('ha-2', 2, 'assistant'), ...day(10, 100), ...day(12, 200)];
  assert.deepEqual(feedSnapshot(local, remote).map((m) => m.id), ['hu-1', 'ha-2', 'hu-10', 'ha-10', 'hu-12', 'ha-12']);
});

test("what the server's page doesn't reach stays; an empty answer keeps what's stored", () => {
  assert.deepEqual(feedSnapshot([row('old', 1), row('dup', 50)], [row('hu-9', 50), row('hu-10', 60)]).map((m) => m.id), ['old', 'hu-9', 'hu-10']);
  assert.deepEqual(feedSnapshot([row('kept', 1)], []).map((m) => m.id), ['kept']);
});

test('a talk that never reached the server stays, one it knew and lost moves on', async () => {
  const fresh = harness([botChat(), talk()]);
  await syncBotFeed(fresh.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(!fresh.calls.some((c) => c.startsWith('moveTalk')));
  // the first turn may be running right now, with messages but no session yet
  const running = harness([botChat(), { ...talk(), messageCount: 2, preview: 'x' }]);
  await syncBotFeed(running.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(!running.calls.some((c) => c.startsWith('moveTalk')));
  const lost = harness([botChat(), { ...talk(), remote: { source: 'api_server', lastActive: 50 } }]);
  await syncBotFeed(lost.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(lost.calls.includes('moveTalk:new'));
});

test('files waiting unsent in a composer: the talk stays until they are sent or gone', async () => {
  const lost = () => [botChat(), { ...talk(), remote: { source: 'api_server', lastActive: 50 } }];
  let waiting = true;
  const h = harness(lost(), { holdTalkMove: () => waiting });
  assert.deepEqual(await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' }), {});
  assert.ok(!h.calls.some((c) => c.startsWith('moveTalk')));
  waiting = false;
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(h.calls.includes('moveTalk:new'));
});

test("another device's newer generation is followed", async () => {
  const h = harness([botChat(), talk()], { findTalkSession: async () => session('hui-bot-default--ab', 50) });
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.ok(h.calls.includes('moveTalk:hui-bot-default--ab'));
});

test("Hermes' single-session answer has no last_active: a changed count still brings another device's turn", async () => {
  const row = { ...session('hui-bot-default', 0, 6), lastActive: undefined };
  const h = harness([botChat(), { ...talk(), remote: { source: 'api_server', lastActive: 50, remoteCount: 4 } }], { fetchSession: async () => row as never });
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.equal(h.items.get('talk')?.remote?.lastActive, 12345);
  assert.equal(h.items.get('talk')?.remote?.remoteCount, 6);
  // no change: no refetch
  h.items.set('talk', { ...h.items.get('talk')!, remote: { source: 'api_server', lastActive: 50, remoteCount: 6 } });
  await syncBotFeed(h.d, { botChatId: 'chat', retiredIds: [], talkId: 'talk' });
  assert.equal(h.items.get('talk')?.remote?.lastActive, 50);
});

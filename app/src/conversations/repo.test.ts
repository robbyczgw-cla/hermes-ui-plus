/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../hermes/types';
import { createController } from './controller.ts';
import { INDEX_KEY, createRepo, msgsKey, uriFieldsOf, type StorageLike } from './repo.ts';
import { createIndexStore } from './store.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  const s: StorageLike & { data: Map<string, string>; log: string[]; failNext?: boolean } = {
    data,
    log,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      if (s.failNext) {
        s.failNext = false;
        throw new Error('disk full');
      }
      log.push('set ' + k);
      data.set(k, v);
    },
    async removeItem(k) {
      log.push('rm ' + k);
      data.delete(k);
    },
    async getAllKeys() {
      return Array.from(data.keys());
    },
  };
  return s;
}

const m = (i: number, text = `t${i}`): ChatMessage => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text, tools: [], status: 'done', createdAt: i });
const profile = { id: 'p1', kind: 'hermes' as const };

async function boot(storage: StorageLike, onError?: (e: unknown, w: string) => void) {
  const repo = createRepo(storage, { debounceMs: 5, onError });
  const store = createIndexStore(await repo.loadIndex());
  store.subscribe(() => repo.saveIndex(store.get()));
  return { repo, store, ctl: createController(store, repo) };
}

test('create/save/reload round trip, messages written before index', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  assert.match(c.hermesSessionId!, /^hui-/);
  assert.equal(a.ctl.list().length, 0); // draft hidden
  a.ctl.save(c.id, [m(0, 'Hallo Hermes'), m(1, 'Hi!')]);
  await a.repo.flush();
  const iMsgs = st.log.indexOf('set ' + msgsKey(c.id));
  const iIndex = st.log.lastIndexOf('set ' + INDEX_KEY);
  assert.ok(iMsgs !== -1 && iIndex > iMsgs, st.log.join());

  const b = await boot(st);
  const list = b.ctl.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Hallo Hermes');
  assert.equal(list[0].preview, 'Hi!');
  assert.equal(list[0].hermesSessionId, c.hermesSessionId);
  assert.equal((await b.ctl.loadMessages(c.id)).length, 2);
});

test('create re-uses an existing draft of the same profile', async () => {
  const { ctl } = await boot(memory());
  const a = ctl.create(profile);
  assert.equal(ctl.create(profile).id, a.id);
  assert.notEqual(ctl.create({ id: 'p2', kind: 'demo' }).id, a.id);
});

test('identical save does not bump updatedAt', async () => {
  let t = 1000;
  const repo = createRepo(memory(), { debounceMs: 5 });
  const store = createIndexStore();
  const ctl = createController(store, repo, () => ++t);
  const c = ctl.create(profile);
  ctl.save(c.id, [m(0), m(1)]);
  const u = ctl.get(c.id)!.updatedAt;
  ctl.save(c.id, [m(0), m(1)]);
  assert.equal(ctl.get(c.id)!.updatedAt, u);
  ctl.save(c.id, [m(0), m(1), m(2)]);
  assert.ok(ctl.get(c.id)!.updatedAt > u);
});

test('remove deletes messages and drops orphan keys on next load', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, [m(0)]);
  await a.repo.flush();
  a.ctl.remove(c.id);
  await a.repo.flush();
  assert.equal(st.data.has(msgsKey(c.id)), false);
  st.data.set(msgsKey('ghost'), '{}');
  const b = await boot(st);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(st.data.has(msgsKey('ghost')), false);
  assert.equal(b.ctl.list().length, 0);
});

test('save after remove is ignored', async () => {
  const { ctl, repo } = await boot(memory());
  const c = ctl.create(profile);
  ctl.remove(c.id);
  ctl.save(c.id, [m(0)]);
  assert.equal(repo.hasPending() && (await repo.loadMessages(c.id)).length > 0, false);
});

test('corrupt index is backed up and store starts empty', async () => {
  const st = memory({ [INDEX_KEY]: '{not json' });
  const errors: string[] = [];
  const { ctl } = await boot(st, (_e, w) => errors.push(w));
  assert.equal(ctl.list().length, 0);
  assert.equal(st.data.get(INDEX_KEY + '.corrupt'), '{not json');
  assert.deepEqual(errors, ['index corrupt']);
});

test('corrupt messages file -> empty transcript, no throw', async () => {
  const st = memory({ [msgsKey('x')]: 'oops' });
  const repo = createRepo(st, { onError: () => {} });
  assert.deepEqual(await repo.loadMessages('x'), []);
});

test('failed transcript write stays pending and is retried; the index is written anyway', async () => {
  const st = memory();
  const a = await boot(st, () => {});
  const c = a.ctl.create(profile);
  st.failNext = true;
  a.ctl.save(c.id, [m(0, 'abc')]);
  await a.repo.flush();
  assert.equal(st.data.has(msgsKey(c.id)), false);
  assert.equal(a.repo.hasPending(), true);
  assert.ok(st.data.get(INDEX_KEY)!.includes('abc'), 'index (title/preview) not held hostage by the failed transcript');
  await a.repo.flush();
  assert.equal(st.data.has(msgsKey(c.id)), true);
  assert.equal(a.repo.hasPending(), false);
});

// storage with a byte quota (Android AsyncStorage 6 MB SQLite cap / web localStorage ~5 MB)
function quotaStorage(limit: number) {
  const data = new Map<string, string>();
  const used = () => [...data.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const s: StorageLike & { data: Map<string, string> } = {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      const prev = data.get(k);
      if (used() - (prev ? k.length + prev.length : 0) + k.length + v.length > limit) throw new Error('database or disk is full (SQLITE_FULL)');
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
  };
  return s;
}
const big = (id: string, text: string): ChatMessage => ({ id, role: 'assistant', text, tools: [], status: 'done', createdAt: 1 });

test('storage full: one failing transcript never blocks the index or deletions, so deleting chats frees space (review P0-1)', async () => {
  const s = quotaStorage(30_000);
  const errors: string[] = [];
  let ok = 0;
  const repo = createRepo(s, { debounceMs: 1, onError: (_e, w) => errors.push(w), onFlushOk: () => ok++ });
  repo.saveMessages('old', [big('a', 'x'.repeat(20_000))]);
  repo.saveIndex({ items: [{ id: 'old' } as never], activeId: 'old' });
  await repo.flush();
  assert.ok(s.data.has(msgsKey('old')));
  // the active chat grows past the quota; meanwhile the user creates a chat and deletes the old one
  repo.saveMessages('active', [big('b', 'y'.repeat(15_000))]);
  repo.saveIndex({ items: [{ id: 'active' } as never, { id: 'new' } as never], activeId: 'new' });
  repo.removeMessages('old');
  await repo.flush();
  assert.equal(s.data.has(msgsKey('old')), false, 'deleted chat removed from storage (space freed)');
  const idx = JSON.parse(s.data.get(INDEX_KEY)!);
  assert.deepEqual(idx.items.map((x: { id: string }) => x.id), ['active', 'new']);
  assert.equal(idx.activeId, 'new');
  assert.ok(errors.includes('saveMessages'));
  // the freed space lets the retried transcript through
  await repo.flush();
  assert.ok(s.data.has(msgsKey('active')));
  assert.equal(repo.hasPending(), false);
  assert.ok(ok >= 2);
});

test('throttled flushes back off a failing transcript instead of rewriting it every time', async () => {
  let t = 0;
  let writes = 0;
  const st = memory();
  const failing: StorageLike = { ...st, setItem: async (k, v) => (k.startsWith('hui.conv.msgs.') ? (writes++, Promise.reject(new Error('SQLITE_FULL'))) : st.setItem(k, v)) };
  const repo = createRepo(failing, { debounceMs: 1, retryMs: 1000, now: () => t, onError: () => {} });
  repo.saveMessages('a', [m(0)]);
  await repo.flush();
  assert.equal(writes, 1);
  repo.saveIndex({ items: [] });
  await new Promise((r) => setTimeout(r, 10)); // throttled flush: inside the backoff → skipped
  assert.equal(writes, 1);
  assert.equal(st.data.has(INDEX_KEY), true);
  t = 5000;
  repo.saveIndex({ items: [], activeId: undefined });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(writes, 2);
});

test('transcripts can live in a separate blob storage (index stays in AsyncStorage)', async () => {
  const idx = memory();
  const blobs = memory();
  const repo = createRepo(idx, { debounceMs: 1, blobs });
  const store = createIndexStore(await repo.loadIndex());
  store.subscribe(() => repo.saveIndex(store.get()));
  const ctl = createController(store, repo);
  const c = ctl.create(profile);
  ctl.save(c.id, [m(0, 'hallo')]);
  await repo.flush();
  assert.equal(idx.data.has(msgsKey(c.id)), false);
  assert.equal(blobs.data.has(msgsKey(c.id)), true);
  assert.equal(blobs.data.has(INDEX_KEY), false);
  blobs.data.set(msgsKey('ghost'), '{}');
  const repo2 = createRepo(idx, { blobs });
  await repo2.loadIndex();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(blobs.data.has(msgsKey('ghost')), false, 'orphan sweep runs on the blob storage');
  assert.equal((await repo2.loadMessages(c.id))[0].text, 'hallo');
});

test('attachmentUrisOf scans raw JSON without filling the cache; uriFieldsOf unescapes', async () => {
  const st = memory();
  const withAtt: ChatMessage = { ...m(0, 'bild'), attachments: [{ id: 'x', kind: 'image', name: 'a b.jpg', mimeType: 'image/jpeg', size: 1, uri: 'file:///doc/attachments/x%20y.jpg', status: 'ready' }] };
  st.data.set(msgsKey('c1'), JSON.stringify({ v: 1, messages: [withAtt] }));
  const repo = createRepo(st);
  assert.deepEqual(await repo.attachmentUrisOf('c1'), ['file:///doc/attachments/x%20y.jpg']);
  assert.equal(repo.searchTextOf('c1'), undefined, 'search text not filled');
  assert.deepEqual(await repo.attachmentUrisOf('none'), []);
  assert.deepEqual(uriFieldsOf(JSON.stringify({ uri: 'a"b\\c', x: { uri: 'file:///é' } })), ['a"b\\c', 'file:///é']);
});

test('create({fresh}) never re-uses the open draft and keeps it active; autoTitle stays replaceable', async () => {
  const { ctl, store } = await boot(memory());
  const draft = ctl.create(profile);
  const other = ctl.create(profile, { fresh: true });
  assert.notEqual(other.id, draft.id);
  assert.equal(store.get().activeId, draft.id);
  ctl.save(other.id, [m(0, 'erste frage')]);
  ctl.setAutoTitle(other.id, 'Bridge Titel');
  assert.equal(ctl.get(other.id)!.title, 'Bridge Titel');
  assert.equal(ctl.get(other.id)!.titleSource, 'meta');
  ctl.save(other.id, [m(0, 'erste frage'), m(1, 'antwort')]);
  assert.equal(ctl.get(other.id)!.title, 'Bridge Titel', 'the first-message auto title does not replace it');
  ctl.rename(other.id, 'Mein Titel');
  ctl.setAutoTitle(other.id, 'Anderer');
  assert.equal(ctl.get(other.id)!.title, 'Mein Titel', 'never overrides a user rename');
});

test('stored messages are stripped and capped', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  const many = Array.from({ length: 400 }, (_, i) => m(i));
  many[399] = { ...many[399], status: 'streaming', reasoning: 'thinking so far', statusNote: 'retry' };
  a.ctl.save(c.id, many);
  await a.repo.flush();
  const stored = JSON.parse(st.data.get(msgsKey(c.id))!);
  assert.equal(stored.v, 1);
  assert.equal(stored.messages.length, 300);
  assert.equal(stored.messages[299].status, 'stopped');
  // an interrupted answer keeps what was already streamed (visible after an offline reload)
  assert.equal(stored.messages[299].reasoning, 'thinking so far');
  assert.equal('statusNote' in stored.messages[299], false);
});

test('search finds message text across conversations (lazy load from storage)', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, [m(0, 'frage'), m(1, 'Die Lösung ist Pfannkuchen')]);
  await a.repo.flush();
  const b = await boot(st);
  const hits = await b.ctl.search('pfannkuchen');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].in, 'message');
  assert.deepEqual(await b.ctl.search(''), []);
});

test('active conversation survives restart; other drafts pruned by provider logic', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, [m(0)]);
  a.ctl.setActive(c.id);
  await a.repo.flush();
  const b = await boot(st);
  assert.equal(b.store.get().activeId, c.id);
});

/** let pending promise callbacks / timers run */
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('H1: a corrupt index never sweeps the transcripts (not now, not on later starts)', async () => {
  const st = memory({ [INDEX_KEY]: '{not json', [msgsKey('c-1')]: '{"v":1,"messages":[]}' });
  const a = await boot(st);
  await tick(20);
  assert.equal(st.data.has(msgsKey('c-1')), true, 'transcript kept on the corrupt start');
  assert.equal(a.repo.trustedIndex(), false);
  a.ctl.create(profile);
  await a.repo.flush();
  const b = await boot(st); // index is valid JSON again, but the backup says chats were lost
  await tick(20);
  assert.equal(st.data.has(msgsKey('c-1')), true, 'transcript kept on the next start');
  assert.equal(b.repo.trustedIndex(), false);
});

test('H1: an unreadable index is retried, and a persistent read failure never writes the empty fallback', async () => {
  const meta = { id: 'c-1', title: 'x', profile, createdAt: 1, updatedAt: 1, messageCount: 2 };
  const st = memory({ [INDEX_KEY]: JSON.stringify({ v: 1, items: [meta] }), [msgsKey('c-1')]: '{"v":1,"messages":[]}' });
  let fails = 1;
  const flaky: StorageLike = { ...st, getItem: async (k) => (k === INDEX_KEY && fails-- > 0 ? Promise.reject(new Error('EIO')) : st.getItem(k)) };
  const ok = await boot(flaky);
  assert.equal(ok.store.get().items.length, 1, 'transient failure retried');

  fails = 99;
  const broken = await boot(flaky);
  assert.equal(broken.store.get().items.length, 0);
  broken.ctl.create(profile);
  await broken.repo.flush();
  await tick(20);
  assert.deepEqual(JSON.parse(st.data.get(INDEX_KEY)!).items.map((c: { id: string }) => c.id), ['c-1'], 'real index not overwritten');
  assert.equal(st.data.has(msgsKey('c-1')), true, 'transcript not swept');
  assert.equal(broken.repo.trustedIndex(), false);
});

test('H9: the startup sweep never deletes a chat created and flushed while the key listing was in flight', async () => {
  const st = memory();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: StorageLike = {
    ...st,
    getAllKeys: async () => {
      await gate;
      return st.getAllKeys!();
    },
  };
  const a = await boot(slow);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, [m(0, 'hi'), m(1, 'ho')]);
  await a.repo.flush(); // transcript written, no longer pending
  release();
  await tick(20);
  assert.equal(st.data.has(msgsKey(c.id)), true);
});

test('M1: a transcript read that raced a newer save does not return or cache the stale stored copy', async () => {
  const st = memory({ [msgsKey('c-1')]: JSON.stringify({ v: 1, messages: [m(0, 'old')] }) });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: StorageLike = {
    ...st,
    getItem: async (k) => {
      const v = await st.getItem(k);
      if (k === msgsKey('c-1')) await gate;
      return v;
    },
  };
  const repo = createRepo(slow, { debounceMs: 5 });
  const reading = repo.loadMessages('c-1');
  repo.saveMessages('c-1', [m(0, 'old'), m(1, 'new answer')]);
  await repo.flush();
  release();
  const got = await reading;
  assert.equal(got.length, 2);
  assert.equal((await repo.loadMessages('c-1')).length, 2, 'cache not replaced by the stale read');
});

test('M9: a failed index-only write is retried automatically', async () => {
  const st = memory();
  const repo = createRepo(st, { debounceMs: 1, retryMs: 10 });
  st.failNext = true;
  repo.saveIndex({ items: [], activeId: 'x' });
  await tick(5);
  assert.equal(st.data.has(INDEX_KEY), false);
  await tick(40);
  assert.equal(JSON.parse(st.data.get(INDEX_KEY)!).activeId, 'x');
  assert.equal(repo.hasPending(), false);
});

test('M5: a branch never re-uses the open empty draft; it is a new, fully initialised, active conversation', async () => {
  const { ctl, store } = await boot(memory());
  const draft = ctl.create(profile); // user opened a new empty chat while the fork was running
  const b = ctl.createBranch(profile, { messages: [m(0, 'Frage'), m(1, 'Antwort')], sessionId: 'fork-1', seed: 2, model: 'x', title: 'Zweig' });
  assert.notEqual(b.id, draft.id);
  assert.equal(store.get().activeId, b.id);
  assert.equal(b.hermesSessionId, 'fork-1');
  assert.equal(b.branchSeed, 2);
  assert.equal(b.model, 'x');
  assert.equal(b.title, 'Zweig');
  assert.equal((await ctl.loadMessages(b.id)).length, 2);
  const d = ctl.get(draft.id)!;
  assert.notEqual(d.hermesSessionId, 'fork-1', 'the draft keeps its own session');
});

test('Astra F01: a MISSING index next to stored transcripts never sweeps them (now or on later starts)', async () => {
  const st = memory({ [msgsKey('c-old')]: '{"v":1,"messages":[]}' });
  const a = await boot(st);
  await tick(20);
  assert.equal(st.data.has(msgsKey('c-old')), true);
  a.ctl.save(a.ctl.create(profile).id, [m(0, 'neu'), m(1, 'x')]);
  await a.repo.flush();
  await boot(st);
  await tick(20);
  assert.equal(st.data.has(msgsKey('c-old')), true, 'kept on the next start too (quarantined)');
});

test('Astra F01: valid JSON with an invalid index shape (or dropped entries) never sweeps', async () => {
  for (const idx of ['{}', 'null', '{"v":1,"items":[{"bogus":true}]}']) {
    const st = memory({ [INDEX_KEY]: idx, [msgsKey('c-1')]: '{"v":1,"messages":[]}' });
    const a = await boot(st);
    await tick(20);
    assert.equal(st.data.has(msgsKey('c-1')), true, idx);
    assert.equal(a.repo.trustedIndex(), false, idx);
  }
});

test('Astra F01: a fresh install (no index, no transcripts) sweeps normally on the next start', async () => {
  const st = memory();
  const a = await boot(st);
  a.ctl.create(profile);
  await a.repo.flush();
  await tick(20);
  st.data.set(msgsKey('orphan'), '{"v":1,"messages":[]}');
  const b = await boot(st);
  await tick(20);
  assert.equal(b.repo.trustedIndex(), true);
  assert.equal(st.data.has(msgsKey('orphan')), false);
});

test('save over MESSAGE_CAP marks the conversation historyTruncated (persisted across reload)', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, Array.from({ length: 10 }, (_, i) => m(i)));
  assert.equal(a.ctl.get(c.id)?.historyTruncated, undefined);
  a.ctl.save(c.id, Array.from({ length: 305 }, (_, i) => m(i)));
  assert.equal(a.ctl.get(c.id)?.historyTruncated, true);
  await a.repo.flush();
  const b = await boot(st);
  assert.equal(b.ctl.get(c.id)?.historyTruncated, true);
  assert.equal((await b.ctl.loadMessages(c.id)).length, 300);
});

test('peekMessages: synchronous hit for pending / cached transcripts, undefined before the first read', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, [m(0, 'Hallo'), m(1, 'Hi')]);
  assert.equal(a.ctl.peekMessages(c.id)?.length, 2); // pending write
  await a.repo.flush();
  const b = await boot(st);
  assert.equal(b.ctl.peekMessages(c.id), undefined); // not read yet
  await b.ctl.prefetchMessages([c.id]);
  const hit = b.ctl.peekMessages(c.id);
  assert.equal(hit?.length, 2);
  assert.equal(hit?.[0].text, 'Hallo');
  // identical save after a peek is still a no-op (signature taken from the peeked list)
  const before = b.store.get().items.find((x) => x.id === c.id)!.updatedAt;
  b.ctl.save(c.id, hit!);
  assert.equal(b.store.get().items.find((x) => x.id === c.id)!.updatedAt, before);
});

test('a prefetch and the chat opening right after it share one storage read', async () => {
  const st = memory();
  const a = await boot(st);
  const c = a.ctl.create(profile);
  a.ctl.save(c.id, [m(0, 'Hallo'), m(1, 'Hi')]);
  await a.repo.flush();
  let reads = 0;
  const counting: StorageLike = { ...st, getItem: (k) => (k === msgsKey(c.id) && reads++, st.getItem(k)) };
  const b = await boot(counting);
  const pre = b.ctl.prefetchMessages([c.id]);
  const open = b.ctl.loadMessages(c.id);
  const [, list] = await Promise.all([pre, open]);
  assert.equal(reads, 1);
  assert.equal(list.length, 2);
});

test('prefetchMessages skips unknown / already cached ids, yields before each read and stops when cancelled', async () => {
  const st = memory();
  const a = await boot(st);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = a.ctl.create(profile, { fresh: true });
    a.ctl.save(c.id, [m(0, `chat ${i}`), m(1, 'x')]);
    ids.push(c.id);
  }
  await a.repo.flush();
  const b = await boot(st);
  let yields = 0;
  await b.ctl.prefetchMessages(['nope', ids[0]], { between: async () => void yields++ });
  assert.equal(yields, 1);
  assert.ok(b.ctl.peekMessages(ids[0]));
  let cancel = false;
  await b.ctl.prefetchMessages([ids[0], ids[1], ids[2]], {
    between: async () => {
      yields++;
      cancel = true; // cancelled while waiting for the idle slot of ids[1]
    },
    cancelled: () => cancel,
  });
  assert.equal(yields, 2); // ids[0] was cached: no yield, no read
  assert.equal(b.ctl.peekMessages(ids[1]), undefined);
  assert.equal(b.ctl.peekMessages(ids[2]), undefined);
});

test('a chat without a stored transcript (Hermes list entry) peeks as empty after one read, without an LRU slot', async () => {
  const st = memory();
  let reads = 0;
  const counting: StorageLike = { ...st, getItem: (k) => (k.startsWith(msgsKey('')) && reads++, st.getItem(k)) };
  const a = await boot(counting);
  const c = a.ctl.create(profile, { fresh: true });
  assert.equal(a.ctl.peekMessages(c.id), undefined); // never read
  await a.ctl.prefetchMessages([c.id]);
  assert.deepEqual(a.ctl.peekMessages(c.id), []); // known empty: the chat mounts on its first render
  await a.ctl.prefetchMessages([c.id]);
  assert.equal(reads, 1);
  // a save makes it a normal cached transcript
  a.ctl.save(c.id, [m(0, 'Hallo'), m(1, 'Hi')]);
  assert.equal(a.ctl.peekMessages(c.id)?.length, 2);
  await a.repo.flush();
  assert.equal(a.ctl.peekMessages(c.id)?.length, 2);
});

test('save with keepOrder leaves updatedAt (the list order) untouched', async () => {
  const a = await boot(memory());
  const c = a.ctl.create(profile, { fresh: true });
  a.ctl.save(c.id, [m(0, 'Hallo'), m(1, 'Hi')]);
  const before = a.ctl.get(c.id)!.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  a.ctl.save(c.id, [m(0, 'Hallo'), m(1, 'Hi'), m(2, 'Noch was')], { keepOrder: true });
  assert.equal(a.ctl.get(c.id)!.updatedAt, before);
  assert.equal(a.ctl.get(c.id)!.messageCount, 3);
  a.ctl.save(c.id, [m(0, 'Hallo'), m(1, 'Hi'), m(2, 'Noch was'), m(3, 'ok')]);
  assert.ok(a.ctl.get(c.id)!.updatedAt > before);
});

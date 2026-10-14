/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../hermes/types';
import { createController } from './controller.ts';
import { createThrottledSaver, type Timers } from './partialSave.ts';
import { findOrphanFiles, fileBaseName } from './prune.ts';
import { createRepo, msgsKey } from './repo.ts';
import { createIndexStore } from './store.ts';
import { memoryStorage } from './storage/kv.ts';

function fakeTimers() {
  const due: { fn: () => void; at: number }[] = [];
  let now = 0;
  const timers: Timers = {
    set: (fn, ms) => {
      const t = { fn, at: now + ms };
      due.push(t);
      return t;
    },
    clear: (h) => {
      const i = due.indexOf(h as (typeof due)[number]);
      if (i >= 0) due.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const t of due.filter((x) => x.at <= now)) {
      due.splice(due.indexOf(t), 1);
      t.fn();
    }
  };
  return { timers, advance };
}

const u: ChatMessage = { id: 'u', role: 'user', text: 'Schreib einen langen Text', tools: [], status: 'done', createdAt: 1 };
const a = (text: string, status: ChatMessage['status'] = 'streaming'): ChatMessage => ({ id: 'a', role: 'assistant', text, tools: [], status, createdAt: 2 });

test('streaming answer is persisted periodically (throttled) and on flush, restored as stopped (review P1-3)', async () => {
  const { timers, advance } = fakeTimers();
  const st = memoryStorage();
  const repo = createRepo(st, { debounceMs: 1 });
  const store = createIndexStore();
  const ctl = createController(store, repo);
  const c = ctl.create({ id: 'p', kind: 'demo' });
  const saves: number[] = [];
  const saver = createThrottledSaver((m) => (saves.push(m.length), ctl.save(c.id, m)), 2500, timers);

  saver.now([u, a('')]); // user bubble + placeholder: at once
  assert.equal(saves.length, 1);
  saver.update([u, a('Es war')]);
  saver.update([u, a('Es war einmal')]);
  advance(1000);
  assert.equal(saves.length, 1, 'throttled');
  advance(1600);
  assert.equal(saves.length, 2, 'newest state written after the interval');
  saver.update([u, a('Es war einmal ein König')]);
  saver.flush(); // app goes to the background
  assert.equal(saves.length, 3);
  saver.flush();
  assert.equal(saves.length, 3, 'nothing new → no write');
  await repo.flush();

  // app killed here: the next start shows the partial answer, marked as stopped
  const repo2 = createRepo(st);
  const restored = await repo2.loadMessages(c.id);
  assert.equal(restored[1].text, 'Es war einmal ein König');
  assert.equal(restored[1].status, 'stopped');
  assert.ok(st.data.has(msgsKey(c.id)));
});

test('saver: dispose cancels a pending partial save', () => {
  const { timers, advance } = fakeTimers();
  let n = 0;
  const s = createThrottledSaver(() => n++, 2500, timers);
  s.update([u, a('x')]);
  s.dispose();
  advance(5000);
  assert.equal(n, 0);
});

test('orphan prune: stops when every file is referenced, never deletes on read errors, keeps live drafts (perf P1-1)', async () => {
  const dir = 'file:///data/doc/attachments/';
  const reads: string[] = [];
  const stored: Record<string, string[]> = { c1: [], c2: [dir + 'a.jpg'], c3: [dir + 'b.pdf'], c4: [] };
  const urisOf = async (id: string) => (reads.push(id), stored[id]);
  // nothing in the dir: no transcript is read at all
  assert.deepEqual(await findOrphanFiles({ files: [], conversationIds: ['c1', 'c2'], urisOf, keep: () => [] }), []);
  assert.deepEqual(reads, []);
  // all files referenced by c2/c3 → c4 is never read
  assert.deepEqual(await findOrphanFiles({ files: [dir + 'a.jpg', 'file:/data/doc/attachments/b.pdf'], conversationIds: ['c1', 'c2', 'c3', 'c4'], urisOf, keep: () => [] }), []);
  assert.deepEqual(reads, ['c1', 'c2', 'c3']);
  // orphan + a live draft file
  assert.deepEqual(
    await findOrphanFiles({ files: [dir + 'a.jpg', dir + 'old.jpg', dir + 'draft.jpg'], conversationIds: ['c1', 'c2'], urisOf, keep: () => [dir + 'draft.jpg'] }),
    [dir + 'old.jpg']
  );
  // unreadable chat → keep everything
  const failing = async () => {
    throw new Error('io');
  };
  assert.deepEqual(await findOrphanFiles({ files: [dir + 'x.jpg'], conversationIds: ['c1'], urisOf: failing, keep: () => [] }), []);
  // cancelled midway → nothing deleted
  assert.deepEqual(await findOrphanFiles({ files: [dir + 'x.jpg'], conversationIds: ['c1', 'c2'], urisOf, keep: () => [], cancelled: () => true }), []);
  assert.equal(fileBaseName('file:///a/b/x%20y.jpg'), 'x y.jpg');
});

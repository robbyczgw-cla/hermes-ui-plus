// Files of a queued message across a restart (queuedFilesCore.ts): web keeps the bytes in a blob store, native
// only checks its persisted copies; missing bytes become a failed chip, never a lost message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueuedFiles, QUEUED_FILE_TTL_MS, type QueuedBlobRecord, type QueuedBlobStore } from './queuedFilesCore.ts';
import type { Attachment } from './types.ts';

const att = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id,
  kind: 'file',
  name: `${id}.pdf`,
  mimeType: 'application/pdf',
  size: 3,
  uri: `blob:test/${id}`,
  status: 'ready',
  ...over,
});

function memoryStore() {
  const map = new Map<string, QueuedBlobRecord>();
  const store: QueuedBlobStore = {
    get: async (id) => map.get(id),
    put: async (id, rec) => void map.set(id, rec),
    delete: async (id) => void map.delete(id),
    list: async () => Array.from(map, ([id, r]) => ({ id, at: r.at })),
  };
  return { map, store };
}

function web(now = { t: 1000 }) {
  const { map, store } = memoryStore();
  const live = new Map<string, Blob>([['blob:test/f', new Blob(['abc'])], ['blob:test/img', new Blob(['png'])]]);
  let n = 0;
  const files = createQueuedFiles({
    blobs: async () => store,
    readBlob: async (uri) => {
      const b = live.get(uri);
      if (!b) throw new Error('revoked');
      return b;
    },
    objectUrl: () => `blob:test/restored-${++n}`,
    now: () => now.t,
  });
  return { files, map, live, now };
}

test('web: stash → reload → restore gives fresh object URLs; drop forgets the bytes', async () => {
  const w = web();
  const atts = [att('f'), att('img', { kind: 'image', uri: 'blob:test/img' })];
  await w.files.stash(atts);
  assert.deepEqual([...w.map.keys()].sort(), ['f', 'img']);
  w.live.clear(); // the page reloaded: every blob: URL is dead
  const back = await w.files.restore(atts);
  assert.ok(back.every((a) => a.uri.startsWith('blob:test/restored-') && a.status === 'ready'));
  assert.equal(await (w.map.get('f')!.blob).text(), 'abc');
  await w.files.drop(['f', 'img']);
  assert.equal(w.map.size, 0);
});

test('web: bytes that are gone → a failed chip when they are needed, untouched when the bridge already has the file', async () => {
  const w = web();
  const uploaded = att('up', { uri: 'blob:test/up', remoteRef: { id: 'r', path: '/uploads/up.pdf', name: 'up.pdf', size: 3, mimeType: 'application/pdf' } });
  const back = await w.files.restore([att('lost'), uploaded, att('data', { uri: 'data:application/pdf;base64,YWJj' })]);
  assert.equal(back[0].status, 'error');
  assert.equal(back[0].error?.key, 'attachments.file.missingAfterRestart');
  assert.deepEqual(back[0].error?.vars, { name: 'lost.pdf' });
  assert.equal(back[1], uploaded, 'sent by its server path: no bytes needed');
  assert.equal(back[2].status, 'ready', 'data: URLs carry their bytes');
});

test('web: unclaimed entries expire after the TTL, the ones being stashed never', async () => {
  const w = web({ t: 0 });
  await w.files.stash([att('old', { uri: 'blob:test/f' })]);
  w.now.t = QUEUED_FILE_TTL_MS + 1;
  await w.files.stash([att('f')]);
  assert.deepEqual([...w.map.keys()], ['f']);
});

test('web: a drop right after a stash runs after its writes (no orphan entry)', async () => {
  const w = web();
  const s = w.files.stash([att('f')]);
  const d = w.files.drop(['f']);
  await Promise.all([s, d]);
  assert.equal(w.map.size, 0);
});

test('web without IndexedDB: nothing stored, restore reports the missing bytes, nothing throws', async () => {
  const files = createQueuedFiles({ blobs: async () => null, readBlob: async () => new Blob(['x']), objectUrl: () => 'blob:x', now: () => 0 });
  await files.stash([att('f')]);
  const [a] = await files.restore([att('f')]);
  assert.equal(a.status, 'error');
  await files.drop(['f']);
});

test('native: nothing is copied; restore only flags local copies that disappeared', async () => {
  const existing = new Set(['file:///docs/attachments/a.pdf', 'file:///docs/attachments/img.jpg']);
  let reads = 0;
  const files = createQueuedFiles({
    readBlob: async () => {
      reads++;
      return new Blob([]);
    },
    objectUrl: () => 'blob:never',
    exists: (uri) => existing.has(uri),
    now: () => 0,
  });
  const atts = [
    att('a', { uri: 'file:///docs/attachments/a.pdf' }),
    att('img', { kind: 'image', uri: 'file:///docs/attachments/img.jpg' }),
    att('gone', { uri: 'file:///docs/attachments/gone.pdf' }),
    att('sent', { uri: 'file:///docs/attachments/sent.pdf', remoteRef: { id: 'r', path: '/uploads/sent.pdf', name: 'sent.pdf', size: 3, mimeType: 'application/pdf' } }),
  ];
  await files.stash(atts);
  assert.equal(reads, 0);
  const back = await files.restore(atts);
  assert.deepEqual(back.map((a) => a.status), ['ready', 'ready', 'error', 'ready']);
  assert.equal(back[0], atts[0]);
});

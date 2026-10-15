/// <reference types="node" />
// Dropped / pasted files on the web and in the desktop app: object URLs only for accepted files, only while they are
// prepared, and none left behind (fake URL registry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentError } from './types.ts';
import type { Attachment, AttachmentMsg } from './types.ts';
import { importWebFileList, type WebFileImport } from './webFiles.ts';
import type { UrlRegistry } from './webBlobs.ts';

function fakeUrls() {
  let n = 0;
  const live = new Set<string>();
  const created: string[] = [];
  const urls: UrlRegistry = {
    create() {
      const u = `blob:fake/${++n}`;
      live.add(u);
      created.push(u);
      return u;
    },
    revoke(u) {
      live.delete(u);
    },
  };
  return { urls, live, created };
}

const file = (name: string, type = 'application/pdf', size = 10) => Object.assign(new Blob(['x'.repeat(size)], { type }), { name });
const stored = (name: string): Attachment => ({ id: name, kind: 'file', name, mimeType: 'application/pdf', size: 10, uri: `hui-att:${name}`, status: 'ready' });

function setup(over: Partial<WebFileImport<ReturnType<typeof file>>> = {}) {
  const u = fakeUrls();
  const discarded: Attachment[] = [];
  const ready: string[] = [];
  const o: WebFileImport<ReturnType<typeof file>> = {
    remaining: 10,
    urls: u.urls,
    nameOf: (f) => f.name,
    check: (p) => (p.mimeType === 'video/mp4' ? { key: 'attachments.picker.unsupportedType', vars: { name: p.name } } : null),
    prepare: async (p) => stored(p.name),
    discard: async (a) => void discarded.push(a),
    stillWanted: () => true,
    onPrepared: (a) => void ready.push(a.id),
    ...over,
  };
  return { ...u, discarded, ready, o };
}

test('only accepted files get an object URL, and each is revoked once its bytes are stored', async () => {
  const s = setup({ remaining: 2 });
  const r = await importWebFileList([file('a.pdf'), file('b.pdf'), file('c.pdf'), file('d.pdf'), file('e.pdf')], s.o);
  assert.equal(s.created.length, 2, 'files over the limit never get a URL');
  assert.equal(s.live.size, 0);
  assert.deepEqual(r.attachments.map((a) => a.id), ['a.pdf', 'b.pdf']);
  assert.deepEqual(s.ready, ['a.pdf', 'b.pdf']);
  assert.deepEqual(r.errors, [{ key: 'attachments.picker.onlyRemaining', vars: { remaining: 2 } }]);
});

test('rejected files: no URL for a refused type, a failed preparation revokes its URL', async () => {
  const s = setup({
    prepare: async (p) => {
      if (p.name === 'broken.pdf') throw new AttachmentError('import_failed', { key: 'attachments.file.openFailed', vars: { name: p.name } });
      return stored(p.name);
    },
  });
  const r = await importWebFileList([file('clip.mp4', 'video/mp4'), file('broken.pdf'), file('ok.pdf')], s.o);
  assert.equal(s.created.length, 2, 'no URL for the refused video');
  assert.equal(s.live.size, 0);
  assert.deepEqual(r.attachments.map((a) => a.id), ['ok.pdf']);
  assert.deepEqual(
    r.errors.map((e: AttachmentMsg) => e.key),
    ['attachments.picker.unsupportedType', 'attachments.file.openFailed'],
  );
});

test('without IndexedDB the attachment keeps its URL (revoked when it is deleted, not before)', async () => {
  const s = setup({ prepare: async (p) => ({ ...stored(p.name), uri: p.uri }) });
  const r = await importWebFileList([file('a.pdf')], s.o);
  assert.equal(s.live.size, 1);
  assert.equal(r.attachments[0].uri, s.created[0]);
});

test('the lock engaged meanwhile: the prepared file is discarded, the rest is not even read', async () => {
  let wanted = true;
  const s = setup({
    stillWanted: () => wanted,
    prepare: async (p) => {
      wanted = false; // the lock engages while the first file is prepared
      return stored(p.name);
    },
  });
  const r = await importWebFileList([file('a.pdf'), file('b.pdf')], s.o);
  assert.deepEqual(r.attachments, []);
  assert.deepEqual(s.ready, []);
  assert.deepEqual(s.discarded.map((a) => a.id), ['a.pdf']);
  assert.equal(s.created.length, 1);
  assert.equal(s.live.size, 0);
});

test('no free slot: nothing is read', async () => {
  const s = setup({ remaining: 0 });
  const r = await importWebFileList([file('a.pdf')], s.o);
  assert.equal(s.created.length, 0);
  assert.deepEqual(r.errors.map((e) => e.key), ['attachments.picker.onlyRemaining']);
});

/// <reference types="node" />
// Web / desktop app: attachment bytes live in IndexedDB under a stable `hui-att:` uri; object URLs are only made
// per session from them (a persisted `blob:` URL is dead after a reload).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebAttachmentStore, isStoredWebUri, memoryBlobBackend, type UrlRegistry } from './webBlobs.ts';

function fakeUrls() {
  let n = 0;
  const live = new Map<string, Blob>();
  const urls: UrlRegistry & { live: Map<string, Blob> } = {
    live,
    create(b) {
      const u = `blob:fake/${++n}`;
      live.set(u, b);
      return u;
    },
    revoke(u) {
      live.delete(u);
    },
  };
  return urls;
}

/** a page: its own URL registry; `fetch` only knows that page's live blob: URLs */
function page(backend: ReturnType<typeof memoryBlobBackend> | null) {
  const urls = fakeUrls();
  const store = createWebAttachmentStore({
    backend: Promise.resolve(backend),
    urls,
    fetchBlob: async (u) => {
      const b = urls.live.get(u);
      if (!b) throw new Error(`dead URL ${u}`);
      return b;
    },
  });
  return { urls, store };
}

test('a dropped file is stored durably and opens again after a reload', async () => {
  const backend = memoryBlobBackend();
  const first = page(backend);
  const src = first.urls.create(new Blob(['%PDF-1.7 hello'], { type: 'application/pdf' }));
  const saved = await first.store.save(src, 'att1.pdf');
  assert.equal(saved.uri, 'hui-att:att1.pdf');
  assert.equal(saved.size, 14);
  assert.ok(isStoredWebUri(saved.uri));
  assert.ok(!saved.uri.startsWith('blob:'));

  // reload: new page, new URL registry, same IndexedDB
  const second = page(backend);
  const url = await second.store.resolve(saved.uri);
  assert.ok(url && url.startsWith('blob:fake/'));
  assert.equal(second.store.peek(saved.uri), url, 'resolved once per session');
  assert.equal(await (await second.store.blob(saved.uri)).text(), '%PDF-1.7 hello');
  assert.deepEqual(await second.store.list(), ['hui-att:att1.pdf']);
});

test('other uris pass through; a missing record resolves to null', async () => {
  const { store } = page(memoryBlobBackend());
  assert.equal(store.peek('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(await store.resolve('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(store.peek('hui-att:gone.jpg'), undefined);
  assert.equal(await store.resolve('hui-att:gone.jpg'), null);
  await assert.rejects(store.blob('hui-att:gone.jpg'));
});

test('remove deletes the bytes and revokes the session URL', async () => {
  const backend = memoryBlobBackend();
  const { store, urls } = page(backend);
  const saved = await store.save(urls.create(new Blob(['x'])), 'a.txt');
  const url = await store.resolve(saved.uri);
  assert.ok(url && urls.live.has(url));
  await store.remove(saved.uri);
  assert.ok(!urls.live.has(url!));
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.resolve(saved.uri), null);
});

test('without IndexedDB the session URL is kept (works until the tab closes, as before)', async () => {
  const { store, urls } = page(null);
  const src = urls.create(new Blob(['abc']));
  const saved = await store.save(src, 'b.txt');
  assert.equal(saved.uri, src);
  assert.equal(saved.size, 3);
  assert.deepEqual(await store.list(), []);
});

test('a stored attachment can be the source of another one (image edit re-prepares it)', async () => {
  const backend = memoryBlobBackend();
  const { store, urls } = page(backend);
  const a = await store.save(urls.create(new Blob(['img'])), 'a.jpg');
  const b = await store.save(a.uri, 'b.jpg');
  assert.equal(b.uri, 'hui-att:b.jpg');
  assert.equal(await (await store.blob(b.uri)).text(), 'img');
});

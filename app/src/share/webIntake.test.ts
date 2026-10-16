/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_CACHE, SHARE_KEY_PREFIX, readWebShare, takeShareParam } from './webIntake.ts';

test('takeShareParam: the #huiShare fragment is taken out of the URL, path and query stay; junk ids become "failed"', () => {
  assert.deepEqual(takeShareParam('https://app.test/?x=1#huiShare=abc123-x'), { id: 'abc123-x', cleanUrl: '/?x=1' });
  assert.deepEqual(takeShareParam('https://app.test/#huiShare=missed'), { id: 'missed', cleanUrl: '/' });
  assert.deepEqual(takeShareParam('https://app.test/#huiShare=..%2F..%2Fetc'), { id: 'failed', cleanUrl: '/' });
  assert.equal(takeShareParam('https://app.test/?huiShare=abc123'), null);
  assert.equal(takeShareParam('https://app.test/#pair?u=1'), null);
  assert.equal(takeShareParam('not a url'), null);
});

/** Cache Storage double with what sw.js writes */
function fakeCaches(entries: Record<string, Response>) {
  const store = new Map(Object.entries(entries));
  const opened: string[] = [];
  return {
    store,
    opened,
    async open(name: string) {
      opened.push(name);
      return {
        async match(k: string) {
          const r = store.get(k);
          return r ? r.clone() : undefined;
        },
        async delete(k: string) {
          return store.delete(k);
        },
      };
    },
  };
}

test('readWebShare: consuming meta + files frees the cache before the page can close', async () => {
  const base = `${SHARE_KEY_PREFIX}abcd1/`;
  const c = fakeCaches({
    [`${base}meta`]: Response.json({ title: 'T', text: 'see', url: 'https://example.com/a', files: [{ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.mp4', type: 'video/mp4' }] }),
    [`${base}0`]: new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    [`${base}1`]: new Response(new Blob(['xx'], { type: 'video/mp4' })),
  });
  const r = await readWebShare('abcd1', c);
  assert.ok(r);
  assert.equal(c.opened[0], SHARE_CACHE);
  assert.equal(r.payload.text, 'see\nhttps://example.com/a');
  assert.equal(r.payload.title, 'T');
  assert.deepEqual(r.payload.files.map((f) => f.name), ['a.pdf']);
  assert.equal(await r.payload.files[0].webFile?.text(), '%PDF-1.4');
  assert.equal(r.payload.refused.length, 1);
  assert.equal(c.store.size, 0, 'no persistent copy remains if the tab closes without Send/Cancel');
  r.release();
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(c.store.size, 0);
});

test('readWebShare: a consumed entry is silent, corrupt metadata reports failure and is removed', async () => {
  assert.equal(await readWebShare('nope1', fakeCaches({})), null);
  const broken = fakeCaches({ [`${SHARE_KEY_PREFIX}bad12/meta`]: new Response('{not json') });
  await assert.rejects(readWebShare('bad12', broken), /share intake failed/);
  assert.equal(broken.store.size, 0);
});

test('readWebShare: a missing file never becomes a sendable text-only partial share', async () => {
  const base = `${SHARE_KEY_PREFIX}abcd2/`;
  const c = fakeCaches({
    [`${base}meta`]: Response.json({ text: 'summarize the attached files', files: [{ name: 'a.pdf' }, { name: 'b.pdf' }] }),
    [`${base}0`]: new Response('%PDF-1.4'),
  });
  await assert.rejects(readWebShare('abcd2', c), /share intake failed/);
  assert.equal(c.store.size, 0, 'remaining bytes and metadata are removed together');
});

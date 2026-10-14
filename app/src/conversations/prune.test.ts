/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreferencedFiles } from './prune.ts';

const IMG = 'file:///data/attachments/a1.jpg';
const DOC = 'file:///data/attachments/d2.pdf';

test('H7: deleting a branch keeps attachment files its parent (or another survivor) still references', async () => {
  const stored: Record<string, string[]> = { parent: [IMG], other: [] };
  const files = await unreferencedFiles({ uris: [IMG, DOC], survivorIds: ['parent', 'other'], urisOf: async (id) => stored[id] });
  assert.deepEqual(files, [DOC]);
});

test('H7: file:/ and file:/// spellings compare equal; live drafts keep their files; unreadable survivor → delete nothing', async () => {
  assert.deepEqual(await unreferencedFiles({ uris: [IMG], survivorIds: ['p'], urisOf: async () => ['file:/data/attachments/a1.jpg'] }), []);
  assert.deepEqual(await unreferencedFiles({ uris: [IMG], survivorIds: [], urisOf: async () => [], keep: () => [IMG] }), []);
  assert.deepEqual(
    await unreferencedFiles({ uris: [IMG], survivorIds: ['p'], urisOf: async () => Promise.reject(new Error('EIO')) }),
    []
  );
  assert.deepEqual(await unreferencedFiles({ uris: [IMG], survivorIds: ['p'], urisOf: async () => [] }), [IMG]);
});

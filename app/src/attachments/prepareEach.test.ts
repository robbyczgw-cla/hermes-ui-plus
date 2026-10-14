/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareEach } from './prepareEach.ts';
import { AttachmentError } from './types.ts';
import type { Attachment } from './types.ts';

const att = (id: string): Attachment => ({ id, kind: 'image', name: `${id}.jpg`, mimeType: 'image/jpeg', size: 1, uri: `file:///${id}.jpg`, status: 'ready' });
const tick = () => new Promise((r) => setTimeout(r, 1));

test('each prepared file is handed out before the next one is prepared, in pick order', async () => {
  const log: string[] = [];
  const r = await prepareEach(
    ['a', 'b', 'c'],
    async (x) => {
      log.push(`prepare ${x}`);
      await tick();
      return att(x);
    },
    { onPrepared: (a) => log.push(`ready ${a.id}`), fallbackError: () => ({ key: 'attachments.picker.imageFailed' }) }
  );
  assert.deepEqual(log, ['prepare a', 'ready a', 'prepare b', 'ready b', 'prepare c', 'ready c']);
  assert.deepEqual(r.attachments.map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(r.errors, []);
});

test('skips and failures become messages; the others still arrive', async () => {
  const ready: string[] = [];
  const r = await prepareEach(
    ['ok1', 'video', 'broken', 'gone', 'ok2'],
    async (x) => {
      if (x === 'video') return { skip: { key: 'attachments.picker.videoUnsupported' } };
      if (x === 'broken') throw new Error('decode');
      if (x === 'gone') throw new AttachmentError('file_gone', { key: 'attachments.file.openFailed', vars: { name: x } });
      return att(x);
    },
    { onPrepared: (a) => ready.push(a.id), fallbackError: () => ({ key: 'attachments.picker.imageFailed' }) }
  );
  assert.deepEqual(ready, ['ok1', 'ok2']);
  assert.deepEqual(r.errors.map((e) => e.key), ['attachments.picker.videoUnsupported', 'attachments.picker.imageFailed', 'attachments.file.openFailed']);
});

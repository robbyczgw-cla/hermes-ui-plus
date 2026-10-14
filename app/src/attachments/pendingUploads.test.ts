// Send while uploads still run (pendingUploads.ts): tasks hand over without restarting, the message waits for every
// upload, retry / remove / cancel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingUploads, startUploadTask, type UploadFn, type UploadTask } from './pendingUploads.ts';
import { AttachmentError, type Attachment, type AttachmentTarget, type RemoteRef } from './types.ts';
import type { DraftAttachment } from './draft.ts';

const target: AttachmentTarget = { kind: 'hermes', bridge: true };
const file = (id: string, extra: Partial<DraftAttachment> = {}): DraftAttachment => ({
  id,
  kind: 'file',
  name: `${id}.pdf`,
  mimeType: 'application/pdf',
  size: 1000,
  uri: `file:///test/${id}.pdf`,
  status: 'uploading',
  progress: 0,
  ...extra,
});
const image = (id: string): DraftAttachment => ({ id, kind: 'image', name: `${id}.jpg`, mimeType: 'image/jpeg', size: 500, uri: `file:///test/${id}.jpg`, status: 'ready' });
const ref = (a: Attachment): RemoteRef => ({ id: `r-${a.id}`, path: `/uploads/${a.id}`, name: a.name, size: a.size, mimeType: a.mimeType });

/** a controllable fake upload: progress(id, f), finish(id), fail(id) */
function fakeUploads() {
  const runs = new Map<string, { progress(f: number): void; resolve(r: RemoteRef): void; reject(e: unknown): void; att: Attachment; signal: AbortSignal }>();
  const starts: string[] = [];
  const upload: UploadFn = (att, o) =>
    new Promise<RemoteRef>((resolve, reject) => {
      starts.push(att.id);
      runs.set(att.id, { progress: o.onProgress, resolve, reject, att, signal: o.signal });
      o.signal.addEventListener('abort', () => reject(new AttachmentError('upload_aborted', { key: 'attachments.upload.aborted' }, att.id)));
    });
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    upload,
    starts,
    aborted: (id: string) => !!runs.get(id)?.signal.aborted,
    progress: (id: string, f: number) => runs.get(id)!.progress(f),
    finish: async (id: string) => {
      const r = runs.get(id)!;
      r.resolve(ref(r.att));
      await flush();
    },
    fail: async (id: string) => {
      runs.get(id)!.reject(new AttachmentError('upload_failed', { key: 'attachments.upload.failedNoConnection' }, id));
      await flush();
    },
  };
}

function setup(atts: DraftAttachment[]) {
  const f = fakeUploads();
  const tasks = new Map<string, UploadTask>();
  for (const a of atts) if (a.status === 'uploading') tasks.set(a.id, startUploadTask(a, f.upload));
  const pending = createPendingUploads(atts, tasks, { target, start: (a) => startUploadTask(a, f.upload) });
  const changes: Attachment[][] = [];
  const ready: Attachment[][] = [];
  return { f, tasks, pending, changes, ready, attach: () => pending.attach({ onChange: (a) => changes.push(a), onReady: (s) => ready.push(s) }) };
}

test('startUploadTask: progress in whole percent, result, subscribers can change (hand-over)', async () => {
  const f = fakeUploads();
  const task = startUploadTask(file('a'), f.upload);
  const seen: string[] = [];
  const off = task.subscribe(() => seen.push(`draft:${task.state()}:${task.progress()}`));
  f.progress('a', 0.101);
  f.progress('a', 0.104); // same percent: no event
  off(); // the draft lets go …
  task.subscribe(() => seen.push(`chat:${task.state()}:${task.progress()}`)); // … the chat follows on
  f.progress('a', 0.5);
  await f.finish('a');
  assert.deepEqual(seen, ['draft:running:0.101', 'chat:running:0.5', 'chat:done:1']);
  assert.equal(task.ref()?.path, '/uploads/a');
  assert.deepEqual(f.starts, ['a'], 'one upload, never restarted');
});

test('the message waits for every upload and then gets the sent attachments with their remote refs', async () => {
  const s = setup([file('a'), file('b'), image('img')]);
  assert.equal(s.pending.state(), 'uploading');
  s.attach();
  assert.equal(s.ready.length, 0);
  s.f.progress('a', 0.42);
  assert.equal(s.changes.at(-1)!.find((x) => x.id === 'a')!.progress, 0.42);
  await s.f.finish('a');
  assert.equal(s.ready.length, 0, 'b still uploading');
  await s.f.finish('b');
  assert.equal(s.ready.length, 1);
  const sent = s.ready[0];
  assert.deepEqual(sent.map((a) => [a.id, a.status, a.remoteRef?.path ?? null]), [
    ['a', 'ready', '/uploads/a'],
    ['b', 'ready', '/uploads/b'],
    ['img', 'ready', null],
  ]);
  assert.ok(sent.every((a) => a.progress === undefined && a.error === undefined), 'toSent: no draft-only fields');
  assert.deepEqual(s.f.starts, ['a', 'b']);
});

test('nothing is followed before attach (a refused send leaves the tasks to the draft); attach of a finished set is ready at once', async () => {
  const s = setup([file('a')]);
  await s.f.finish('a');
  assert.equal(s.changes.length, 0);
  assert.equal(s.pending.state(), 'uploading', 'snapshot taken before it finished');
  s.attach();
  assert.equal(s.ready.length, 1);
  assert.equal(s.ready[0][0].remoteRef?.path, '/uploads/a');
});

test('a failed upload: state failed, retry starts a new upload, the send goes once it is done', async () => {
  const s = setup([file('a'), file('b')]);
  s.attach();
  await s.f.fail('a');
  assert.equal(s.pending.state(), 'failed');
  const failed = s.pending.snapshot().find((x) => x.id === 'a')!;
  assert.equal(failed.status, 'error');
  assert.equal(failed.error?.key, 'attachments.upload.failedNoConnection');
  await s.f.finish('b');
  assert.equal(s.ready.length, 0, 'never sends with a failed attachment');
  s.pending.retry('a');
  assert.equal(s.pending.state(), 'uploading');
  assert.deepEqual(s.f.starts, ['a', 'b', 'a']);
  await s.f.finish('a');
  assert.equal(s.ready.length, 1);
  assert.deepEqual(s.ready[0].map((x) => x.id), ['a', 'b']);
});

test('remove: aborts that upload, the rest is sent without it', async () => {
  const s = setup([file('a'), file('b')]);
  s.attach();
  await s.f.fail('a');
  const gone = s.pending.remove('a');
  assert.equal(gone?.id, 'a');
  assert.equal(s.pending.state(), 'uploading');
  const r = s.pending.remove('b'); // removing a running one aborts it
  assert.equal(r?.id, 'b');
  assert.ok(s.f.aborted('b'));
  assert.equal(s.ready.length, 1, 'nothing left to wait for');
  assert.deepEqual(s.ready[0], []);
});

test('cancel: aborts every running upload, returns the attachments, never fires again', async () => {
  const s = setup([file('a'), file('b'), image('img')]);
  s.attach();
  const n = s.changes.length;
  const back = s.pending.cancel();
  assert.deepEqual(back.map((a) => a.id), ['a', 'b', 'img']);
  assert.ok(s.f.aborted('a') && s.f.aborted('b'));
  assert.equal(s.pending.state(), 'cancelled');
  await new Promise((r) => setImmediate(r));
  assert.equal(s.changes.length, n);
  assert.equal(s.ready.length, 0);
  assert.deepEqual(s.pending.cancel(), [], 'second cancel is a no-op');
});

test('"uploading" without a task to follow becomes a failed upload (retry offered), never an endless wait', () => {
  const pending = createPendingUploads([file('x')], new Map(), { target, start: () => assert.fail('no start') });
  assert.equal(pending.state(), 'failed');
  assert.equal(pending.snapshot()[0].status, 'error');
});

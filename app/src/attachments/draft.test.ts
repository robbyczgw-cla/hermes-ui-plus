/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheck, draftHasErrors, draftIsBusy, draftReducer, needsUpload, newAttachmentId, toSent } from './draft.ts';
import type { DraftAttachment } from './draft.ts';
import { MIME } from './mime.ts';
import { att } from './fixtures.test.ts';

const HB = { kind: 'hermes', bridge: true } as const;
const HN = { kind: 'hermes', bridge: false } as const;
const CL = { kind: 'claude' } as const;

test('ids are unique and prefixed', () => {
  const a = newAttachmentId();
  assert.match(a, /^att-[0-9a-f]{16}$/);
  assert.notEqual(a, newAttachmentId());
});

test('needsUpload only for files on a bridge profile', () => {
  const pdf = att({ name: 'a.pdf', mimeType: MIME.pdf });
  assert.equal(needsUpload(pdf, HB), true);
  assert.equal(needsUpload(pdf, HN), false);
  assert.equal(needsUpload(pdf, CL), false);
  assert.equal(needsUpload(att({ name: 'a.jpg', mimeType: MIME.jpeg }), HB), false);
  assert.equal(needsUpload({ ...pdf, remoteRef: { id: 'x', path: '/x', name: 'a.pdf', size: 1, mimeType: MIME.pdf } }, HB), false);
});

test('retarget sets and clears check errors but keeps upload errors', () => {
  const pdf: DraftAttachment = att({ id: 'p', name: 'a.pdf', mimeType: MIME.pdf });
  const failed: DraftAttachment = { ...att({ id: 'u', name: 'b.pdf', mimeType: MIME.pdf }), status: 'error', error: { key: 'attachments.upload.failedGeneric' }, errorSource: 'upload' };
  let s = draftReducer([pdf, failed], { type: 'retarget', target: HN });
  assert.equal(s[0].status, 'error');
  assert.equal(s[0].errorSource, 'check');
  assert.deepEqual(s[1].error, { key: 'attachments.upload.failedGeneric' });
  s = draftReducer(s, { type: 'retarget', target: HB });
  assert.equal(s[0].status, 'ready');
  assert.equal(s[0].error, undefined);
  assert.equal(s[1].status, 'error');
});

test('applyCheck leaves uploading items alone', () => {
  const up: DraftAttachment = { ...att({ name: 'a.pdf', mimeType: MIME.pdf }), status: 'uploading' };
  assert.equal(applyCheck(up, HN), up);
});

test('add / patch / remove / clear, busy + error flags', () => {
  let s = draftReducer([], { type: 'add', attachments: [att({ id: 'a', name: 'a.pdf', mimeType: MIME.pdf })] });
  s = draftReducer(s, { type: 'patch', id: 'a', patch: { status: 'uploading', progress: 0.5 } });
  assert.equal(draftIsBusy(s), true);
  s = draftReducer(s, { type: 'patch', id: 'a', patch: { status: 'error', error: { key: 'attachments.upload.failedGeneric' } } });
  assert.equal(draftHasErrors(s), true);
  assert.equal(draftReducer(s, { type: 'remove', id: 'a' }).length, 0);
  assert.equal(draftReducer(s, { type: 'clear' }).length, 0);
});

test('toSent strips draft-only fields', () => {
  const d: DraftAttachment = { ...att({ id: 'a', name: 'a.pdf', mimeType: MIME.pdf }), progress: 1, errorSource: 'check', error: { key: 'attachments.upload.failedGeneric' }, status: 'error' };
  const s = toSent(d);
  assert.equal(s.status, 'ready');
  assert.equal('progress' in s, false);
  assert.equal('errorSource' in s, false);
  assert.equal('error' in s, false);
});

// Transcript side of "Send while uploads are still running" (pendingSend.ts) + its storage / running-turn rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Attachment } from '../attachments/types';
import { prepareForStorage } from '../conversations/messages.ts';
import { dropPending, hasPendingSend, patchPendingAttachments, pendingIsEmpty, releasePending } from './pendingSend.ts';
import type { ChatMessage } from './types';

const att = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id,
  kind: 'file',
  name: `${id}.pdf`,
  mimeType: 'application/pdf',
  size: 10,
  uri: `file:///test/${id}.pdf`,
  status: 'uploading',
  progress: 0.2,
  ...over,
});
const done = (i: number): ChatMessage[] => [
  { id: `u${i}`, role: 'user', text: `q${i}`, tools: [], status: 'done', createdAt: i },
  { id: `a${i}`, role: 'assistant', text: `a${i}`, tools: [], status: 'done', createdAt: i },
];
const pendingMsg: ChatMessage = { id: 'u-p', role: 'user', text: 'see file', tools: [], status: 'done', createdAt: 9, attachments: [att('f')], sendPending: true };

test('progress patches the pending message in place; a transcript replaced meanwhile gets it back', () => {
  const list = [...done(1), pendingMsg];
  const r = patchPendingAttachments(list, pendingMsg, [att('f', { progress: 0.6 })]);
  assert.equal(r.list.length, 3);
  assert.equal(r.list[2].attachments?.[0].progress, 0.6);
  assert.equal(r.list[2].sendPending, true);
  assert.equal(r.list[0], list[0], 'other messages keep their identity');
  const replaced = done(1); // recovery / sync replaced the transcript
  const back = patchPendingAttachments(replaced, r.message, [att('f', { progress: 0.9 })]);
  assert.deepEqual(back.list.map((m) => m.id), ['u1', 'a1', 'u-p']);
});

test('release: a normal user message with the sent attachments + the assistant placeholder, at the end', () => {
  const sent = [att('f', { status: 'ready', progress: undefined, remoteRef: { id: 'r', path: '/uploads/f', name: 'f.pdf', size: 10, mimeType: 'application/pdf' } })];
  const list = [...done(1), pendingMsg];
  const out = releasePending(list, pendingMsg, sent, 100);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  const user = out[2];
  assert.equal(user.id, 'u-p');
  assert.equal(user.sendPending, undefined);
  assert.equal(user.attachments?.[0].remoteRef?.path, '/uploads/f');
  assert.equal(out[3].status, 'streaming');
  // every attachment removed, text kept: a plain text message
  assert.equal(releasePending(list, pendingMsg, [], 100)[2].attachments, undefined);
});

test('cancel drops the message; an empty send is detected', () => {
  assert.deepEqual(dropPending([...done(1), pendingMsg], 'u-p').map((m) => m.id), ['u1', 'a1']);
  const list = done(2);
  assert.equal(dropPending(list, 'nope'), list);
  assert.equal(pendingIsEmpty('  ', []), true);
  assert.equal(pendingIsEmpty('x', []), false);
  assert.equal(pendingIsEmpty('', [att('f')]), false);
});

test('a pending message counts as a running turn and is never stored (it was not sent)', () => {
  assert.equal(hasPendingSend([...done(1), pendingMsg]), true);
  assert.equal(hasPendingSend(done(1)), false);
  const stored = prepareForStorage([...done(1), pendingMsg]);
  assert.deepEqual(stored.map((m) => m.id), ['u1', 'a1']);
});

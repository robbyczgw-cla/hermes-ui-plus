// Transcript side of "Send while uploads are still running" (pendingSend.ts) + its storage / running-turn rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Attachment } from '../attachments/types';
import { attachmentUris, messagesSignature, prepareForStorage } from '../conversations/messages.ts';
import { reconcileTranscript } from '../conversations/remoteSync.ts';
import { createAssistantMessage, finalize } from './chatState.ts';
import { reusableSendKey } from './idempotency.ts';
import {
  ackSend,
  adoptQueued,
  checkQueued,
  dropPending,
  hasPendingSend,
  isQueued,
  patchPendingAttachments,
  pendingIsEmpty,
  QUEUED_INITIAL,
  queuedReduce,
  queuedNotice,
  queuedTurnStored,
  releasePending,
  unackedUser,
  type QueuedEvent,
  type QueuedState,
} from './pendingSend.ts';
import { isRecovering, resumeCutOff } from './recovery.ts';
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

test('a pending message counts as a running turn; it is stored as queued (not sent), not dropped', () => {
  assert.equal(hasPendingSend([...done(1), pendingMsg]), true);
  assert.equal(hasPendingSend(done(1)), false);
  const stored = prepareForStorage([...done(1), pendingMsg]);
  assert.deepEqual(stored.map((m) => m.id), ['u1', 'a1', 'u-p']);
  assert.equal(stored[2].sendPending, undefined);
  assert.equal(stored[2].sendQueued, true);
  assert.equal(hasPendingSend(stored), false, 'a restored queued message is no running turn');
});

// ---------------------------------------------------------------- queued after a restart

const ref = (id: string) => ({ id: `r-${id}`, path: `/uploads/${id}.pdf`, name: `${id}.pdf`, size: 10, mimeType: 'application/pdf' });
const T0 = 1_700_000_000_000;
const queuedLive: ChatMessage = {
  id: 'u-q',
  role: 'user',
  text: 'compare both files',
  tools: [],
  status: 'done',
  createdAt: T0,
  sendPending: true,
  attachments: [
    { ...att('done1', { status: 'ready', progress: 1, remoteRef: ref('done1') }) },
    { ...att('busy', { progress: 0.4 }), errorSource: 'upload' } as Attachment,
    att('img', { kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', uri: 'file:///test/img.jpg', status: 'ready', progress: undefined }),
  ],
};
const history = (): ChatMessage[] => [
  { id: 'u1', role: 'user', text: 'hello', tools: [], status: 'done', createdAt: T0 - 60_000 },
  { id: 'a1', role: 'assistant', text: 'hi', tools: [], status: 'done', createdAt: T0 - 59_000 },
];
/** what the app finds after a restart */
const restored = (live: ChatMessage[] = [...history(), queuedLive]): ChatMessage[] => JSON.parse(JSON.stringify(prepareForStorage(live)));

test('persistence round trip: text + attachment refs survive, upload state reduced to "done (remoteRef) or not"', () => {
  const back = restored();
  const q = back[2];
  assert.equal(q.id, 'u-q');
  assert.equal(q.text, 'compare both files');
  assert.equal(q.sendQueued, true);
  assert.equal(q.sendPending, undefined);
  assert.equal(isQueued(q), true);
  assert.deepEqual(q.attachments?.map((a) => a.id), ['done1', 'busy', 'img']);
  for (const a of q.attachments ?? []) {
    assert.equal(a.status, 'ready');
    assert.equal(a.progress, undefined);
    assert.equal(a.error, undefined);
    assert.equal((a as { errorSource?: string }).errorSource, undefined);
  }
  assert.deepEqual(q.attachments?.[0].remoteRef, ref('done1'), 'a finished upload is not repeated');
  assert.equal(q.attachments?.[1].remoteRef, undefined, 'the unfinished one is uploaded on "Erneut senden"');
  // the stored transcript references the local files: the start-up prune keeps them (no copy of the bytes)
  assert.deepEqual(attachmentUris(back).sort(), ['file:///test/busy.pdf', 'file:///test/done1.pdf', 'file:///test/img.jpg']);
  // stored again unchanged (a restored queued message is not re-written on every save)
  assert.deepEqual(prepareForStorage(back), back);
});

test('upload progress alone does not change the stored form (no write per percent); a finished upload does', () => {
  const list = [...history(), queuedLive];
  const progressed = [...history(), { ...queuedLive, attachments: queuedLive.attachments!.map((a) => (a.id === 'busy' ? { ...a, progress: 0.9 } : a)) }];
  assert.equal(messagesSignature(progressed), messagesSignature(list));
  const finished = [...history(), { ...queuedLive, attachments: queuedLive.attachments!.map((a) => (a.id === 'busy' ? { ...a, status: 'ready' as const, remoteRef: ref('busy') } : a)) }];
  assert.notEqual(messagesSignature(finished), messagesSignature(list));
});

test('restore UI state machine: one tap → one check → adopted / sending / back to queued with a notice', () => {
  const run = (...events: QueuedEvent[]) => events.reduce<QueuedState>((s, e) => queuedReduce(s, e), QUEUED_INITIAL);
  assert.deepEqual(run(), { phase: 'queued' });
  assert.deepEqual(run({ type: 'resend', busy: false }), { phase: 'checking' });
  assert.deepEqual(run({ type: 'resend', busy: true }), { phase: 'queued' }, 'another turn runs: nothing happens');
  // a second tap / a discard while checking is ignored (never two sends, no discard of a message being sent)
  assert.deepEqual(run({ type: 'resend', busy: false }, { type: 'resend', busy: false }), { phase: 'checking' });
  assert.deepEqual(run({ type: 'resend', busy: false }, { type: 'discard' }), { phase: 'checking' });
  assert.deepEqual(run({ type: 'resend', busy: false }, { type: 'checked', result: 'stored' }), { phase: 'adopted' });
  assert.deepEqual(run({ type: 'resend', busy: false }, { type: 'checked', result: 'notStored' }), { phase: 'sending' });
  const failed = run({ type: 'resend', busy: false }, { type: 'checked', result: 'unknown' });
  assert.deepEqual(failed, { phase: 'queued', notice: 'checkFailed' });
  assert.deepEqual(queuedReduce(failed, { type: 'resend', busy: false }), { phase: 'checking' }, 'can be tried again');
  assert.deepEqual(run({ type: 'discard' }), { phase: 'discarded' });
  // a stray check result without a running check changes nothing
  assert.deepEqual(run({ type: 'checked', result: 'notStored' }), { phase: 'queued' });
  // terminal states stay
  const sending = run({ type: 'resend', busy: false }, { type: 'checked', result: 'notStored' });
  assert.equal(queuedReduce(sending, { type: 'resend', busy: false }), sending);
  assert.equal(queuedReduce(sending, { type: 'discard' }), sending);
});

const remoteRow = (id: string, role: 'user' | 'assistant', text: string, createdAt: number): ChatMessage => ({ id: `h${role[0]}-${id}`, role, text, tools: [], status: 'done', createdAt });

test('dedupe check: the turn is in the stored session only when Hermes has one more matching row than sent here', () => {
  const list = restored();
  // Hermes has only the earlier turn: not sent → upload + send
  const before = [remoteRow('1', 'user', 'hello', T0 - 60_000), remoteRow('2', 'assistant', 'hi', T0 - 59_000)];
  assert.equal(checkQueued(list, 'u-q', before), 'notStored');
  // killed after the turn started: the stored session has it (with the attachment part appended by the encoder)
  const after = [...before, remoteRow('3', 'user', 'compare both files\n\n[Datei angehängt: done1.pdf (application/pdf, 10 B) – Pfad auf dem Server: /uploads/done1.pdf]', T0 + 4000)];
  assert.equal(checkQueued(list, 'u-q', after), 'stored');
  // the same text asked (and answered) here a minute earlier: that stored row is the earlier turn, not ours
  const earlier: ChatMessage[] = [
    ...history(),
    { id: 'u2', role: 'user', text: 'Compare both files', tools: [], status: 'done', createdAt: T0 - 30_000 },
    { id: 'a2', role: 'assistant', text: 'done', tools: [], status: 'done', createdAt: T0 - 29_000 },
    list[2],
  ];
  const remoteEarlier = [...before, remoteRow('4', 'user', 'Compare both files', T0 - 30_000), remoteRow('5', 'assistant', 'done', T0 - 29_000)];
  assert.equal(queuedTurnStored(earlier, 'u-q', remoteEarlier), false);
  assert.equal(queuedTurnStored(earlier, 'u-q', [...remoteEarlier, remoteRow('6', 'user', 'compare both files', T0 + 2000)]), true);
  // a row older than the tap on Send (beyond clock skew) is never ours
  assert.equal(queuedTurnStored(list, 'u-q', [remoteRow('7', 'user', 'compare both files', T0 - 3_600_000)]), false);
  // no session API: nothing to check against → send; fetch failed → never send blind
  assert.equal(checkQueued(list, 'u-q', null), 'notStored');
  assert.equal(checkQueued(list, 'u-q', 'error'), 'unknown');
});

test('adopt: Hermes has the turn → a normal sent message + a recovering answer placeholder (filled from the session)', () => {
  const list = restored();
  const out = adoptQueued(list, 'u-q', T0 + 10_000);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(out[2].id, 'u-q');
  assert.equal(out[2].sendQueued, undefined);
  assert.equal(out[2].attachments?.length, 3);
  assert.equal(isRecovering(out[3]), true);
  assert.equal(adoptQueued(history(), 'nope', 1).length, 2);
});

test('transcript sync: a queued message Hermes already has is shown once as sent (with its answer), never offered again', () => {
  const local = restored();
  const remote = [
    remoteRow('1', 'user', 'hello', T0 - 60_000),
    remoteRow('2', 'assistant', 'hi', T0 - 59_000),
    remoteRow('3', 'user', 'compare both files', T0 + 3000),
    remoteRow('4', 'assistant', 'They differ in section 2.', T0 + 9000),
  ];
  const out = reconcileTranscript(local, remote);
  assert.deepEqual(out.map((m) => m.text), ['hello', 'hi', 'compare both files', 'They differ in section 2.']);
  assert.equal(out[2].id, 'u-q', 'the local message (with its attachments) stays, no duplicate');
  assert.equal(out[2].sendQueued, undefined);
  assert.equal(out[2].attachments?.length, 3);
  // not in Hermes: stays queued, nothing appended
  const notSent = reconcileTranscript(local, remote.slice(0, 2));
  assert.equal(notSent, local);
  assert.equal(notSent[2].sendQueued, true);
  // an OLD stored row with the same text (beyond the window) does not adopt it
  const old = [remoteRow('8', 'user', 'compare both files', T0 - 3_600_000), remoteRow('9', 'assistant', 'old answer', T0 - 3_599_000), ...remote.slice(0, 2)];
  const kept = reconcileTranscript(local, old);
  assert.equal(kept.find((m) => m.id === 'u-q')?.sendQueued, true);
  // queued in the middle (the user went on chatting): the stored answer goes right after it
  const mid = [...local, { id: 'u9', role: 'user' as const, text: 'next', tools: [], status: 'done' as const, createdAt: T0 + 20_000 }];
  const midOut = reconcileTranscript(mid, remote);
  assert.deepEqual(midOut.map((m) => m.text), ['hello', 'hi', 'compare both files', 'They differ in section 2.', 'next']);
});

// ---------------------------------------------------------------- sent, not yet acknowledged (durable send)
// The user message is written to storage before the turn request starts, with its Idempotency-Key; until the
// bridge / Hermes accepted the turn it is stored as queued (no answer placeholder), so a kill in between never loses
// it and never shows it as sent.

const KEY = 'turn-test-key-0001';
/** send() without uploads: user message (unacknowledged, with the key) + the answer placeholder */
const sending = (): ChatMessage[] => [
  ...history(),
  unackedUser({ id: 'u-s', role: 'user', text: 'what is new?', tools: [], status: 'done', createdAt: T0 }, KEY),
  { ...createAssistantMessage(T0), sendKey: KEY },
];

test('unacknowledged send: stored as queued with its key, without the answer placeholder', () => {
  const back = restored(sending());
  assert.deepEqual(back.map((m) => m.id), ['u1', 'a1', 'u-s']);
  const q = back[2];
  assert.equal(q.sendQueued, true);
  assert.equal(q.sendKey, KEY, 'the key survives: "Erneut senden" re-uses it (the bridge re-attaches)');
  assert.equal((q as { sendUnacked?: boolean }).sendUnacked, undefined, 'runtime flag not stored');
  assert.equal(isQueued(q), true);
  assert.equal(queuedNotice(q), 'request');
  // not mistaken for a cut-off answer (no recovering placeholder, nothing polled)
  assert.equal(resumeCutOff(back), back);
  assert.equal(hasPendingSend(back), false);
  // stored again unchanged
  assert.deepEqual(prepareForStorage(back), back);
});

test('uploads done → turn starts: released with the key, stored as queued until the server accepts', () => {
  const sent = [att('f', { status: 'ready', progress: undefined, remoteRef: ref('f') })];
  const list = releasePending([...history(), pendingMsg], pendingMsg, sent, T0, KEY);
  assert.equal(list[2].sendKey, KEY);
  const back = restored(list);
  assert.deepEqual(back.map((m) => m.id), ['u1', 'a1', 'u-p']);
  assert.equal(back[2].sendQueued, true);
  assert.deepEqual(back[2].attachments?.[0].remoteRef, ref('f'), 'the upload is not repeated');
  assert.equal(queuedNotice(back[2]), 'request');
  // still waiting for uploads (no key yet): the upload notice
  assert.equal(queuedNotice(restored()[2]), 'upload');
  // without a key (no turn yet) release stays a normal message
  assert.equal(releasePending([...history(), pendingMsg], pendingMsg, sent, T0)[2].sendKey, undefined);
});

test('accepted: a normal sent message; a kill now restores the answer as recovering (existing path)', () => {
  const acked = ackSend(sending());
  assert.equal(acked[2].sendUnacked, undefined);
  assert.equal(acked[2].sendKey, undefined);
  assert.equal(acked[3].sendKey, KEY, 'the key stays on the answer (retry rules, idempotency.ts)');
  const back = restored(acked);
  assert.deepEqual(back.map((m) => m.id), ['u1', 'a1', 'u-s', back[3].id]);
  assert.equal(back[2].sendQueued, undefined);
  assert.equal(isRecovering(resumeCutOff(back)[3]), true, 'the stored session / inbox fills in the answer');
  // nothing flagged: same list object
  assert.equal(ackSend(acked), acked);
});

test('failed before the server took it: a sent message with an error answer; "Erneut" re-uses the key', () => {
  const list = sending();
  const failed = ackSend([...list.slice(0, -1), finalize(list[3], 'error', 'Netzwerkfehler', T0 + 500)]);
  const back = restored(failed);
  assert.equal(back[2].sendQueued, undefined);
  assert.equal(back[3].status, 'error');
  assert.equal(reusableSendKey(back[3]), KEY);
});

test('restored unacknowledged send: the same check / adopt / sync rules as any queued message', () => {
  const back = restored(sending());
  const before = [remoteRow('1', 'user', 'hello', T0 - 60_000), remoteRow('2', 'assistant', 'hi', T0 - 59_000)];
  // never reached Hermes: "Erneut senden" sends it (with the same key, see useHermesChat.resendQueued)
  assert.equal(checkQueued(back, 'u-s', before), 'notStored');
  // reached Hermes before the kill: shown as sent, answer recovered, never sent twice
  const withTurn = [...before, remoteRow('3', 'user', 'what is new?', T0 + 1000)];
  assert.equal(checkQueued(back, 'u-s', withTurn), 'stored');
  const adopted = adoptQueued(back, 'u-s', T0 + 5000);
  assert.equal(adopted[2].sendQueued, undefined);
  assert.equal(isRecovering(adopted[3]), true);
  // the transcript sync dedupes it once the stored turn has its answer
  const synced = reconcileTranscript(back, [...withTurn, remoteRow('4', 'assistant', 'Nothing new.', T0 + 4000)]);
  assert.deepEqual(synced.map((m) => m.text), ['hello', 'hi', 'what is new?', 'Nothing new.']);
  assert.equal(synced[2].id, 'u-s');
  assert.equal(synced[2].sendQueued, undefined);
});

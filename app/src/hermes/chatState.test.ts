/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP_MARKER, MAX_MESSAGE_REASONING, MAX_MESSAGE_TEXT, appendCapped, applyEvent, createAssistantMessage, createUserMessage, finalize, newId } from './chatState.ts';
import type { ChatMessage, HermesEvent } from './types';

function run(evs: HermesEvent[], t0 = 1000): ChatMessage {
  let m: ChatMessage = createAssistantMessage(t0);
  let t = t0;
  for (const e of evs) m = applyEvent(m, e, (t += 10));
  return m;
}

test('text and reasoning accumulate; status note clears when text resumes', () => {
  const m = run([
    { type: 'status', kind: 'lifecycle', text: 'wait' },
    { type: 'reasoning', text: 'a' },
    { type: 'reasoning', text: 'b' },
    { type: 'text', text: 'Hel' },
    { type: 'text', text: 'lo' },
  ]);
  assert.equal(m.text, 'Hello');
  assert.equal(m.reasoning, 'ab');
  assert.equal(m.statusNote, undefined);
  assert.equal(m.status, 'streaming');
});

test('tool lifecycle: running -> done, label kept, orphan completion still recorded', () => {
  const m = run([
    { type: 'tool', callId: 'c1', name: 'terminal', status: 'running', label: 'date', emoji: 'x' },
    { type: 'tool', callId: 'c1', name: 'terminal', status: 'done' },
    { type: 'tool', callId: 'c2', name: 'web', status: 'done' },
  ]);
  assert.equal(m.tools.length, 2);
  assert.deepEqual(
    { s: m.tools[0].status, l: m.tools[0].label, e: m.tools[0].emoji, ended: m.tools[0].endedAt !== undefined },
    { s: 'done', l: 'date', e: 'x', ended: true }
  );
  assert.equal(m.tools[1].label, 'web');
  assert.ok(m.tools[0].startedAt < (m.tools[0].endedAt as number));
});

test('does not mutate the previous message object', () => {
  const m0 = createAssistantMessage(1);
  const m1 = applyEvent(m0, { type: 'text', text: 'x' }, 2);
  assert.equal(m0.text, '');
  assert.equal(m1.text, 'x');
  const t0 = applyEvent(m0, { type: 'tool', callId: 'a', name: 'n', status: 'running' }, 2);
  const t1 = applyEvent(t0, { type: 'tool', callId: 'a', name: 'n', status: 'done' }, 3);
  assert.equal(t0.tools[0].status, 'running');
  assert.equal(t1.tools[0].status, 'done');
});

test('finish stop -> done and closes running tools; length -> truncated; error -> error', () => {
  const done = run([
    { type: 'start', completionId: 'chatcmpl-1' },
    { type: 'tool', callId: 'c1', name: 't', status: 'running' },
    { type: 'finish', reason: 'stop', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
  ]);
  assert.equal(done.status, 'done');
  assert.equal(done.completionId, 'chatcmpl-1');
  assert.equal(done.tools[0].status, 'done');
  assert.equal(done.usage?.totalTokens, 3);
  const len = run([{ type: 'text', text: 'x' }, { type: 'finish', reason: 'length' }]);
  assert.equal(len.status, 'done');
  assert.equal(len.truncated, true);
  const err = run([{ type: 'text', text: 'partial' }, { type: 'finish', reason: 'error', error: 'kaputt' }]);
  assert.equal(err.status, 'error');
  assert.equal(err.error, 'kaputt');
  assert.equal(err.text, 'partial');
});

test('approval is set and cleared on finish/finalize', () => {
  const ap = { runId: 'r', requestId: 'q', command: 'c', description: 'd', choices: ['once', 'deny'] as const, timestamp: 1 };
  const m = run([{ type: 'approval', approval: { ...ap, choices: ['once', 'deny'] } }]);
  assert.equal(m.approval?.requestId, 'q');
  assert.equal(finalize(m, 'stopped', undefined, 5).approval, undefined);
});

test('route is stored; finalize keeps text and sets error only for error status', () => {
  const route = { format: 'table', confidence: 1, reason: '', model: 'm', ms: 1 } as const;
  const m = run([{ type: 'route', route }, { type: 'text', text: 'abc' }]);
  assert.equal(m.route?.format, 'table');
  const s = finalize(m, 'stopped', 'ignored', 9);
  assert.equal(s.status, 'stopped');
  assert.equal(s.error, undefined);
  assert.equal(s.text, 'abc');
  assert.equal(finalize(m, 'error', 'bad', 9).error, 'bad');
});

test('ids and user message', () => {
  assert.match(newId('hui'), /^hui-[0-9a-f]{16}$/);
  assert.notEqual(newId('a'), newId('a'));
  const u = createUserMessage('hi', 5);
  assert.deepEqual({ r: u.role, t: u.text, s: u.status, c: u.createdAt }, { r: 'user', t: 'hi', s: 'done', c: 5 });
});

test('user message carries attachments only when there are some', () => {
  const att = { id: 'x', kind: 'image' as const, name: 'a.jpg', mimeType: 'image/jpeg', size: 3, uri: 'file:///a.jpg', status: 'ready' as const };
  assert.equal('attachments' in createUserMessage('hi', 1), false);
  assert.equal('attachments' in createUserMessage('hi', 1, []), false);
  assert.deepEqual(createUserMessage('', 1, [att]).attachments, [att]);
});

test('appendCapped: cut once at the cap with a marker, surrogate pairs stay whole, later deltas ignored', () => {
  assert.deepEqual(appendCapped('ab', 'cd', 10), { text: 'abcd', capped: false });
  assert.deepEqual(appendCapped('abcdefgh', 'ijkl', 10), { text: `abcdefghij${CAP_MARKER}`, capped: true });
  const capped = `abcdefghij${CAP_MARKER}`;
  assert.deepEqual(appendCapped(capped, 'more', 10), { text: capped, capped: true });
  // emoji (surrogate pair) right at the cut is not split
  const r = appendCapped('abcdefghi', '😀x', 10);
  assert.equal(r.text, `abcdefghi${CAP_MARKER}`);
  assert.ok(!r.text.includes('\ud83d'));
});

test('text over MAX_MESSAGE_TEXT is capped (textCapped + marker); reasoning over MAX_MESSAGE_REASONING too', () => {
  let m = createAssistantMessage(0);
  const chunk = 'x'.repeat(100_000);
  for (let i = 0; i < 15; i++) m = applyEvent(m, { type: 'text', text: chunk }, i);
  assert.equal(m.text.length, MAX_MESSAGE_TEXT + CAP_MARKER.length);
  assert.ok(m.text.endsWith(CAP_MARKER));
  assert.equal(m.textCapped, true);
  const before = m;
  m = applyEvent(m, { type: 'text', text: 'late' }, 99);
  assert.equal(m, before, 'nothing more is appended');

  let r = createAssistantMessage(0);
  for (let i = 0; i < 5; i++) r = applyEvent(r, { type: 'reasoning', text: 'y'.repeat(50_000) }, i);
  assert.equal(r.reasoning?.length, MAX_MESSAGE_REASONING + CAP_MARKER.length);
  assert.ok(r.reasoning?.endsWith(CAP_MARKER));
  assert.equal(r.textCapped, undefined, 'reasoning cap does not flag the answer text');
  const small = applyEvent(createAssistantMessage(0), { type: 'text', text: 'hi' }, 1);
  assert.equal(small.textCapped, undefined);
});

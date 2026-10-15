/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerInSession, newSendKey, reusableSendKey, sendKeyAfterFailure, UNRECORDED_TURN_CODE } from './idempotency.ts';
import type { ChatMessage } from './types';

const failed = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1', role: 'assistant', text: '', tools: [], status: 'error', error: 'Netzwerkfehler', createdAt: 1, sendKey: 'turn-abc', ...extra,
});

test('new keys are unique, visible ASCII and short enough for the bridge (≤ 255)', () => {
  const a = newSendKey();
  const b = newSendKey();
  assert.notEqual(a, b);
  assert.match(a, /^[\x21-\x7e]{1,255}$/);
});

test('a send that failed before any answer re-uses its key', () => {
  assert.equal(reusableSendKey(failed()), 'turn-abc');
});

test('fresh key when the earlier attempt produced or may have produced an answer', () => {
  const cases: Partial<ChatMessage>[] = [
    { completionId: 'chatcmpl-1' }, // Hermes accepted it
    { interrupted: 5 }, // lost after acceptance: recovery owns it
    { text: 'teil' },
    { reasoning: 'denkt' },
    { tools: [{ id: 't', name: 'terminal', status: 'done' } as never] },
    { status: 'stopped' }, // user stop: a new answer is wanted
    { status: 'done' },
    { sendKey: undefined },
  ];
  for (const c of cases) assert.equal(reusableSendKey(failed(c)), undefined, JSON.stringify(c));
  assert.equal(reusableSendKey(undefined), undefined);
  assert.equal(reusableSendKey({ ...failed(), role: 'user' }), undefined);
});

test('a one-turn override (other model, note, no web search) is a different request → fresh key', () => {
  assert.equal(reusableSendKey(failed(), { model: 'x' }), undefined);
  assert.equal(reusableSendKey(failed(), { note: 'kürzer' }), undefined);
  assert.equal(reusableSendKey(failed(), { webSearch: false }), undefined);
  assert.equal(reusableSendKey(failed(), {}), 'turn-abc');
});

test('a plain send the bridge refused for good (dead key) leaves a fresh key: "Erneut" is not stuck', () => {
  for (const code of ['resume_unavailable', 'idempotency_key_conflict', UNRECORDED_TURN_CODE]) {
    const key = sendKeyAfterFailure('turn-abc', code);
    assert.notEqual(key, 'turn-abc', code);
    assert.match(key, /^[\x21-\x7e]{1,255}$/);
    // the failed answer as useHermesChat stores it: the retry sends the fresh key
    assert.equal(reusableSendKey(failed({ sendKey: key })), key);
  }
});

test('other failures keep the key: the earlier attempt may still be running / recorded on the bridge', () => {
  for (const code of [undefined, 'idempotency_in_progress', 'rate_limit_exceeded', 'bridge_error']) {
    assert.equal(sendKeyAfterFailure('turn-abc', code), 'turn-abc', String(code));
  }
});

test('turn_unrecorded: the earlier attempt ran on the bridge → recover from the session, like an accepted turn', () => {
  assert.equal(answerInSession({ code: UNRECORDED_TURN_CODE }), true);
  assert.equal(answerInSession({ accepted: true }), true);
  for (const code of [undefined, 'resume_unavailable', 'idempotency_key_conflict', 'idempotency_in_progress']) {
    assert.equal(answerInSession({ code }), false, String(code));
  }
});

/// <reference types="node" />
// bugs review 2026-10-11 P3-4: Retry-After of 429/503 is honoured (one automatic retry, else shown)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { HermesError } from './stream.ts';
import { abortableDelay, autoRetryDelayMs, hasVisibleOutput, retryAfterErrorText } from './retryPolicy.ts';
import { createAssistantMessage } from './chatState.ts';

const draining = new HermesError('busy', 'gateway_draining', { status: 503, retryAfter: 1 });
const capped = new HermesError('rate_limit', 'too many concurrent runs', { status: 429, retryAfter: 3 });

test('503 draining / 429 with short Retry-After before output → retry once after that delay', () => {
  assert.equal(autoRetryDelayMs(draining, { attempt: 0, streamed: false }), 1000);
  assert.equal(autoRetryDelayMs(capped, { attempt: 0, streamed: false }), 3000);
});

test('no second automatic retry, none after output, none for long waits or other errors', () => {
  assert.equal(autoRetryDelayMs(draining, { attempt: 1, streamed: false }), null);
  assert.equal(autoRetryDelayMs(draining, { attempt: 0, streamed: true }), null);
  assert.equal(autoRetryDelayMs(new HermesError('rate_limit', 'x', { retryAfter: 30 }), { attempt: 0, streamed: false }), null);
  assert.equal(autoRetryDelayMs(new HermesError('rate_limit', 'x'), { attempt: 0, streamed: false }), null);
  assert.equal(autoRetryDelayMs(new HermesError('server', 'x', { retryAfter: 1 }), { attempt: 0, streamed: false }), null);
  assert.equal(autoRetryDelayMs(new Error('x'), { attempt: 0, streamed: false }), null);
});

test('the error bubble names the wait time (translated)', () => {
  const long = new HermesError('rate_limit', 'Too many requests.', { status: 429, retryAfter: 30 });
  const key = retryAfterErrorText(long);
  assert.deepEqual(key, { key: 'backends.hermes.errors.retryAfter', params: { message: 'Too many requests.', seconds: 30 } });
  assert.equal(makeT('en', 'en-US')(key!.key, key!.params), 'Too many requests. Please try again in 30 s.');
  assert.equal(retryAfterErrorText(new HermesError('rate_limit', 'x')), undefined);
  assert.equal(retryAfterErrorText(new HermesError('auth', 'x', { retryAfter: 5 })), undefined);
});

test('visible output blocks the automatic retry', () => {
  const empty = createAssistantMessage(0);
  assert.equal(hasVisibleOutput(empty), false);
  assert.equal(hasVisibleOutput({ ...empty, text: 'Hal' }), true);
  assert.equal(hasVisibleOutput({ ...empty, reasoning: '…' }), true);
});

test('the wait ends right away on stop()', async () => {
  const ctrl = new AbortController();
  const t0 = Date.now();
  const p = abortableDelay(10_000, ctrl.signal);
  ctrl.abort();
  await p;
  assert.ok(Date.now() - t0 < 1000);
});

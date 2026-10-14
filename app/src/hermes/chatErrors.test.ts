/// <reference types="node" />
// bugs review 2026-10-11 P3-3: chat errors keep their i18n key and are translated at render time
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { applyEvent, createAssistantMessage, createUserMessage, errorTextOf, finalize, keyedError, messageErrorText } from './chatState.ts';
import { keyedHermesError } from './stream.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');

test('keyed HermesError → message keeps the key → rendered in the UI language', () => {
  const err = keyedHermesError('timeout', 'backends.hermes.errors.noResponseTimeout');
  const m = finalize(createAssistantMessage(0), 'error', err.message, 1, errorTextOf(err));
  assert.match(m.error ?? '', /Zeitüberschreitung/); // German text stays for old builds / logs
  assert.equal(messageErrorText(m, en), en('backends.hermes.errors.noResponseTimeout'));
  assert.doesNotMatch(messageErrorText(m, en), /Zeitüberschreitung/);
  assert.match(messageErrorText(m, de), /Zeitüberschreitung/);
});

test('setup errors of the hooks are keyed (no hard-coded German in the UI)', () => {
  const e = keyedError('backends.errors.noApiKey');
  assert.match(e.message, /API-Schlüssel/);
  const m = finalize(createAssistantMessage(0), 'error', e.message, 1, errorTextOf(e));
  assert.match(messageErrorText(m, en), /API key/);
});


test('agent error finish without text uses a key; with server text the server text is shown as is', () => {
  const a = applyEvent(createAssistantMessage(0), { type: 'finish', reason: 'error' }, 1);
  assert.equal(messageErrorText(a, en), en('backends.hermes.errors.agentFailed'));
  const b = applyEvent(createAssistantMessage(0), { type: 'finish', reason: 'error', error: 'tool crashed' }, 1);
  assert.equal(b.errorText, undefined);
  assert.equal(messageErrorText(b, en), 'tool crashed');
});

test('a new error without a key drops an older key; non-error status clears it', () => {
  const keyed = finalize(createAssistantMessage(0), 'error', 'x', 1, { key: 'backends.errors.noModel' });
  assert.equal(finalize(keyed, 'error', 'server says no', 2).errorText, undefined);
  assert.equal(finalize(keyed, 'error', undefined, 2).errorText?.key, 'backends.errors.noModel');
  assert.equal('errorText' in finalize(keyed, 'stopped', undefined, 2), false);
});

test('plain errors without a key render their message', () => {
  assert.equal(errorTextOf(new Error('boom')), undefined);
  assert.equal(messageErrorText({ error: 'boom' }, en), 'boom');
});

test('user messages store the device time zone at send time (P3-10)', () => {
  assert.equal(createUserMessage('hi', 0, undefined, 'Europe/Vienna').timeZone, 'Europe/Vienna');
  assert.equal(typeof createUserMessage('hi', 0).timeZone, 'string');
});

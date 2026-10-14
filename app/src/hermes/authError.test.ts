import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_DENIED_KEY, authErrorText, isAuthErrorMessage, isAuthFailure } from './authError.ts';
import { makeT } from '../i18n/core.ts';

test('401/403 and typical server texts are credential failures', () => {
  assert.equal(isAuthFailure(401), true);
  assert.equal(isAuthFailure(403, 'whatever'), true);
  for (const s of ['Invalid bridge token', 'Invalid gateway API key (API_SERVER_KEY)', 'Unauthorized', 'missing api_key', 'Authentication failed', 'gateway_auth_error']) {
    assert.equal(isAuthFailure(undefined, s), true, s);
  }
  for (const s of ['Too many concurrent runs', 'draining', 'Missing or invalid \'messages\' field', 'invalid model name', '']) {
    assert.equal(isAuthFailure(500, s), false, s);
  }
  assert.equal(isAuthFailure(undefined, undefined), false);
});

test('authErrorText maps to the human message in every language', () => {
  assert.deepEqual(authErrorText(401, 'Invalid bridge token'), { key: AUTH_DENIED_KEY });
  assert.equal(authErrorText(429, 'slow down'), undefined);
  assert.equal(makeT('de', 'de-DE')(AUTH_DENIED_KEY), 'Zugang abgelehnt – Schlüssel prüfen');
  for (const l of ['en', 'es'] as const) {
    const s = makeT(l, l)(AUTH_DENIED_KEY);
    assert.ok(s && s !== AUTH_DENIED_KEY && s !== 'Zugang abgelehnt – Schlüssel prüfen', l);
  }
});

test('isAuthErrorMessage: keyed auth errors of all backends and raw auth texts offer "Verbindung bearbeiten"', () => {
  assert.equal(isAuthErrorMessage({ status: 'error', error: 'x', errorText: { key: AUTH_DENIED_KEY } }), true);
  assert.equal(isAuthErrorMessage({ status: 'error', error: 'Invalid bridge token' }), true);
  assert.equal(isAuthErrorMessage({ status: 'error', error: 'x', errorText: { key: 'backends.hermes.errors.timeout' } }), false);
  assert.equal(isAuthErrorMessage({ status: 'done', error: 'Invalid bridge token' }), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authFlag, saveDecision, testAuthFailed } from './saveGuard.ts';

test('a test rejected for its credentials requires "Trotzdem speichern"', () => {
  const bad = { rows: [{ ok: true }, { ok: false, auth: true }] };
  assert.equal(testAuthFailed(bad), true);
  assert.equal(saveDecision(bad, false), 'confirm');
  assert.equal(saveDecision(bad, true), 'save');
});

test('untested, passed or non-auth failures save directly', () => {
  assert.equal(saveDecision(null, false), 'save');
  assert.equal(saveDecision({ rows: [{ ok: true }, { ok: true }] }, false), 'save');
  assert.equal(saveDecision({ rows: [{ ok: false }, { ok: false, auth: false }] }, false), 'save'); // unreachable / timeout
  assert.equal(saveDecision({ rows: [{ ok: true, auth: true }] }, false), 'save');
});

test('authFlag: status, error kind and typical messages', () => {
  assert.equal(authFlag(401), true);
  assert.equal(authFlag(403), true);
  assert.equal(authFlag(500), false);
  assert.equal(authFlag(undefined, { status: 401 }), true);
  assert.equal(authFlag(undefined, { kind: 'auth', message: 'x' }), true);
  assert.equal(authFlag(undefined, new Error('Invalid bridge token')), true);
  assert.equal(authFlag(undefined, 'Invalid API key'), true);
  assert.equal(authFlag(undefined, new Error('Network request failed')), false);
  assert.equal(authFlag(undefined, undefined), false);
});

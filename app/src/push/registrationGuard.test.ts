/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeRegistration, nextRegistrationGen } from './registrationGuard.ts';

test('M8: a registration finishing after push was switched off is revoked on the server, never stored', async () => {
  let enabled = true;
  let stored = 0;
  let revoked = 0;
  const gen = nextRegistrationGen('p1'); // startup registration starts
  enabled = false; // user switches notifications off
  nextRegistrationGen('p1'); // disablePush
  const out = await completeRegistration({ profileId: 'p1', gen, enabled: () => enabled, store: () => stored++, revoke: async () => void revoked++ });
  assert.equal(out, 'revoked');
  assert.equal(stored, 0);
  assert.equal(revoked, 1);
});

test('M8: a superseded job does not store; the current one does', async () => {
  let stored = '';
  const old = nextRegistrationGen('p2');
  const cur = nextRegistrationGen('p2');
  assert.equal(await completeRegistration({ profileId: 'p2', gen: old, enabled: () => true, store: () => (stored = 'old'), revoke: async () => {} }), 'superseded');
  assert.equal(await completeRegistration({ profileId: 'p2', gen: cur, enabled: () => true, store: () => (stored = 'cur'), revoke: async () => {} }), 'stored');
  assert.equal(stored, 'cur');
});

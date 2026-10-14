import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTicket, takeTicket } from './turnTicket.ts';

test('ticket: current while nothing changed; stopped after stop(); superseded after a session change', () => {
  const t = takeTicket('hui-a', 3);
  assert.equal(checkTicket(t, 'hui-a', 3), 'current');
  assert.equal(checkTicket(t, 'hui-a', 4), 'stopped', 'stop() bumps the generation');
  assert.equal(checkTicket(t, 'hui-b', 3), 'superseded');
  assert.equal(checkTicket(t, 'hui-b', 4), 'superseded', 'a new session wins over a stop');
});

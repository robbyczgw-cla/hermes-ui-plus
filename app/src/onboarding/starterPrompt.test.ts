import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

installRnStubs();
const { queueStarterPrompt, subscribeStarterPrompt, takeStarterPrompt } = await import('./starterPrompt.ts');

test('a queued starter prompt is delivered exactly once, and only to the conversation it was queued for', () => {
  queueStarterPrompt('c-new', '  Zeig mir ein Diagramm.  ');
  assert.equal(takeStarterPrompt('c-other'), null, 'other chat does not get it');
  assert.equal(takeStarterPrompt(undefined), null);
  assert.equal(takeStarterPrompt('c-new'), 'Zeig mir ein Diagramm.');
  assert.equal(takeStarterPrompt('c-new'), null, 'not delivered twice (remount of the session)');
});

test('empty prompt or id is ignored; the newest queued prompt wins', () => {
  queueStarterPrompt('c1', '   ');
  queueStarterPrompt('', 'x');
  assert.equal(takeStarterPrompt('c1'), null);
  queueStarterPrompt('c1', 'first');
  queueStarterPrompt('c2', 'second');
  assert.equal(takeStarterPrompt('c1'), null);
  assert.equal(takeStarterPrompt('c2'), 'second');
});

test('a prompt nobody picked up expires after 60 s', () => {
  const now = mock.method(Date, 'now', () => 1_000_000);
  try {
    queueStarterPrompt('c3', 'late');
    now.mock.mockImplementation(() => 1_000_000 + 61_000);
    assert.equal(takeStarterPrompt('c3'), null);
  } finally {
    now.mock.restore();
  }
});

test('subscribers (a session mounted before the host queued the prompt) are notified', () => {
  let n = 0;
  const off = subscribeStarterPrompt(() => n++);
  queueStarterPrompt('c4', 'hi');
  assert.equal(n, 1);
  off();
  queueStarterPrompt('c4', 'hi again');
  assert.equal(n, 1);
  takeStarterPrompt('c4');
});

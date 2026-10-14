/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages } from './sessions.ts';
import { MESSAGES_FIXTURE } from './sessions.fixtures.ts';
import { loadToolDetails } from './toolDetails.ts';
import type { ChatMessage } from './types';

const rows = parseMessages(MESSAGES_FIXTURE, 'x').messages;
const CALL = 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0';
const turn: ChatMessage = {
  id: 'a-1',
  role: 'assistant',
  text: 'Ich hole die aktuelle Uhrzeit direkt vom System.Samstag…',
  tools: [{ id: CALL, name: 'terminal', label: 'date', status: 'done', startedAt: 10, endedAt: 20 }],
  status: 'done',
  createdAt: 5,
};
const noSleep = async () => {};

test('loadToolDetails: enriches the turn and commits once', async () => {
  const commits: ChatMessage[][] = [];
  const ok = await loadToolDetails({
    messageId: 'a-1',
    fetchRows: async () => rows,
    alive: () => true,
    get: () => [turn],
    commit: (n) => commits.push(n),
    signal: new AbortController().signal,
    sleep: noSleep,
  });
  assert.equal(ok, true);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0][0].tools[0].detail?.input, { command: 'date' });
});

test('H6: a detail response arriving after unmount / cancel never commits the retired hook\'s transcript', async () => {
  let alive = true;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const commits: ChatMessage[][] = [];
  const ctrl = new AbortController();
  const job = loadToolDetails({
    messageId: 'a-1',
    fetchRows: async () => {
      await gate;
      return rows;
    },
    alive: () => alive,
    get: () => [turn],
    commit: (n) => commits.push(n),
    signal: ctrl.signal,
    sleep: noSleep,
  });
  // chat closed while the request is in flight (same session id: the old session-only guard did not catch it)
  alive = false;
  ctrl.abort();
  release();
  assert.equal(await job, false);
  assert.equal(commits.length, 0);
});

test('H6: cancelled during the initial delay → no request at all', async () => {
  const ctrl = new AbortController();
  let fetched = 0;
  ctrl.abort();
  const ok = await loadToolDetails({
    messageId: 'a-1',
    fetchRows: async () => {
      fetched++;
      return rows;
    },
    alive: () => true,
    get: () => [turn],
    commit: () => assert.fail('must not commit'),
    signal: ctrl.signal,
  });
  assert.equal(ok, false);
  assert.equal(fetched, 0);
});

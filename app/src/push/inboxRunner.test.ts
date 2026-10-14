/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInbox } from './inboxRunner.ts';

const noSleep = async () => {};

test('M7: a transient config failure is retried; the runner connects once the config is back', async () => {
  const ctrl = new AbortController();
  let configCalls = 0;
  let connects = 0;
  const end = await runInbox({
    signal: ctrl.signal,
    loadConfig: async () => {
      if (++configCalls < 3) throw new Error('offline');
      return { inbox: true };
    },
    connect: async () => {
      connects++;
      ctrl.abort(); // stop after the first connection
    },
    isFatal: () => false,
    backoff: () => 0,
    sleep: noSleep,
  });
  assert.equal(configCalls, 3);
  assert.equal(connects, 1);
  assert.equal(end, 'aborted');
});

test('M7: unsupported config / fatal errors end the runner (the caller then drops it)', async () => {
  const base = { signal: new AbortController().signal, connect: async () => assert.fail('no connect'), backoff: () => 0, sleep: noSleep };
  assert.equal(await runInbox({ ...base, loadConfig: async () => null, isFatal: () => false }), 'unsupported');
  assert.equal(await runInbox({ ...base, loadConfig: async () => ({ inbox: false }), isFatal: () => false }), 'unsupported');
  assert.equal(await runInbox({ ...base, loadConfig: async () => Promise.reject(new Error('401')), isFatal: () => true }), 'fatal');
});

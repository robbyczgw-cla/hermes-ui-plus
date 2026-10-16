import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeShareDeliveries, deliverShare, hasShareDelivery, resetShareInbox } from './inbox.ts';

function clock() {
  const pending = new Map<number, () => void>();
  let seq = 0;
  return {
    set(fn: () => void) { pending.set(++seq, fn); return seq; },
    clear(id: unknown) { pending.delete(id as number); },
    async tick() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((fn) => fn());
      await new Promise<void>((r) => setImmediate(r));
    },
  };
}

const delivery = (text: string) => ({ text, files: [] });

test('a composer unmounted before its next tick leaves the share for its replacement', async () => {
  resetShareInbox();
  const timers = clock();
  const taken: string[] = [];
  deliverShare('test-chat', delivery('original'));
  const unmount = consumeShareDeliveries('test-chat', () => { assert.fail('unmounted composer received a share'); }, timers);
  unmount();
  await timers.tick();
  assert.equal(hasShareDelivery('test-chat'), true);
  const off = consumeShareDeliveries('test-chat', (d) => { taken.push(d.text); }, timers);
  await timers.tick();
  assert.deepEqual(taken, ['original']);
  assert.equal(hasShareDelivery('test-chat'), false);
  off();
});

test('confirmed shares wait in arrival order and imports never overlap', async () => {
  resetShareInbox();
  const timers = clock();
  const taken: string[] = [];
  let finish!: () => void;
  const firstImport = new Promise<void>((resolve) => { finish = resolve; });
  deliverShare('test-chat', delivery('first'));
  deliverShare('test-chat', delivery('second'));
  const off = consumeShareDeliveries('test-chat', async (d) => {
    taken.push(d.text);
    if (d.text === 'first') await firstImport;
  }, timers);
  await timers.tick();
  await timers.tick();
  assert.deepEqual(taken, ['first']);
  assert.equal(hasShareDelivery('test-chat'), true);
  finish();
  await new Promise<void>((r) => setImmediate(r));
  await timers.tick();
  assert.deepEqual(taken, ['first', 'second']);
  assert.equal(hasShareDelivery('test-chat'), false);
  off();
});

test('a cancelled handoff to one chat cannot deliver into another chat', async () => {
  resetShareInbox();
  const timers = clock();
  deliverShare('test-chat-a', delivery('for a'));
  const offA = consumeShareDeliveries('test-chat-a', () => assert.fail('old chat'), timers);
  offA();
  const offB = consumeShareDeliveries('test-chat-b', () => assert.fail('wrong chat'), timers);
  await timers.tick();
  assert.equal(hasShareDelivery('test-chat-a'), true);
  offB();
});

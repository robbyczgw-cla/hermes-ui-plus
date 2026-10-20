// F07 of the 0.1.4 real-user journeys: "make it 3 minutes" while a 2-minute tea timer ran produced a second, idle
// timer and the old one kept running. timerLink finds the timer a newer one follows up on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPredecessor, isGeneratedTimerId, predecessorOf, registerTimer, subscribeTimers, type LiveTimer } from './timerLink.ts';

type Entry = LiveTimer & { seq: number };

function timer(o: Partial<Entry> & { remaining?: number | null }): Entry {
  const remaining = o.remaining === undefined ? 60_000 : o.remaining;
  return {
    conversationId: 'c1',
    messageId: 'm1',
    createdAt: 1000,
    label: '',
    seq: 1,
    active: () => remaining,
    replace: () => {},
    ...o,
  };
}

const me = { conversationId: 'c1', messageId: 'm2', createdAt: 2000, label: '' };

test('the reported case: two unlabeled timers, the first running → the newer one offers to take over (no silent replace)', () => {
  const old = timer({});
  const r = findPredecessor(me, [old]);
  assert.ok(r);
  assert.equal(r.timer, old);
  assert.equal(r.sameId, false);
});

test('same explicit id → sameId (takes over on its own); generated fallback ids never count as the same id', () => {
  assert.equal(findPredecessor({ ...me, explicitId: 'tea', label: 'Tee' }, [timer({ explicitId: 'tea', label: 'Tea' })])?.sameId, true);
  assert.equal(isGeneratedTimerId('timer-seg-0'), true);
  assert.equal(isGeneratedTimerId('timer-seg-2.1.0'), true);
  assert.equal(isGeneratedTimerId('timer-seg-1-2'), true);
  assert.equal(isGeneratedTimerId('timer-n'), true);
  assert.equal(isGeneratedTimerId('tea'), false);
  assert.equal(isGeneratedTimerId('timer-pasta'), false);
});

test('independent timers stay independent: other label, idle/done, same message, newer, other chat', () => {
  assert.equal(findPredecessor({ ...me, label: 'Eier' }, [timer({ label: 'Tee' })]), null);
  assert.equal(findPredecessor(me, [timer({ remaining: null })]), null);
  assert.equal(findPredecessor(me, [timer({ messageId: 'm2' })]), null);
  assert.equal(findPredecessor(me, [timer({ createdAt: 3000 })]), null);
  assert.equal(findPredecessor(me, [timer({ conversationId: 'c2' })]), null);
  // labels compare loosely (case, spaces)
  assert.ok(findPredecessor({ ...me, label: ' tee ' }, [timer({ label: 'Tee' })]));
});

test('several candidates: same id wins, else the newest; without message times the registration order decides', () => {
  const a = timer({ createdAt: 500, label: '' });
  const b = timer({ createdAt: 900, label: '' });
  assert.equal(findPredecessor(me, [a, b])?.timer, b);
  const c = timer({ createdAt: 100, explicitId: 'x' });
  assert.equal(findPredecessor({ ...me, explicitId: 'x' }, [a, b, c])?.timer, c);
  const noTime = { conversationId: 'c1', messageId: 'm9', label: '', seq: 5 };
  assert.ok(findPredecessor(noTime, [timer({ createdAt: undefined, seq: 4 })]));
  assert.equal(findPredecessor(noTime, [timer({ createdAt: undefined, seq: 6 })]), null);
});

test('registry: registering notifies subscribers, unregistering removes the timer', () => {
  let calls = 0;
  const unsub = subscribeTimers(() => calls++);
  const r = registerTimer(timer({ conversationId: 'reg', messageId: 'a' }));
  assert.ok(calls >= 1);
  assert.ok(predecessorOf({ conversationId: 'reg', messageId: 'b', label: '', seq: r.seq + 1 }));
  r.unregister();
  assert.equal(predecessorOf({ conversationId: 'reg', messageId: 'b', label: '', seq: r.seq + 1 }), null);
  unsub();
});

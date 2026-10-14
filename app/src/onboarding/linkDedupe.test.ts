import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkDeduper, spentCodeKey, usedLinkKeys } from './linkDedupe.ts';

test('simultaneous deliveries of one link (initial URL + native intent) open the flow once', () => {
  let t = 1000;
  const d = createLinkDeduper(4000, () => t);
  assert.equal(d.accept('hermesuiplus://pair?u=a&t=b'), true);
  t += 30;
  assert.equal(d.accept('hermesuiplus://pair?u=a&t=b'), false);
});

test('the same link opened again later (retry after dismissing / offline) is delivered again', () => {
  let t = 0;
  const d = createLinkDeduper(4000, () => t);
  assert.equal(d.accept('L'), true);
  t = 60_000;
  assert.equal(d.accept('L'), true);
});

test('different links are independent; clear() forgets', () => {
  const d = createLinkDeduper(4000, () => 5);
  assert.equal(d.accept('A'), true);
  assert.equal(d.accept('B'), true);
  assert.equal(d.accept('A'), false);
  d.clear();
  assert.equal(d.accept('A'), true);
});

// E2E round 4, B3: after a configuration change (font scale) the activity is recreated, the router reads the VIEW intent
// again and reports the spent pair link as `initial` once more → its connection screen appeared on top of the chat.
test('the initial URL of the process is delivered once – also when it is reported again long after (activity recreated)', () => {
  let t = 0;
  const d = createLinkDeduper(4000, () => t);
  const L = 'hermesuiplus://pair?u=a&c=pc_test_0000';
  assert.equal(d.accept(L, { initial: true }), true);
  t = 20;
  assert.equal(d.accept(L, { initial: true }), false, 'getInitialURL + native intent at cold start');
  t = 600_000;
  assert.equal(d.accept(L, { initial: true }), false, 'the same intent after a recreation is not a new open');
  d.clear();
  assert.equal(d.accept(L, { initial: true }), false, 'clear() (web hashchange) only resets the time window');
  // opening the link deliberately while the app runs is still a retry
  assert.equal(d.accept(L), true);
  // another initial link (new process-level intent) is independent
  assert.equal(d.accept('hermesuiplus://pair?u=b&c=pc_test_1111', { initial: true }), true);
});

test('a used pair link is recognised by the link itself and by its one-time code (any spelling of the link)', () => {
  const code = 'pc_test_000000000000';
  assert.deepEqual(usedLinkKeys('L1', ''), ['L1']);
  assert.deepEqual(usedLinkKeys('L1', code), ['L1', spentCodeKey(code)]);
  // the code key does not depend on the link text: other parameter order / encoding / name still hits it
  assert.equal(usedLinkKeys('L2', code)[1], usedLinkKeys('L1', code)[1]);
  assert.notEqual(spentCodeKey(code), code, 'a code key never collides with a link key');
});

// Review: a redeemed device token was lost when the profile save failed and the user left the connect screen (the
// link was already marked used). The token is kept as a "pending recovery" until a save of it succeeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePairLink, type PairData } from './pairLink.ts';
import { parsePairRecovery, samePairTarget, serializePairRecovery } from './pairRecovery.ts';

const CODE = 'pc_test_000000000000';
const TOKEN = 'nca_user_test_token_0000000000';
const pairOf = (link: string): PairData => {
  const r = parsePairLink(link, { flavor: 'personal' });
  assert.ok(r.ok);
  return r.pair;
};
const LINK = `hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&c=${CODE}&n=Hermes&m=agent-test`;
const redeemed = (): PairData => ({ ...pairOf(LINK), code: '', token: TOKEN });

test('round trip: the redeemed pair comes back as a token link (never with the spent code)', () => {
  const raw = serializePairRecovery(redeemed());
  assert.ok(raw);
  assert.ok(!raw.includes(CODE), 'the one-time code is not kept');
  const r = parsePairRecovery(raw, { flavor: 'personal' });
  assert.ok(r);
  assert.equal(r.pair.token, TOKEN);
  assert.equal(r.pair.code, '');
  assert.equal(r.pair.baseUrl, 'https://b.example.org/v1');
  assert.equal(r.pair.name, 'Hermes');
  assert.equal(r.pair.model, 'agent-test');
  assert.equal(r.pair.kind, 'hermes');
  // the link opens the normal connect screen with the token (no redeem needed)
  const again = parsePairLink(r.link, { flavor: 'personal' });
  assert.ok(again.ok && again.pair.token === TOKEN && !again.pair.code);
});

test('nothing to keep without a token or while a code is still unredeemed', () => {
  assert.equal(serializePairRecovery(pairOf(LINK)), null);
  assert.equal(serializePairRecovery({ ...redeemed(), token: '' }), null);
});

test('broken / foreign stored values read as "nothing pending"', () => {
  for (const raw of [null, '', 'x', '{}', '[]', '{"v":2,"link":"hermesui://pair?u=https%3A%2F%2Fb.example.org&t=fake"}', '{"v":1,"link":"https://example.com"}', '{"v":1,"link":"hermesui://pair?u=https%3A%2F%2Fb.example.org"}', `{"v":1,"link":"hermesui://pair?u=https%3A%2F%2Fb.example.org&c=${CODE}"}`]) {
    assert.equal(parsePairRecovery(raw, { flavor: 'personal' }), null, String(raw));
  }
});

test('samePairTarget: same backend + base URL (+ model for model-bound kinds), trailing slash / case ignored', () => {
  const a = redeemed();
  assert.equal(samePairTarget(a, pairOf('hermesui://pair?u=https%3A%2F%2FB.example.org%2Fv1%2F&c=pc_test_111111111111')), true);
  assert.equal(samePairTarget(a, pairOf('hermesui://pair?u=https%3A%2F%2Fother.example.org%2Fv1&c=pc_test_111111111111')), false);
});

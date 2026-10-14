// Onboarding persistence on the real storage.ts: fresh storage, flag round trip, applied pair links (review part 5,
// test gap 4 – what can be exercised without mounting the screens).
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
const s = await import('./storage.ts');
beforeEach(() => rn.resetAll());

test('fresh storage: no flag; set → read back with the path; reset → gone', async () => {
  assert.equal(await s.loadOnboardedFlag(), null);
  await s.setOnboarded('bridge');
  assert.equal((await s.loadOnboardedFlag())?.path, 'bridge');
  await s.resetOnboarding();
  assert.equal(await s.loadOnboardedFlag(), null);
});

test('unreadable storage reads as "not onboarded"; a failed write rejects (the gate swallows it, the flow was shown)', async () => {
  rn.asyncStorage.failWhen = () => 'boom';
  assert.equal(await s.loadOnboardedFlag(), null);
  await assert.rejects(s.setOnboarded('direct'));
});

test('pair links already applied are remembered by digest only (no token stored) and not re-applied', async () => {
  const link = 'hermesuiplus://pair?u=https%3A%2F%2Fh.example&t=SECRET-TOKEN&n=Home';
  assert.equal(await s.wasPairLinkApplied(link), false);
  await s.markPairLinkApplied(link);
  assert.equal(await s.wasPairLinkApplied(link), true);
  assert.equal(await s.wasPairLinkApplied(link + '&x=1'), false);
  const stored = [...rn.asyncStorage.data.values()].join('\n');
  assert.ok(!stored.includes('SECRET-TOKEN'));
});

test('applied-link list is bounded and survives a failing write', async () => {
  for (let i = 0; i < 30; i++) await s.markPairLinkApplied(`l${i}`);
  const list = JSON.parse(rn.asyncStorage.data.get('hermes.pairLinksApplied.v1')!) as string[];
  assert.equal(list.length, 20);
  rn.asyncStorage.failWhen = (op) => (op === 'set' ? 'full' : null);
  await s.markPairLinkApplied('another'); // must not throw
});

test('pending recovery: the redeemed token lives in the secure store (not AsyncStorage) until a save of it clears it', async () => {
  const { parsePairLink } = await import('./pairLink.ts');
  const r = parsePairLink('hermesui://pair?u=https%3A%2F%2Fh.example%2Fv1&c=pc_test_000000000000&n=Home', { flavor: 'personal' });
  assert.ok(r.ok);
  const token = 'nca_user_test_token_0000000000';
  assert.equal(await s.loadPairRecovery(), null);
  await s.keepPairRecovery({ ...r.pair, code: '', token });
  assert.ok(![...rn.asyncStorage.data.values()].some((v) => v.includes(token)), 'native: never in AsyncStorage');
  assert.ok([...rn.secureStore.data.values()].some((v) => v.includes(token)), 'kept like the profile keys');
  const rec = await s.loadPairRecovery();
  assert.equal(rec?.pair.token, token);
  assert.equal(rec?.pair.baseUrl, 'https://h.example/v1');
  // saving another connection leaves it; saving this token clears it
  await s.clearPairRecovery('nca_user_test_token_1111111111');
  assert.equal((await s.loadPairRecovery())?.pair.token, token);
  await s.clearPairRecovery(token);
  assert.equal(await s.loadPairRecovery(), null);
  // an unreadable store reads as "nothing pending"; a failing write rejects (connectPairCode ignores it)
  rn.secureStore.failWhen = () => 'locked';
  assert.equal(await s.loadPairRecovery(), null);
  await assert.rejects(s.keepPairRecovery({ ...r.pair, code: '', token }));
});

test('a redeemed one-time code marks every link carrying it as used (on every platform), the code itself is not stored', async () => {
  const code = 'pc_test_000000000000';
  const link = `hermesuiplus://pair?u=https%3A%2F%2Fh.example&c=${code}&n=Home`;
  const respelled = `hermesuiplus://pair?c=${code}&u=https%3A%2F%2Fh.example`;
  assert.equal(await s.wasPairLinkUsed(link, code), false);
  await s.markPairCodeSpent(code);
  assert.equal(await s.wasPairLinkUsed(link, code), true);
  assert.equal(await s.wasPairLinkUsed(respelled, code), true);
  assert.equal(await s.wasPairLinkUsed(link.replace(code, 'pc_test_111111111111'), 'pc_test_111111111111'), false);
  // the connect screens ask by code alone (spent here + saved → continue instead of "expired", E2E round 5 N1)
  assert.equal(await s.wasPairCodeSpent(code), true);
  assert.equal(await s.wasPairCodeSpent('pc_test_111111111111'), false);
  assert.equal(await s.wasPairCodeSpent(''), false);
  assert.ok(![...rn.asyncStorage.data.values()].some((v) => v.includes(code)), 'only digests are kept');
  // a saved token link (no code) still counts by its own text
  await s.markPairLinkApplied('hermesuiplus://pair?u=x&t=fake');
  assert.equal(await s.wasPairLinkUsed('hermesuiplus://pair?u=x&t=fake', ''), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePairLink, type PairData } from './pairLink.ts';
import { connectPairCode, deepLinkRoute, pairPending, redeemOnConnect, resumeSpentPair } from './pairConnect.ts';
import type { ConnectionProfile } from '../settings/profiles.ts';
import { createConnectLock, pairLinkArrival } from './connectLock.ts';
import type { RedeemFetch } from './pairRedeem.ts';

const CODE = 'pc_test_000000000000';
const TOKEN = 'nca_user_test_token_0000000000';
const LINK = `hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&c=${CODE}&n=Hermes`;
const pairOf = (link: string): PairData => {
  const r = parsePairLink(link, { flavor: 'personal' });
  assert.ok(r.ok);
  return r.pair;
};

test('a valid link (also with a one-time code) opens the confirmation form – nothing is sent before a tap', () => {
  assert.equal(deepLinkRoute(parsePairLink(LINK, { flavor: 'personal' })), 'form');
  assert.equal(deepLinkRoute(parsePairLink('hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&t=' + TOKEN, { flavor: 'personal' })), 'form');
  // invalid links go to the scanner, which shows the error
  assert.equal(deepLinkRoute(parsePairLink('https://example.com/nope', { flavor: 'personal' })), 'scan');
  assert.equal(pairPending(pairOf(LINK)), true, 'the form shows host + name and waits for "Verbinden"');
  assert.equal(pairPending(pairOf('hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&t=' + TOKEN)), false);
  assert.equal(pairPending(null), false);
});

test('tap on Connect: the code is redeemed exactly once and the device token replaces it', async () => {
  let calls = 0;
  const fetchImpl: RedeemFetch = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ token: TOKEN }) };
  };
  const r = await redeemOnConnect(pairOf(LINK), { fetchImpl });
  assert.ok(r.ok);
  assert.equal(r.pair.token, TOKEN);
  assert.equal(r.pair.code, '');
  assert.equal(r.pair.name, 'Hermes');
  assert.equal(calls, 1);
  // a pair without a code never contacts the bridge
  const legacy = await redeemOnConnect(pairOf('hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&t=' + TOKEN), { fetchImpl });
  assert.ok(legacy.ok);
  assert.equal(calls, 1);
});

test('404 / 410 at Connect: the clear "expired or used" message that says how to get a new link', async () => {
  for (const status of [404, 410]) {
    const r = await redeemOnConnect(pairOf(LINK), { fetchImpl: async () => ({ ok: false, status, text: async () => '' }) });
    assert.ok(!r.ok);
    assert.equal(r.error, 'expired');
    assert.equal(r.messageKey, 'onboarding.redeem.expired');
    assert.equal(r.final, true, 'the link is worthless now: only a new one helps');
  }
  const net = await redeemOnConnect(pairOf(LINK), { fetchImpl: async () => Promise.reject(new Error('offline')) });
  assert.ok(!net.ok);
  assert.equal(net.messageKey, 'onboarding.redeem.network');
  assert.equal(net.final, false, 'a network error may be retried with the same link');
});

// ── E2E round 4 (B1/B2): Back right after "Verbinden" burned the code and lost the token ───────────────────────────
const okFetch: RedeemFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ token: TOKEN }) });

test('redeem → save runs to the end on its own: the token is saved even when the screen is gone meanwhile', async () => {
  const lock = createConnectLock();
  const events: string[] = [];
  let release!: () => void;
  const slowFetch: RedeemFetch = (...a) => new Promise((res) => (release = () => res(okFetch(...a))));
  const run = connectPairCode(pairOf(LINK), {
    redeemOptions: { fetchImpl: slowFetch },
    hold: lock.hold,
    spent: (code) => void events.push(`spent:${code}`),
    redeemed: (p) => void events.push(`redeemed:${p.token}`),
    save: async (p) => void events.push(`save:${p.token}:${p.code}`),
  });
  await Promise.resolve();
  assert.equal(lock.busy(), true, 'Back / header back / close are swallowed while the code is in flight');
  release(); // the user pressed Back here – nothing in the pipeline depends on the screen
  const out = await run;
  assert.equal(out.phase, 'saved');
  assert.deepEqual(events, [`spent:${CODE}`, `redeemed:${TOKEN}`, `save:${TOKEN}:`], 'the code is marked used before the save');
  assert.equal(lock.busy(), false);
});

test('the lock is held until the save finished – not only during the redeem', async () => {
  const lock = createConnectLock();
  let busyDuringSave = false;
  await connectPairCode(pairOf(LINK), {
    redeemOptions: { fetchImpl: okFetch },
    hold: lock.hold,
    save: async () => {
      busyDuringSave = lock.busy();
    },
  });
  assert.equal(busyDuringSave, true);
  assert.equal(lock.busy(), false);
});

test('a failed save keeps the redeemed token for the retry (which never redeems again)', async () => {
  let calls = 0;
  const fetchImpl: RedeemFetch = async (...a) => {
    calls++;
    return okFetch(...a);
  };
  const lock = createConnectLock();
  const first = await connectPairCode(pairOf(LINK), { redeemOptions: { fetchImpl }, hold: lock.hold, save: async () => Promise.reject(new Error('disk full')) });
  assert.equal(first.phase, 'save-failed');
  assert.ok(first.phase === 'save-failed' && first.pair.token === TOKEN && first.pair.code === '');
  assert.equal(lock.busy(), false);
  if (first.phase !== 'save-failed') return;
  const saved: string[] = [];
  const retry = await connectPairCode(first.pair, { redeemOptions: { fetchImpl }, save: async (p) => void saved.push(p.token) });
  assert.equal(retry.phase, 'saved');
  assert.deepEqual(saved, [TOKEN]);
  assert.equal(calls, 1, 'the code is redeemed exactly once');
});

test('a failed redeem saves nothing, marks nothing used and releases the lock', async () => {
  const lock = createConnectLock();
  let saved = false;
  let spent = false;
  const out = await connectPairCode(pairOf(LINK), {
    redeemOptions: { fetchImpl: async () => ({ ok: false, status: 410, text: async () => '' }) },
    hold: lock.hold,
    spent: () => void (spent = true),
    save: async () => void (saved = true),
  });
  assert.equal(out.phase, 'redeem-failed');
  assert.ok(out.phase === 'redeem-failed' && out.final);
  assert.equal(saved, false);
  assert.equal(spent, false);
  assert.equal(lock.busy(), false);
});

test('connect lock: nested holds, idempotent release, subscribers see every change', () => {
  const lock = createConnectLock();
  const seen: boolean[] = [];
  const unsub = lock.subscribe(() => seen.push(lock.busy()));
  const a = lock.hold();
  const b = lock.hold();
  a();
  a();
  assert.equal(lock.busy(), true, 'a second release of the same hold does not free the other one');
  b();
  assert.equal(lock.busy(), false);
  unsub();
  lock.hold();
  assert.deepEqual(seen, [true, true, true, false]);
});

// E2E round 5, N1: Back from the privacy step reached the connect screen again; "Verbinden" redeemed the spent code
// and showed "Kopplungslink abgelaufen oder schon benutzt" although the app was connected. A code this device already
// redeemed whose connection is saved continues with that connection instead.
const SAVED: ConnectionProfile = { id: 'p-test-1', kind: 'hermes', name: 'Hermes', baseUrl: 'https://b.example.org/v1', apiKey: TOKEN, sessionKey: 'hermes-ui' };

test('resumeSpentPair: a spent code with a matching saved connection resumes with its token', async () => {
  const spentCodes = new Set([CODE]);
  const spent = async (c: string) => spentCodes.has(c);
  const r = await resumeSpentPair(pairOf(LINK), { spent, profiles: [SAVED] });
  assert.ok(r);
  assert.equal(r.token, TOKEN);
  assert.equal(r.code, '');
  // trailing slash / case differences in the saved URL still match
  assert.ok(await resumeSpentPair(pairOf(LINK), { spent, profiles: [{ ...SAVED, baseUrl: 'https://B.example.org/v1/' }] }));
  // not spent on this device → the normal redeem
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent: async () => false, profiles: [SAVED] }), null);
  // spent but nothing saved for that bridge → the normal redeem (and its error)
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent, profiles: [] }), null);
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent, profiles: [{ ...SAVED, baseUrl: 'https://other.example.org/v1' }] }), null);
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent, profiles: [{ ...SAVED, apiKey: '' }] }), null);
  // a pair without a code never resumes; a failing lookup is "not spent"
  assert.equal(await resumeSpentPair(pairOf('hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&t=' + TOKEN), { spent, profiles: [SAVED] }), null);
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent: async () => Promise.reject(new Error('io')), profiles: [SAVED] }), null);
});

test('Connect on a code this device already redeemed and saved: continues without redeeming again', async () => {
  let calls = 0;
  const fetchImpl: RedeemFetch = async () => {
    calls++;
    return { ok: false, status: 410, text: async () => '' };
  };
  const lock = createConnectLock();
  const events: string[] = [];
  const out = await connectPairCode(pairOf(LINK), {
    redeemOptions: { fetchImpl },
    hold: lock.hold,
    resume: (p) => resumeSpentPair(p, { spent: async (c) => c === CODE, profiles: [SAVED] }),
    spent: (code) => void events.push(`spent:${code}`),
    redeemed: (p) => void events.push(`redeemed:${p.token}`),
    save: async (p) => void events.push(`save:${p.token}:${p.code}`),
  });
  assert.equal(out.phase, 'saved');
  assert.equal(calls, 0, 'the spent code is not sent again');
  assert.deepEqual(events, [`redeemed:${TOKEN}`, `save:${TOKEN}:`]);
  assert.equal(lock.busy(), false);
  // nothing saved for it → the redeem runs and its "expired" error stays
  const miss = await connectPairCode(pairOf(LINK), { redeemOptions: { fetchImpl }, resume: () => null, save: async () => {} });
  assert.equal(miss.phase, 'redeem-failed');
  assert.equal(calls, 1);
});

// Review: redeem went through, the profile save failed, the user left the screen → the token only lived in screen
// state while the link was already marked used. It is kept durably (pending recovery) before anything else happens.
test('the device token is kept for recovery right after the redeem – before the code is marked used and before the save', async () => {
  const events: string[] = [];
  const out = await connectPairCode(pairOf(LINK), {
    redeemOptions: { fetchImpl: okFetch },
    keep: async (p) => void events.push(`keep:${p.token}:${p.code}`),
    spent: (code) => void events.push(`spent:${code}`),
    save: async () => {
      events.push('save');
      throw new Error('disk full');
    },
  });
  assert.equal(out.phase, 'save-failed');
  assert.deepEqual(events, [`keep:${TOKEN}:`, `spent:${CODE}`, 'save']);
  // a failing keep never stops the save
  const saved = await connectPairCode(pairOf(LINK), { redeemOptions: { fetchImpl: okFetch }, keep: () => Promise.reject(new Error('locked')), save: async () => {} });
  assert.equal(saved.phase, 'saved');
  // nothing redeemed (failure / resumed saved connection) → nothing kept
  let kept = 0;
  await connectPairCode(pairOf(LINK), { redeemOptions: { fetchImpl: async () => ({ ok: false, status: 410, text: async () => '' }) }, keep: () => void kept++, save: async () => {} });
  await connectPairCode(pairOf(LINK), { resume: (p) => ({ ...p, code: '', token: TOKEN }), keep: () => void kept++, save: async () => {} });
  assert.equal(kept, 0);
});

test('the same link again after a lost save: continues with the kept token instead of "expired"', async () => {
  const kept: PairData = { ...pairOf(LINK), code: '', token: TOKEN };
  const spent = async (c: string) => c === CODE;
  const r = await resumeSpentPair(pairOf(LINK), { spent, profiles: [], pending: async () => kept });
  assert.equal(r?.token, TOKEN);
  assert.equal(r?.code, '');
  // another bridge / not spent here / nothing pending → the normal redeem
  const other = pairOf('hermesui://pair?u=https%3A%2F%2Fother.example.org%2Fv1&c=' + CODE);
  assert.equal(await resumeSpentPair(other, { spent, profiles: [], pending: async () => kept }), null);
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent: async () => false, profiles: [], pending: async () => kept }), null);
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent, profiles: [], pending: async () => null }), null);
  assert.equal(await resumeSpentPair(pairOf(LINK), { spent, profiles: [], pending: () => Promise.reject(new Error('io')) }), null);
});

// Review: deep links bypassed the connect lock – another spelling of the same link remounted the connect screen during
// a running redeem (a second redeem request), an invalid one switched to the scanner. While the lock is held, links
// wait (the latest is handled after the run); one carrying the code being redeemed is dropped.
test('connect lock knows the code being redeemed', async () => {
  const lock = createConnectLock();
  let release!: () => void;
  const slowFetch: RedeemFetch = (...a) => new Promise((res) => (release = () => res(okFetch(...a))));
  const run = connectPairCode(pairOf(LINK), { redeemOptions: { fetchImpl: slowFetch }, hold: lock.hold, save: async () => {} });
  await Promise.resolve();
  assert.deepEqual(lock.codes(), [CODE]);
  release();
  await run;
  assert.deepEqual(lock.codes(), []);
  const plain = lock.hold();
  assert.deepEqual(lock.codes(), [], 'a hold without a code (save retry) has none');
  plain();
});

test('pair links arriving during a connect wait; the same code is dropped; after a save they wait for the flow to finish', () => {
  const idle = { busy: false, running: [] as string[], flowSaved: false };
  assert.equal(pairLinkArrival({ ...idle, code: CODE }), 'show');
  assert.equal(pairLinkArrival({ ...idle, code: undefined }), 'show');
  const busy = { busy: true, running: [CODE], flowSaved: false };
  assert.equal(pairLinkArrival({ ...busy, code: CODE }), 'drop', 'another spelling of the link being redeemed');
  assert.equal(pairLinkArrival({ ...busy, code: 'pc_test_111111111111' }), 'defer');
  assert.equal(pairLinkArrival({ ...busy, code: undefined }), 'defer', 'token / invalid links wait as well');
  // saved: the flow is on its post-connect steps and would ignore the link (and mark the wrong one applied)
  assert.equal(pairLinkArrival({ ...idle, flowSaved: true, code: 'pc_test_111111111111' }), 'defer');
});

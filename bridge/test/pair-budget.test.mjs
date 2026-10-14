import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createPairing, REDEEM_GLOBAL, REDEEM_INFLIGHT } from '../src/pair.mjs';

function fixture() {
  const pair = createPairing({ host: 'localhost', port: 8790, token: 'test-admin-token' }, {
    env: {}, devices: { redeem: (code) => code === 'valid-test-code' ? { id: 'd_aaaaaaaaaa', token: 'test-device-token' } : null },
  });
  const request = (addr, code) => {
    const req = code === null ? new Readable({ read() {} }) : Readable.from([JSON.stringify({ code })]);
    req.method = 'POST'; req.url = '/bridge/pair/redeem'; req.headers = {};
    req.socket = { remoteAddress: addr };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {}, destroy() {} };
    return { req, res, done: pair.handle(req, res) };
  };
  return request;
}

test('global failed-attempt budget cannot block a valid redemption', async () => {
  const request = fixture();
  for (let i = 0; i < REDEEM_GLOBAL; i++) {
    const r = request(`192.0.2.${1 + Math.floor(i / 10)}`, 'unknown-test-code');
    await r.done; assert.equal(r.res.status, 410);
  }
  const bad = request('192.0.2.200', 'another-test-code');
  await bad.done; assert.equal(bad.res.status, 429);
  const good = request('192.0.2.200', 'valid-test-code');
  await good.done; assert.equal(good.res.status, 200);
});

test('independent global resource cap bounds stalled redeem bodies and releases slots', async () => {
  const request = fixture();
  const pending = Array.from({ length: REDEEM_INFLIGHT }, () => request('192.0.2.1', null));
  try {
    const over = request('192.0.2.1', 'valid-test-code');
    await over.done; assert.equal(over.res.status, 429);
  } finally {
    pending.forEach(({ req }) => req.destroy());
    await Promise.all(pending.map((r) => r.done));
  }
  const good = request('192.0.2.1', 'valid-test-code');
  await good.done; assert.equal(good.res.status, 200);
});

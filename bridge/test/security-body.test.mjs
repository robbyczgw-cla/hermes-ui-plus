import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createPairing, REDEEM_BODY_MAX } from '../src/pair.mjs';
import { createDeviceAdmin } from '../src/device-admin.mjs';

function request(path, chunks) {
  return Object.assign(Readable.from(chunks), {
    method: 'POST', url: path, headers: {}, socket: { remoteAddress: '192.0.2.1' },
  });
}
function response() {
  return { writeHead(status) { this.status = status; }, end(body) { this.body = body; }, destroy() {} };
}

test('pair redemption enforces its byte cap on chunked multibyte JSON before checking the code', async () => {
  let checked = 0;
  const pair = createPairing({ host: 'localhost', port: 1, token: 'test-body-admin-token' }, {
    env: {}, devices: { redeem() { checked++; return null; } },
  });
  const body = Buffer.from(JSON.stringify({ code: '文'.repeat(REDEEM_BODY_MAX / 2) }));
  assert.ok(body.length > REDEEM_BODY_MAX);
  const res = response();
  await pair.handle(request('/bridge/pair/redeem', [body.subarray(0, 700), body.subarray(700)]), res);
  assert.equal(res.status, 413);
  assert.equal(checked, 0);
});

test('device management enforces a byte cap on chunked multibyte labels', async () => {
  let issued = 0;
  const admin = createDeviceAdmin({ auth: { check: () => ({ kind: 'admin' }) }, devices: {}, issue() { issued++; return {}; } });
  const body = Buffer.from(JSON.stringify({ label: '文'.repeat(2048) }));
  const res = response();
  await admin.handle(request('/bridge/devices', [body.subarray(0, 3000), body.subarray(3000)]), res);
  assert.equal(res.status, 413);
  assert.equal(issued, 0);
});

test('small multibyte JSON is decoded only after reassembly across arbitrary UTF-8 boundaries', async () => {
  const label = 'test-文-🌍';
  let seen;
  const admin = createDeviceAdmin({ auth: { check: () => ({ kind: 'admin' }) }, devices: {}, issue(value) { seen = value; return {}; } });
  const body = Buffer.from(JSON.stringify({ label }));
  for (let split = 1; split < body.length; split++) {
    const res = response();
    await admin.handle(request('/bridge/devices', [body.subarray(0, split), body.subarray(split)]), res);
    assert.equal(res.status, 201);
    assert.equal(seen, label, `split=${split}`);
  }
});

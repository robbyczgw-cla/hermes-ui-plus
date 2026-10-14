/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeOrigin, healthUrl, isBridgeHeader, parseUploadResponse, uploadHeaders, uploadUrl } from './uploadCore.ts';
import { isAttachmentError } from './types.ts';

const A = { id: 'att-1', name: 'Übersicht März.pdf', mimeType: 'application/pdf', size: 2048 };

test('urls strip /v1 and trailing slashes', () => {
  assert.equal(bridgeOrigin('https://hermes-host.example.ts.net:8790/v1/'), 'https://hermes-host.example.ts.net:8790');
  assert.equal(uploadUrl('https://hermes-host.example.ts.net:8790/v1'), 'https://hermes-host.example.ts.net:8790/bridge/uploads');
  assert.equal(uploadUrl('http://127.0.0.1:8790'), 'http://127.0.0.1:8790/bridge/uploads');
  assert.equal(healthUrl('http://x/v1'), 'http://x/health');
});

test('headers: bearer, content type, percent-encoded ASCII filename', () => {
  const h = uploadHeaders(A, 'tok');
  assert.equal(h.Authorization, 'Bearer tok');
  assert.equal(h['Content-Type'], 'application/pdf');
  assert.equal(h['X-Filename'], '%C3%9Cbersicht%20M%C3%A4rz.pdf');
  assert.match(h['X-Filename'], /^[\x21-\x7e]+$/);
  assert.equal(decodeURIComponent(h['X-Filename']), A.name);
  assert.equal(uploadHeaders({ name: 'x', mimeType: '' }, 't')['Content-Type'], 'application/octet-stream');
});

test('201 → RemoteRef', () => {
  const body = JSON.stringify({ id: 'u1', path: '/var/lib/hermes-ui-bridge/uploads/2026-10-10/ab-x.pdf', name: 'x.pdf', size: 2048, mimeType: 'application/pdf' });
  assert.deepEqual(parseUploadResponse(201, body, A), { id: 'u1', path: '/var/lib/hermes-ui-bridge/uploads/2026-10-10/ab-x.pdf', name: 'x.pdf', size: 2048, mimeType: 'application/pdf' });
});

test('2xx with a bad body → error', () => {
  assert.throws(() => parseUploadResponse(201, 'nope', A), (e: unknown) => isAttachmentError(e) && e.msg.key === 'attachments.upload.badResponse');
  assert.throws(
    () => parseUploadResponse(201, JSON.stringify({ path: 'relative/x' }), A),
    (e: unknown) => isAttachmentError(e) && e.msg.key === 'attachments.upload.badResponse'
  );
});

test('error statuses map to message keys', () => {
  const cases: [number, string][] = [
    [401, 'attachments.upload.unauthorized'],
    [404, 'attachments.upload.notSupported'],
    [413, 'attachments.upload.tooLarge'],
    [415, 'attachments.upload.unsupportedType'],
    [500, 'attachments.upload.failedStatus'],
    [0, 'attachments.upload.failedNoConnection'],
  ];
  for (const [status, key] of cases) {
    assert.throws(() => parseUploadResponse(status, '', A), (e: unknown) => isAttachmentError(e) && e.msg.key === key && e.attachmentId === 'att-1');
  }
  assert.throws(() => parseUploadResponse(400, JSON.stringify({ error: { message: 'empty body', type: 'invalid_request_error' } }), A), /empty body/);
});

test('bridge detection header', () => {
  assert.equal(isBridgeHeader('1'), true);
  assert.equal(isBridgeHeader(null), false);
  assert.equal(isBridgeHeader('0'), false);
});

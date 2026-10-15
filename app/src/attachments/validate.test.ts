/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Length, checkAttachment, encodedSize, remainingSlots, validateForTarget } from './validate.ts';
import { isAttachmentError, LIMITS } from './types.ts';
import { MIME } from './mime.ts';
import { att } from './fixtures.test.ts';

const HB = { kind: 'hermes', bridge: true } as const;
const HN = { kind: 'hermes', bridge: false } as const;
const CL = { kind: 'claude' } as const;

function throwsKey(fn: () => unknown, key: string) {
  assert.throws(fn, (e: unknown) => isAttachmentError(e) && e.msg.key === key);
}

test('base64Length', () => {
  assert.equal(base64Length(0), 0);
  assert.equal(base64Length(1), 4);
  assert.equal(base64Length(3), 4);
  assert.equal(base64Length(4), 8);
});

test('hermes without bridge: only images + small text files', () => {
  assert.equal(checkAttachment(att({ name: 'a.jpg', mimeType: MIME.jpeg }), HN), null);
  assert.equal(checkAttachment(att({ name: 'a.csv', mimeType: MIME.csv, size: 150_000 }), HN), null);
  assert.equal(checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf }), HN)?.key, 'attachments.validate.needsBridge');
  assert.equal(checkAttachment(att({ name: 'a.docx', mimeType: MIME.docx }), HN)?.key, 'attachments.validate.needsBridge');
  assert.equal(checkAttachment(att({ name: 'big.txt', mimeType: 'text/plain', size: 300_000 }), HN)?.key, 'attachments.validate.tooLargeInline');
});

test('hermes with bridge: files up to 20 MB, any supported type', () => {
  assert.equal(checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 19_000_000 }), HB), null);
  assert.equal(checkAttachment(att({ name: 'a.xlsx', mimeType: MIME.xlsx }), HB), null);
  assert.equal(checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 21_000_000 }), HB)?.key, 'attachments.validate.tooLarge');
  assert.equal(checkAttachment(att({ name: 'a.zip', mimeType: 'application/zip' }), HB)?.key, 'attachments.validate.unsupportedType');
  // file references are tiny in the body
  assert.ok(encodedSize(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 19_000_000 }), HB) < 1000);
});

test('too large at the boundary: size and limit never read the same', () => {
  const just = checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 20_400_000 }), HB);
  assert.deepEqual(just?.vars, { name: 'a.pdf', size: '20,4 MB', max: '20,0 MB' });
  const byte = checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 20_000_001 }), HB);
  assert.notEqual(byte?.vars?.size, byte?.vars?.max);
  const far = checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 25_000_000 }), HB);
  assert.deepEqual(far?.vars, { name: 'a.pdf', size: '25 MB', max: '20 MB' });
});

test('claude: office rejected, pdf/text accepted, image formats', () => {
  assert.equal(checkAttachment(att({ name: 'a.pdf', mimeType: MIME.pdf, size: 5_000_000 }), CL), null);
  assert.equal(checkAttachment(att({ name: 'a.json', mimeType: MIME.json }), CL), null);
  assert.equal(checkAttachment(att({ name: 'a.heic', mimeType: 'image/heic' }), CL)?.key, 'attachments.validate.unsupportedImage');
});

test('images over the per-image limit are rejected everywhere', () => {
  const big = att({ name: 'a.jpg', mimeType: MIME.jpeg, size: LIMITS.maxImageBytes + 1 });
  assert.equal(checkAttachment(big, HB)?.key, 'attachments.validate.tooLarge');
  assert.equal(checkAttachment(big, CL)?.key, 'attachments.validate.tooLarge');
});

test('hermes per-message budget (10 MB body)', () => {
  const imgs = Array.from({ length: 3 }, (_, i) => att({ id: `i${i}`, name: `${i}.jpg`, mimeType: MIME.jpeg, size: 3_000_000 }));
  // 3 × 4 MB base64 = 12 MB > 9 MB
  throwsKey(() => validateForTarget(imgs, HB), 'attachments.validate.payloadTooLarge');
  assert.ok(validateForTarget(imgs.slice(0, 2), HB) < LIMITS.hermesPayloadBudget);
});

test('claude budget counts the conversation history', () => {
  const pdf = att({ name: 'a.pdf', mimeType: MIME.pdf, size: 15_000_000 });
  assert.ok(validateForTarget([pdf], CL) > 0);
  throwsKey(() => validateForTarget([pdf], CL, { history: [att({ id: 'old', name: 'b.pdf', mimeType: MIME.pdf, size: 10_000_000 })] }), 'attachments.validate.historyTooLarge');
});

test('too many attachments, error items block sending', () => {
  const many = Array.from({ length: LIMITS.maxAttachments + 1 }, (_, i) => att({ id: `x${i}`, name: `${i}.txt`, mimeType: 'text/plain' }));
  throwsKey(() => validateForTarget(many, HB), 'attachments.validate.tooMany');
  throwsKey(
    () => validateForTarget([att({ name: 'a.pdf', mimeType: MIME.pdf, status: 'error', error: { key: 'attachments.upload.failedGeneric' } })], HB),
    'attachments.upload.failedGeneric'
  );
  assert.equal(remainingSlots(8), 2);
  assert.equal(remainingSlots(12), 0);
});

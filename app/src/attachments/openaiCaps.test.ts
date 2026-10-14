/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capsAllowFile, DEFAULT_OPENAI_CAPS, mimeMatches, parseOpenAICaps } from './openaiCaps.ts';

test('defaults for unknown servers: images on, text only', () => {
  assert.deepEqual(parseOpenAICaps(null), DEFAULT_OPENAI_CAPS);
  assert.deepEqual(parseOpenAICaps({ session_continuity_header: 'X' }), DEFAULT_OPENAI_CAPS);
});

test('attachments field wins; legacy images_in understood', () => {
  assert.equal(parseOpenAICaps({ images_in: false }).images, false);
  const c = parseOpenAICaps({ images_in: false, attachments: { images: true, files: ['application/pdf', 7], maxBytes: 4000000 } });
  assert.deepEqual(c, { images: true, files: ['application/pdf'], maxBytes: 4000000 });
  assert.equal(parseOpenAICaps({ attachments: { maxBytes: -1 } }).maxBytes, DEFAULT_OPENAI_CAPS.maxBytes);
});

test('mime patterns', () => {
  assert.ok(mimeMatches('text/*', 'text/csv'));
  assert.ok(mimeMatches('application/pdf', 'APPLICATION/PDF'));
  assert.ok(mimeMatches('*/*', 'x/y'));
  assert.ok(!mimeMatches('text/*', 'application/pdf'));
  assert.ok(!capsAllowFile(DEFAULT_OPENAI_CAPS, 'application/pdf'));
  assert.ok(capsAllowFile({ ...DEFAULT_OPENAI_CAPS, files: ['application/pdf'] }, 'application/pdf'));
});

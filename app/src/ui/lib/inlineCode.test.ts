/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindAfterCode, longestNowrapCode, nowrapCode, INLINE_CODE_NOWRAP_CHARS } from './inlineCode.ts';

test('short commands stay on one line, long ones and multi-line spans may wrap', () => {
  assert.equal(nowrapCode('smartctl -a /dev/sdb'), true);
  assert.equal(nowrapCode('x'.repeat(INLINE_CODE_NOWRAP_CHARS)), true);
  assert.equal(nowrapCode('x'.repeat(INLINE_CODE_NOWRAP_CHARS + 1)), false);
  assert.equal(nowrapCode('a\nb'), false);
});

test('closing punctuation after code is glued with a word joiner, other text is untouched', () => {
  assert.equal(bindAfterCode('.'), '⁠.');
  assert.equal(bindAfterCode(', then reboot'), '⁠, then reboot');
  assert.equal(bindAfterCode(')'), '⁠)');
  assert.equal(bindAfterCode(' with the new UUID.'), ' with the new UUID.');
  assert.equal(bindAfterCode(''), '');
});

test('table cells: longest code span that must fit on one line', () => {
  assert.equal(longestNowrapCode('`find /srv -type f | wc -l`'), 25);
  assert.equal(longestNowrapCode('run `df -h` or `du -sh /srv`'), 11);
  assert.equal(longestNowrapCode('plain text'), 0);
  assert.equal(longestNowrapCode('`' + 'x'.repeat(40) + '`'), 0);
});

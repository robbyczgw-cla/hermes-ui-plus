import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDictationNotice, needsPermissionRecheck } from './dictationNotice.ts';

const DENIED = 'Ohne Mikrofon-Zugriff ist keine Spracheingabe möglich.';

test('mic-denied hint: goes once the permission is granted (back from the system settings), stays while still denied', () => {
  const n = { error: DENIED, permissionError: DENIED };
  assert.equal(needsPermissionRecheck(n), true);
  assert.equal(dropDictationNotice(n, { type: 'appActive', granted: true }), true);
  assert.equal(dropDictationNotice(n, { type: 'appActive', granted: false }), false);
});

test('mic-denied hint: a later, different notice is not touched by the permission re-check', () => {
  const n = { error: 'Zu kurz – halte die Taste gedrückt.', permissionError: DENIED };
  assert.equal(needsPermissionRecheck(n), false);
  assert.equal(dropDictationNotice(n, { type: 'appActive', granted: true }), false);
  assert.equal(needsPermissionRecheck({ error: null, permissionError: DENIED }), false);
});

test('dictation notices never outlive the chat: leaving the chat screen or switching chats drops them', () => {
  for (const type of ['left', 'chatChanged'] as const) {
    assert.equal(dropDictationNotice({ error: DENIED, permissionError: DENIED }, { type }), true);
    assert.equal(dropDictationNotice({ error: 'other', permissionError: null }, { type }), true);
    assert.equal(dropDictationNotice({ error: null, permissionError: null }, { type }), false);
    // a failed upload with its recording kept (retry) is the user's data: not dropped just by looking elsewhere
    assert.equal(dropDictationNotice({ error: 'Upload failed', permissionError: null, canRetry: true }, { type }), false);
  }
});

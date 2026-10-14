import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeKey, parseDesktopEvent, sameCommandWithin } from './events.ts';
import { desktopKeyFor, neighbourChat } from './keys.ts';
import { menuChats, sidebarOrder } from './order.ts';
import { lockDue, shouldAttachPaste } from './policy.ts';

test('parseDesktopEvent: strings, objects, junk', () => {
  assert.deepEqual(parseDesktopEvent('new-chat'), { cmd: 'new-chat' });
  assert.deepEqual(parseDesktopEvent({ cmd: 'open-recent', index: 2 }), { cmd: 'open-recent', index: 2 });
  assert.deepEqual(parseDesktopEvent({ cmd: 'open-chat', id: 'c1' }), { cmd: 'open-chat', id: 'c1', args: true });
  assert.deepEqual(parseDesktopEvent({ cmd: 'context-action', token: 't1', action: 'copy' }), { cmd: 'context-action', token: 't1', action: 'copy', args: true });
  assert.equal(parseDesktopEvent('<script>'), null);
  assert.equal(parseDesktopEvent({ cmd: 5 }), null);
  assert.equal(parseDesktopEvent(null), null);
  assert.equal(parseDesktopEvent({ cmd: 'open-recent', index: -1 })?.index, undefined);
});

test('key commands are de-duplicated (menu + keydown = one press), payload events never', () => {
  const e = { cmd: 'find' };
  assert.equal(sameCommandWithin({ cmd: 'find', at: 1000 }, e, 1200), true);
  assert.equal(sameCommandWithin({ cmd: 'find', at: 1000 }, e, 1600), false);
  assert.equal(sameCommandWithin({ cmd: 'search', at: 1000 }, e, 1100), false);
  const r = { cmd: 'open-recent', index: 1 };
  assert.equal(sameCommandWithin({ cmd: dedupeKey(r), at: 0 }, r, 10), true);
  assert.equal(sameCommandWithin({ cmd: dedupeKey(r), at: 0 }, { cmd: 'open-recent', index: 2 }, 10), false);
  assert.equal(sameCommandWithin({ cmd: 'pending', at: 0 }, { cmd: 'pending', args: true }, 10), false);
});

test('desktopKeyFor: the macOS shortcut set', () => {
  const k = (key: string, mods: Record<string, boolean> = {}, code?: string) => desktopKeyFor({ key, code, metaKey: true, ...mods }, true);
  assert.deepEqual(k('n'), { cmd: 'new-chat' });
  assert.deepEqual(k('O', { shiftKey: true }), { cmd: 'new-chat' });
  assert.deepEqual(k('f'), { cmd: 'find' });
  assert.deepEqual(k('k'), { cmd: 'search' });
  assert.deepEqual(k('b'), { cmd: 'toggle-sidebar' });
  assert.deepEqual(k('s', { ctrlKey: true }), { cmd: 'toggle-sidebar' });
  assert.deepEqual(k(','), { cmd: 'settings' });
  assert.deepEqual(k('.'), { cmd: 'stop' });
  assert.deepEqual(k('l'), { cmd: 'focus-composer' });
  assert.deepEqual(k('C', { shiftKey: true }), { cmd: 'copy-last' });
  assert.deepEqual(k('3'), { cmd: 'open-recent', index: 2 });
  assert.deepEqual(k('ArrowUp', { altKey: true }), { cmd: 'prev-chat' });
  assert.deepEqual(k('ArrowDown', { altKey: true }), { cmd: 'next-chat' });
  // left alone: plain text editing / system keys
  assert.equal(k('c'), null);
  assert.equal(k('v'), null);
  assert.equal(k('0'), null);
  assert.equal(k('ArrowUp'), null);
  assert.equal(desktopKeyFor({ key: 'n' }, true), null);
  assert.equal(desktopKeyFor({ key: 'n', ctrlKey: true }, true), null);
  assert.equal(desktopKeyFor({ key: 'n', metaKey: true, isComposing: true }, true), null);
  // Linux: Ctrl instead of ⌘
  assert.deepEqual(desktopKeyFor({ key: 'k', ctrlKey: true }, false), { cmd: 'search' });
  assert.equal(desktopKeyFor({ key: 'k', metaKey: true }, false), null);
});

test('sidebar order: pinned first, then recency, no archived; prev/next wraps not', () => {
  const list = [
    { id: 'a', updatedAt: 5, createdAt: 1 },
    { id: 'b', updatedAt: 9, createdAt: 1 },
    { id: 'p', updatedAt: 1, createdAt: 1, pinned: true },
    { id: 'x', updatedAt: 99, createdAt: 1, archived: true },
    { id: 'h', updatedAt: 50, createdAt: 1, profileKind: 'hidden' },
  ];
  const order = sidebarOrder(list, (m) => m.profileKind !== 'hidden').map((m) => m.id);
  assert.deepEqual(order, ['p', 'b', 'a']);
  assert.equal(neighbourChat(order, 'b', 1), 'a');
  assert.equal(neighbourChat(order, 'b', -1), 'p');
  assert.equal(neighbourChat(order, 'a', 1), null);
  assert.equal(neighbourChat(order, 'p', -1), null);
  assert.equal(neighbourChat(order, 'zzz', 1), 'p');
  assert.equal(neighbourChat(order, null, -1), 'a');
  assert.equal(neighbourChat([], 'a', 1), null);
  assert.deepEqual(menuChats([{ id: 'a', title: '  Hello\nworld ', updatedAt: 0, createdAt: 0 }, { id: 'b', updatedAt: 0, createdAt: 0 }], 'New chat'), [
    { id: 'a', title: 'Hello world' },
    { id: 'b', title: 'New chat' },
  ]);
});

test('paste: files become attachments unless it is rich text', () => {
  assert.equal(shouldAttachPaste({ fileCount: 0, types: ['text/plain'], text: 'hi' }), false);
  assert.equal(shouldAttachPaste({ fileCount: 1, types: ['Files'], text: '' }), true); // screenshot
  assert.equal(shouldAttachPaste({ fileCount: 1, types: ['Files', 'text/plain'], text: 'report.pdf' }), true); // Finder
  assert.equal(shouldAttachPaste({ fileCount: 1, types: ['Files', 'text/html', 'text/plain'], text: 'https://example.com/a.png' }), true); // Copy Image
  assert.equal(shouldAttachPaste({ fileCount: 1, types: ['Files', 'text/html', 'text/plain'], text: 'A paragraph from a document' }), false); // Word
});

test('lock after time in the background', () => {
  assert.equal(lockDue(null, 10_000_000, 5), false);
  assert.equal(lockDue(0, 4 * 60_000, 5), false);
  assert.equal(lockDue(0, 5 * 60_000, 5), true);
  assert.equal(lockDue(0, 99 * 60_000, 0), false); // launch only
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareOrCopy, shareTarget, type ShareDeps } from './shareOrCopy.ts';

function deps(over: Partial<ShareDeps>): ShareDeps & { copied: string[]; shared: string[] } {
  const copied: string[] = [];
  const shared: string[] = [];
  return {
    target: 'web',
    copy: async (t) => {
      copied.push(t);
      return true;
    },
    copied,
    shared,
    ...over,
  };
}

test('shareTarget: desktop app wins, then web vs native', () => {
  assert.equal(shareTarget('android', false), 'native');
  assert.equal(shareTarget('ios', false), 'native');
  assert.equal(shareTarget('web', false), 'web');
  assert.equal(shareTarget('web', true), 'desktop');
});

test('native: share sheet, dismissed = cancelled, error → copy', async () => {
  const ok = deps({ target: 'native', nativeShare: async () => ({ action: 'sharedAction' }) });
  assert.equal(await shareOrCopy('p', 't', ok), 'shared');
  assert.deepEqual(ok.copied, []);
  const dismissed = deps({ target: 'native', nativeShare: async () => ({ action: 'dismissedAction' }) });
  assert.equal(await shareOrCopy('p', 't', dismissed), 'cancelled');
  assert.deepEqual(dismissed.copied, []);
  const broken = deps({ target: 'native', nativeShare: async () => { throw new Error('no activity'); } });
  assert.equal(await shareOrCopy('p', 't', broken), 'copied');
  assert.deepEqual(broken.copied, ['p']);
});

test('web: navigator.share, abort stays cancelled, other errors and no API → copy', async () => {
  const seen: unknown[] = [];
  const ok = deps({ webShare: async (d) => void seen.push(d) });
  assert.equal(await shareOrCopy('p', 't', ok), 'shared');
  assert.deepEqual(seen, [{ text: 'p', title: 't' }]);
  assert.deepEqual(ok.copied, []);

  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  const cancelled = deps({ webShare: async () => { throw abort; } });
  assert.equal(await shareOrCopy('p', 't', cancelled), 'cancelled');
  assert.deepEqual(cancelled.copied, []);

  const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  const notAllowed = deps({ webShare: async () => { throw denied; } });
  assert.equal(await shareOrCopy('p', 't', notAllowed), 'copied');
  assert.deepEqual(notAllowed.copied, ['p']);

  const none = deps({ webShare: null });
  assert.equal(await shareOrCopy('p', 't', none), 'copied');
  assert.deepEqual(none.copied, ['p']);
});

test('desktop: always copies, even when a share API exists', async () => {
  let called = false;
  const d = deps({ target: 'desktop', webShare: async () => void (called = true), nativeShare: async () => void (called = true) });
  assert.equal(await shareOrCopy('p', 't', d), 'copied');
  assert.equal(called, false);
  assert.deepEqual(d.copied, ['p']);
});

test('copy failures surface as failed', async () => {
  assert.equal(await shareOrCopy('p', 't', deps({ target: 'desktop', copy: async () => false })), 'failed');
  assert.equal(await shareOrCopy('p', 't', deps({ webShare: null, copy: async () => { throw new Error('denied'); } })), 'failed');
});

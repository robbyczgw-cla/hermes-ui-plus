import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

// Platform, Share, the clipboard and the Tauri marker are swapped per test: the module reads them at call time.
const platform = { OS: 'android' };
const shared: unknown[] = [];
const copied: string[] = [];
const state = { share: async (_c: unknown, _o?: unknown): Promise<{ action: string }> => ({ action: 'sharedAction' }), copyResult: true as boolean | Error };
installRnStubs({
  'react-native': {
    Platform: platform,
    Share: { share: (c: unknown, o?: unknown) => (shared.push(c), state.share(c, o)) },
    AccessibilityInfo: { announceForAccessibility: () => undefined },
  },
  'expo-clipboard': {
    setStringAsync: async (s: string) => {
      if (state.copyResult instanceof Error) throw state.copyResult;
      copied.push(s);
      return state.copyResult;
    },
  },
});
const { copySetupPrompt, shareSetupPrompt } = await import('./agentSetupShare.ts');
const G = globalThis as unknown as { navigator?: unknown; window?: unknown };

function reset(os: string) {
  platform.OS = os;
  shared.length = 0;
  copied.length = 0;
  state.share = async () => ({ action: 'sharedAction' });
  state.copyResult = true;
  delete G.window;
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
}

test('android / ios: the native share sheet gets the prompt and the title', async () => {
  for (const os of ['android', 'ios']) {
    reset(os);
    assert.equal(await shareSetupPrompt('PROMPT', 'Title'), 'shared');
    assert.deepEqual(shared, [{ message: 'PROMPT', title: 'Title' }]);
    assert.deepEqual(copied, []);
  }
});

test('native share failing → copied', async () => {
  reset('android');
  state.share = async () => {
    throw new Error('no activity');
  };
  assert.equal(await shareSetupPrompt('PROMPT', 'Title'), 'copied');
  assert.deepEqual(copied, ['PROMPT']);
});

test('web: navigator.share when present, clipboard when absent', async () => {
  reset('web');
  const calls: unknown[] = [];
  G.navigator = { share: async (d: unknown) => void calls.push(d) };
  assert.equal(await shareSetupPrompt('PROMPT', 'Title'), 'shared');
  assert.deepEqual(calls, [{ text: 'PROMPT', title: 'Title' }]);
  assert.deepEqual(copied, []);

  reset('web');
  G.navigator = {};
  assert.equal(await shareSetupPrompt('PROMPT', 'Title'), 'copied');
  assert.deepEqual(copied, ['PROMPT']);
});

test('desktop app (Tauri): copies even if the webview has navigator.share', async () => {
  reset('web');
  G.window = { __TAURI_INTERNALS__: { invoke: async () => null } };
  let called = false;
  G.navigator = { share: async () => void (called = true) };
  assert.equal(await shareSetupPrompt('PROMPT', 'Title'), 'copied');
  assert.equal(called, false);
  assert.deepEqual(copied, ['PROMPT']);
});

test('copySetupPrompt: false when the clipboard refuses or throws', async () => {
  reset('web');
  assert.equal(await copySetupPrompt('x'), true);
  state.copyResult = false;
  assert.equal(await copySetupPrompt('x'), false);
  state.copyResult = new Error('denied');
  assert.equal(await copySetupPrompt('x'), false);
  assert.equal(await shareSetupPrompt('x', 't'), 'failed');
});

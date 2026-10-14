// On-device dictation lifecycle on the real deviceStt.ts with controllable native modules (testkit/rn.ts).
// Review part 5: finding 2 (cancel during model preparation must never start the microphone), finding 5 (abort must
// not deliver a competing completion), test gap 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, flush, installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();

type Handler = (e: never) => void;
function fakeAnalyzer() {
  const log: string[] = [];
  const listeners = new Map<string, Set<Handler>>();
  const model = deferred<{ status: 'installed' }>();
  const startGate = deferred();
  const cancelGate = deferred();
  const mod = {
    isAvailable: () => true,
    ensureModel: async (lang: string) => (log.push(`ensureModel:${lang}`), model.promise),
    start: async () => (log.push('start'), startGate.promise),
    stop: async () => void log.push('stop'),
    cancel: async () => (log.push('cancel'), cancelGate.promise),
    addListener: (ev: string, fn: Handler) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
      return { remove: () => void listeners.get(ev)!.delete(fn) };
    },
  };
  const emit = (ev: string, payload: unknown) => {
    for (const fn of Array.from(listeners.get(ev) ?? [])) fn(payload as never);
  };
  return { mod, log, emit, model, startGate, cancelGate, listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) };
}

const fake = fakeAnalyzer();
rn.native.HuiSpeechAnalyzer = fake.mod;
const { startRecognition } = await import('./deviceStt.ts');

function handlers() {
  const ends: unknown[] = [];
  const partials: string[] = [];
  return { ends, partials, h: { onPartial: (t: string) => partials.push(t), onLevel: () => undefined, onEnd: (r: unknown) => void ends.push(r) } };
}

test('cancel while the language model installs: the microphone is never started', async () => {
  const ctrl = new AbortController();
  const hs = handlers();
  const p = startRecognition('de-DE', hs.h, ctrl.signal);
  const rejected = assert.rejects(p, (e: { code?: string }) => e.code === 'aborted');
  await flush();
  assert.deepEqual(fake.log, ['ensureModel:de-DE']);
  ctrl.abort(); // dictation cancelled / unmounted
  fake.model.resolve({ status: 'installed' }); // installation finishes later
  await rejected;
  assert.ok(!fake.log.includes('start'), 'native start must not be called after cancellation');
  assert.equal(fake.listenerCount(), 0, 'no listeners left behind');
});

test('already aborted signal: nothing is touched', async () => {
  const before = fake.log.length;
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(startRecognition('de-DE', handlers().h, ctrl.signal), (e: { code?: string }) => e.code === 'aborted');
  assert.equal(fake.log.length, before);
});

test('cancel while the native start is in flight: stopped again, and the next start waits for that teardown', async () => {
  fake.log.length = 0;
  const ctrl = new AbortController();
  const p1 = startRecognition('de-DE', handlers().h, ctrl.signal);
  const r1 = assert.rejects(p1, (e: { code?: string }) => e.code === 'aborted');
  await flush();
  assert.deepEqual(fake.log, ['ensureModel:de-DE', 'start']);
  ctrl.abort();
  fake.startGate.resolve(undefined); // native start completes after the cancel
  await flush();
  assert.deepEqual(fake.log, ['ensureModel:de-DE', 'start', 'cancel']);

  // a new dictation begins while the cancel is still running
  const p2 = startRecognition('en-US', handlers().h);
  await flush();
  assert.deepEqual(fake.log, ['ensureModel:de-DE', 'start', 'cancel'], 'new start waits for the old teardown');
  fake.cancelGate.resolve(undefined);
  await r1;
  await flush();
  assert.deepEqual(fake.log.slice(0, 4), ['ensureModel:de-DE', 'start', 'cancel', 'ensureModel:en-US']);
  (await p2).abort();
});

test('abort() detaches silently: no onEnd, late native events are ignored', async () => {
  const hs = handlers();
  const session = await startRecognition('de-DE', hs.h);
  fake.emit('partial', { text: 'hallo', transcript: 'hallo' });
  assert.deepEqual(hs.partials, ['hallo']);
  session.abort();
  fake.emit('partial', { text: 'welt', transcript: 'hallo welt' });
  fake.emit('end', { transcript: 'hallo welt', cancelled: true });
  await flush();
  assert.deepEqual(hs.ends, [], 'abort must not deliver an empty result that beats the caller\'s own partial');
  assert.deepEqual(hs.partials, ['hallo']);
  assert.equal(fake.listenerCount(), 0);
});

test('normal stop: the engine delivers the final text through onEnd exactly once', async () => {
  const hs = handlers();
  const session = await startRecognition('de-DE', hs.h);
  fake.emit('final', { text: 'ein Test', transcript: 'ein Test' });
  session.stop();
  fake.emit('end', { transcript: 'ein Test', cancelled: false });
  fake.emit('end', { transcript: 'again', cancelled: false });
  assert.deepEqual(hs.ends, [{ text: 'ein Test', error: null }]);
});

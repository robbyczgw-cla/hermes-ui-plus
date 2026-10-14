// expo-speech-recognition backend (Android / SFSpeechRecognizer / web) of deviceStt.ts with a fake native module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, flush, installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
rn.platform.OS = 'android';

type Handler = (e: never) => void;
const log: string[] = [];
const listeners = new Map<string, Set<Handler>>();
const locales = deferred<{ installedLocales: string[] }>();
const emit = (ev: string, payload: unknown = {}) => {
  for (const fn of Array.from(listeners.get(ev) ?? [])) fn(payload as never);
};
rn.modules['expo-speech-recognition'] = {
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    supportsOnDeviceRecognition: () => true,
    getSupportedLocales: () => locales.promise,
    start: (o: { lang: string }) => void log.push(`start:${o.lang}`),
    stop: () => void log.push('stop'),
    abort: () => void log.push('abort'),
    addListener: (ev: string, fn: Handler) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
      return { remove: () => void listeners.get(ev)!.delete(fn) };
    },
  },
};
const { startRecognition } = await import('./deviceStt.ts');

test('cancel while the offline-model check runs: recognition never starts', async () => {
  const ctrl = new AbortController();
  const p = startRecognition('de-DE', { onPartial: () => undefined, onLevel: () => undefined, onEnd: () => undefined }, ctrl.signal);
  const rejected = assert.rejects(p, (e: { code?: string }) => e.code === 'aborted');
  await flush();
  ctrl.abort();
  locales.resolve({ installedLocales: ['de-DE'] });
  await rejected;
  assert.deepEqual(log, []);
});

test('abort() after start: onEnd is not called, even when the engine reports end / results afterwards', async () => {
  const ends: unknown[] = [];
  const partials: string[] = [];
  const s = await startRecognition('de-DE', { onPartial: (t) => partials.push(t), onLevel: () => undefined, onEnd: (r) => void ends.push(r) });
  assert.deepEqual(log, ['start:de-DE']);
  emit('start');
  emit('result', { isFinal: false, results: [{ transcript: 'guten tag' }] });
  assert.deepEqual(partials, ['guten tag']);
  s.abort();
  emit('result', { isFinal: true, results: [{ transcript: 'guten tag zusammen' }] });
  emit('end');
  assert.deepEqual(ends, []);
  assert.deepEqual(partials, ['guten tag']);
  assert.ok(log.includes('abort'));
});

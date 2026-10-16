import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micKeyProps } from './micKeys.ts';

function fake(phase: 'idle' | 'starting' | 'recording' | 'transcribing') {
  const calls: string[] = [];
  const dictation = {
    phase,
    start: async (m?: string) => void calls.push(`start:${m}`),
    stop: async () => void calls.push('stop'),
    cancel: () => void calls.push('cancel'),
  };
  return { dictation, calls };
}
const ev = (key: string, extra: Record<string, unknown> = {}) => {
  const e = { key, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...extra };
  return e;
};
type Handlers = { onKeyDown: (e: never) => void; onKeyUp: (e: never) => void };
const handlers = (o: Parameters<typeof micKeyProps>[0]) => micKeyProps(o) as unknown as Handlers;

test('Enter taps the mic: idle starts, recording stops, starting cancels, transcribing does nothing', () => {
  for (const [phase, want] of [['idle', ['start:tap']], ['recording', ['stop']], ['starting', ['cancel']], ['transcribing', []]] as const) {
    const { dictation, calls } = fake(phase);
    const e = ev('Enter');
    handlers({ dictation }).onKeyDown(e as never);
    assert.deepEqual(calls, want, phase);
    assert.ok(e.defaultPrevented);
  }
});

test('Space acts on keyup (keydown only blocks page scroll)', () => {
  const { dictation, calls } = fake('idle');
  const h = handlers({ dictation });
  const down = ev(' ');
  h.onKeyDown(down as never);
  assert.deepEqual(calls, []);
  assert.ok(down.defaultPrevented);
  h.onKeyUp(ev(' ') as never);
  assert.deepEqual(calls, ['start:tap']);
});

test('disabled, modifiers, key repeat and other keys do nothing', () => {
  const { dictation, calls } = fake('idle');
  const dis = handlers({ dictation, disabled: true });
  dis.onKeyDown(ev('Enter') as never);
  dis.onKeyUp(ev(' ') as never);
  const h = handlers({ dictation });
  h.onKeyDown(ev('Enter', { ctrlKey: true }) as never);
  h.onKeyDown(ev('Enter', { repeat: true }) as never);
  h.onKeyUp(ev(' ', { metaKey: true }) as never);
  h.onKeyDown(ev('a') as never);
  h.onKeyUp(ev('Tab') as never);
  assert.deepEqual(calls, []);
});

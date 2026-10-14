import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindEscapeStack, createEscapeStack } from './escapeStack.ts';

test('Esc closes the newest overlay first; removed overlays are skipped', () => {
  const s = createEscapeStack();
  const closed: string[] = [];
  const offDrawer = s.push(() => closed.push('drawer'));
  const offSheet = s.push(() => closed.push('sheet'));
  assert.equal(s.escape(), true);
  assert.deepEqual(closed, ['sheet']);
  offSheet();
  s.escape();
  assert.deepEqual(closed, ['sheet', 'drawer']);
  offDrawer();
  assert.equal(s.escape(), false);
  assert.equal(s.size(), 0);
});

test('DOM binding: keydown closes, the keyup of the same press is swallowed, handled keys are left alone', () => {
  const s = createEscapeStack();
  const listeners: Record<string, (e: never) => void> = {};
  bindEscapeStack(s, { addEventListener: (type, fn) => (listeners[type] = fn as never) });
  let closed = 0;
  s.push(() => closed++);
  const ev = (key: string, defaultPrevented = false) => {
    const e = { key, defaultPrevented, prevented: false, stopped: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; } };
    return e;
  };
  const down = ev('Escape');
  listeners.keydown(down as never);
  assert.equal(closed, 1);
  assert.equal(down.prevented, true);
  const up = ev('Escape');
  listeners.keyup(up as never);
  assert.equal(up.stopped, true);
  // an input that already handled Esc (preventDefault) wins
  listeners.keydown(ev('Escape', true) as never);
  assert.equal(closed, 1);
  const up2 = ev('Escape');
  listeners.keyup(up2 as never);
  assert.equal(up2.stopped, false);
  listeners.keydown(ev('Enter') as never);
  assert.equal(closed, 1);
});

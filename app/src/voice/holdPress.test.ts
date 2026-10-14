// Mic button press state machine (holdPress.ts): recording starts on touch-down, the press resolves to tap / hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHoldController, type PressDictation } from './holdPress.ts';

function setup(phase: PressDictation['phase'] = 'idle', opts: { holdToTalk?: boolean; available?: boolean } = {}) {
  const log: string[] = [];
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const d: PressDictation = {
    phase,
    available: opts.available ?? true,
    start: async (m) => void log.push(`start:${m}@${now}`),
    stop: async () => void log.push(`stop@${now}`),
    cancel: () => void log.push(`cancel@${now}`),
    releaseHold: () => void log.push(`release@${now}`),
    setHoldDragX: (dx) => void log.push(`drag:${dx}`),
    resolvePress: (as) => void log.push(`resolve:${as}@${now}`),
  };
  const ctl = createHoldController(
    () => undefined,
    () => log.push('haptic'),
    {
      set: (fn, ms) => {
        const t = { at: now + ms, fn, id: ++ids };
        timers.push(t);
        return t.id;
      },
      clear: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  );
  ctl.update({ dictation: d, holdToTalk: opts.holdToTalk ?? true, holdDelayMs: 280, cancelDistance: 90 });
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return { ctl, d, log, advance };
}

test('touch-down starts recording at once (no 280 ms wait); a hold resolves after the delay, release stops', () => {
  const { ctl, log, advance } = setup();
  assert.equal(ctl.begin(100), true);
  assert.deepEqual(log, ['start:press@0'], 'recording requested on touch-down');
  advance(279);
  assert.deepEqual(log, ['start:press@0']);
  advance(1);
  assert.deepEqual(log, ['start:press@0', 'resolve:hold@280']);
  advance(2000);
  ctl.end(true);
  assert.deepEqual(log, ['start:press@0', 'resolve:hold@280', 'release@2280']);
});

test('a short tap keeps the recording that started on touch-down (resolved as tap, no second start, no stop)', () => {
  const { ctl, log, advance } = setup();
  ctl.begin(100);
  advance(120);
  ctl.end(true);
  advance(1000); // the hold timer is gone
  assert.deepEqual(log, ['start:press@0', 'resolve:tap@120']);
});

test('a touch the system cancels before the delay aborts the press', () => {
  const { ctl, log, advance } = setup();
  ctl.begin(100);
  advance(50);
  ctl.end(false);
  advance(1000);
  assert.deepEqual(log, ['start:press@0', 'resolve:abort@50']);
});

test('hold: sliding left past the distance cancels, the release afterwards only resets the drag', () => {
  const { ctl, log, advance } = setup();
  ctl.begin(300);
  advance(280);
  advance(20);
  ctl.move(250);
  ctl.move(200);
  ctl.end(true);
  assert.deepEqual(log, ['start:press@0', 'resolve:hold@280', 'drag:-50', 'drag:-100', 'haptic', 'cancel@300', 'drag:0']);
});

test('moves during the undecided window are ignored (no early cancel)', () => {
  const { ctl, log, advance } = setup();
  ctl.begin(300);
  ctl.move(100);
  advance(100);
  ctl.end(true);
  assert.deepEqual(log, ['start:press@0', 'resolve:tap@100']);
});

test('while recording (tap mode) a touch is a plain tap on release: stop', () => {
  const { ctl, log, advance } = setup('recording');
  ctl.begin(0);
  advance(500); // even a long press: no hold while a recording runs
  ctl.end(true);
  assert.deepEqual(log, ['stop@500']);
});

test('hold-to-talk off / no engine: a tap on release, as before', () => {
  for (const o of [{ holdToTalk: false }, { available: false }]) {
    const { ctl, log, advance } = setup('idle', o);
    ctl.begin(0);
    advance(100);
    ctl.end(true);
    assert.deepEqual(log, ['start:tap@100']);
  }
});

test('a second finger is ignored; end runs once per touch', () => {
  const { ctl, log, advance } = setup();
  assert.equal(ctl.begin(0), true);
  assert.equal(ctl.begin(10), false);
  advance(100);
  ctl.end(true);
  ctl.end(true);
  assert.deepEqual(log, ['start:press@0', 'resolve:tap@100']);
});

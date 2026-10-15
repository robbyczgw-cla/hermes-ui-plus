/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FADE_IN_MS, FADE_IN_SETTLED, REANIMATED_HANDBACK_MS, fadeInFrom, fadeInPlan, fadeInReactStyle } from './fadeIn.ts';
import { ENTER_STAGGER_MAX_MS as MAX_STAGGER_MS } from '../../chat/enterBlock.ts';

test('fade-in: React owns the end state after the fade – before Reanimated could hand back or drop it', () => {
  for (const delay of [0, 40, 120, MAX_STAGGER_MS]) {
    const plan = fadeInPlan(delay, false);
    assert.equal(plan.startAt, delay);
    // the UI-thread fade finishes first …
    assert.ok(plan.settleAt >= plan.startAt + FADE_IN_MS);
    // … and the settled style is in React's props long before Reanimated's 1–2 s hand-back / purge window
    assert.ok(plan.settleAt < REANIMATED_HANDBACK_MS, `settleAt ${plan.settleAt}`);
  }
});

test('fade-in: reduced motion is settled from the start; odd delays are sanitized', () => {
  assert.deepEqual(fadeInPlan(120, true), { startAt: 0, settleAt: 0 });
  assert.deepEqual(fadeInPlan(-5, false), fadeInPlan(0, false));
  assert.deepEqual(fadeInPlan(Number.NaN, false), fadeInPlan(0, false));
});

test('fade-in regression: a settled block is fully visible from React props alone (Reanimated value dropped)', () => {
  // Reanimated keeps the mount-time style as the view's React props; when its UI-thread value is purged
  // unsynced (JS stall > 1 s), every later React commit shows exactly what React holds.
  const before = fadeInReactStyle(6, false);
  assert.deepEqual(before, fadeInFrom(6));
  assert.equal(before.opacity, 0); // the hazard: invisible, but laid out (the "empty gap")
  const after = fadeInReactStyle(6, true);
  assert.equal(after.opacity, 1);
  assert.equal(after.transform[0].translateY, 0);
  // the overlay the component appends after the animated style flattens to the same end state
  const flattened = { ...fadeInFrom(6), ...FADE_IN_SETTLED };
  assert.deepEqual(flattened, after);
  assert.ok(Object.isFrozen(FADE_IN_SETTLED));
});

test('fade-in guard: <FadeIn> appends the settled style after its animated style and settles on a JS timer', () => {
  const src = readFileSync(new URL('../primitives/basics.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function FadeIn('), src.indexOf('\n}\n', src.indexOf('export function FadeIn(')));
  assert.match(body, /fadeInPlan\(delay, reduced\)/);
  assert.match(body, /setTimeout\(settle, plan\.settleAt\)/);
  assert.match(body, /style=\{\[style, anim, settled \? FADE_IN_SETTLED : null\]\}/);
});

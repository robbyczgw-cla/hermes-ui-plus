/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard for the gesture state manager bug class (first seen in MicButton, E2E log 2026-10):
 * react-native-gesture-handler v2 hands `onTouches*` callbacks a GestureStateManager whose begin/activate/end/fail
 * call Reanimated's `setGestureState`. That function only works on the UI runtime; on the JS runtime it logs
 * "[Reanimated] You can not use setGestureState in non-worklet function." and returns without changing the state
 * (react-native-reanimated src/platformFunctions/setGestureState.ts). A gesture with `.runOnJS(true)` dispatches
 * every callback on the JS thread (gesture-handler eventReceiver.ts creates the manager there), so its m.activate()
 * etc. silently never happen. Rule: a gesture chain that drives its state manually must not use `.runOnJS(true)`,
 * and its `onTouches*` callbacks that take the manager are explicit `'worklet'`s (hop to JS via runOnJS for React).
 */

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(SRC.length).replaceAll('\\', '/');

/** `Gesture.X()…` builder chains: from `Gesture.` to the `;` (or unbalanced closer) at the chain's own nesting level. */
function gestureChains(src: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const re = /\bGesture\.(?:Manual|Pan|Tap|LongPress|Fling|Pinch|Rotation|Hover|ForceTouch|Native)\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    let i = m.index;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        if (depth === 0) break;
        depth--;
      } else if ((c === ';' || c === ',') && depth === 0) break;
    }
    out.push({ start: m.index, text: src.slice(m.index, i) });
  }
  return out;
}

type GestureViolation = { offset: number; reason: string };

/** Violations of the rule above in one source file. */
function gestureViolations(src: string): GestureViolation[] {
  const out: GestureViolation[] = [];
  for (const chain of gestureChains(src)) {
    // onTouches* callbacks that receive the state manager: `.onTouchesDown((e, m) => {` / `(_e, manager) =>`
    const cbRe = /\.onTouches(?:Down|Move|Up|Cancelled)\(\s*\(\s*[\w$]+\s*(?::[^,)]*)?,\s*([\w$]+)[^)]*\)\s*=>\s*\{/g;
    let usesManager = false;
    for (let c = cbRe.exec(chain.text); c; c = cbRe.exec(chain.text)) {
      const name = c[1]!;
      const body = chain.text.slice(c.index + c[0].length);
      if (!new RegExp(`\\b${name}\\s*\\.\\s*(?:begin|activate|end|fail)\\s*\\(`).test(body.slice(0, 2000))) continue;
      usesManager = true;
      if (!/^\s*(['"])worklet\1/.test(body)) {
        out.push({ offset: chain.start + c.index, reason: `onTouches* callback using the state manager "${name}" is not a 'worklet'` });
      }
    }
    if (usesManager && /\.runOnJS\(\s*true\s*\)/.test(chain.text)) {
      out.push({ offset: chain.start, reason: 'gesture with .runOnJS(true) drives its state manager (setGestureState only works in a UI worklet)' });
    }
  }
  return out;
}

const lineOf = (src: string, offset: number) => src.slice(0, offset).split('\n').length;

test('gesture guard: the scanner flags the old MicButton shape (runOnJS(true) + manager calls, no worklet)', () => {
  const old = `
  const gesture = Gesture.Manual()
    .runOnJS(true)
    .enabled(!disabled)
    .onTouchesDown((e, m) => {
      const x = e.allTouches[0]?.absoluteX ?? 0;
      if (ctl.begin(x)) m.activate();
    })
    .onTouchesUp((_e, m) => {
      ctl.end(true);
      m.end();
    });
  const other = 1;`;
  const v = gestureViolations(old);
  assert.equal(v.filter((x) => /runOnJS\(true\)/.test(x.reason)).length, 1);
  assert.equal(v.filter((x) => /not a 'worklet'/.test(x.reason)).length, 2);
});

test('gesture guard: worklet callbacks that hop to JS via runOnJS pass; runOnJS(true) without manager calls passes', () => {
  const fixed = `
  const gesture = Gesture.Manual()
    .enabled(!disabled)
    .onTouchesDown((e, m) => {
      'worklet';
      m.activate();
      runOnJS(touchDown)(e.allTouches[0]?.absoluteX ?? 0);
    })
    .onTouchesCancelled((_e, m) => {
      'worklet';
      m.fail();
      runOnJS(touchEnd)(false);
    });`;
  assert.deepEqual(gestureViolations(fixed), []);
  const jsPan = `const pan = Gesture.Pan().runOnJS(true).onEnd((e) => { setIndex(e.translationX > 0 ? 1 : 0); });`;
  assert.deepEqual(gestureViolations(jsPan), []);
  // the manager parameter unused (only the event): fine on the JS thread too
  const jsTouches = `const g = Gesture.Manual().runOnJS(true).onTouchesMove((e, _m) => { move(e.allTouches[0]?.absoluteX); });`;
  assert.deepEqual(gestureViolations(jsTouches), []);
});

test('gesture guard: no gesture in app/src calls the state manager off the UI thread', () => {
  const hits: string[] = [];
  for (const f of sourceFiles(SRC)) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('Gesture.')) continue;
    for (const v of gestureViolations(src)) hits.push(`${rel(f)}:${lineOf(src, v.offset)} ${v.reason}`);
  }
  assert.deepEqual(hits, []);
});

test('gesture guard: MicButton drives its manual gesture from UI-thread worklets', () => {
  const src = readFileSync(join(SRC, 'voice/components/MicButton.tsx'), 'utf8');
  const chains = gestureChains(src).filter((c) => c.text.startsWith('Gesture.Manual('));
  assert.equal(chains.length, 1);
  const chain = chains[0]!.text;
  assert.doesNotMatch(chain, /\.runOnJS\(\s*true\s*\)/);
  for (const cb of ['onTouchesDown', 'onTouchesMove', 'onTouchesUp', 'onTouchesCancelled']) {
    assert.match(chain, new RegExp(`\\.${cb}\\([^)]*\\)\\s*=>\\s*\\{\\s*'worklet';`), `${cb} is a worklet`);
  }
  assert.match(chain, /m\.activate\(\)/);
  assert.match(chain, /runOnJS\(touchDown\)/);
});

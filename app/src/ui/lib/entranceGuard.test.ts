/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard for the FadeIn bug class (ui/lib/fadeIn.ts): a view whose only path to visible runs through a
 * Reanimated value can be stranded at its mount-time style (opacity 0, off-screen, zero width) when
 * Reanimated drops the settled UI-thread value after a JS stall. The audit (2026-10) covered every
 * `entering=` layout animation, every `useAnimatedStyle` whose shared value starts invisible
 * (sheets, drawer, chart entrance, progress/score/poll/decision bars, count-up, HtmlBlock height),
 * RN `Animated` banners/toasts/chips (safe: the Animated.Value object itself is React's prop, it cannot
 * revert to its initial value on re-render), looping loaders (never settle), shared values initialised
 * to their visible rest state (press scale, switches, guide pages, gestures), RN `Modal` animationType
 * and the `LayoutAnimation.configureNext` press toggles in the chat (final layout is React's).
 */

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(SRC.length).replaceAll('\\', '/');

test('entrance guard: no reanimated entering= layout animations (they can strand views invisible)', () => {
  const hits: string[] = [];
  for (const f of tsxFiles(SRC)) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\bentering=/.test(line)) hits.push(`${rel(f)}:${i + 1}`);
    });
  }
  // use the <FadeIn> primitive (ui/primitives/basics.tsx) instead: it hands its end state to React
  assert.deepEqual(hits, []);
});

test('entrance guard: no reanimated layout transitions, no exiting= in answer content (frames can freeze)', () => {
  // a Reanimated layout={LinearTransition…} keeps the animated frame on the UI thread only. When a checklist card
  // grew at the turn end (counter + Share/Edit appear), its items stayed frozen 53 px up over the progress bar,
  // item 2 squashed to 1 px (E2E `checklist`, 2026-10-15). Answer content lets React own its final layout.
  const transition = /\b(LinearTransition|SequencedTransition|FadingTransition|JumpingTransition|CurvedTransition|EntryExitTransition)\b/;
  const hits: string[] = [];
  for (const f of tsxFiles(SRC)) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (transition.test(line) || (rel(f).startsWith('ui/components/') && /\bexiting=/.test(line))) hits.push(`${rel(f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('entrance guard: animated styles that start invisible hand their end state to React', () => {
  // file → marker proving the settled (plain, React-owned) final style is appended after the animated one
  const expected: Record<string, RegExp> = {
    'ui/components/ChartParts.tsx': /settled \? \{ opacity: FADE_IN_SETTLED\.opacity/,
    'ui/components/content.tsx': /settled \? \{ width: ratio \* w \}/,
    'ui/components/modules/c1/Poll.tsx': /settled \? \{ width: target \* w \}/,
    'ui/components/modules/Checklist.tsx': /settled \? \(\{ width: `\$\{ratio \* 100\}%` \}/,
    'ui/components/modules/d1/Products.tsx': /settled \? \{ transform: \[\{ scaleX: Math\.max\(0\.0001, value \/ 10\) \}\] \}/,
    'ui/components/modules/c3/Decision.tsx': /settled \? \{ transform: \[\{ scaleX: Math\.max\(0\.0001, \(r\.score \?\? 0\) \/ 10\) \}\] \}/,
    'ui/components/modules/d1/parts.tsx': /settled \? \(wide \? \{ opacity: 1/,
    'approvals/ApprovalSheet.tsx': /enterSettled \? FADE_IN_SETTLED : null/,
    'conversations/ConversationDrawer.tsx': /settledOpen \? \{ transform: \[\{ translateX: 0 \}\] \}/,
    'sandbox/HtmlBlock.tsx': /heightSettled \? \{ height: target \}/,
  };
  for (const [file, marker] of Object.entries(expected)) {
    const src = readFileSync(join(SRC, file), 'utf8');
    assert.match(src, marker, file);
  }
});

test('entrance guard: animation-callback hand-offs have a JS-timer fallback', () => {
  // sheet close (withTiming callback), count-up → plain text, toast unmount: none may depend on the
  // animation driver reporting "finished"
  assert.match(readFileSync(join(SRC, 'ui/components/modules/d1/parts.tsx'), 'utf8'), /setTimeout\(onClose, 300\)/);
  assert.match(readFileSync(join(SRC, 'ui/components/CountUpValue.tsx'), 'utf8'), /setTimeout\(\(\) => setDone\(true\), DURATION \+ 300\)/);
  assert.match(readFileSync(join(SRC, 'chat/Toast.tsx'), 'utf8'), /setTimeout\(\(\) => doneRef\.current\(\), 400\)/);
  // the drawer already had its unmount fallback before this audit – keep it
  assert.match(readFileSync(join(SRC, 'conversations/ConversationDrawer.tsx'), 'utf8'), /setTimeout\(\(\) => setMounted\(false\), 400\)/);
});

test('entrance guard: LayoutAnimation stays limited to the audited chat press toggles', () => {
  const allowed = new Set(['chat/ToolChips.tsx', 'chat/ToolTimeline.tsx', 'chat/MessageItem.tsx']);
  const hits: string[] = [];
  for (const f of tsxFiles(SRC)) {
    if (allowed.has(rel(f))) continue;
    if (/LayoutAnimation\.configureNext/.test(readFileSync(f, 'utf8'))) hits.push(rel(f));
  }
  assert.deepEqual(hits, []);
});

test('entrance guard: useSettledAfter is a plain JS timer (independent of the UI thread)', () => {
  const src = readFileSync(join(SRC, 'ui/lib/useSettledAfter.ts'), 'utf8');
  assert.match(src, /setTimeout\(\(\) => setSettled\(true\), ms\)/);
  assert.match(src, /clearTimeout\(id\)/);
  assert.doesNotMatch(src, /reanimated/);
});

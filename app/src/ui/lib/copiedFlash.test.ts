/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPIED_MS, createCopiedFlash } from './copiedFlash.ts';

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++seq;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: unknown) => void due.delete(id as number),
    advance(ms: number) {
      now += ms;
      for (const [id, d] of [...due]) if (d.at <= now) (due.delete(id), d.fn());
    },
    pending: () => due.size,
  };
}

test('copied flash: "Copied" state for ~1.5 s, a second tap restarts the window, dispose clears the timer', () => {
  assert.equal(COPIED_MS, 1500);
  const tm = fakeTimers();
  const states: boolean[] = [];
  const f = createCopiedFlash((on) => states.push(on), COPIED_MS, tm);
  f.flash();
  assert.deepEqual(states, [true]);
  tm.advance(1000);
  f.flash(); // tapped again: stays "Copied" for another full window
  tm.advance(1000);
  assert.deepEqual(states, [true, true]);
  tm.advance(500);
  assert.deepEqual(states, [true, true, false]);
  f.flash();
  f.dispose(); // unmount: no state update afterwards
  tm.advance(5000);
  assert.deepEqual(states, [true, true, false, true]);
  assert.equal(tm.pending(), 0);
});

test('copied flash: every copy button uses the shared state and the localized label (no hardcoded "Kopiert")', () => {
  const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  for (const file of ['chat/Markdown.tsx', 'ui/components/media.tsx', 'chat/ToolTimeline.tsx', 'chat/MessageItem.tsx']) {
    const s = src(file);
    assert.match(s, /useCopiedFlash\(/, file);
    assert.doesNotMatch(s, /'Kopiert'|'Kopieren'/, file);
  }
  for (const lang of ['de', 'en', 'es']) assert.match(src(`i18n/${lang}.ts`), /^ {4}copied: '[^']+',$/m, lang);
});

/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ChatView re-renders on every streaming update (its `messages` prop). Its sheets / bars must not: they are memoized
 * and get only stable props (no inline closures, no per-update arrays). Source guard (no React renderer in node:test).
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chatView = read('./ChatView.tsx');

/** the JSX element `<Name … />` (or up to its closing tag) as written in ChatView */
function element(name: string): string {
  const start = chatView.indexOf(`<${name}`);
  assert.ok(start >= 0, name);
  const selfClose = chatView.indexOf('/>', start);
  return chatView.slice(start, selfClose + 2);
}

test('chat view memo guard: menu, find bar, approvals and consent sheet are memoized components', () => {
  for (const [file, name] of [
    ['./ChatMenu.tsx', 'ChatMenu'],
    ['./FindBar.tsx', 'FindBar'],
    ['../approvals/ApprovalStack.tsx', 'ApprovalStack'],
    ['../compliance/Consent.tsx', 'ConsentSheet'],
  ]) {
    assert.match(read(file), new RegExp(`export const ${name} = memo\\(function ${name}\\(`), name);
  }
});

test('chat view memo guard: their props are stable (no inline closures, approvals kept by identity)', () => {
  for (const name of ['ChatMenu', 'FindBar', 'ApprovalStack', 'ConsentSheet']) {
    assert.doesNotMatch(element(name), /=>/, `${name}: inline closure prop`);
  }
  assert.match(chatView, /const approvals = useStableList\(/);
  assert.match(element('ChatMenu'), /\{\.\.\.menuHandlers\}/);
  assert.match(chatView, /const menuHandlers = useMemo\([\s\S]*?\n {4}\[\],\n {2}\);/);
});

test('image edit provider: the sheet is a memoized element (the provider itself re-renders with its children)', () => {
  const src = read('../imageedit/ImageEditProvider.tsx');
  assert.match(src, /const sheet = useMemo\(/);
  // personal tree: the OpenAI-compatible attachment caps feed the gate; public (Hermes-only) tree: no caps. Either way
  // the gate is memoized on exactly what it reads, so the sheet's `gate` prop stays stable across streaming updates.
  assert.match(
    src,
    /const gate = useMemo\(\(\) => editGate\(profile, (?:caps\), \[profile, caps\]|null\), \[profile\])\);/,
  );
  assert.match(src, /\{children\}\n\s*\{sheet\}/);
});

/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { BOOTSTRAP_SYSTEM_MESSAGE } from './bootstrap.ts';

test('BOOTSTRAP_SYSTEM_MESSAGE is a verbatim copy of hermes-skill/bootstrap-system-message.txt', () => {
  const url = new URL('../../../hermes-skill/bootstrap-system-message.txt', import.meta.url);
  if (!existsSync(url)) return; // skill folder not present in this checkout
  assert.equal(BOOTSTRAP_SYSTEM_MESSAGE, readFileSync(url, 'utf8'));
});

test('message starts with the marker', () => {
  assert.ok(BOOTSTRAP_SYSTEM_MESSAGE.startsWith('[hermes-ui-app]'));
});

test('message covers the inline skill core (bridge), the skill_view fallback (direct) and result-first', () => {
  assert.match(BOOTSTRAP_SYSTEM_MESSAGE, /follows inline as the next system message/);
  assert.match(BOOTSTRAP_SYSTEM_MESSAGE, /skill_view\("hermes-ui", file_path="references\/<ref>\.md"\)/);
  assert.match(BOOTSTRAP_SYSTEM_MESSAGE, /If it is missing, load skill hermes-ui with skill_view on the first turn/);
  assert.match(BOOTSTRAP_SYSTEM_MESSAGE, /the key result first in 1-3 sentences/);
  // Inline core present -> no skill_view for SKILL.md (costs a tool round trip), only for references.
  assert.match(BOOTSTRAP_SYSTEM_MESSAGE, /When a \[hermes-ui-skill\] system message is present, do NOT call skill_view for SKILL\.md/);
  assert.match(BOOTSTRAP_SYSTEM_MESSAGE, /use skill_view only for references\/<ref>\.md/);
  assert.ok(BOOTSTRAP_SYSTEM_MESSAGE.endsWith('\n') && !BOOTSTRAP_SYSTEM_MESSAGE.slice(0, -1).includes('\n'), 'one line');
});

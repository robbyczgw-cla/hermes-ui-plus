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

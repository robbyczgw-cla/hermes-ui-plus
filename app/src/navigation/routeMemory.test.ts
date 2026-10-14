import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberRoute, takeRouteToRestore } from './routeMemory.ts';

test('route memory: an open Settings screen is reopened once after an activity recreation', () => {
  assert.equal(takeRouteToRestore(), null); // first start
  rememberRoute('/settings');
  assert.equal(takeRouteToRestore(), '/settings');
  assert.equal(takeRouteToRestore(), null); // only once
  rememberRoute('/');
  assert.equal(takeRouteToRestore(), null); // the chat is the start screen anyway
  rememberRoute('/unknown');
  assert.equal(takeRouteToRestore(), null);
});

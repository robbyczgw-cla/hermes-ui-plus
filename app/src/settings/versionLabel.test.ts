import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionLabel } from './versionLabel.ts';

test('version label: build number and source commit when the build script set them', () => {
  assert.equal(versionLabel('0.1.0', { buildNumber: 42, buildSource: 'abc1234' }), '0.1.0 · Build 42 (abc1234)');
  assert.equal(versionLabel('0.1.0', { buildNumber: 42 }), '0.1.0 · Build 42');
  // export builds have no git commit: no "(nogit-dirty)" noise
  assert.equal(versionLabel('0.1.0', { buildNumber: 7, buildSource: 'nogit-dirty' }), '0.1.0 · Build 7');
  assert.equal(versionLabel('0.1.0', {}), '0.1.0');
  assert.equal(versionLabel('0.1.0', { buildNumber: '3' }), '0.1.0');
  assert.equal(versionLabel(undefined, undefined), '–');
});

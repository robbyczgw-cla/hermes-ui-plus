// share_image readiness (scripts/e2e/device.py ready_at / settled): the time comes from a raw-screencap luma curve
// compared with the look confirmed as ready, not from the uiautomator wait (which also counts dumps that block while
// the sheet's spinner turns). Pure functions; nothing here touches adb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;
const opts = { skip: !hasPython && 'no python3' };
const call = (expr) => {
  const r = spawnSync('python3', ['-B', '-c', `import json, sys; sys.path.insert(0, ${JSON.stringify(DIR)}); import device as d; print(json.dumps(${expr}))`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

// the curve of the main-branch run that reported ready_s=12.4: final look from 1.03 s, same luma as the confirmed
// ready screenshot (211.1)
const MAIN_RUN = [[0.09, 240.7], [0.53, 241.9], [1.03, 211.1], [1.35, 211.1], [1.83, 211.1], [2.31, 211.1], [2.77, 211.1], [3.13, 211.1]];

test('ready_at: the first sample from which the curve stays at the ready look', opts, () => {
  assert.equal(call(`d.ready_at(${JSON.stringify(MAIN_RUN)}, 211.1)`), 1.03);
  // a look that comes back after a dip counts from its last arrival
  assert.equal(call('d.ready_at([[0.1, 200], [0.5, 211], [0.9, 230], [1.4, 211], [2.0, 211.4]], 211)'), 1.4);
  // never there / left again: no readiness time
  assert.equal(call('d.ready_at([[0.1, 240], [0.5, 230]], 211)'), null);
  assert.equal(call('d.ready_at([[0.1, 211], [0.5, 230]], 211)'), null);
  assert.equal(call('d.ready_at([], 211)'), null);
});

test('settled: the last hold_s seconds hold still', opts, () => {
  assert.equal(call(`d.settled(${JSON.stringify(MAIN_RUN)}, 2.0)`), true);
  assert.equal(call(`d.settled(${JSON.stringify(MAIN_RUN.slice(0, 4))}, 2.0)`), false); // covers only 1.26 s
  assert.equal(call('d.settled([[0, 211], [1.5, 230], [2.5, 211], [3.1, 211]], 2.0)'), false);
  assert.equal(call('d.settled([], 2.0)'), false);
});

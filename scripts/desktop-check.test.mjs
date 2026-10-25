// scripts/desktop-check (docs/RELEASING.md "Every shipped platform"): usage errors, and the UI texts the WebDriver
// flow clicks on still exist in the app's English strings (a renamed button would otherwise only show up in the
// release run).
//   node --test scripts/desktop-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const driver = readFileSync(here('./desktop-check/pair-check.mjs'), 'utf8');
const en = ['onboardingGuided', 'onboarding', 'compliance'].map((ns) => readFileSync(here(`../app/src/i18n/ns/${ns}.en.ts`), 'utf8')).join('\n');

test('linux.sh and pair-check.mjs refuse to run without their arguments', () => {
  const sh = spawnSync('bash', [here('./desktop-check/linux.sh')], { encoding: 'utf8' });
  assert.equal(sh.status, 2);
  assert.match(sh.stderr, /usage: linux\.sh --appimage FILE --hermes-home DIR/);
  const js = spawnSync(process.execPath, [here('./desktop-check/pair-check.mjs')], { encoding: 'utf8' });
  assert.notEqual(js.status, 0);
});

test('every label the desktop pairing check clicks or waits for is an English UI string of the app', () => {
  const used = new Set();
  for (const m of driver.matchAll(/(?:click|find)\('([^']+)'/g)) used.add(m[1]);
  for (const m of driver.matchAll(/x\.includes\('([^']+)'\)/g)) used.add(m[1]);
  for (const label of ['Connect', 'How is your Hermes set up?', 'I have a QR code or link', 'Use link', 'Check the connection', 'Got it, continue', 'All set', 'Start an empty chat']) {
    assert.ok(used.has(label), `driver no longer uses "${label}" (update this list)`);
  }
  used.delete('://pair?u='); // placeholder, checked below
  for (const label of used) assert.ok(en.includes(`'${label}'`), `"${label}" is not an English UI string any more`);
  // the paste field is found by its placeholder `{scheme}://pair?u=…`
  assert.match(en, /pastePlaceholder: '\{scheme\}:\/\/pair\?u=…'/);
  assert.ok(driver.includes("'://pair?u='"));
});

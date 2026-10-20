import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brand, brandVars, shareWordmark } from './brand.ts';
import { PAIR_SCHEMES, pairScheme } from './flavor.ts';

const ID = JSON.parse(readFileSync(new URL('../brand/identity.json', import.meta.url), 'utf8'));

test('official brand mirrors app/brand/identity.json', () => {
  const b = brand('hermes');
  assert.equal(b.name, ID.name);
  assert.equal(b.shortName, ID.shortName);
  assert.equal(b.displayName, ID.displayName);
  assert.equal(brandVars('hermes').appShort, ID.displayName);
  assert.equal(b.bridgeName, ID.bridgeName);
  assert.equal(b.scheme, ID.scheme);
  assert.equal(b.homepage, ID.homepage);
  assert.equal(b.repoUrl, ID.repoUrl);
  assert.equal(b.privacyUrl, ID.privacyUrl);
  assert.equal(b.supportEmail, ID.supportEmail);
  assert.match(String(b.supportEmail), /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  for (const u of [b.homepage, b.repoUrl, b.privacyUrl]) assert.ok(u === null || /^https:\/\//.test(u), String(u));
  assert.equal(pairScheme('hermes'), ID.scheme);
  assert.deepEqual([...PAIR_SCHEMES], [ID.scheme, ...ID.legacySchemes]);
  assert.ok(ID.displayName.length <= 12, 'home-screen label must fit under an icon');
  assert.ok(ID.storeName.startsWith(ID.displayName), 'store name starts with the on-device name (App Store 2.3.8)');
  assert.equal(shareWordmark('hermes'), ID.displayName);
});

test('personal flavor keeps its wording', () => {
  assert.equal(brand('personal').name, 'Hermes UI');
  assert.equal(pairScheme('personal'), 'hermesui');
  assert.equal(shareWordmark('personal'), 'Hermes');
  assert.deepEqual(Object.keys(brandVars('personal')).sort(), ['app', 'appShort', 'bridge', 'scheme']);
});


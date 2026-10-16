/// <reference types="node" />
// app/plugins/withShareTarget.js: which shares Android offers to HUI+, and the iOS extension switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { classifyFile, normalizeMime } from '../attachments/mime.ts';

const require = createRequire(import.meta.url);
const plugin = require('../../plugins/withShareTarget.js') as ((config: Record<string, unknown>) => Record<string, unknown>) & {
  shareIntentParams(env?: Record<string, string | undefined>): {
    androidIntentFilters: string[];
    androidMultiIntentFilters: string[];
    androidMainActivityAttributes: Record<string, string>;
    disableIOS: boolean;
  };
  SHARE_MIME_TYPES: string[];
};
const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')).expo;

test('Android filters: text, images, PDF and the document types the attachment path takes, nothing it refuses', () => {
  const p = plugin.shareIntentParams({});
  for (const t of ['text/*', 'image/*', 'application/pdf']) {
    assert.ok(p.androidIntentFilters.includes(t), t);
    assert.ok(p.androidMultiIntentFilters.includes(t), t);
  }
  assert.ok(!p.androidIntentFilters.some((t) => t === '*/*' || t.startsWith('video/') || t.includes('octet-stream')));
  // every concrete type is one classifyFile accepts (wildcards: a representative)
  for (const t of plugin.SHARE_MIME_TYPES) {
    const concrete = t === 'text/*' ? 'text/plain' : t === 'image/*' ? 'image/png' : t;
    assert.ok(classifyFile(normalizeMime(concrete, '')), `${t} is not an accepted attachment type`);
  }
  assert.equal(p.androidMainActivityAttributes['android:launchMode'], 'singleTask');
});

test('iOS share extension: off by default, on only with HUI_IOS_SHARE_EXTENSION=1; no ids hardcoded', () => {
  assert.equal(plugin.shareIntentParams({}).disableIOS, true);
  assert.equal(plugin.shareIntentParams({ HUI_IOS_SHARE_EXTENSION: '0' }).disableIOS, true);
  assert.equal(plugin.shareIntentParams({ HUI_IOS_SHARE_EXTENSION: '1' }).disableIOS, false);
  const p = plugin.shareIntentParams({ HUI_IOS_SHARE_EXTENSION: '1' }) as Record<string, unknown>;
  // bundle id / app group derive from the flavor's bundle id (expo-share-intent: <id>.share-extension, group.<id>)
  assert.equal(p.iosAppGroupIdentifier, undefined);
  assert.equal(p.iosShareExtensionBundleIdentifier, undefined);
});

test('app.json registers the plugin', () => {
  assert.ok((appJson.plugins as unknown[]).includes('./plugins/withShareTarget.js'));
});

test('the plugin applies to an Expo config (the library export is resolved, not called as a module object)', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const out = plugin({ _internal: { projectRoot: new URL('../..', import.meta.url).pathname }, name: 'x', slug: 'x', scheme: 'x', sdkVersion: '57.0.0', ios: { bundleIdentifier: 'com.example.x' }, android: { package: 'com.example.x' } });
    assert.equal(typeof out, 'object');
    assert.ok((out as { mods?: { android?: Record<string, unknown> } }).mods?.android?.manifest, 'Android manifest mod registered');
  } finally {
    console.warn = warn;
  }
});

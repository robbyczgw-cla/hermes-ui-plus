import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseBgService } from './bgService.ts';

const require = createRequire(import.meta.url);
const plugin = require('../../plugins/withBgService.js') as {
  removeBgService(m: unknown): any;
  bgServiceDisabled(env: Record<string, string | undefined>): boolean;
  BG_SERVICE_NAME: string;
  BG_SERVICE_PERMISSIONS: string[];
};

test('EXPO_PUBLIC_BG_SERVICE: only "0" switches the service off (default on)', () => {
  assert.equal(parseBgService(undefined), true);
  assert.equal(parseBgService(''), true);
  assert.equal(parseBgService('1'), true);
  assert.equal(parseBgService(' 0 '), false);
  assert.equal(plugin.bgServiceDisabled({}), false);
  assert.equal(plugin.bgServiceDisabled({ EXPO_PUBLIC_BG_SERVICE: '1' }), false);
  assert.equal(plugin.bgServiceDisabled({ EXPO_PUBLIC_BG_SERVICE: '0' }), true);
});

test('config plugin removes the keep-alive service and FGS permissions from the merged manifest (idempotent)', () => {
  const manifest = {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [{ $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } }, { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } }],
      application: [{ $: { 'android:name': '.MainApplication' }, service: [{ $: { 'android:name': 'other.Service' } }] }],
    },
  };
  const once = plugin.removeBgService(manifest);
  const twice = plugin.removeBgService(JSON.parse(JSON.stringify(once)));
  for (const out of [once, twice]) {
    const m = out.manifest;
    assert.equal(m.$['xmlns:tools'], 'http://schemas.android.com/tools');
    const perms = m['uses-permission'].map((p: { $: Record<string, string> }) => p.$);
    assert.deepEqual(perms[0], { 'android:name': 'android.permission.POST_NOTIFICATIONS' });
    for (const name of plugin.BG_SERVICE_PERMISSIONS) {
      assert.deepEqual(perms.filter((p: Record<string, string>) => p['android:name'] === name), [{ 'android:name': name, 'tools:node': 'remove' }]);
    }
    const services = m.application[0].service.map((s: { $: Record<string, string> }) => s.$);
    assert.deepEqual(services, [{ 'android:name': 'other.Service' }, { 'android:name': plugin.BG_SERVICE_NAME, 'tools:node': 'remove' }]);
  }
});

test('plugin names match the stream-keepalive module manifest', () => {
  const xml = readFileSync(new URL('../../modules/stream-keepalive/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.ok(xml.includes(`android:name="${plugin.BG_SERVICE_NAME}"`));
  for (const p of plugin.BG_SERVICE_PERMISSIONS) assert.ok(xml.includes(`android:name="${p}"`), p);
});

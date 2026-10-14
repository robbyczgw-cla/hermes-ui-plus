// Expo config plugin: build-time switch for the Android "finish answers in the background" foreground service
// (modules/stream-keepalive, type dataSync).
//
//   EXPO_PUBLIC_BG_SERVICE=0  → the merged manifest drops the service and its FGS permissions
//                              (tools:node="remove"), so a store build declares no foreground service at all.
//                              The JS side (src/background/bgService.ts) treats the module as absent; Hermes
//                              turns still finish on the server and the app recovers them via the bridge.
//   unset / anything else     → no change (default for GitHub builds: the service stays).
//
// Pure transform `removeBgService` is unit-tested (src/background/bgService.test.ts). See docs/STORE.md.
const SERVICE = 'ai.hermes.streamkeepalive.StreamKeepAliveService';
const PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_DATA_SYNC'];

function bgServiceDisabled(env = process.env) {
  return String(env.EXPO_PUBLIC_BG_SERVICE ?? '').trim() === '0';
}

/** Adds `tools:node="remove"` entries for the keep-alive service and its permissions (idempotent). */
function removeBgService(androidManifest) {
  const m = androidManifest.manifest;
  m.$ = { ...m.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  const perms = (m['uses-permission'] = (m['uses-permission'] ?? []).filter((p) => !PERMISSIONS.includes(p.$?.['android:name'])));
  for (const name of PERMISSIONS) perms.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  const app = (m.application ?? [])[0];
  if (app) {
    const services = (app.service = (app.service ?? []).filter((s) => s.$?.['android:name'] !== SERVICE));
    services.push({ $: { 'android:name': SERVICE, 'tools:node': 'remove' } });
  }
  return androidManifest;
}

function withBgService(config) {
  if (!bgServiceDisabled()) return config;
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (c) => {
    c.modResults = removeBgService(c.modResults);
    return c;
  });
}

module.exports = withBgService;
module.exports.removeBgService = removeBgService;
module.exports.bgServiceDisabled = bgServiceDisabled;
module.exports.BG_SERVICE_NAME = SERVICE;
module.exports.BG_SERVICE_PERMISSIONS = PERMISSIONS;

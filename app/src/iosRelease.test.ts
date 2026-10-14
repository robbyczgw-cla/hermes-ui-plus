// iOS release config (docs/IOS.md "Release config"): app/plugins/withIosRelease.js helpers and the app.json
// invariants App Store review depends on (export compliance, privacy manifest, usage strings de/en, iPad, push).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const plugin = require('../plugins/withIosRelease.js') as {
  iosMarketingVersion(v: string): string;
  iosBuildNumber(env: string | undefined, configured: string | undefined): string;
  apsEnvironment(env: string | undefined): string | null;
  colorSetContents(light: string, dark: string): any;
  patchStoryboard(xml: string, light: string): string;
  COLOR_NAME: string;
};
const APP = join(import.meta.dirname, '..');
const appJson = JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8')).expo;
const brand = JSON.parse(readFileSync(join(APP, 'brand', 'identity.json'), 'utf8'));
const pluginOpts = (name: string): any =>
  ((appJson.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === name) as [string, any] | undefined)?.[1];

test('ios version: numeric marketing version from the pre-release app version', () => {
  assert.equal(plugin.iosMarketingVersion('0.1.0-alpha.1'), '0.1.0');
  assert.equal(plugin.iosMarketingVersion('1.2.3+build.5'), '1.2.3');
  assert.equal(plugin.iosMarketingVersion('2'), '2');
  assert.equal(plugin.iosMarketingVersion('1.02'), '1.2');
  assert.throws(() => plugin.iosMarketingVersion('alpha'), /numeric/);
  assert.throws(() => plugin.iosMarketingVersion('1.2.3.4'), /numeric/);
  assert.equal(plugin.iosMarketingVersion(appJson.version), '0.1.0');
});

test('ios build number: env override, else configured, validated', () => {
  assert.equal(plugin.iosBuildNumber(undefined, '1'), '1');
  assert.equal(plugin.iosBuildNumber('42', '1'), '42');
  assert.equal(plugin.iosBuildNumber(' ', '3'), '3');
  assert.throws(() => plugin.iosBuildNumber('4a', '1'), /integers/);
  assert.equal(plugin.apsEnvironment(undefined), null);
  assert.equal(plugin.apsEnvironment('production'), 'production');
  assert.throws(() => plugin.apsEnvironment('prod'), /HUI_APS_ENV/);
});

const STORYBOARD = `<document><scenes><scene><objects><viewController><view key="view" id="EXPO-ContainerView">
                        <color key="backgroundColor" systemColor="systemBackgroundColor"/>
                    </view></viewController></objects></scene></scenes>
    <resources>
        <image name="SplashScreenLogo" width="100" height="90"/>
    </resources>
</document>`;

test('launch screen: storyboard uses the brand color set (paper light, ink dark), idempotent', () => {
  const out = plugin.patchStoryboard(STORYBOARD, brand.colors.paper);
  assert.match(out, new RegExp(`<color key="backgroundColor" name="${plugin.COLOR_NAME}"/>`));
  assert.match(out, new RegExp(`<namedColor name="${plugin.COLOR_NAME}">`));
  assert.doesNotMatch(out, /systemBackgroundColor/);
  assert.equal(plugin.patchStoryboard(out, brand.colors.paper), out);
  assert.throws(() => plugin.patchStoryboard('<document/>', brand.colors.paper), /unexpected SplashScreen/);
  const set = plugin.colorSetContents(brand.colors.paper, brand.colors.ink);
  assert.equal(set.colors.length, 2);
  assert.deepEqual(set.colors[1].appearances, [{ appearance: 'luminosity', value: 'dark' }]);
  assert.equal(set.colors[1].color.components.red, (0x0f / 255).toFixed(3));
});

test('app.json: export compliance, deployment target, iPad multitasking, plugin registered', () => {
  assert.equal(appJson.ios.config.usesNonExemptEncryption, false);
  assert.equal(appJson.ios.deploymentTarget, '26.0');
  assert.equal(appJson.ios.supportsTablet, true);
  assert.notEqual(appJson.ios.requireFullScreen, true, 'iPad multitasking needs all orientations, not full screen');
  assert.ok(appJson.plugins.includes('./plugins/withIosRelease.js'));
  assert.ok(appJson.plugins.indexOf('./plugins/withIosRelease.js') > appJson.plugins.findIndex((p: unknown) => Array.isArray(p) && p[0] === 'expo-notifications'));
});

test('app.json: no background modes (push = alert only, TTS stops in the background)', () => {
  assert.equal(appJson.ios.infoPlist.UIBackgroundModes, undefined);
  assert.equal(pluginOpts('expo-audio').enableBackgroundPlayback, false);
  assert.equal(pluginOpts('expo-audio').enableBackgroundRecording, false);
  assert.notEqual(pluginOpts('expo-notifications')?.enableBackgroundRemoteNotifications, true);
});

test('privacy manifest: no tracking, no collected data, required-reason APIs of the native deps', () => {
  const pm = appJson.ios.privacyManifests;
  assert.equal(pm.NSPrivacyTracking, false);
  assert.deepEqual(pm.NSPrivacyTrackingDomains, []);
  assert.deepEqual(pm.NSPrivacyCollectedDataTypes, [], 'PRIVACY.md / docs/IOS.md: Data Not Collected');
  const reasons = Object.fromEntries(
    (pm.NSPrivacyAccessedAPITypes as { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] }[]).map((t) => [
      t.NSPrivacyAccessedAPIType.replace('NSPrivacyAccessedAPICategory', ''),
      t.NSPrivacyAccessedAPITypeReasons,
    ]),
  );
  // union of the PrivacyInfo.xcprivacy files of react-native, expo-*, async-storage (docs/IOS.md lists them)
  const need: Record<string, string[]> = {
    UserDefaults: ['CA92.1'],
    FileTimestamp: ['C617.1', '0A2A.1', '3B52.1'],
    DiskSpace: ['E174.1', '85F4.1'],
    SystemBootTime: ['35F9.1'],
  };
  for (const [api, rs] of Object.entries(need)) for (const r of rs) assert.ok(reasons[api]?.includes(r), `${api} ${r}`);
});

test('usage strings: same keys in German and English, every permission the plugins request is explained', () => {
  const de = JSON.parse(readFileSync(join(APP, appJson.locales.de), 'utf8')).ios;
  const en = JSON.parse(readFileSync(join(APP, appJson.locales.en), 'utf8')).ios;
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  for (const k of [
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSSpeechRecognitionUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSCalendarsFullAccessUsageDescription',
    'NSLocalNetworkUsageDescription',
  ]) {
    assert.ok(de[k]?.length > 20 && en[k]?.length > 20, k);
    assert.ok(de[k].length <= 160 && en[k].length <= 160, `${k} short`);
  }
  // English base strings in app.json / plugin options must match the en locale (no drift)
  assert.equal(pluginOpts('expo-camera').cameraPermission, en.NSCameraUsageDescription);
  assert.equal(pluginOpts('expo-speech-recognition').microphonePermission, en.NSMicrophoneUsageDescription);
  assert.equal(pluginOpts('expo-speech-recognition').speechRecognitionPermission, en.NSSpeechRecognitionUsageDescription);
  assert.equal(pluginOpts('expo-image-picker').photosPermission, en.NSPhotoLibraryUsageDescription);
  assert.equal(appJson.ios.infoPlist.NSLocalNetworkUsageDescription, en.NSLocalNetworkUsageDescription);
});

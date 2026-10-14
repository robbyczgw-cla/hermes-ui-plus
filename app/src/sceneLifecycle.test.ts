// app/plugins/withSceneLifecycle.js: AppDelegate transform and Info.plist scene manifest are validated together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plugin = require('../plugins/withSceneLifecycle.js') as {
  patchAppDelegate(src: string): string;
  sceneManifestFor(src: string, existing: unknown): any;
  OUR_DELEGATE: string;
};

const TEMPLATE = `import Expo
@main
class AppDelegate: ExpoAppDelegate {
  override func application() -> Bool {
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
#endif
    return true
  }
}
`;
const delegateOf = (m: any) => m.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName;

test('scene plugin: old template is patched and gets our manifest (idempotent)', () => {
  const patched = plugin.patchAppDelegate(TEMPLATE);
  assert.match(patched, /class SceneDelegate: ExpoAppSceneDelegate \{\}/);
  assert.equal(plugin.patchAppDelegate(patched), patched);
  assert.equal(delegateOf(plugin.sceneManifestFor(TEMPLATE, undefined)), plugin.OUR_DELEGATE);
  // re-run on our own output keeps our manifest
  assert.equal(delegateOf(plugin.sceneManifestFor(patched, plugin.sceneManifestFor(TEMPLATE, undefined))), plugin.OUR_DELEGATE);
});

test('scene plugin: an upstream template that adopted scenes keeps its own manifest; none = clear error', () => {
  const upstream = 'class AppDelegate: ExpoAppDelegate {}\nclass MySceneDelegate: ExpoAppSceneDelegate {}\n';
  const theirs = { UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).MySceneDelegate' }] } };
  assert.equal(plugin.sceneManifestFor(upstream, theirs), theirs);
  assert.throws(() => plugin.sceneManifestFor(upstream, undefined), /adopted scenes/);
});

test('scene plugin: a conflicting existing manifest is not silently replaced', () => {
  const other = { UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneDelegateClassName: 'Other.Delegate' }] } };
  assert.throws(() => plugin.sceneManifestFor(TEMPLATE, other), /refusing to replace/);
});

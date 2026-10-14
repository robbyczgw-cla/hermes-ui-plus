// Config plugin: adopt the UIScene life cycle on iOS (required by the iOS 27 SDK: an app built with Xcode 27 that has
// no UIApplicationSceneManifest is terminated at launch with "UIScene life cycle is required for apps built with this
// SDK"). Expo SDK 57 ships the scene delegate (ExpoAppSceneDelegate in the `expo` pod), but its prebuild template
// (expo-template-bare-minimum 57.0.x) still starts React Native from the app delegate without a scene manifest.
// This plugin:
//  - AppDelegate.swift: conform to ExpoReactNativeFactoryProvider, stop creating the window / starting React Native in
//    didFinishLaunching (the scene delegate does that for the connecting UIWindowScene), add `SceneDelegate`;
//  - Info.plist: UIApplicationSceneManifest with one window scene (no multiple windows; iPad Split View / Slide Over /
//    Stage Manager resizing work with a single scene).
// Idempotent; fails the prebuild if the AppDelegate template changed in a way it does not recognise. Remove it once
// the Expo template adopts scenes itself (the plugin then leaves the files untouched).
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const START_RN = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function patchAppDelegate(src) {
  if (/ExpoAppSceneDelegate/.test(src)) return src; // template (or an earlier run) already adopted scenes
  if (!START_RN.test(src) || !/class AppDelegate: ExpoAppDelegate \{/.test(src)) {
    throw new Error('withSceneLifecycle: unexpected AppDelegate.swift template, update app/plugins/withSceneLifecycle.js');
  }
  return (
    src
      .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
      .replace(START_RN, '\n    // window + React Native start: SceneDelegate (UIScene life cycle, plugins/withSceneLifecycle.js)\n') +
    '\n// UIScene life cycle (iOS 27 SDK): creates the window for the scene and starts React Native in it.\n' +
    'class SceneDelegate: ExpoAppSceneDelegate {}\n'
  );
}

const OUR_DELEGATE = '$(PRODUCT_MODULE_NAME).SceneDelegate';
const OUR_CLASS = /\nclass SceneDelegate: ExpoAppSceneDelegate \{\}\n/;
const OUR_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: OUR_DELEGATE }],
  },
};

/** delegate class names of an Info.plist scene manifest (window role) */
function manifestDelegates(manifest) {
  const roles = manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
  return Array.isArray(roles) ? roles.map((r) => r?.UISceneDelegateClassName).filter(Boolean) : [];
}

/**
 * Info.plist scene manifest for the given (template) AppDelegate source, validated together with it:
 *  - our transform (or an earlier run of it): our manifest; an existing manifest naming another delegate = conflict
 *  - an upstream template that adopted scenes itself (ExpoAppSceneDelegate, but not our SceneDelegate class):
 *    keep its existing, valid manifest untouched; no manifest = error (we cannot know its delegate class)
 */
function sceneManifestFor(appDelegateSrc, existing) {
  const upstream = /ExpoAppSceneDelegate/.test(appDelegateSrc) && !OUR_CLASS.test(appDelegateSrc);
  const delegates = manifestDelegates(existing);
  if (upstream) {
    if (delegates.length) return existing;
    throw new Error('withSceneLifecycle: the AppDelegate template adopted scenes but Info.plist has no scene manifest; remove app/plugins/withSceneLifecycle.js or update it');
  }
  if (existing && delegates.some((d) => d !== OUR_DELEGATE)) {
    throw new Error(`withSceneLifecycle: Info.plist already has a scene manifest for ${delegates.join(', ')}; refusing to replace it with ${OUR_DELEGATE}`);
  }
  return OUR_MANIFEST;
}

/** template AppDelegate source as on disk (before our mod), for the Info.plist mod when it runs first */
function readAppDelegate(projectRoot) {
  try {
    const { IOSConfig } = require('expo/config-plugins');
    return IOSConfig.Paths.getAppDelegate(projectRoot).contents;
  } catch {
    return null;
  }
}

module.exports = function withSceneLifecycle(config) {
  let templateSrc = null; // the AppDelegate as the template provided it (before patchAppDelegate)
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('withSceneLifecycle: only the Swift AppDelegate is supported');
    templateSrc = c.modResults.contents;
    c.modResults.contents = patchAppDelegate(c.modResults.contents);
    return c;
  });
  return withInfoPlist(config, (c) => {
    const src = templateSrc ?? readAppDelegate(c.modRequest.projectRoot);
    if (src == null) throw new Error('withSceneLifecycle: cannot read AppDelegate.swift to validate the scene manifest');
    c.modResults.UIApplicationSceneManifest = sceneManifestFor(src, c.modResults.UIApplicationSceneManifest);
    return c;
  });
};
module.exports.patchAppDelegate = patchAppDelegate;
module.exports.sceneManifestFor = sceneManifestFor;
module.exports.OUR_DELEGATE = OUR_DELEGATE;

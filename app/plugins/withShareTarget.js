// Expo config plugin: "Share to HUI+" (docs/SHARE-TARGET.md) via expo-share-intent (+ app/patches for its Android
// module). Shared content opens the share sheet (src/share/); nothing is sent without the user's Send.
//
// Android: ACTION_SEND / ACTION_SEND_MULTIPLE intent filters on MainActivity for the types the attachment path takes
//          (src/attachments/mime.ts classifyFile: text, images, PDF, JSON / YAML / XML, docx / xlsx). No `*/*` and no
//          octet-stream: HUI+ must not show up for videos, archives or APKs it would refuse anyway.
// iOS:     the share extension target is built only with HUI_IOS_SHARE_EXTENSION=1. It needs its own App ID
//          (<bundle id>.share-extension) and the App Group group.<bundle id>; both derive from the flavor's bundle id
//          (app.config.ts), so hermes and personal never share them and no id is hardcoded here. The default stays
//          off because the local-signing path of scripts/build-ios.sh has no profile for the extension
//          (docs/SHARE-TARGET.md "iOS").
//
// Pure helper `shareIntentParams` is unit-tested (src/share/plugin.test.ts).
const SHARE_MIME_TYPES = [
  'text/*',
  'image/*',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function iosShareExtensionEnabled(env = process.env) {
  return String(env.HUI_IOS_SHARE_EXTENSION ?? '').trim() === '1';
}

/** expo-share-intent parameters for this app */
function shareIntentParams(env = process.env) {
  return {
    androidIntentFilters: SHARE_MIME_TYPES,
    androidMultiIntentFilters: SHARE_MIME_TYPES,
    // Expo's MainActivity is singleTask already; stated explicitly so a share reaches the running app (onNewIntent)
    androidMainActivityAttributes: { 'android:launchMode': 'singleTask' },
    disableIOS: !iosShareExtensionEnabled(env),
    // the extension only hands over; the sheet in the app does the rest
    iosActivationRules: {
      NSExtensionActivationSupportsText: true,
      NSExtensionActivationSupportsWebURLWithMaxCount: 1,
      NSExtensionActivationSupportsImageWithMaxCount: 10,
      NSExtensionActivationSupportsFileWithMaxCount: 10,
    },
  };
}

function withShareTarget(config) {
  // the library's plugin is an ES module default export compiled to CommonJS
  const mod = require('expo-share-intent/app.plugin.js');
  const withShareIntent = typeof mod === 'function' ? mod : mod.default;
  return withShareIntent(config, shareIntentParams());
}

module.exports = withShareTarget;
module.exports.shareIntentParams = shareIntentParams;
module.exports.SHARE_MIME_TYPES = SHARE_MIME_TYPES;

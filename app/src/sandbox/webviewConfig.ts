// Static, locked-down react-native-webview props for the sandbox frame (HtmlFrame.tsx).
// Pure, no RN runtime imports (runs under `node --test`, see webviewConfig.test.ts).
//
// Values must match the NATIVE prop types (RNCWebViewNativeComponent.ts codegen spec), not only
// the TS types: on Android (new architecture) the generated RNCWebViewManagerDelegate casts every
// prop blindly, and react-native-webview's Android wrapper passes props through unnormalized.
// `dataDetectorTypes="none"` (a string, which WebViewTypes allows and the iOS wrapper wraps into
// an array) therefore crashed the whole app with
//   ClassCastException: java.lang.String cannot be cast to com.facebook.react.bridge.ReadableArray
//   at RNCWebViewManagerDelegate.setProperty
// as soon as the first ```hui-html block mounted its WebView. Array-typed native props must be
// passed as arrays.
import type { WebViewProps } from 'react-native-webview';

/** Must match EVERYTHING: react-native-webview hands URLs that fail the whitelist straight to
 *  Linking.openURL (i.e. opens other apps) without asking onShouldStartLoadWithRequest. With
 *  '*' every navigation reaches our handler, which refuses all but the initial shell load. */
export const ORIGIN_WHITELIST: string[] = ['*'];

export const LOCKED_WEBVIEW_PROPS = {
  // --- navigation: nothing but the shell document may load
  originWhitelist: ORIGIN_WHITELIST,
  setSupportMultipleWindows: false,
  javaScriptCanOpenWindowsAutomatically: false,
  allowsBackForwardNavigationGestures: false,
  allowsLinkPreview: false,
  // iOS only (no-op on Android), but the native prop is an ARRAY on both platforms (see above).
  dataDetectorTypes: ['none'],
  // --- no file system, no persistent/shared storage, no cookies, no device APIs
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  domStorageEnabled: false,
  // NOT incognito (perf review P1-4): on Android it sets LOAD_NO_CACHE and calls clearCache(true) +
  // CookieManager.removeAllCookies() – app-wide, on every mount – so Leaflet, CDN libraries and map tiles were
  // downloaded again for every widget. Isolation does not depend on it: the document has an opaque origin
  // (no storage, no cookies of its own; storage shims are in-memory), DOM storage and third-party/shared cookies
  // are off. Trade-off (sandbox/README.md): the HTTP cache is shared app-wide, so a widget can tell whether a CDN
  // URL was loaded before (timing) and CDN/tile responses may persist in the WebView cache.
  incognito: false,
  cacheEnabled: true,
  cacheMode: 'LOAD_DEFAULT',
  thirdPartyCookiesEnabled: false,
  sharedCookiesEnabled: false,
  saveFormDataDisabled: true,
  geolocationEnabled: false,
  mediaCapturePermissionGrantType: 'deny',
  mediaPlaybackRequiresUserAction: true,
  allowsProtectedMedia: false,
  mixedContentMode: 'never',
  paymentRequestEnabled: false,
  javaScriptEnabled: true,
  // --- layout: height is driven from outside
  showsHorizontalScrollIndicator: false,
  bounces: false,
  overScrollMode: 'never',
  automaticallyAdjustContentInsets: false,
  contentInsetAdjustmentBehavior: 'never',
  setBuiltInZoomControls: false,
  setDisplayZoomControls: false,
  textZoom: 100,
} satisfies Partial<WebViewProps>;

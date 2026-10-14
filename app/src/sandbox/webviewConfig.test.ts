import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { LOCKED_WEBVIEW_PROPS } from './webviewConfig.ts';

// Codegen spec of the native component: the source of truth for the Android delegate's casts.
const require = createRequire(import.meta.url);
const SPEC = readFileSync(join(dirname(require.resolve('react-native-webview/package.json')), 'src/RNCWebViewNativeComponent.ts'), 'utf8');

/** Raw type text of `name?: <type>;` in the NativeProps spec (null: not a native prop, JS-only). */
function nativeType(name: string): string | null {
  const start = new RegExp(`\\n\\s+${name}\\??:\\s*`).exec(SPEC);
  if (!start) return null;
  let depth = 0;
  for (let i = start.index + start[0].length; i < SPEC.length; i++) {
    const ch = SPEC[i];
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) return SPEC.slice(start.index + start[0].length, i).replace(/\s+/g, ' ').trim();
  }
  return null;
}

function expectedKind(type: string): 'array' | 'boolean' | 'number' | 'string' | 'object' {
  if (/^(WithDefault<\s*)?ReadonlyArray</.test(type)) return 'array';
  if (/^(WithDefault<\s*)?boolean\b/.test(type)) return 'boolean';
  if (/^(WithDefault<\s*)?(Double|Float|Int32)\b/.test(type)) return 'number';
  if (/^(WithDefault<\s*)?(\|\s*)?(string\b|')/.test(type)) return 'string';
  return 'object';
}

test('spec parser finds the props it needs to (guards against a silently empty check)', () => {
  assert.match(nativeType('dataDetectorTypes') ?? '', /ReadonlyArray/);
  assert.equal(expectedKind(nativeType('incognito')!), 'boolean');
  assert.equal(expectedKind(nativeType('textZoom')!), 'number');
  assert.equal(expectedKind(nativeType('mixedContentMode')!), 'string');
});

// Regression: dataDetectorTypes="none" crashed the Android app (ClassCastException String ->
// ReadableArray in RNCWebViewManagerDelegate.setProperty) when a hui-html block mounted.
test('dataDetectorTypes is passed as an array', () => {
  assert.ok(Array.isArray(LOCKED_WEBVIEW_PROPS.dataDetectorTypes));
});

test('every locked prop has the JS type the native (codegen) prop expects', () => {
  let checked = 0;
  for (const [name, value] of Object.entries(LOCKED_WEBVIEW_PROPS)) {
    const type = nativeType(name);
    if (type == null) continue; // handled in the JS wrapper (e.g. originWhitelist)
    const kind = expectedKind(type);
    const actual = Array.isArray(value) ? 'array' : typeof value;
    assert.equal(actual, kind, `${name}: native type ${type}`);
    checked++;
  }
  assert.ok(checked >= 20, `only ${checked} props checked`);
});

test('security lockdown stays in place', () => {
  const p = LOCKED_WEBVIEW_PROPS;
  assert.deepEqual(p.originWhitelist, ['*']); // see webviewConfig.ts / README "Navigation"
  for (const k of ['allowFileAccess', 'allowFileAccessFromFileURLs', 'allowUniversalAccessFromFileURLs', 'domStorageEnabled', 'thirdPartyCookiesEnabled', 'sharedCookiesEnabled', 'geolocationEnabled', 'setSupportMultipleWindows', 'javaScriptCanOpenWindowsAutomatically', 'paymentRequestEnabled', 'allowsProtectedMedia'] as const) {
    assert.equal(p[k], false, k);
  }
  // perf review P1-4: no incognito (it wiped the WebView cache + all cookies app-wide on every mount); the cache is
  // on, isolation comes from the opaque origin + storage/cookie switches above (README "Threat model")
  assert.equal(p.incognito, false);
  assert.equal(p.cacheEnabled, true);
  assert.equal(p.cacheMode, 'LOAD_DEFAULT');
  assert.equal(p.saveFormDataDisabled, true);
  assert.equal(p.mixedContentMode, 'never');
  assert.equal(p.mediaCapturePermissionGrantType, 'deny');
});

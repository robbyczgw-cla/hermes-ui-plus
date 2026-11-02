/// <reference types="node" />
// Test harness (node:test): lets Node load the REAL answer components (.tsx: HuiView, MessageItem's SegmentView and
// everything below them) the way the web build runs them: `.tsx` transpiled on load, `react-native` →
// react-native-web, and forgiving stand-ins for the native-only packages (reanimated, svg, gesture handler, expo-*,
// …). Mounted into testkit/miniDom.ts by testkit/answerView.ts.
//
// Stand-ins: any export is a component that renders its children or a no-op function/hook; a few packages get
// specific ones below (svg keeps its <Text> labels and draws no shapes, reanimated's values are plain, gesture
// builders chain). Images are boxes (`data-stub="Image"`); web views draw nothing.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

type Obj = Record<string, unknown>;
const G = globalThis as unknown as { __huiWebStubs?: Record<string, Obj>; __huiWebHooks?: boolean; __DEV__?: boolean };

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(APP, 'src');
const require = createRequire(join(APP, 'package.json'));
const RNW = pathToFileURL(require.resolve('react-native-web')).href;

/** Native-only packages: replaced by stand-ins (see `stubModule`). `react-native` itself maps to react-native-web. */
const NATIVE = /^(expo($|[-/])|@expo\/|react-native-(reanimated|svg|gesture-handler|safe-area-context|webview|view-shot|screens|worklets)|@react-native-async-storage\/)/;

/** Named imports per stubbed package, collected from the app sources (ESM needs static export names). */
function importedNames(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const re = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+)?\s*from\s*'([^']+)'/g;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !f.includes('.test.')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(re)) {
          const spec = m[3];
          if (!NATIVE.test(spec)) continue;
          const set = out.get(spec) ?? new Set<string>();
          for (const part of (m[2] ?? '').split(',')) {
            const name = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) set.add(name);
          }
          out.set(spec, set);
        }
      }
    }
  };
  walk(SRC);
  return out;
}

export function installWebRenderHooks(): void {
  if (G.__huiWebHooks) return;
  G.__huiWebHooks = true;
  G.__DEV__ = false;
  const names = importedNames();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'react-native') return { url: RNW, shortCircuit: true };
      if (NATIVE.test(specifier)) return { url: `hui-web-stub:${specifier}`, shortCircuit: true };
      if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:') && context.parentURL.includes('/src/')) {
        const from = new URL(specifier, context.parentURL);
        const p = fileURLToPath(from);
        if (existsSync(p) && statSync(p).isFile()) return { url: from.href, shortCircuit: true };
        for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
          if (existsSync(p + suffix)) return { url: pathToFileURL(p + suffix).href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('hui-web-stub:')) {
        const spec = url.slice('hui-web-stub:'.length);
        const list = [...(names.get(spec) ?? [])].filter((n) => n !== 'default');
        const src =
          `const m = globalThis.__huiWebStub(${JSON.stringify(spec)});\n` +
          `export default m.default;\n` +
          list.map((k) => `export const ${k} = m[${JSON.stringify(k)}];`).join('\n');
        return { format: 'module', source: src, shortCircuit: true };
      }
      if (url.startsWith('file:') && url.endsWith('.tsx')) {
        const file = fileURLToPath(url);
        const out = ts.transpileModule(readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false, isolatedModules: true },
        }).outputText;
        return { format: 'module', source: out, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  (globalThis as unknown as { __huiWebStub: (s: string) => Obj }).__huiWebStub = stubModule;
}

/** A forgiving stand-in: any property is a component that renders its children, or a no-op function/hook. */
function stubModule(spec: string): Obj {
  const cached = (G.__huiWebStubs ??= {})[spec];
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  const RN = require('react-native-web') as Obj;
  const View = RN.View as never;
  const Text = RN.Text as never;
  const passthrough = (name: string) => {
    const C = (props: Obj) => React.createElement(View, { 'data-stub': name } as never, (props?.children as never) ?? null);
    C.displayName = name;
    return C;
  };
  const special: Obj = {};
  if (spec === 'react-native-svg') {
    // SVG text labels (chart axes, values) stay readable; shapes draw nothing
    for (const k of ['Svg', 'G', 'Defs', 'ClipPath', 'LinearGradient', 'RadialGradient', 'Mask', 'Pattern', 'Symbol', 'Use', 'ForeignObject']) special[k] = passthrough(k);
    for (const k of ['Text', 'TSpan', 'TextPath']) special[k] = (p: Obj) => React.createElement(Text, null, (p?.children as never) ?? null);
    for (const k of ['Path', 'Rect', 'Circle', 'Line', 'Polyline', 'Polygon', 'Ellipse', 'Stop', 'Image']) special[k] = () => null;
    special.default = special.Svg;
  }
  if (spec === 'react-native-reanimated') {
    const anim = { View, Text, ScrollView: RN.ScrollView, Image: RN.Image, createAnimatedComponent: (c: unknown) => c };
    Object.assign(special, {
      default: anim,
      useSharedValue: (v: unknown) => ({ value: v }),
      useAnimatedStyle: () => ({}),
      useAnimatedProps: () => ({}),
      useDerivedValue: (f: () => unknown) => ({ value: f() }),
      useAnimatedReaction: () => undefined,
      useReducedMotion: () => true,
      withTiming: (v: unknown) => v,
      withSpring: (v: unknown) => v,
      withRepeat: (v: unknown) => v,
      withSequence: (...v: unknown[]) => v[v.length - 1],
      withDelay: (_d: unknown, v: unknown) => v,
      cancelAnimation: () => undefined,
      runOnJS: (f: unknown) => f,
      interpolate: (_v: unknown, _i: unknown, o: number[]) => o?.[0] ?? 0,
      interpolateColor: (_v: unknown, _i: unknown, o: unknown[]) => o?.[0],
      Easing: new Proxy({}, { get: () => () => (t: unknown) => t }),
      // layout animation builders: FadeIn.duration(200).delay(50).reduceMotion(…) — every call returns the builder
      ...Object.fromEntries(['FadeIn', 'FadeOut', 'FadeInDown', 'FadeInUp', 'FadeOutUp', 'FadeOutDown', 'SlideInDown', 'SlideOutDown', 'SlideInRight', 'SlideOutLeft', 'ZoomIn', 'ZoomOut', 'LinearTransition', 'Layout', 'ReduceMotion'].map((k) => [k, builder()])),
    });
  }
  if (spec === 'react-native-gesture-handler') {
    // Gesture.Pan().minDistance(4).onStart(…) — chainable no-op builders; detectors render their child
    Object.assign(special, { Gesture: new Proxy({}, { get: () => () => builder() }), GestureDetector: passthrough('GestureDetector'), GestureHandlerRootView: passthrough('GestureHandlerRootView') });
  }
  if (spec === 'react-native-safe-area-context') {
    Object.assign(special, { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: passthrough('SafeAreaView'), SafeAreaProvider: passthrough('SafeAreaProvider') });
  }
  if (spec === 'expo-audio') Object.assign(special, { RecordingPresets: { HIGH_QUALITY: { android: {}, ios: {} }, LOW_QUALITY: { android: {}, ios: {} } }, AudioQuality: { HIGH: 96, LOW: 32, MEDIUM: 64, MAX: 127, MIN: 0 } });
  if (spec === 'expo-image') special.Image = (p: Obj) => React.createElement(View, { 'data-stub': 'Image', 'aria-label': (p?.accessibilityLabel ?? p?.alt) as never });
  if (spec === 'expo-localization') Object.assign(special, { useLocales: () => [], getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }], getCalendars: () => [{ timeZone: 'UTC' }] });
  if (spec === 'expo-constants') special.default = { expoConfig: { version: '0.0.0', extra: {} }, manifest: null };
  if (spec === 'expo-router') Object.assign(special, { useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }), router: { push: () => undefined }, useLocalSearchParams: () => ({}), Link: passthrough('Link') });
  const store = new Map<string, string>();
  if (spec === '@react-native-async-storage/async-storage') {
    special.default = { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => void store.set(k, v), removeItem: async (k: string) => void store.delete(k), multiGet: async (ks: string[]) => ks.map((k) => [k, store.get(k) ?? null]) };
  }
  const mod = new Proxy(special, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (k === 'default') return (t.default = new Proxy({}, { get: (_o, kk) => (typeof kk === 'string' ? stubValue(kk) : undefined) }));
      return (t[k] = stubValue(k));
    },
  });
  function stubValue(k: string): unknown {
    if (/^use[A-Z]/.test(k)) return () => undefined;
    if (/^[A-Z]/.test(k)) return passthrough(k);
    return () => undefined;
  }
  G.__huiWebStubs[spec] = mod as Obj;
  return mod as Obj;
}

/** A chainable no-op (reanimated's animation builders). */
function builder(): unknown {
  const fn: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : fn), apply: () => fn });
  return fn;
}

/// <reference types="node" />
// Test harness (node:test, type stripping): lets tests import the REAL app modules that pull in React Native /
// Expo packages (storage.ts, voice/*, i18n provider helpers, …) by replacing those packages with in-memory fakes.
//
//   const rn = installRnStubs();            // before the dynamic import
//   const { saveProfiles } = await import('../settings/storage.ts');
//
// The hook also resolves extensionless relative imports (`./migrate`) to .ts/.tsx like Metro does. Files with
// JSX (.tsx) cannot be loaded by Node; only import the non-UI modules.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Obj = Record<string, unknown>;
const G = globalThis as unknown as { __huiStubs?: Record<string, Obj>; __huiHooks?: boolean };

/** In-memory AsyncStorage / SecureStore with failure injection. */
export class MemoryKv {
  readonly data = new Map<string, string>();
  /** every call (op + key) in order */
  readonly log: string[] = [];
  /** return a message to make this call reject */
  failWhen: ((op: 'get' | 'set' | 'remove', key: string) => string | null) | null = null;
  /** optional delay gate: awaited before every call completes (for race tests) */
  gate: ((op: 'get' | 'set' | 'remove', key: string) => Promise<void> | null) | null = null;
  private async run<T>(op: 'get' | 'set' | 'remove', key: string, fn: () => T): Promise<T> {
    this.log.push(`${op}:${key}`);
    const g = this.gate?.(op, key);
    if (g) await g;
    const f = this.failWhen?.(op, key);
    if (f) throw new Error(f);
    return fn();
  }
  getItem = (k: string) => this.run('get', k, () => this.data.get(k) ?? null);
  setItem = (k: string, v: string) => this.run('set', k, () => void this.data.set(k, v));
  removeItem = (k: string) => this.run('remove', k, () => void this.data.delete(k));
  multiGet = (keys: readonly string[]) => Promise.all(keys.map(async (k) => [k, await this.getItem(k)] as [string, string | null]));
  // expo-secure-store flavour
  getItemAsync = this.getItem;
  setItemAsync = this.setItem;
  deleteItemAsync = this.removeItem;
  reset(): void {
    this.data.clear();
    this.log.length = 0;
    this.failWhen = null;
    this.gate = null;
  }
}

export type NetCall = { url: string; init: Record<string, unknown> };

export type RnStubs = {
  /** expo-audio player + expo-speech: what was played / spoken (finishes by itself one macrotask later) */
  played: string[];
  spoken: string[];
  /** requests made through `expo/fetch` and global fetch-like stubs */
  net: { calls: NetCall[]; handler: (url: string, init: Record<string, unknown>) => Promise<unknown> };
  asyncStorage: MemoryKv;
  secureStore: MemoryKv;
  platform: { OS: string };
  appStateListeners: Set<(s: string) => void>;
  /** native Expo modules by name (requireOptionalNativeModule), e.g. HuiSpeechAnalyzer */
  native: Record<string, unknown>;
  /** extra/overriding stub modules, by package name */
  modules: Record<string, Obj>;
  resetAll(): void;
};

let installed: RnStubs | null = null;

const STUBBED = new Set([
  'react-native',
  '@react-native-async-storage/async-storage',
  'expo-secure-store',
  'expo-audio',
  'expo-file-system',
  'expo-speech',
  'expo-speech-recognition',
  'expo',
  'expo-linking',
  'expo-localization',
  'expo-haptics',
]);

export function installRnStubs(extra: Record<string, Obj> = {}): RnStubs {
  if (installed) {
    Object.assign(installed.modules, extra);
    return installed;
  }
  const asyncStorage = new MemoryKv();
  const secureStore = new MemoryKv();
  const platform = { OS: 'ios' };
  const played: string[] = [];
  const spoken: string[] = [];
  const net: RnStubs['net'] = {
    calls: [],
    handler: async () => ({ ok: true, status: 200, text: async () => '', bytes: async () => new Uint8Array([1, 2, 3]), arrayBuffer: async () => new ArrayBuffer(3) }),
  };
  const native: Record<string, unknown> = {};
  const playerListeners = new Set<(st: unknown) => void>();
  const player = {
    pause: () => undefined,
    play: () => {
      setImmediate(() => {
        for (const l of Array.from(playerListeners)) l({ playing: true, duration: 1, currentTime: 1, didJustFinish: true, error: null });
      });
    },
    replace: (src: { uri: string }) => void played.push(src.uri),
    setPlaybackRate: () => undefined,
    addListener: (_e: string, fn: (st: unknown) => void) => {
      playerListeners.add(fn);
      return { remove: () => void playerListeners.delete(fn) };
    },
  };
  class FakeEntry {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri?: string })?.uri ?? '')).join('/');
    }
    create() {}
    write() {}
    delete() {}
  }
  const appStateListeners = new Set<(s: string) => void>();
  const modules: Record<string, Obj> = {
    'react-native': {
      Platform: platform,
      AppState: {
        addEventListener: (_e: string, fn: (s: string) => void) => {
          appStateListeners.add(fn);
          return { remove: () => void appStateListeners.delete(fn) };
        },
      },
      Linking: { openSettings: async () => undefined, openURL: async () => undefined },
      AccessibilityInfo: { announceForAccessibility: () => undefined },
    },
    '@react-native-async-storage/async-storage': { default: asyncStorage },
    'expo-secure-store': bind(secureStore),
    'expo-audio': {
      createAudioPlayer: () => player,
      setAudioModeAsync: async () => undefined,
      AudioQuality: { HIGH: 96 },
      RecordingPresets: { HIGH_QUALITY: { android: {}, ios: {} } },
      useAudioRecorder: () => ({}),
      getRecordingPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      requestRecordingPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    },
    'expo-file-system': { Directory: FakeEntry, File: FakeEntry, Paths: { cache: 'cache' }, UploadType: { BINARY_CONTENT: 0 } },
    'expo-speech': {
      maxSpeechInputLength: 4000,
      VoiceQuality: { Enhanced: 'Enhanced', Default: 'Default' },
      getAvailableVoicesAsync: async () => [],
      speak: (text: string, o: { onDone?: () => void }) => {
        spoken.push(text);
        setImmediate(() => o.onDone?.());
      },
      stop: async () => undefined,
    },
    'expo-speech-recognition': {},
    expo: {
      requireOptionalNativeModule: (name: string) => native[name] ?? null,
      fetch: (url: string, init: Record<string, unknown>) => {
        net.calls.push({ url, init });
        return net.handler(url, init);
      },
    },
    'expo-linking': {},
    'expo-localization': { useLocales: () => [] },
    'expo-haptics': {},
    ...extra,
  };
  G.__huiStubs = modules;
  // CommonJS-style lazy `require('expo-speech-recognition')` in ESM-loaded app code
  const g = globalThis as unknown as { require?: (n: string) => unknown };
  g.require ??= (n: string) => modules[n] ?? (() => { throw new Error(`Cannot find module ${n}`); })();
  if (!G.__huiHooks) {
    G.__huiHooks = true;
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const base = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
        if (STUBBED.has(specifier) || STUBBED.has(base)) return { url: `hui-stub:${base}`, shortCircuit: true };
        if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
          try {
            return nextResolve(specifier, context);
          } catch (e) {
            const from = new URL(specifier, context.parentURL);
            for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
              const cand = new URL(from.href + suffix);
              if (existsSync(fileURLToPath(cand))) return { url: pathToFileURL(fileURLToPath(cand)).href, shortCircuit: true };
            }
            throw e;
          }
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (!url.startsWith('hui-stub:')) return nextLoad(url, context);
        const name = url.slice('hui-stub:'.length);
        const mod = G.__huiStubs?.[name] ?? {};
        const names = Object.keys(mod).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
        const src =
          `const m = globalThis.__huiStubs[${JSON.stringify(name)}];\n` +
          `export default m.default ?? m;\n` +
          names.map((k) => `export const ${k} = m[${JSON.stringify(k)}];`).join('\n');
        return { format: 'module', source: src, shortCircuit: true };
      },
    });
  }
  installed = {
    played,
    spoken,
    net,
    native,
    asyncStorage,
    secureStore,
    platform,
    appStateListeners,
    modules,
    resetAll() {
      asyncStorage.reset();
      secureStore.reset();
      platform.OS = 'ios';
      played.length = 0;
      spoken.length = 0;
      net.calls.length = 0;
    },
  };
  return installed;
}

function bind(kv: MemoryKv): Obj {
  return {
    getItemAsync: kv.getItemAsync,
    setItemAsync: kv.setItemAsync,
    deleteItemAsync: kv.deleteItemAsync,
  };
}

/** A promise you resolve by hand (deterministic ordering instead of sleeps). */
export function deferred<T = void>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** Let pending microtasks / already-resolved promise chains run. */
export const flush = (n = 5): Promise<void> => (n <= 0 ? Promise.resolve() : new Promise<void>((r) => setImmediate(r)).then(() => flush(n - 1)));

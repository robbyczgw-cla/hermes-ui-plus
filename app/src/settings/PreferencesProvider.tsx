// React store for app preferences (`usePreferences()`), persisted in AsyncStorage (PREFS_KEY).
// Applies the theme-relevant ones app-wide through <HuiThemeProvider> and pushes the module-level switches
// (haptics, image loading, reduced motion for reanimated) on change.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { setImageLoadPolicy } from '../images/policy';
import { setUnknownImagePolicy } from '../images/trust';
import { setAnswerUiPrefs } from '../ui/lib/answerPrefs';
import { setImageSearchMode, setOwnImageConfig } from '../images/web';
import { loadImageKey } from './storage';
import { HuiThemeProvider, setHapticsEnabled } from '../ui';
import { useDesktopChrome } from '../desktop/chrome';
import {
  DEFAULT_PREFERENCES,
  LEGACY_APPEARANCE_KEY,
  LEGACY_TOOL_DETAILS_KEY,
  PREFS_KEY,
  migratePreferences,
  resetSection,
  serializePreferences,
  type PrefSection,
  type Preferences,
} from './preferences';

export type PreferencesApi = {
  prefs: Preferences;
  /** false until the stored value was read (first frame uses defaults) */
  loaded: boolean;
  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void;
  update(patch: Partial<Preferences>): void;
  reset(section: PrefSection): void;
};

const Ctx = createContext<PreferencesApi>({
  prefs: DEFAULT_PREFERENCES,
  loaded: false,
  set: () => {},
  update: () => {},
  reset: () => {},
});

/** All app preferences + setters. Outside the provider: defaults, setters are no-ops. */
export function usePreferences(): PreferencesApi {
  return useContext(Ctx);
}

/** Single preference value (convenience for components that need just one). */
export function usePreference<K extends keyof Preferences>(key: K): Preferences[K] {
  return useContext(Ctx).prefs[key];
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.multiGet([PREFS_KEY, LEGACY_APPEARANCE_KEY, LEGACY_TOOL_DETAILS_KEY])
      .then((rows) => {
        if (!alive) return;
        const get = (k: string) => rows.find((r) => r[0] === k)?.[1] ?? null;
        const { prefs: p, changed } = migratePreferences(get(PREFS_KEY), { appearance: get(LEGACY_APPEARANCE_KEY), toolDetails: get(LEGACY_TOOL_DETAILS_KEY) });
        // a change made before the read finished wins over the stored value
        if (!touched.current) setPrefs(p);
        if (changed && !touched.current) AsyncStorage.setItem(PREFS_KEY, serializePreferences(p)).catch(() => {});
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const commit = useCallback((fn: (p: Preferences) => Preferences) => {
    touched.current = true;
    setPrefs((cur) => {
      const next = fn(cur);
      if (next !== cur) AsyncStorage.setItem(PREFS_KEY, serializePreferences(next)).catch(() => {});
      return next;
    });
  }, []);

  const set = useCallback<PreferencesApi['set']>((key, value) => commit((p) => (p[key] === value ? p : { ...p, [key]: value })), [commit]);
  const update = useCallback((patch: Partial<Preferences>) => commit((p) => ({ ...p, ...patch })), [commit]);
  const reset = useCallback((section: PrefSection) => commit((p) => resetSection(p, section)), [commit]);

  // module-level switches (non-React callers: haptic(), image resolver)
  useEffect(() => setHapticsEnabled(prefs.haptics), [prefs.haptics]);
  useEffect(() => setImageLoadPolicy(prefs.imageLoading), [prefs.imageLoading]);
  useEffect(() => setUnknownImagePolicy(prefs.unknownImages), [prefs.unknownImages]);
  useEffect(() => setImageSearchMode(prefs.imageSearch), [prefs.imageSearch]);
  // "Antworten" switches the ui/ layer needs (summary card, sources numbering, stats count-up)
  const answerSummary = prefs['answers.summary'];
  const answerFootnotes = prefs['answers.footnotes'];
  const answerMotion = prefs['answers.motion'];
  useEffect(() => setAnswerUiPrefs({ summary: answerSummary, footnotes: answerFootnotes, motion: answerMotion }), [answerSummary, answerFootnotes, answerMotion]);
  // own image-search key of the selected provider (secure storage) → resolver
  useEffect(() => {
    let alive = true;
    loadImageKey(prefs.imageProvider).then((key) => alive && setOwnImageConfig(key ? { provider: prefs.imageProvider, key } : null));
    return () => {
      alive = false;
    };
  }, [prefs.imageProvider]);

  const value = useMemo<PreferencesApi>(() => ({ prefs, loaded, set, update, reset }), [prefs, loaded, set, update, reset]);
  // accent "Wie macOS" (desktop app): the system accent color, live from desktop/chrome.ts
  const systemAccent = useDesktopChrome().accent;

  return (
    <Ctx.Provider value={value}>
      {/* reanimated animations (withTiming/withSpring/layout) follow the app override; 'system' needs no config */}
      {prefs.reduceMotion !== 'system' ? <ReducedMotionConfig mode={prefs.reduceMotion === 'on' ? ReduceMotion.Always : ReduceMotion.Never} /> : null}
      <HuiThemeProvider
        scheme={prefs.themeMode === 'system' ? null : prefs.themeMode}
        family={prefs.themeFamily}
        accent={prefs.accent === 'system' ? (systemAccent ?? 'theme') : prefs.accent}
        fontSize={prefs.fontSize}
        density={prefs.density}
        reduceMotion={prefs.reduceMotion}
      >
        {children}
      </HuiThemeProvider>
    </Ctx.Provider>
  );
}

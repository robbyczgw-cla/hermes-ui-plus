// Language selection state behind <I18nProvider/> (pure: storage, device locales and the lazy dictionary loader are
// injected, so it is tested with the real core.ts logic, langController.test.ts).
//
// - hydration (stored setting) never overwrites a choice the user made while the read was running (finding 7);
// - a dictionary chunk that fails to load (offline first use of en/es) is reported (`failed`) and can be retried
//   explicitly: `retry()`, or choosing the already-selected language again (finding 8). German stays visible meanwhile.
import { isLangSetting, LANG_STORAGE_KEY, resolveLocale, type Lang, type LangSetting } from './core.ts';

export type Shown = { lang: Lang; locale: string };
export type LangState = {
  setting: LangSetting;
  /** language the UI renders in; null until the first dictionary is ready (render nothing, no German flash) */
  shown: Shown | null;
  /** the wanted language's dictionary could not be loaded; `shown` is the previous / German fallback */
  failed: boolean;
};

export type LangDeps = {
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
  deviceTags(): readonly string[];
  hasDictionary(lang: Lang): boolean;
  loadDictionary(lang: Lang): Promise<void>;
};

export type LangController = {
  getState(): LangState;
  subscribe(fn: () => void): () => void;
  /** read the stored setting (once) */
  hydrate(): Promise<void>;
  setSetting(s: LangSetting): void;
  /** device locales changed (setting 'system') */
  refresh(): void;
  /** load the wanted dictionary again after a failure */
  retry(): void;
};

export function createLangController(deps: LangDeps): LangController {
  const wantedNow = (setting: LangSetting) => resolveLocale(setting, deps.deviceTags());
  const initial = wantedNow('system');
  let state: LangState = { setting: 'system', shown: deps.hasDictionary(initial.lang) ? initial : null, failed: false };
  let userChanged = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  const set = (next: Partial<LangState>) => {
    state = { ...state, ...next };
    for (const l of Array.from(listeners)) l();
  };

  /** show the wanted language as soon as its dictionary is there; the newest request wins */
  const apply = () => {
    const my = ++generation;
    const wanted = wantedNow(state.setting);
    if (deps.hasDictionary(wanted.lang)) {
      const cur = state.shown;
      set({ failed: false, shown: cur && cur.lang === wanted.lang && cur.locale === wanted.locale ? cur : wanted });
      return;
    }
    deps.loadDictionary(wanted.lang).then(
      () => {
        if (my === generation) set({ failed: false, shown: wanted });
      },
      () => {
        // chunk failed (offline): keep what is shown, fall back to German on a first start rather than a blank app
        if (my === generation) set({ failed: true, shown: state.shown ?? { lang: 'de', locale: 'de-DE' } });
      },
    );
  };
  apply();

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async hydrate() {
      const v = await deps.storage.getItem(LANG_STORAGE_KEY).catch(() => null);
      if (userChanged || !isLangSetting(v) || v === state.setting) return; // a choice made meanwhile wins
      set({ setting: v });
      apply();
    },
    setSetting(s) {
      userChanged = true;
      const changed = s !== state.setting;
      set({ setting: s });
      deps.storage.setItem(LANG_STORAGE_KEY, s).catch(() => undefined);
      if (changed || state.failed) apply();
    },
    refresh: apply,
    retry: apply,
  };
}

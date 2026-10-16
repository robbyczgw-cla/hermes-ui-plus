import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocales } from 'expo-localization';
import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  applyDocumentLang,
  formatDate as fmtDate,
  formatNumber as fmtNumber,
  formatRelative as fmtRelative,
  hasDictionary,
  loadDictionary,
  makeT,
  type Lang,
  type LangSetting,
  type TFn,
} from './core.ts';
import { createLangController } from './langController.ts';

type Ctx = {
  t: TFn;
  lang: Lang;
  locale: string;
  setting: LangSetting;
  setSetting: (s: LangSetting) => void;
  /** the selected language's dictionary could not be loaded (offline); `lang` is then the previous / German one */
  langFailed: boolean;
  /** try to load the selected language again */
  retryLanguage: () => void;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  formatDate: (d: Date | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatRelative: (d: Date | number, now?: Date | number) => string;
};

function build(lang: Lang, locale: string, setting: LangSetting, setSetting: (s: LangSetting) => void, langFailed = false, retryLanguage: () => void = () => {}): Ctx {
  return {
    t: makeT(lang, locale),
    lang,
    locale,
    setting,
    setSetting,
    langFailed,
    retryLanguage,
    formatNumber: (n, o) => fmtNumber(locale, n, o),
    formatDate: (d, o) => fmtDate(locale, d, o),
    formatRelative: (d, now) => fmtRelative(locale, d, now),
  };
}

// Outside a provider: German, so existing code keeps working.
const fallback: Ctx = build('de', 'de-DE', 'de', () => {});
const I18nContext = createContext<Ctx>(fallback);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const deviceTags = useLocales().map((l) => l.languageTag);
  const tagsRef = useRef(deviceTags);
  tagsRef.current = deviceTags;
  const tagsKey = deviceTags.join('|');
  // setting, stored-value hydration and lazy en/es dictionaries live in langController.ts (tested there)
  const ctl = useMemo(
    () => createLangController({ storage: AsyncStorage, deviceTags: () => tagsRef.current, hasDictionary, loadDictionary }),
    [],
  );
  useEffect(() => {
    void ctl.hydrate();
  }, [ctl]);
  useEffect(() => ctl.refresh(), [ctl, tagsKey]);
  const st = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);

  const shownLang = st.shown?.lang;
  useEffect(() => {
    if (shownLang) applyDocumentLang(typeof document === 'undefined' ? undefined : document, shownLang);
  }, [shownLang]);

  const value = useMemo(
    () => (st.shown ? build(st.shown.lang, st.shown.locale, st.setting, ctl.setSetting, st.failed, ctl.retry) : null),
    [st, ctl],
  );
  if (!value) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
/** `const t = useT(); t('actions.send'); t('errors.unknown', { message })` */
export const useT = (): TFn => useContext(I18nContext).t;
/** BCP47 tag + Intl helpers for the active locale. */
export function useLocale() {
  const { locale, lang, formatNumber, formatDate, formatRelative } = useContext(I18nContext);
  return { locale, lang, formatNumber, formatDate, formatRelative };
}

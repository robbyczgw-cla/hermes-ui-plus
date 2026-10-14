/**
 * Language names + speech locales for the `translation` node. Own small map because
 * Intl.DisplayNames does not exist on the Hermes engine (see scripts/hermes-compat-check.mjs).
 * Pure (no React / RN imports) → node:test-able.
 */

export type UiLang = 'de' | 'en' | 'es';

type LangInfo = {
  /** names in the UI languages */
  de: string;
  en: string;
  es: string;
  /** the language's own name ("Español") – shown as a secondary label */
  native: string;
  /** default BCP47 tag for speech (device TTS voice lookup) */
  speech: string;
  rtl?: boolean;
};

export const LANGUAGES: Readonly<Record<string, LangInfo>> = {
  de: { de: 'Deutsch', en: 'German', es: 'Alemán', native: 'Deutsch', speech: 'de-DE' },
  en: { de: 'Englisch', en: 'English', es: 'Inglés', native: 'English', speech: 'en-US' },
  es: { de: 'Spanisch', en: 'Spanish', es: 'Español', native: 'Español', speech: 'es-ES' },
  fr: { de: 'Französisch', en: 'French', es: 'Francés', native: 'Français', speech: 'fr-FR' },
  it: { de: 'Italienisch', en: 'Italian', es: 'Italiano', native: 'Italiano', speech: 'it-IT' },
  pt: { de: 'Portugiesisch', en: 'Portuguese', es: 'Portugués', native: 'Português', speech: 'pt-PT' },
  nl: { de: 'Niederländisch', en: 'Dutch', es: 'Neerlandés', native: 'Nederlands', speech: 'nl-NL' },
  tr: { de: 'Türkisch', en: 'Turkish', es: 'Turco', native: 'Türkçe', speech: 'tr-TR' },
  pl: { de: 'Polnisch', en: 'Polish', es: 'Polaco', native: 'Polski', speech: 'pl-PL' },
  ru: { de: 'Russisch', en: 'Russian', es: 'Ruso', native: 'Русский', speech: 'ru-RU' },
  uk: { de: 'Ukrainisch', en: 'Ukrainian', es: 'Ucraniano', native: 'Українська', speech: 'uk-UA' },
  cs: { de: 'Tschechisch', en: 'Czech', es: 'Checo', native: 'Čeština', speech: 'cs-CZ' },
  sk: { de: 'Slowakisch', en: 'Slovak', es: 'Eslovaco', native: 'Slovenčina', speech: 'sk-SK' },
  hu: { de: 'Ungarisch', en: 'Hungarian', es: 'Húngaro', native: 'Magyar', speech: 'hu-HU' },
  ro: { de: 'Rumänisch', en: 'Romanian', es: 'Rumano', native: 'Română', speech: 'ro-RO' },
  hr: { de: 'Kroatisch', en: 'Croatian', es: 'Croata', native: 'Hrvatski', speech: 'hr-HR' },
  sr: { de: 'Serbisch', en: 'Serbian', es: 'Serbio', native: 'Српски', speech: 'sr-RS' },
  bg: { de: 'Bulgarisch', en: 'Bulgarian', es: 'Búlgaro', native: 'Български', speech: 'bg-BG' },
  el: { de: 'Griechisch', en: 'Greek', es: 'Griego', native: 'Ελληνικά', speech: 'el-GR' },
  sv: { de: 'Schwedisch', en: 'Swedish', es: 'Sueco', native: 'Svenska', speech: 'sv-SE' },
  da: { de: 'Dänisch', en: 'Danish', es: 'Danés', native: 'Dansk', speech: 'da-DK' },
  nb: { de: 'Norwegisch', en: 'Norwegian', es: 'Noruego', native: 'Norsk', speech: 'nb-NO' },
  fi: { de: 'Finnisch', en: 'Finnish', es: 'Finés', native: 'Suomi', speech: 'fi-FI' },
  ca: { de: 'Katalanisch', en: 'Catalan', es: 'Catalán', native: 'Català', speech: 'ca-ES' },
  eu: { de: 'Baskisch', en: 'Basque', es: 'Euskera', native: 'Euskara', speech: 'eu-ES' },
  gl: { de: 'Galicisch', en: 'Galician', es: 'Gallego', native: 'Galego', speech: 'gl-ES' },
  la: { de: 'Latein', en: 'Latin', es: 'Latín', native: 'Latina', speech: 'la' },
  ar: { de: 'Arabisch', en: 'Arabic', es: 'Árabe', native: 'العربية', speech: 'ar-SA', rtl: true },
  he: { de: 'Hebräisch', en: 'Hebrew', es: 'Hebreo', native: 'עברית', speech: 'he-IL', rtl: true },
  fa: { de: 'Persisch', en: 'Persian', es: 'Persa', native: 'فارسی', speech: 'fa-IR', rtl: true },
  ur: { de: 'Urdu', en: 'Urdu', es: 'Urdu', native: 'اردو', speech: 'ur-PK', rtl: true },
  hi: { de: 'Hindi', en: 'Hindi', es: 'Hindi', native: 'हिन्दी', speech: 'hi-IN' },
  zh: { de: 'Chinesisch', en: 'Chinese', es: 'Chino', native: '中文', speech: 'zh-CN' },
  ja: { de: 'Japanisch', en: 'Japanese', es: 'Japonés', native: '日本語', speech: 'ja-JP' },
  ko: { de: 'Koreanisch', en: 'Korean', es: 'Coreano', native: '한국어', speech: 'ko-KR' },
  vi: { de: 'Vietnamesisch', en: 'Vietnamese', es: 'Vietnamita', native: 'Tiếng Việt', speech: 'vi-VN' },
  th: { de: 'Thailändisch', en: 'Thai', es: 'Tailandés', native: 'ไทย', speech: 'th-TH' },
  id: { de: 'Indonesisch', en: 'Indonesian', es: 'Indonesio', native: 'Bahasa Indonesia', speech: 'id-ID' },
};

/** aliases → canonical base code */
const ALIASES: Readonly<Record<string, string>> = { no: 'nb', nn: 'nb', iw: 'he', in: 'id', ua: 'uk', gr: 'el', cz: 'cs', jp: 'ja', kr: 'ko', cn: 'zh', dk: 'da', se: 'sv' };

const REGIONS: Readonly<Record<string, Record<UiLang, string>>> = {
  DE: { de: 'Deutschland', en: 'Germany', es: 'Alemania' },
  AT: { de: 'Österreich', en: 'Austria', es: 'Austria' },
  CH: { de: 'Schweiz', en: 'Switzerland', es: 'Suiza' },
  US: { de: 'USA', en: 'US', es: 'EE. UU.' },
  GB: { de: 'UK', en: 'UK', es: 'Reino Unido' },
  AU: { de: 'Australien', en: 'Australia', es: 'Australia' },
  CA: { de: 'Kanada', en: 'Canada', es: 'Canadá' },
  ES: { de: 'Spanien', en: 'Spain', es: 'España' },
  MX: { de: 'Mexiko', en: 'Mexico', es: 'México' },
  AR: { de: 'Argentinien', en: 'Argentina', es: 'Argentina' },
  CO: { de: 'Kolumbien', en: 'Colombia', es: 'Colombia' },
  CL: { de: 'Chile', en: 'Chile', es: 'Chile' },
  BR: { de: 'Brasilien', en: 'Brazil', es: 'Brasil' },
  PT: { de: 'Portugal', en: 'Portugal', es: 'Portugal' },
  FR: { de: 'Frankreich', en: 'France', es: 'Francia' },
  BE: { de: 'Belgien', en: 'Belgium', es: 'Bélgica' },
  CN: { de: 'China', en: 'China', es: 'China' },
  TW: { de: 'Taiwan', en: 'Taiwan', es: 'Taiwán' },
  HK: { de: 'Hongkong', en: 'Hong Kong', es: 'Hong Kong' },
};

const SCRIPTS: Readonly<Record<string, Record<UiLang, string>>> = {
  Hant: { de: 'traditionell', en: 'Traditional', es: 'tradicional' },
  Hans: { de: 'vereinfacht', en: 'Simplified', es: 'simplificado' },
  Latn: { de: 'lateinisch', en: 'Latin', es: 'latino' },
  Cyrl: { de: 'kyrillisch', en: 'Cyrillic', es: 'cirílico' },
};

const UNKNOWN: Record<UiLang, string> = { de: 'Unbekannte Sprache', en: 'Unknown language', es: 'Idioma desconocido' };

export type ParsedLang = { base: string; script?: string; region?: string; raw: string };

/** "pt-BR" → {base:'pt', region:'BR'}; "zh_Hant_TW" → {base:'zh', script:'Hant', region:'TW'}; junk → base 'und'. */
export function parseLang(code: unknown): ParsedLang {
  const raw = typeof code === 'string' ? code.trim() : '';
  const parts = raw.split(/[-_]/).filter(Boolean);
  const b = (parts[0] ?? '').toLowerCase();
  if (!/^[a-z]{2,3}$/.test(b)) return { base: 'und', raw };
  const base = ALIASES[b] ?? b;
  let script: string | undefined;
  let region: string | undefined;
  for (const p of parts.slice(1)) {
    if (!script && /^[A-Za-z]{4}$/.test(p)) script = p[0].toUpperCase() + p.slice(1).toLowerCase();
    else if (!region && (/^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p))) region = p.toUpperCase();
  }
  return { base, ...(script ? { script } : {}), ...(region ? { region } : {}), raw };
}

export function isKnownLang(code: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, parseLang(code).base);
}

/**
 * Localized language label: "Spanisch", "Portugiesisch (Brasilien)", "Chinesisch (traditionell)".
 * Unknown codes → the code in upper case ("KA"); empty/'und' → "Unbekannte Sprache".
 */
export function languageName(code: unknown, ui: UiLang = 'de'): string {
  const p = parseLang(code);
  if (p.base === 'und') return UNKNOWN[ui];
  const info = Object.prototype.hasOwnProperty.call(LANGUAGES, p.base) ? LANGUAGES[p.base] : undefined;
  const name = info ? info[ui] : p.base.toUpperCase();
  const extra = [p.script ? SCRIPTS[p.script]?.[ui] ?? p.script : '', p.region ? REGIONS[p.region]?.[ui] ?? p.region : ''].filter(Boolean);
  return extra.length ? `${name} (${extra.join(', ')})` : name;
}

/** The language's own name ("Español"), or '' when unknown / identical to the localized name. */
export function nativeName(code: unknown, ui: UiLang = 'de'): string {
  const p = parseLang(code);
  const info = Object.prototype.hasOwnProperty.call(LANGUAGES, p.base) ? LANGUAGES[p.base] : undefined;
  if (!info || info.native === info[ui]) return '';
  return info.native;
}

/** BCP47 tag for the device voice: keeps an explicit region ("pt-BR"), else the default ("es" → "es-ES"). */
export function speechLocale(code: unknown): string {
  const p = parseLang(code);
  if (p.base === 'und') return '';
  if (p.base === 'zh') {
    if (p.region) return `zh-${p.region}`;
    if (p.script === 'Hant') return 'zh-TW';
    return 'zh-CN';
  }
  if (p.region && /^[A-Z]{2}$/.test(p.region)) return `${p.base}-${p.region}`;
  const info = Object.prototype.hasOwnProperty.call(LANGUAGES, p.base) ? LANGUAGES[p.base] : undefined;
  return info ? info.speech : p.base;
}

export function isRtl(code: unknown): boolean {
  const p = parseLang(code);
  return !!(Object.prototype.hasOwnProperty.call(LANGUAGES, p.base) && LANGUAGES[p.base].rtl);
}

/** Same base language? ("de" ≈ "de-AT") – used to pick a bridge voice for a text. */
export function sameLanguage(a: unknown, b: unknown): boolean {
  const pa = parseLang(a).base;
  return pa !== 'und' && pa === parseLang(b).base;
}

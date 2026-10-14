/**
 * Small pure helpers for the voice UI (format.test.ts): timer label, metering → level,
 * waveform history, dictation insertion, settings normalisation.
 */
import { DEFAULT_STT_API, DEFAULT_TTS_API, normalizeSttApi, normalizeTtsApi } from './apiCore.ts';
import type { SttLanguage, VoiceEngineChoice, VoiceSettings } from './types.ts';

/** 7_400 → "0:07", 65_000 → "1:05" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * expo-audio metering is dBFS on all platforms (iOS averagePower, Android 20·log10(maxAmplitude/32767),
 * web RMS), silence ≈ -160. Speech sits around -45 … -10 dB. Map to 0..1 with a gentle curve.
 */
export function meteringToLevel(db: number | null | undefined): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  const FLOOR = -55;
  const CEIL = -8;
  const x = Math.min(1, Math.max(0, (db - FLOOR) / (CEIL - FLOOR)));
  return Math.round(Math.pow(x, 1.4) * 1000) / 1000;
}

/** Append a level to a fixed-length history (oldest dropped). */
export function pushLevel(levels: readonly number[], level: number, max: number): number[] {
  const next = levels.length >= max ? levels.slice(levels.length - max + 1) : levels.slice();
  next.push(Math.min(1, Math.max(0, level)));
  return next;
}

/**
 * Insert dictated text into the composer text: at `selection` if given, else appended.
 * Adds a separating space where needed and returns the new caret position.
 */
export function insertDictation(current: string, dictated: string, selection?: { start: number; end: number }): { text: string; caret: number } {
  const d = dictated.trim();
  if (!d) return { text: current, caret: selection?.end ?? current.length };
  const start = selection ? Math.max(0, Math.min(selection.start, current.length)) : current.length;
  const end = selection ? Math.max(start, Math.min(selection.end, current.length)) : current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,!?;:)]/.test(after) ? ' ' : '';
  const text = `${before}${lead}${d}${trail}${after}`;
  return { text, caret: before.length + lead.length + d.length + trail.length };
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  ttsVoice: null,
  ttsRate: 1,
  autoRead: false,
  sttLanguage: 'auto',
  autoSend: false,
  sttEngine: 'auto',
  ttsEngine: 'auto',
  deviceVoice: null,
  sttApi: DEFAULT_STT_API,
  ttsApi: DEFAULT_TTS_API,
};

const ENGINES: readonly VoiceEngineChoice[] = ['auto', 'device', 'bridge', 'apikey'];
const engine = (v: unknown): VoiceEngineChoice => (ENGINES.includes(v as VoiceEngineChoice) ? (v as VoiceEngineChoice) : 'auto');

export const TTS_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const LANGS: readonly SttLanguage[] = ['auto', 'de', 'en', 'es'];

/** Parse persisted settings (unknown JSON) → complete, valid VoiceSettings. */
export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rate = typeof o.ttsRate === 'number' && Number.isFinite(o.ttsRate) ? Math.min(2, Math.max(0.5, o.ttsRate)) : DEFAULT_VOICE_SETTINGS.ttsRate;
  return {
    ttsVoice: typeof o.ttsVoice === 'string' && o.ttsVoice.trim() ? o.ttsVoice.trim() : null,
    ttsRate: Math.round(rate * 100) / 100,
    autoRead: o.autoRead === true,
    sttLanguage: LANGS.includes(o.sttLanguage as SttLanguage) ? (o.sttLanguage as SttLanguage) : 'auto',
    autoSend: o.autoSend === true,
    sttEngine: engine(o.sttEngine),
    ttsEngine: engine(o.ttsEngine),
    deviceVoice: typeof o.deviceVoice === 'string' && o.deviceVoice.trim() ? o.deviceVoice.trim() : null,
    sttApi: normalizeSttApi(o.sttApi),
    ttsApi: normalizeTtsApi(o.ttsApi),
  };
}

/** 1 → "1×", 1.25 → "1,25×" (de) / "1.25×" (en): decimal separator of the given locale. */
export function formatRate(rate: number, locale = 'de-DE'): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate)}×`;
}

// ── device voices (TTS voice picker, deviceTts.ts) ──────────────────────────────────────────────────────────

export type VoiceQualityLevel = 'default' | 'enhanced' | 'premium';

/** One installed TTS voice. `enhanced`: better than default (Enhanced or Premium). */
export type DeviceVoice = { id: string; name: string; lang: string; quality: VoiceQualityLevel; enhanced: boolean };

/** Raw voice from expo-speech, optionally corrected by the iOS native list (exact quality, novelty flag). */
export type RawVoice = { identifier: string; name?: string; language: string; quality: VoiceQualityLevel; novelty?: boolean };

const normLang = (l: string) => (l ?? '').toLowerCase().replace(/_/g, '-');
const QUALITY_ORDER: Record<VoiceQualityLevel, number> = { premium: 0, enhanced: 1, default: 2 };

/**
 * Voices for `locale`'s language (base match: 'de' → de-DE, de-AT …), without novelty voices (Bells, Bubbles …),
 * de-duplicated. Order: Premium/Enhanced before Default; within that the exact region first; then Premium before
 * Enhanced; then by name.
 */
export function rankDeviceVoices(raw: readonly RawVoice[], locale: string): DeviceVoice[] {
  const loc = normLang(locale);
  const base = loc.split('-')[0];
  const seen = new Set<string>();
  const out: DeviceVoice[] = [];
  for (const v of raw) {
    if (!v.identifier || v.novelty || seen.has(v.identifier) || normLang(v.language).split('-')[0] !== base) continue;
    seen.add(v.identifier);
    out.push({ id: v.identifier, name: v.name || v.identifier, lang: v.language, quality: v.quality, enhanced: v.quality !== 'default' });
  }
  const tier = (v: DeviceVoice) => (v.enhanced ? 0 : 2) + (normLang(v.lang) === loc ? 0 : 1);
  return out.sort((a, b) => tier(a) - tier(b) || QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality] || a.name.localeCompare(b.name));
}

/** "Automatisch (beste Stimme)": the best voice of the exact region, else the best of the language. */
export function bestDeviceVoice(ranked: readonly DeviceVoice[], locale: string): DeviceVoice | undefined {
  const loc = normLang(locale);
  return ranked.find((v) => normLang(v.lang) === loc) ?? ranked[0];
}

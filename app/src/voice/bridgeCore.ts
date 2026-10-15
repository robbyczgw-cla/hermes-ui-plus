/**
 * UI-bridge voice contract (pure, bridgeCore.test.ts). origin = profile baseUrl without trailing /v1.
 *
 *   GET  {origin}/bridge/voice/config → {stt:{provider,model}, tts:{provider,model,voices:[{id,name,lang,provider}],defaultVoice}}
 *   POST {origin}/bridge/stt   Bearer, raw audio body (real Content-Type), optional X-Language: de
 *                              → {text, language, durationMs, provider, model}
 *   POST {origin}/bridge/tts   Bearer, JSON {text, voice?, format:'mp3'} (≤ 4000 chars) → streamed audio/mpeg
 *   errors: {error:{message,type,code}}
 */
import type { TFn, TKey, Vars } from '../i18n/core.ts';
import { VoiceError } from './types.ts';
import type { SttLanguage, SttResult, TtsVoice, VoiceConfig, VoiceConn, VoiceErrorCode, VoiceErrorKey, VoiceOp } from './types.ts';

export function bridgeOrigin(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

export const voiceConfigUrl = (baseUrl: string) => `${bridgeOrigin(baseUrl)}/bridge/voice/config`;
export const sttUrl = (baseUrl: string) => `${bridgeOrigin(baseUrl)}/bridge/stt`;
export const ttsUrl = (baseUrl: string) => `${bridgeOrigin(baseUrl)}/bridge/tts`;

/** Structural subset of settings/profiles ConnectionProfile (kept local: no cross-module import). */
export type ProfileLike = { kind: string; baseUrl: string; apiKey: string; bridge?: boolean };

/** Voice needs the UI bridge: Hermes profiles with `bridge: true`. Claude-direct / Hermes-direct → null. */
export function voiceConnFromProfile(p: ProfileLike | null | undefined): VoiceConn | null {
  if (!p || p.kind !== 'hermes' || !p.bridge || !p.baseUrl.trim()) return null;
  return { baseUrl: p.baseUrl, apiKey: p.apiKey };
}

function auth(conn: VoiceConn): Record<string, string> {
  return conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {};
}

export function configHeaders(conn: VoiceConn): Record<string, string> {
  return { ...auth(conn), Accept: 'application/json' };
}

/** Content-Type without parameters (`audio/webm;codecs=opus` → `audio/webm`). */
export function cleanMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

/** Best-effort audio mime for a recording file (expo-audio: .m4a on Android/iOS, webm on Chrome). */
export function recordingMime(uri: string, blobType?: string | null): string {
  const fromBlob = cleanMime(blobType);
  if (fromBlob.startsWith('audio/') || fromBlob.startsWith('video/')) return fromBlob.replace(/^video\//, 'audio/');
  const ext = (uri.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  switch (ext) {
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4';
    case '3gp':
      return 'audio/3gpp';
    case 'caf':
      return 'audio/x-caf';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'audio/mp4';
  }
}

export function sttHeaders(conn: VoiceConn, mime: string, language: SttLanguage): Record<string, string> {
  const h: Record<string, string> = { ...auth(conn), 'Content-Type': cleanMime(mime) || 'audio/mp4', Accept: 'application/json' };
  if (language !== 'auto') h['X-Language'] = language;
  return h;
}

export function ttsHeaders(conn: VoiceConn): Record<string, string> {
  return { ...auth(conn), 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
}

export function ttsBody(text: string, voice?: string | null): string {
  const b: { text: string; voice?: string; format: 'mp3' } = { text, format: 'mp3' };
  if (voice) b.voice = voice;
  return JSON.stringify(b);
}

// ── parsing ────────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function parseVoice(v: unknown): TtsVoice | null {
  if (typeof v === 'string' && v.trim()) return { id: v.trim(), name: v.trim(), lang: '', provider: '' };
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return { id, name: str(o.name) || id, lang: str(o.lang) || str(o.language), provider: str(o.provider) };
}

/** Tolerant parser for `GET /bridge/voice/config` (accepts a JSON string or an object). */
export function parseVoiceConfig(input: unknown): VoiceConfig {
  let j: unknown = input;
  if (typeof input === 'string') {
    try {
      j = JSON.parse(input);
    } catch {
      throw new VoiceError('bad_response', 'voice.errors.badConfigResponse');
    }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    throw new VoiceError('bad_response', 'voice.errors.badConfigResponse');
  }
  const o = j as Record<string, unknown>;
  // `available: false` = the bridge names its provider but has no key for it (POST answers *_not_configured):
  // same as no STT / TTS, so settings and the mic agree. Older bridges without the flag count as available.
  const part = (v: unknown) => (v && typeof v === 'object' && (v as Record<string, unknown>).available !== false ? (v as Record<string, unknown>) : null);
  const sttRaw = part(o.stt);
  const ttsRaw = part(o.tts);

  const stt = sttRaw && (str(sttRaw.provider) || str(sttRaw.model)) ? { provider: str(sttRaw.provider), model: str(sttRaw.model) } : null;

  let tts: VoiceConfig['tts'] = null;
  if (ttsRaw && (str(ttsRaw.provider) || str(ttsRaw.model) || Array.isArray(ttsRaw.voices))) {
    const seen = new Set<string>();
    const voices: TtsVoice[] = [];
    for (const v of Array.isArray(ttsRaw.voices) ? ttsRaw.voices : []) {
      const pv = parseVoice(v);
      if (pv && !seen.has(pv.id)) {
        seen.add(pv.id);
        voices.push(pv);
      }
    }
    const dv = str(ttsRaw.defaultVoice);
    tts = {
      provider: str(ttsRaw.provider),
      model: str(ttsRaw.model),
      voices,
      defaultVoice: dv && (voices.length === 0 || seen.has(dv)) ? dv : voices[0]?.id ?? null,
    };
  }
  return { stt, tts };
}

/** Effective voice: the saved one if the bridge still offers it, else the bridge default. */
export function resolveVoice(config: VoiceConfig | null, saved: string | null): string | null {
  const voices = config?.tts?.voices ?? [];
  if (saved && (voices.length === 0 || voices.some((v) => v.id === saved))) return saved;
  return config?.tts?.defaultVoice ?? null;
}

/** Sort for the picker: voices of the app language first (Spanish UI -> Spanish voices), then German, English, the rest; stable by name. */
export function sortVoices(voices: readonly TtsVoice[], appLang: 'de' | 'en' | 'es' = 'de'): TtsVoice[] {
  const is = (l: string, c: string) => l.toLowerCase().split(/[-_]/)[0] === c;
  const order = [appLang, ...(['de', 'en'] as const).filter((c) => c !== appLang)];
  const rank = (l: string) => {
    const i = order.findIndex((c) => is(l, c));
    return i >= 0 ? i : l ? order.length : order.length + 1;
  };
  return [...voices].sort((a, b) => rank(a.lang) - rank(b.lang) || a.name.localeCompare(b.name, appLang));
}

const LANGUAGE_KEYS: Record<string, TKey> = {
  de: 'voice.languages.de',
  en: 'voice.languages.en',
  fr: 'voice.languages.fr',
  es: 'voice.languages.es',
  it: 'voice.languages.it',
  nl: 'voice.languages.nl',
  pt: 'voice.languages.pt',
  pl: 'voice.languages.pl',
  tr: 'voice.languages.tr',
  ja: 'voice.languages.ja',
  zh: 'voice.languages.zh',
  multi: 'voice.languages.multi',
};

/** "de-DE" → "Deutsch" / "German", "en-US" → "Englisch (US)" / "English (US)", unknown → as-is. */
export function languageLabel(lang: string, t: TFn): string {
  const [base, region] = lang.split(/[-_]/);
  const key = LANGUAGE_KEYS[(base ?? '').toLowerCase()];
  if (!key) return lang;
  const name = t(key);
  return region && region.length <= 3 ? `${name} (${region.toUpperCase()})` : name;
}

type ServerError = { message?: string; type?: string; code?: string };

export function serverError(body: string): ServerError {
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof j.error === 'string') return { message: j.error };
    if (j.error && typeof j.error === 'object') {
      const e = j.error as Record<string, unknown>;
      return {
        message: typeof e.message === 'string' ? e.message : undefined,
        type: typeof e.type === 'string' ? e.type : undefined,
        code: typeof e.code === 'string' ? e.code : typeof e.code === 'number' ? String(e.code) : undefined,
      };
    }
    if (typeof j.message === 'string') return { message: j.message };
  } catch {
    // not JSON
  }
  return {};
}


/** Map an HTTP failure (status 0 = no connection) to a VoiceError (key + vars, see voiceErrorText). */
export function voiceHttpError(op: VoiceOp, status: number, body: string): VoiceError {
  const se = serverError(body);
  const tag = `${se.code ?? ''} ${se.type ?? ''}`.toLowerCase();
  const make = (code: VoiceErrorCode, key: VoiceErrorKey, vars?: Vars) =>
    new VoiceError(code, key, { status, op, vars });

  if (/no_speech|empty_audio|no_audio|silence/.test(tag)) return new VoiceError('no_speech', 'voice.errors.noSpeech', { status });
  if (/not_configured|disabled|no_provider/.test(tag) || status === 501) return make('unavailable', 'voice.errors.unavailable');
  switch (status) {
    case 0:
      return make('network', 'voice.errors.network');
    case 401:
    case 403:
      return make('unauthorized', 'voice.errors.unauthorized');
    case 404:
    case 405:
      return new VoiceError('unavailable', 'voice.errors.noVoiceApi', { status });
    case 408:
    case 504:
      return make('timeout', 'voice.errors.timeout');
    case 413:
      return op === 'stt' ? make('too_large', 'voice.errors.tooLargeStt') : make('too_large', 'voice.errors.tooLargeTts');
    case 415:
      return make('unsupported_format', 'voice.errors.unsupportedFormat');
    case 429:
      return make('rate_limited', 'voice.errors.rateLimited');
    case 400:
    case 422:
      return se.message
        ? make('server', 'voice.errors.serverFailed', { message: se.message })
        : make('server', 'voice.errors.serverFailedPlain');
    case 502:
    case 503:
      return se.message
        ? make('server', 'voice.errors.serviceUnavailableDetail', { message: se.message })
        : make('server', 'voice.errors.serviceUnavailable');
    default:
      return se.message
        ? make('server', 'voice.errors.httpFailedDetail', { status, message: se.message })
        : make('server', 'voice.errors.httpFailed', { status });
  }
}

/** Parse `POST /bridge/stt`; throws VoiceError (German). Empty transcript → 'no_speech'. */
export function parseSttResponse(status: number, body: string): SttResult {
  if (status < 200 || status >= 300) throw voiceHttpError('stt', status, body);
  let j: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(body) as unknown;
    j = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    j = null;
  }
  if (!j || typeof j.text !== 'string') throw new VoiceError('bad_response', 'voice.errors.badSttResponse', { status });
  const text = normalizeTranscript(j.text);
  if (!text) throw new VoiceError('no_speech', 'voice.errors.noSpeech', { status });
  return {
    text,
    language: typeof j.language === 'string' && j.language ? j.language : null,
    durationMs: typeof j.durationMs === 'number' && Number.isFinite(j.durationMs) ? j.durationMs : null,
    provider: str(j.provider),
    model: str(j.model),
  };
}

/** Trim + collapse whitespace; drop Whisper's silence artefacts like "[Musik]" / "(Stille)". */
export function normalizeTranscript(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (/^[[(]\s*(musik|music|stille|silence|blank_audio|applaus|lachen)\s*[\])]\.?$/i.test(t)) return '';
  return t;
}

/** Map a thrown fetch/upload error (no HTTP status) to a VoiceError. */
export function voiceTransportError(op: VoiceOp, e: unknown, aborted: boolean, timedOut: boolean): VoiceError {
  if (e instanceof VoiceError) return e;
  if (timedOut) return new VoiceError('timeout', 'voice.errors.timeout', { op });
  if (aborted) return new VoiceError('aborted', 'voice.errors.aborted', { op });
  return voiceHttpError(op, 0, '');
}

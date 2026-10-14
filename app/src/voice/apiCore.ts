/**
 * Own-API-key voice providers (pure, apiCore.test.ts). Request builders + response/error parsing.
 * Provider API shapes checked against the official docs (2026-10):
 *
 *   STT  POST {base}/audio/transcriptions   multipart/form-data: file, model, [language ISO-639-1], response_format=json
 *        → {text, …}. Groq: base https://api.groq.com/openai/v1 (whisper-large-v3-turbo, ≤ 25 MB, m4a/webm/mp4 ok);
 *        OpenAI: base https://api.openai.com/v1 (gpt-4o-mini-transcribe). Auth: `Authorization: Bearer <key>`.
 *   TTS  POST {base}/audio/speech  JSON {model, input (≤ 4096 chars), voice, response_format:'mp3'} → audio bytes
 *        (OpenAI gpt-4o-mini-tts; voices alloy … cedar). Speed is applied by the player (pitch-corrected), not sent.
 *        Deepgram: POST https://api.deepgram.com/v1/speak?model=aura-2-elara-de&encoding=mp3, JSON {text}
 *        (≤ 2000 chars), `Authorization: Token <key>`, errors {err_code, err_msg}.
 *
 * The key is a parameter only (never stored in settings, never logged).
 */
import { normalizeTranscript, voiceHttpError, voiceTransportError } from './bridgeCore.ts';
import { VoiceError } from './types.ts';
import type { SttApiPreset, SttApiSettings, SttLanguage, SttResult, TtsApiPreset, TtsApiSettings, VoiceErrorKey, VoiceOp } from './types.ts';

export type AppLang = 'de' | 'en' | 'es';

export const STT_API_PRESETS: Record<SttApiPreset, { label: string; baseUrl: string; model: string }> = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe' },
  custom: { label: '', baseUrl: '', model: '' },
};

export const TTS_API_PRESETS: Record<TtsApiPreset, { label: string; baseUrl: string; model: string }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' },
  deepgram: { label: 'Deepgram', baseUrl: 'https://api.deepgram.com/v1', model: '' },
  custom: { label: '', baseUrl: '', model: '' },
};

/** Built-in voices of OpenAI `/audio/speech` (all speak German/Spanish too). */
export const OPENAI_TTS_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;

/** Deepgram Aura-2 voices per language (the voice is the `model` query parameter). */
export const DEEPGRAM_VOICES: Record<AppLang, readonly string[]> = {
  de: ['aura-2-elara-de', 'aura-2-aurelia-de', 'aura-2-lara-de', 'aura-2-kara-de', 'aura-2-viktoria-de', 'aura-2-julius-de', 'aura-2-fabian-de'],
  en: ['aura-2-thalia-en', 'aura-2-andromeda-en', 'aura-2-helena-en', 'aura-2-apollo-en'],
  es: ['aura-2-celeste-es', 'aura-2-carina-es', 'aura-2-estrella-es', 'aura-2-diana-es', 'aura-2-alvaro-es', 'aura-2-javier-es'],
};

export const DEFAULT_STT_API: SttApiSettings = { preset: 'groq', baseUrl: '', model: '' };
export const DEFAULT_TTS_API: TtsApiSettings = { preset: 'openai', baseUrl: '', model: '', voice: '' };

const STT_PRESETS: readonly SttApiPreset[] = ['groq', 'openai', 'custom'];
const TTS_PRESETS: readonly TtsApiPreset[] = ['openai', 'deepgram', 'custom'];
const s = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function normalizeSttApi(raw: unknown): SttApiSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = STT_PRESETS.includes(o.preset as SttApiPreset) ? (o.preset as SttApiPreset) : DEFAULT_STT_API.preset;
  return { preset, baseUrl: s(o.baseUrl), model: s(o.model, 120) };
}

export function normalizeTtsApi(raw: unknown): TtsApiSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = TTS_PRESETS.includes(o.preset as TtsApiPreset) ? (o.preset as TtsApiPreset) : DEFAULT_TTS_API.preset;
  return { preset, baseUrl: s(o.baseUrl), model: s(o.model, 120), voice: s(o.voice, 120) };
}

/**
 * `https://x/v1/` → `https://x/v1`; a pasted full endpoint (`…/audio/transcriptions`, `…/audio/speech`, `…/speak`)
 * is cut back to the base. Returns '' for anything that is not http(s).
 */
export function normalizeApiBase(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(u)) return '';
  u = u.replace(/\/(audio\/transcriptions|audio\/speech|speak)$/i, '');
  return u.replace(/\/+$/, '');
}

/** Effective base URL + model (preset defaults fill empty fields). */
export function effectiveSttApi(st: SttApiSettings): { baseUrl: string; model: string } {
  const p = STT_API_PRESETS[st.preset];
  return { baseUrl: normalizeApiBase(st.baseUrl || p.baseUrl), model: st.model || p.model };
}

export function effectiveTtsApi(st: TtsApiSettings, lang: AppLang): { baseUrl: string; model: string; voice: string } {
  const p = TTS_API_PRESETS[st.preset];
  const baseUrl = normalizeApiBase(st.baseUrl || p.baseUrl);
  if (st.preset === 'deepgram') return { baseUrl, model: '', voice: st.voice || DEEPGRAM_VOICES[lang][0] };
  return { baseUrl, model: st.model || p.model, voice: st.voice || (st.preset === 'openai' ? OPENAI_TTS_VOICES[0] : '') };
}

/** All required fields set (base URL valid, model and voice where needed). The key is checked separately. */
export function isSttApiComplete(st: SttApiSettings): boolean {
  const e = effectiveSttApi(st);
  return !!e.baseUrl && !!e.model;
}

export function isTtsApiComplete(st: TtsApiSettings, lang: AppLang = 'de'): boolean {
  const e = effectiveTtsApi(st, lang);
  return !!e.baseUrl && !!e.voice && (st.preset === 'deepgram' || !!e.model);
}

/** Chunk sizes per provider (OpenAI ≤ 4096, Deepgram ≤ 2000 chars per request). */
export function ttsApiChunkChars(st: TtsApiSettings): { maxChars: number; firstMaxChars: number } {
  return { maxChars: st.preset === 'deepgram' ? 1800 : 3500, firstMaxChars: 400 };
}

/** File name with an extension the providers accept (they look at it to detect the format). */
export function apiAudioFileName(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'speech.webm';
  if (m.includes('ogg')) return 'speech.ogg';
  if (m.includes('wav')) return 'speech.wav';
  if (m.includes('mpeg')) return 'speech.mp3';
  return 'speech.m4a';
}

export type SttApiRequest = { url: string; headers: Record<string, string>; fields: Record<string, string>; fileField: 'file' };
export type TtsApiRequest = { url: string; headers: Record<string, string>; body: string };

/** Multipart transcription request (the audio goes into the `file` field). */
export function buildSttApiRequest(st: SttApiSettings, key: string, language: SttLanguage): SttApiRequest {
  const e = effectiveSttApi(st);
  const fields: Record<string, string> = { model: e.model, response_format: 'json' };
  if (language !== 'auto') fields.language = language;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return { url: `${e.baseUrl}/audio/transcriptions`, headers, fields, fileField: 'file' };
}

/** Speech request for one chunk (mp3). */
export function buildTtsApiRequest(st: TtsApiSettings, key: string, text: string, lang: AppLang): TtsApiRequest {
  const e = effectiveTtsApi(st, lang);
  if (st.preset === 'deepgram') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
    if (key) headers.Authorization = `Token ${key}`;
    return {
      url: `${e.baseUrl}/speak?model=${encodeURIComponent(e.voice)}&encoding=mp3`,
      headers,
      body: JSON.stringify({ text }),
    };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return {
    url: `${e.baseUrl}/audio/speech`,
    headers,
    body: JSON.stringify({ model: e.model, input: text, voice: e.voice, response_format: 'mp3' }),
  };
}

/** Deepgram `{err_code, err_msg}` → the `{error:{…}}` shape voiceHttpError understands. */
function normalizeErrorBody(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    if (j && typeof j === 'object' && !j.error && (typeof j.err_msg === 'string' || typeof j.err_code === 'string')) {
      return JSON.stringify({ error: { message: j.err_msg, code: j.err_code } });
    }
  } catch {
    // not JSON
  }
  return body;
}

/** Bridge-specific copy → provider-neutral copy (same code/status/vars). */
const API_KEY_MAP: Partial<Record<VoiceErrorKey, VoiceErrorKey>> = {
  'voice.errors.unauthorized': 'voice.errors.apiUnauthorized',
  'voice.errors.noVoiceApi': 'voice.errors.apiNotFound',
  'voice.errors.unavailable': 'voice.errors.apiNotFound',
  'voice.errors.network': 'voice.errors.apiNetwork',
  'voice.errors.unsupportedFormat': 'voice.errors.apiUnsupportedFormat',
  'voice.errors.noAudio': 'voice.errors.apiNoAudio',
};

export function toApiError(e: VoiceError, op?: VoiceOp): VoiceError {
  const key = API_KEY_MAP[e.key];
  return key ? new VoiceError(e.code, key, { status: e.status, op: e.op ?? op, vars: e.vars }) : e;
}

export function apiHttpError(op: VoiceOp, status: number, body: string): VoiceError {
  return toApiError(voiceHttpError(op, status, normalizeErrorBody(body)), op);
}

export function apiTransportError(op: VoiceOp, e: unknown, aborted: boolean, timedOut: boolean): VoiceError {
  return toApiError(voiceTransportError(op, e, aborted, timedOut), op);
}

/** Parse an OpenAI-compatible transcription response (`{text}`); empty → 'no_speech'. */
export function parseApiSttResponse(status: number, body: string, provider: string, model: string): SttResult {
  if (status < 200 || status >= 300) throw apiHttpError('stt', status, body);
  let text: unknown;
  try {
    const j = JSON.parse(body) as unknown;
    text = j && typeof j === 'object' ? (j as Record<string, unknown>).text : undefined;
  } catch {
    text = undefined;
  }
  if (typeof text !== 'string') throw new VoiceError('bad_response', 'voice.errors.badSttResponse', { status });
  const clean = normalizeTranscript(text);
  if (!clean) throw new VoiceError('no_speech', 'voice.errors.noSpeech', { status });
  return { text: clean, language: null, durationMs: null, provider, model };
}

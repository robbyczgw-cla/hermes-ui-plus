/**
 * Voice types (owner: voice workstream). Erasable TS only (node:test runs these files with type
 * stripping): no enums/namespaces/parameter properties.
 */
import type { TFn, TKey, Vars } from '../i18n/core.ts';

/** UI-bridge connection used for /bridge/stt, /bridge/tts, /bridge/voice/config. */
export type VoiceConn = { baseUrl: string; apiKey: string };

export type TtsVoice = { id: string; name: string; lang: string; provider: string };

/** Parsed `GET /bridge/voice/config`. Missing parts are null/empty, never undefined. */
export type VoiceConfig = {
  stt: { provider: string; model: string } | null;
  tts: { provider: string; model: string; voices: TtsVoice[]; defaultVoice: string | null } | null;
};

/** `POST /bridge/stt` → 200 */
export type SttResult = { text: string; language: string | null; durationMs: number | null; provider: string; model: string };

export type SttLanguage = 'auto' | 'de' | 'en' | 'es';

/** Engine choice per direction in the settings. */
export type VoiceEngineChoice = 'auto' | 'device' | 'bridge' | 'apikey';
/** Resolved dictation engine. */
export type SttEngine = 'bridge' | 'device' | 'apikey';
/** Resolved read-aloud engine. */
export type TtsEngine = 'bridge' | 'device' | 'apikey';

export type SttApiPreset = 'groq' | 'openai' | 'custom';
export type TtsApiPreset = 'openai' | 'deepgram' | 'custom';
/** Own-key transcription (OpenAI-compatible `/audio/transcriptions`). The key lives in the secure store. */
export type SttApiSettings = { preset: SttApiPreset; baseUrl: string; model: string };
/** Own-key speech (OpenAI-compatible `/audio/speech`, or Deepgram `/v1/speak`). The key lives in the secure store. */
export type TtsApiSettings = { preset: TtsApiPreset; baseUrl: string; model: string; voice: string };

export type VoiceSettings = {
  /** bridge TTS voice id; null = bridge default */
  ttsVoice: string | null;
  /** playback speed 0.75 … 2 (pitch-corrected), applied on the device */
  ttsRate: number;
  /** "Antworten automatisch vorlesen" */
  autoRead: boolean;
  /** sent as `X-Language` (omitted for auto) */
  sttLanguage: SttLanguage;
  /** reserved: send dictated text directly (integrator decides; default off) */
  autoSend: boolean;
  /** dictation engine */
  sttEngine: VoiceEngineChoice;
  /** read-aloud engine */
  ttsEngine: VoiceEngineChoice;
  /** on-device voice identifier (expo-speech / speechSynthesis); null = best voice for the language */
  deviceVoice: string | null;
  sttApi: SttApiSettings;
  ttsApi: TtsApiSettings;
};

export type VoiceErrorCode =
  | 'no_bridge'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'unauthorized'
  | 'unavailable'
  | 'too_large'
  | 'unsupported_format'
  | 'rate_limited'
  | 'no_speech'
  | 'empty_text'
  | 'bad_response'
  | 'permission'
  | 'recording'
  | 'playback'
  | 'server'
  | 'unknown';

/** Operation a bridge error belongs to; its label is part of the message (`{label}`). */
export type VoiceOp = 'stt' | 'tts' | 'config';

/** Dictionary key (`voice.errors.*`) of a user-facing voice error message. */
export type VoiceErrorKey = Extract<TKey, `voice.errors.${string}`>;

const OP_KEY: Record<VoiceOp, TKey> = { stt: 'voice.ops.stt', tts: 'voice.ops.tts', config: 'voice.ops.config' };

/**
 * Error for non-React code: the message is a dictionary key plus vars, not text, so the same error
 * can be shown in the active language. Render it with `voiceErrorText(e, t)`.
 */
export class VoiceError extends Error {
  readonly code: VoiceErrorCode;
  readonly key: VoiceErrorKey;
  readonly status: number | undefined;
  readonly op: VoiceOp | undefined;
  readonly vars: Vars;
  constructor(code: VoiceErrorCode, key: VoiceErrorKey, opts: { status?: number; op?: VoiceOp; vars?: Vars } = {}) {
    super(key);
    this.name = 'VoiceError';
    this.code = code;
    this.key = key;
    this.status = opts.status;
    this.op = opts.op;
    this.vars = opts.vars ?? {};
  }
}

export function isVoiceError(e: unknown): e is VoiceError {
  return e instanceof VoiceError || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'VoiceError');
}


/**
 * User-facing text of a voice error in the active language (`t` from useT()).
 */
  export function voiceErrorText(e: VoiceError, t: TFn): string {
  const vars: Vars = { ...e.vars };
  if (e.op) vars.label = t(OP_KEY[e.op]);
  return t(e.key, vars);
}

export const VOICE_LIMITS = {
  /** dictation hard limit */
  maxRecordingMs: 120_000,
  /** recordings shorter than this are dropped ("zu kurz") */
  minRecordingMs: 600,
  /** bridge accepts ≤ 4000 chars per /bridge/tts call; keep headroom */
  ttsChunkChars: 3500,
  /** first chunk small → playback starts sooner */
  ttsFirstChunkChars: 400,
  /** on-device TTS (expo-speech) chunk size: small so pause/resume restarts little */
  deviceChunkChars: 400,
  sttTimeoutMs: 60_000,
  ttsTimeoutMs: 45_000,
  configTimeoutMs: 8_000,
} as const;

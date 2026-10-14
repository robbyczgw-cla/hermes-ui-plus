/**
 * Engine selection per direction (pure, engine.test.ts).
 *
 * Automatisch:  STT  UI bridge (if it has STT) → on-device recognition → own API key (advanced mode only)
 *               TTS  UI bridge (if it has TTS) → on-device voice
 * Explicit choices are strict: when the chosen engine is missing, the result says why (no silent switch).
 */
import type { SttEngine, TtsEngine, VoiceConfig, VoiceEngineChoice, VoiceError, VoiceErrorCode, VoiceErrorKey } from './types.ts';

/** What the active profile's UI bridge offers for one direction. 'unknown' = config not loaded (yet). */
export type BridgeVoice = 'none' | 'unknown' | 'yes' | 'no';

export function bridgeVoiceSupport(
  hasBridge: boolean,
  config: VoiceConfig | null,
  dir: 'stt' | 'tts',
  opts: { configError?: VoiceError | null; off?: boolean } = {},
): BridgeVoice {
  if (!hasBridge) return 'none';
  if (opts.off) return 'no';
  if (config) return config[dir] ? 'yes' : 'no';
  // old bridge without /bridge/voice/* (404/405/501) → no voice at all
  if (opts.configError && opts.configError.code === 'unavailable') return 'no';
  return 'unknown';
}

export type EngineUnavailable = 'no_bridge' | 'no_device' | 'no_key' | 'none';
export type Resolved<E> = { engine: E; reason: null } | { engine: null; reason: EngineUnavailable };

export type SttEngineInput = {
  choice: VoiceEngineChoice;
  bridge: BridgeVoice;
  /** on-device recognition available (native module / Web Speech API) */
  device: boolean;
  /** own key saved and settings complete */
  apiKey: boolean;
};

const ok = <E>(engine: E): Resolved<E> => ({ engine, reason: null });
const no = <E>(reason: EngineUnavailable): Resolved<E> => ({ engine: null, reason });

export function resolveSttEngine(i: SttEngineInput): Resolved<SttEngine> {
  const choice = i.choice;
  const bridgeOk = i.bridge === 'yes' || i.bridge === 'unknown';
  switch (choice) {
    case 'bridge':
      return i.bridge === 'none' ? no('no_bridge') : ok('bridge');
    case 'device':
      return i.device ? ok('device') : no('no_device');
    case 'apikey':
      return i.apiKey ? ok('apikey') : no('no_key');
    default:
      if (bridgeOk) return ok('bridge');
      if (i.device) return ok('device');
      if (i.apiKey) return ok('apikey');
      return no('none');
  }
}

export type TtsEngineInput = {
  choice: VoiceEngineChoice;
  bridge: BridgeVoice;
  apiKey: boolean;
};

export function resolveTtsEngine(i: TtsEngineInput): Resolved<TtsEngine> {
  const choice = i.choice;
  switch (choice) {
    case 'bridge':
      // a bridge without TTS falls back to the device voice inside the speaker (existing behaviour)
      return i.bridge === 'none' ? no('no_bridge') : ok('bridge');
    case 'device':
      return ok('device');
    case 'apikey':
      return i.apiKey ? ok('apikey') : no('no_key');
    default:
      if (i.bridge === 'yes' || i.bridge === 'unknown') return ok('bridge');
      return ok('device');
  }
}

/** BCP47 tag for on-device recognition: the chosen dictation language, else the app locale. */
export function recognitionLocale(sttLanguage: 'auto' | 'de' | 'en' | 'es', appLocale: string): string {
  const app = appLocale || 'de-DE';
  if (sttLanguage === 'auto') return app;
  if (app.toLowerCase().split(/[-_]/)[0] === sttLanguage) return app;
  return { de: 'de-DE', en: 'en-US', es: 'es-ES' }[sttLanguage];
}

/**
 * expo-speech-recognition / Web Speech error code → user message. null = ignore ('aborted': we cancelled).
 * `web`: 'not-allowed' means the browser blocked the microphone (or the page is not served over HTTPS).
 */
export function recognitionError(code: string, web: boolean): { code: VoiceErrorCode; key: VoiceErrorKey } | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
      return { code: 'permission', key: web ? 'voice.errors.browserMicBlocked' : 'voice.errors.recognitionDenied' };
    case 'service-not-allowed':
      return { code: 'unavailable', key: web ? 'voice.errors.browserSttBlocked' : 'voice.errors.deviceSttDisabled' };
    case 'language-not-supported':
      return { code: 'unavailable', key: 'voice.errors.deviceSttLanguage' };
    case 'network':
      return { code: 'network', key: 'voice.errors.deviceSttNetwork' };
    case 'no-speech':
    case 'speech-timeout':
    case 'nomatch':
      return { code: 'no_speech', key: 'voice.errors.noSpeech' };
    case 'audio-capture':
      return { code: 'recording', key: 'voice.errors.microphoneUnavailable' };
    case 'busy':
      return { code: 'recording', key: 'voice.errors.deviceSttBusy' };
    // SpeechAnalyzer (iOS 26+, modules/speech-analyzer): language model missing / download failed
    case 'model-not-installed':
    case 'model-download-failed':
      return { code: 'unavailable', key: 'voice.errors.deviceSttModel' };
    default:
      return { code: 'unknown', key: 'voice.errors.deviceSttFailed' };
  }
}

/** expo-speech-recognition `volumechange` value (-2 … 10, < 0 inaudible) → waveform level 0..1. */
export function volumeToLevel(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.round(Math.pow(Math.min(1, v / 10), 0.8) * 1000) / 1000;
}

/**
 * Which on-device recognizer runs the 'device' STT engine:
 *   'analyzer'  iOS 26+ SpeechAnalyzer / SpeechTranscriber (local module modules/speech-analyzer)
 *   'expo'      expo-speech-recognition (Android SpeechRecognizer, iOS < 26 SFSpeechRecognizer, Web Speech API)
 * `analyzerLocale`: SpeechTranscriber support for the dictation language ('unknown' = not checked yet). An
 * unsupported language falls back to expo-speech-recognition (SFSpeechRecognizer knows more languages, partly
 * server-based). Android / web never use the analyzer.
 */
export type DeviceSttBackend = 'analyzer' | 'expo';

export type DeviceSttBackendInput = {
  platform: string;
  /** HuiSpeechAnalyzer.isAvailable() (iOS 26+, supported hardware, module in the build) */
  analyzer: boolean;
  /** expo-speech-recognition native module present and recognition available */
  expo: boolean;
  analyzerLocale?: 'unknown' | 'supported' | 'unsupported';
};

export function deviceSttBackend(i: DeviceSttBackendInput): DeviceSttBackend | null {
  if (i.platform === 'ios' && i.analyzer && i.analyzerLocale !== 'unsupported') return 'analyzer';
  return i.expo ? 'expo' : null;
}

/**
 * SpeechAnalyzer failed before listening started: retry with expo-speech-recognition? Only for "this recognizer
 * cannot do it here" (no hardware support, language, model download) – not for permission / microphone / busy,
 * which would fail the same way.
 */
export function analyzerFallsBack(code: string | undefined): boolean {
  return code === 'language-not-supported' || code === 'service-not-allowed' || code === 'model-download-failed' || code === 'model-not-installed';
}

/** model download progress 0..1 → whole percent 0..100 for "Sprachmodell wird geladen … x %" */
export function modelProgressPercent(p: number | null | undefined): number {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, Math.floor(p * 100)));
}

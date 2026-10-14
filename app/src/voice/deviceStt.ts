/**
 * On-device speech recognition (OS engine), two backends (choice: engine.ts deviceSttBackend):
 * - iOS 26+: Apple SpeechAnalyzer / SpeechTranscriber via the local module `modules/speech-analyzer`
 *   (speechAnalyzerNative.ts). Long-form, always on-device, live volatile text; listens until stop() (✓, release,
 *   120 s). The language model is downloaded on first use (AssetInventory) → `onModelProgress`.
 * - everything else (and iOS 26 languages SpeechTranscriber does not know): `expo-speech-recognition`:
 *   Android SpeechRecognizer, iOS SFSpeechRecognizer, web Web Speech API (`webkitSpeechRecognition`,
 *   Chrome/Edge/Safari incl. iOS; not Firefox). Interim results stream to `onPartial`, continuous mode is off
 *   (the engine ends after a pause), on-device recognition is preferred when the OS has a model for the language.
 *
 * The native module is required lazily: an APK/iOS build made before the dependency was added has no
 * module → `deviceSttAvailable()` is false and the option is hidden instead of crashing the voice module.
 */
import { Platform } from 'react-native';
import { analyzerFallsBack, deviceSttBackend, recognitionError, volumeToLevel } from './engine';
import type { DeviceSttBackend } from './engine';
import type { MicPermission } from './permissions';
import { speechAnalyzerAvailable, speechAnalyzerModule } from './speechAnalyzerNative';
import type { SpeechAnalyzerModule } from './speechAnalyzerNative';
import { VoiceError } from './types';

type Mod = typeof import('expo-speech-recognition');
type SpeechModule = Mod['ExpoSpeechRecognitionModule'];

const IS_WEB = Platform.OS === 'web';
let mod: SpeechModule | null | undefined;

function speechModule(): SpeechModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = (require('expo-speech-recognition') as Mod).ExpoSpeechRecognitionModule ?? null;
  } catch {
    mod = null; // native module missing (old build)
  }
  return mod;
}

let availCache: { at: number; value: boolean } | null = null;

function expoAvailable(): boolean {
  try {
    const m = speechModule();
    return !!m && m.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Recognition engine present (SpeechAnalyzer, or native module + OS service / Web Speech API). Cached 30 s. */
export function deviceSttAvailable(): boolean {
  if (availCache && Date.now() - availCache.at < 30_000) return availCache.value;
  const value = speechAnalyzerAvailable() || expoAvailable();
  availCache = { at: Date.now(), value };
  return value;
}

/** Backend the next recognition will use (null: none). Settings hint text depends on it. */
export function deviceSttBackendNow(): DeviceSttBackend | null {
  return deviceSttBackend({ platform: Platform.OS, analyzer: speechAnalyzerAvailable(), expo: expoAvailable() });
}

/** Mic (+ iOS speech recognition) permission. Web: the browser asks on start(); denial → 'not-allowed' error. */
/** Mic + speech-recognition permission granted, remembered for this process (see permissions.ts micGranted). */
let recognitionGranted = false;

/** On-device recognition can start without a permission round trip. */
export const recognitionPermissionKnown = (): boolean => recognitionGranted;

/** A start failed: ask the OS again next time. */
export function forgetRecognitionPermission(): void {
  recognitionGranted = false;
}

export async function ensureRecognitionPermission(): Promise<MicPermission> {
  // both backends ask the OS for the same two permissions (microphone + speech recognition)
  const m = speechModule() ?? (speechAnalyzerAvailable() ? speechAnalyzerModule() : null);
  if (!m) return { ok: false, blocked: false, prompted: false, error: new VoiceError('unavailable', 'voice.errors.deviceSttMissing') };
  if (IS_WEB) return { ok: true, blocked: false, prompted: false };
  if (recognitionGranted) return { ok: true, blocked: false, prompted: false };
  try {
    let p = await m.getPermissionsAsync();
    if (p.granted) {
      recognitionGranted = true;
      return { ok: true, blocked: false, prompted: false };
    }
    const prompted = p.canAskAgain;
    if (p.canAskAgain) p = await m.requestPermissionsAsync();
    recognitionGranted = p.granted;
    if (p.granted) return { ok: true, blocked: false, prompted };
    return p.canAskAgain
      ? { ok: false, blocked: false, prompted, error: new VoiceError('permission', 'voice.errors.recognitionDenied') }
      : { ok: false, blocked: true, prompted, error: new VoiceError('permission', 'voice.errors.recognitionBlocked') };
  } catch {
    return { ok: false, blocked: false, prompted: false, error: new VoiceError('permission', 'voice.errors.microphoneUnavailable') };
  }
}

/** Current mic + speech-recognition permission without prompting (web: unknown → false, the browser decides on start). */
export async function recognitionPermissionGranted(): Promise<boolean> {
  const m = speechModule() ?? (speechAnalyzerAvailable() ? speechAnalyzerModule() : null);
  if (!m || IS_WEB) return false;
  try {
    const granted = (await m.getPermissionsAsync()).granted;
    recognitionGranted = granted;
    return granted;
  } catch {
    return false;
  }
}

const sameLocale = (a: string, b: string) => a.toLowerCase().replace('_', '-') === b.toLowerCase().replace('_', '-');

/**
 * Android: installed offline languages per recognizer service query, 10 min. `getSupportedLocales` binds the
 * recognition service (an IPC round trip, slow on some phones) and ran before every dictation start.
 */
let localesCache: { at: number; installed: string[] } | null = null;
const LOCALES_TTL_MS = 10 * 60_000;

/** iOS: device supports on-device models; Android: the offline model for `lang` is installed. */
async function preferOnDevice(m: SpeechModule, lang: string): Promise<boolean> {
  if (IS_WEB) return false;
  try {
    if (!m.supportsOnDeviceRecognition()) return false;
    if (Platform.OS === 'ios') return true;
    if (!localesCache || Date.now() - localesCache.at > LOCALES_TTL_MS) {
      const r = await m.getSupportedLocales({});
      localesCache = { at: Date.now(), installed: r.installedLocales ?? [] };
    }
    return localesCache.installed.some((l) => sameLocale(l, lang));
  } catch {
    return false;
  }
}

/**
 * Idle-time warm-up before the first dictation (composer mounted): permission state without prompting and, on
 * Android, the installed offline languages – the first press then starts the recognizer without those round trips.
 */
export async function prewarmRecognition(lang: string): Promise<void> {
  const m = speechModule();
  await recognitionPermissionGranted();
  if (m) await preferOnDevice(m, lang);
}

export type RecognitionResult = { text: string; error: VoiceError | null };

export type RecognitionHandlers = {
  /** live (interim) transcript of the whole utterance so far */
  onPartial(text: string): void;
  /** input level 0..1 (native only) */
  onLevel(level: number): void;
  /** recognition finished (pause, stop(), abort() or error); called exactly once */
  onEnd(result: RecognitionResult): void;
  /** SpeechAnalyzer: the language model is downloading (0..1); null when done (listening starts next) */
  onModelProgress?(progress: number | null): void;
};

export type RecognitionSession = {
  /** finish: the engine delivers the final result, then onEnd */
  stop(): void;
  /** discard: stops the engine and detaches silently – `onEnd` is NOT called (nothing competes with the caller's own result) */
  abort(): void;
};

/** Teardown of a start that was cancelled while it was in flight; the next start waits for it (one global native recognizer). */
let nativeBusy: Promise<unknown> = Promise.resolve();

const abortedError = () => new VoiceError('aborted', 'voice.errors.deviceSttFailed', { op: 'stt' });
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError();
}

const errorCode = (e: unknown): string | undefined =>
  e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : undefined;

function analyzerError(code: string | undefined, lang: string): VoiceError {
  const mapped = recognitionError(code ?? 'unknown', false) ?? { code: 'unknown' as const, key: 'voice.errors.deviceSttFailed' as const };
  return new VoiceError(mapped.code, mapped.key, { op: 'stt', vars: { lang } });
}

/** Download the SpeechTranscriber model for `lang` if needed; progress → onModelProgress. (The download itself cannot be cancelled; callers check their signal afterwards.) */
async function ensureAnalyzerModel(a: SpeechAnalyzerModule, lang: string, h: RecognitionHandlers): Promise<'ready' | 'unsupported'> {
  let shown = false;
  const sub = a.addListener('modelProgress', (e) => {
    shown = true;
    h.onModelProgress?.(e.progress);
  });
  try {
    const r = await a.ensureModel(lang);
    return r.status === 'unsupported' ? 'unsupported' : 'ready';
  } finally {
    sub.remove();
    if (shown) h.onModelProgress?.(null);
  }
}

/**
 * Start one recognition. Throws VoiceError when the engine cannot start.
 * iOS 26+: SpeechAnalyzer (falls back to expo-speech-recognition when the language / model is not available).
 * `signal`: cancels the start. Checked after every await before the native recognizer is touched, so a dictation
 * cancelled during first-use model installation never opens the microphone (throws a VoiceError 'aborted').
 */
export async function startRecognition(lang: string, h: RecognitionHandlers, signal?: AbortSignal): Promise<RecognitionSession> {
  throwIfAborted(signal);
  await nativeBusy.catch(() => undefined);
  throwIfAborted(signal);
  const backend = deviceSttBackendNow();
  const a = backend === 'analyzer' ? speechAnalyzerModule() : null;
  if (a) {
    const canFallBack = expoAvailable();
    try {
      const model = await ensureAnalyzerModel(a, lang, h);
      throwIfAborted(signal);
      if (model === 'ready') return await startAnalyzerRecognition(a, lang, h, signal);
      if (!canFallBack) throw new VoiceError('unavailable', 'voice.errors.deviceSttLanguage', { op: 'stt', vars: { lang } });
    } catch (e) {
      if (e instanceof VoiceError) throw e;
      const code = errorCode(e);
      if (!canFallBack || !analyzerFallsBack(code)) throw analyzerError(code, lang);
    }
    // → SFSpeechRecognizer via expo-speech-recognition
  }
  return startExpoRecognition(lang, h, signal);
}

/** SpeechAnalyzer session (long-form: runs until stop() / abort()). */
async function startAnalyzerRecognition(a: SpeechAnalyzerModule, lang: string, h: RecognitionHandlers, signal?: AbortSignal): Promise<RecognitionSession> {
  let transcript = '';
  let error: VoiceError | null = null;
  let ended = false;
  const subs: { remove(): void }[] = [];
  const cleanup = () => {
    for (const s of subs.splice(0)) s.remove();
  };
  subs.push(
    a.addListener('partial', (e) => {
      transcript = e.transcript;
      h.onPartial(transcript);
    }),
    a.addListener('final', (e) => {
      transcript = e.transcript;
      h.onPartial(transcript);
    }),
    a.addListener('level', (e) => h.onLevel(Math.max(0, Math.min(1, Number(e.level) || 0)))),
    a.addListener('error', (e) => {
      const mapped = recognitionError(e.error, false);
      error = mapped ? new VoiceError(mapped.code, mapped.key, { op: 'stt', vars: { lang } }) : null;
    }),
    a.addListener('end', (e) => {
      if (ended) return;
      ended = true;
      cleanup();
      const text = (e.transcript || transcript).trim();
      h.onEnd({ text, error: text && error?.code === 'no_speech' ? null : error });
    }),
  );
  try {
    await a.start({ locale: lang, partial: true });
  } catch (e) {
    ended = true;
    cleanup();
    throw e; // startRecognition maps it (or falls back)
  }
  if (signal?.aborted) {
    // cancelled while the native start was in flight: stop it again; the next start waits for that
    ended = true;
    cleanup();
    nativeBusy = a.cancel().catch(() => undefined);
    await nativeBusy;
    throw abortedError();
  }
  return {
    stop: () => {
      void a.stop().catch(() => undefined);
    },
    abort: () => {
      // the caller discards the result: detach now so a late 'end' cannot reach a newer session
      ended = true;
      cleanup();
      nativeBusy = a.cancel().catch(() => undefined);
    },
  };
}

/** expo-speech-recognition: one non-continuous recognition. */
async function startExpoRecognition(lang: string, h: RecognitionHandlers, signal?: AbortSignal): Promise<RecognitionSession> {
  const m = speechModule();
  if (!m) throw new VoiceError('unavailable', 'voice.errors.deviceSttMissing');
  const onDevice = await preferOnDevice(m, lang);
  throwIfAborted(signal);

  let finalText = '';
  let partial = '';
  let error: VoiceError | null = null;
  let gotResult = false;
  let ended = false;
  let aborted = false;
  let retried = false;
  let restarted = false;
  let sawStart = false;
  let sawError = false;
  const subs: { remove(): void }[] = [];
  const cleanup = () => {
    for (const s of subs.splice(0)) s.remove();
  };

  const begin = (useOnDevice: boolean) => {
    m.start({
      lang,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: useOnDevice,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  };

  subs.push(
    m.addListener('start', () => {
      sawStart = true;
    }),
    m.addListener('result', (ev) => {
      const text = (ev.results?.[0]?.transcript ?? '').trim();
      gotResult = true;
      if (ev.isFinal) {
        if (text) finalText = finalText ? `${finalText} ${text}` : text;
        partial = '';
        h.onPartial(finalText);
      } else {
        partial = text;
        h.onPartial(finalText ? `${finalText} ${text}` : text);
      }
    }),
    m.addListener('volumechange', (ev) => h.onLevel(volumeToLevel(ev.value))),
    m.addListener('error', (ev) => {
      if (ev.error === 'aborted') return; // only our own abort() (already detached) or a stale session
      sawError = true;
      // on-device model not usable after all → one retry with the network recognizer
      if (onDevice && !retried && !gotResult && !aborted && (ev.error === 'language-not-supported' || ev.error === 'service-not-allowed')) {
        retried = true;
        error = null;
        return;
      }
      const mapped = recognitionError(ev.error, IS_WEB);
      error = mapped ? new VoiceError(mapped.code, mapped.key, { op: 'stt', vars: { lang } }) : null;
    }),
    m.addListener('end', () => {
      // a late 'end' of a previous (aborted) session arrives before this session's 'start' → ignore
      if (ended || (!sawStart && !sawError)) return;
      if (retried && !gotResult && !aborted && error === null && finalText === '' && !restarted) {
        restarted = true;
        try {
          begin(false);
          return;
        } catch {
          // fall through → end
        }
      }
      ended = true;
      cleanup();
      const text = (finalText || partial).trim();
      h.onEnd({ text, error: text && error?.code === 'no_speech' ? null : error });
    }),
  );

  try {
    begin(onDevice);
  } catch {
    cleanup();
    throw new VoiceError('recording', 'voice.errors.deviceSttFailed', { op: 'stt' });
  }

  return {
    stop: () => {
      try {
        m.stop();
      } catch {
        // already stopped
      }
    },
    abort: () => {
      aborted = true;
      // the caller discards the result: detach now so a late 'end' cannot reach a newer session
      ended = true;
      cleanup();
      try {
        m.abort();
      } catch {
        // already stopped
      }
    },
  };
}

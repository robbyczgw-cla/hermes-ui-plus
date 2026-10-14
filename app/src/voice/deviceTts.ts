/**
 * On-device TTS (expo-speech; web: speechSynthesis): chosen explicitly ("Gerät") or as the fallback when no
 * UI bridge is configured or the bridge has no TTS. A saved voice (settings `deviceVoice`) wins, else it picks the best installed voice for the requested language (Premium / Enhanced first; iOS quality from modules/speech-analyzer). Speech.pause() does not exist on Android,
 * so the speaker uses small chunks and resumes at the start of the interrupted chunk instead.
 */
import * as Speech from 'expo-speech';
import { bestDeviceVoice, rankDeviceVoices } from './format';
import type { DeviceVoice, RawVoice, VoiceQualityLevel } from './format';
import { speechAnalyzerModule } from './speechAnalyzerNative';

const voicePromises = new Map<string, Promise<string | undefined>>();

const QUALITY: Record<string, VoiceQualityLevel> = { premium: 'premium', enhanced: 'enhanced', default: 'default' };

/**
 * All installed voices with their real quality. iOS: the local module's AVSpeechSynthesisVoice list (expo-speech
 * reports Premium voices as "Default" and has no novelty flag); otherwise / older builds: expo-speech.
 */
async function rawVoices(): Promise<RawVoice[]> {
  const native = speechAnalyzerModule();
  if (native) {
    try {
      return native.getVoices().map((v) => ({ identifier: v.identifier, name: v.name, language: v.language, quality: QUALITY[v.quality] ?? 'default', novelty: v.novelty }));
    } catch {
      // fall through to expo-speech
    }
  }
  const voices = await Speech.getAvailableVoicesAsync();
  return voices.map((v) => ({ identifier: v.identifier, name: v.name, language: v.language, quality: v.quality === Speech.VoiceQuality.Enhanced ? 'enhanced' : 'default' }));
}

/** Identifier of the best installed voice for `lang` (cached), undefined → engine default. */
function bestVoice(lang: string): Promise<string | undefined> {
  let voicePromise = voicePromises.get(lang);
  if (!voicePromise) {
    voicePromise = rawVoices()
      .then((raw) => bestDeviceVoice(rankDeviceVoices(raw, lang), lang)?.id)
      .catch(() => undefined);
    voicePromises.set(lang, voicePromise);
  }
  return voicePromise;
}

export type { DeviceVoice };

/** Installed voices for the app language: Premium / Enhanced first (exact region first), then name. */
export async function listDeviceVoices(locale: string): Promise<DeviceVoice[]> {
  try {
    return rankDeviceVoices(await rawVoices(), locale);
  } catch {
    return [];
  }
}

/** The saved voice if it is installed and speaks `locale`'s language, else null (→ best voice). */
export async function resolveDeviceVoice(saved: string | null, locale: string): Promise<string | null> {
  if (!saved) return null;
  const list = await listDeviceVoices(locale);
  return list.some((v) => v.id === saved) ? saved : null;
}

/** Max text length per Speech.speak() call on this platform (Android ≈ 4000). */
export function deviceMaxChars(): number {
  const m = Speech.maxSpeechInputLength;
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 4000;
}

/** Speak one chunk; resolves when done or stopped (abort → Speech.stop()). */
export async function speakOnDevice(text: string, opts: { rate: number; language: string; voice?: string | null }, signal: AbortSignal): Promise<void> {
  const language = opts.language;
  const voice = opts.voice || (await bestVoice(language));
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      void Speech.stop().catch(() => undefined);
      finish();
    };
    signal.addEventListener('abort', onAbort);
    Speech.speak(text, {
      language,
      voice,
      rate: opts.rate,
      onDone: () => finish(),
      onStopped: () => finish(),
      onError: (e: Error) => finish(e instanceof Error ? e : new Error(String(e))),
    });
  });
}

export function stopDeviceSpeech(): void {
  void Speech.stop().catch(() => undefined);
}

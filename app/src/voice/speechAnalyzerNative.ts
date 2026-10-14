/**
 * JS side of the local Expo module `modules/speech-analyzer` (iOS only): Apple SpeechAnalyzer / SpeechTranscriber
 * (iOS 26+) for on-device dictation, plus exact AVSpeechSynthesisVoice quality for the voice picker.
 * null on Android / web and in iOS builds made before the module existed (no crash: deviceStt.ts then keeps using
 * expo-speech-recognition).
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type Subscription = { remove(): void };

export type AnalyzerPermission = { granted: boolean; canAskAgain: boolean; status: 'granted' | 'undetermined' | 'denied' };
export type AnalyzerModelStatus = 'installed' | 'supported' | 'downloading' | 'unsupported' | 'unavailable';
export type AnalyzerEnsureResult = { status: 'installed' | 'downloaded' | 'unsupported'; locale?: string };
export type NativeVoice = { identifier: string; name: string; language: string; quality: 'default' | 'enhanced' | 'premium'; novelty: boolean; personal: boolean };

export type AnalyzerEvents = {
  /** volatile text: `text` = current volatile segment, `transcript` = finalized + volatile */
  partial: (e: { text: string; transcript: string }) => void;
  /** finalized segment, `transcript` = all finalized text so far */
  final: (e: { text: string; transcript: string }) => void;
  /** `error`: expo-speech-recognition style code (engine.ts recognitionError) */
  error: (e: { error: string; message: string }) => void;
  /** exactly once per session, after stop(), cancel() or an error */
  end: (e: { transcript: string; cancelled: boolean }) => void;
  /** input level 0..1 (~10/s) */
  level: (e: { level: number }) => void;
  /** model download progress 0..1 (ensureModel) */
  modelProgress: (e: { locale: string; progress: number }) => void;
};

export type SpeechAnalyzerModule = {
  isAvailable(): boolean;
  supportedLocales(): Promise<{ supported: string[]; installed: string[] }>;
  modelStatus(locale: string): Promise<{ status: AnalyzerModelStatus; locale?: string }>;
  ensureModel(locale: string): Promise<AnalyzerEnsureResult>;
  getPermissionsAsync(): Promise<AnalyzerPermission>;
  requestPermissionsAsync(): Promise<AnalyzerPermission>;
  start(options: { locale: string; partial: boolean }): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  getVoices(): NativeVoice[];
  addListener<K extends keyof AnalyzerEvents>(event: K, fn: AnalyzerEvents[K]): Subscription;
};

let cached: SpeechAnalyzerModule | null | undefined;

export function speechAnalyzerModule(): SpeechAnalyzerModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = Platform.OS === 'ios' ? requireOptionalNativeModule<SpeechAnalyzerModule>('HuiSpeechAnalyzer') : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** SpeechAnalyzer usable on this device (iOS 26+, supported hardware, module in the build). */
export function speechAnalyzerAvailable(): boolean {
  const m = speechAnalyzerModule();
  if (!m) return false;
  try {
    return m.isAvailable();
  } catch {
    return false;
  }
}

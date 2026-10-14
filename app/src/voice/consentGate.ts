// AI data-sharing consent at the voice execution boundary (review part 5, finding 4). Chat sends are gated in the
// composer; voice sends audio / text to a remote service by itself, so the engines that leave the device ask too:
//   bridge  → UI bridge speech services,  apikey → the provider the user configured
// Local engines ('device') stay usable without it. The same gate covers Settings previews, auto-read and the demo.
import { aiConsentCurrentNow, isAiConsentCurrent, requestAiConsent } from '../compliance/store';
import { VoiceError } from './types.ts';
import type { SttEngine, TtsEngine } from './types.ts';

export function voiceEngineNeedsConsent(engine: SttEngine | TtsEngine): boolean {
  return engine === 'bridge' || engine === 'apikey';
}

export type ConsentDeps = {
  /** is the consent for the current text version stored? */
  isCurrent(): Promise<boolean>;
  /** show the notice; resolves true when accepted */
  request(): Promise<boolean>;
};

const defaultDeps: ConsentDeps = { isCurrent: isAiConsentCurrent, request: requestAiConsent };

export type VoiceConsent = { ok: true; /** the notice was shown just now (a hold-to-talk gesture is over by then) */ prompted: boolean } | { ok: false; error: VoiceError };

/** `ok` = go ahead; otherwise the error to show instead of starting the remote voice. */
export async function ensureVoiceConsent(engine: SttEngine | TtsEngine, deps?: ConsentDeps): Promise<VoiceConsent> {
  if (!voiceEngineNeedsConsent(engine)) return { ok: true, prompted: false };
  try {
    const d = deps ?? defaultDeps;
    if (await d.isCurrent()) return { ok: true, prompted: false };
    if (await d.request()) return { ok: true, prompted: true };
  } catch {
    // unreadable consent state counts as "not given"
  }
  return { ok: false, error: new VoiceError('permission', 'voice.errors.consentRequired') };
}

/**
 * Synchronous fast path for dictation start: true when `engine` needs no consent or the stored consent is already
 * loaded and current (revoking it in Settings updates the same in-memory state). false = use ensureVoiceConsent.
 */
export function voiceConsentKnown(engine: SttEngine | TtsEngine, now: () => boolean | null = aiConsentCurrentNow): boolean {
  return !voiceEngineNeedsConsent(engine) || now() === true;
}

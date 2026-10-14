/**
 * Microphone permission (expo-audio). Requires the expo-audio config plugin with a German
 * `microphonePermission` text and RECORD_AUDIO on Android (see INTEGRATION.md – note that
 * `expo-image-picker` with `microphonePermission: false` BLOCKS RECORD_AUDIO).
 */
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking } from 'react-native';
import { VoiceError } from './types';

export type MicPermission = {
  ok: boolean;
  /** permanently denied → offer openAppSettings() */
  blocked: boolean;
  /** the system dialog was shown (a hold-to-talk gesture is over by then) */
  prompted: boolean;
  /** why it failed (render with voiceErrorText) */
  error?: VoiceError;
};

/**
 * A granted microphone permission, remembered for this process: dictation then starts without a native permission
 * round trip. Safe to keep: revoking it in the system settings ends the app process on Android and iOS; a start
 * that fails anyway (web: site setting changed) forgets it (forgetMicPermission) and the next start asks the OS.
 */
let micGranted = false;

/** The microphone permission is known to be granted (no await needed before recording). */
export const micPermissionKnown = (): boolean => micGranted;

/** The recorder failed to start: check the permission with the OS again next time. */
export function forgetMicPermission(): void {
  micGranted = false;
}

export async function ensureMicPermission(): Promise<MicPermission> {
  if (micGranted) return { ok: true, blocked: false, prompted: false };
  try {
    let p = await getRecordingPermissionsAsync();
    if (p.granted) {
      micGranted = true;
      return { ok: true, blocked: false, prompted: false };
    }
    const prompted = p.canAskAgain;
    if (p.canAskAgain) p = await requestRecordingPermissionsAsync();
    micGranted = p.granted;
    if (p.granted) return { ok: true, blocked: false, prompted };
    return p.canAskAgain
      ? { ok: false, blocked: false, prompted, error: new VoiceError('permission', 'voice.errors.permissionDenied') }
      : { ok: false, blocked: true, prompted, error: new VoiceError('permission', 'voice.errors.permissionBlocked') };
  } catch {
    return { ok: false, blocked: false, prompted: false, error: new VoiceError('permission', 'voice.errors.microphoneUnavailable') };
  }
}

/** Current microphone permission without prompting (false on errors). */
export async function micPermissionGranted(): Promise<boolean> {
  try {
    const granted = (await getRecordingPermissionsAsync()).granted;
    micGranted = granted;
    return granted;
  } catch {
    return false;
  }
}

export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

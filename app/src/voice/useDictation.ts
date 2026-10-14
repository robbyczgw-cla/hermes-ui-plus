/**
 * Dictation (speech → text into the composer). Engine per settings `sttEngine` (engine.ts resolveSttEngine):
 * - 'bridge' / 'apikey': mic permission → expo-audio recorder (AAC/.m4a mono on Android + iOS, webm on web,
 *   metering on) → stop → POST /bridge/stt or the own key's /audio/transcriptions → `onText(text)`.
 * - 'device': OS recognition (deviceStt.ts); the interim transcript streams into the RecordingBar
 *   (it replaces the text input while dictating), the final text goes to `onText` when the engine ends.
 * The composer inserts the text; nothing is sent.
 * Modes: 'tap' (tap to start, tap to stop) and 'hold' (hold to talk, release to stop, slide left to
 * cancel); 'press' = the MicButton started on touch-down and resolves it to tap / hold / abort (resolvePress,
 * holdPress.ts) while the recorder is already starting. Hard limit 120 s → auto stop + transcribe. Without bridge
 * `start()` only explains why. Consent and a granted permission are remembered (consentGate voiceConsentKnown,
 * permissions micPermissionKnown): after the first time a start goes straight to the recorder.
 *
 * Level meter + timer live in a tiny external store (`useDictationMeter`) so only the RecordingBar
 * re-renders at 10 Hz, not the whole composer.
 */
import { AudioQuality, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { useLocale, useT } from '../i18n';
import type { TKey } from '../i18n/core.ts';
import { haptic } from '../ui';
import { isSttApiComplete } from './apiCore';
import { useVoiceApiKeys } from './apiKeys';
import { transcribeWithApi } from './apiVoice';
import { transcribe } from './bridge';
import { ensureVoiceConsent, voiceConsentKnown } from './consentGate';
import { isAiConsentCurrent } from '../compliance/store';
import {
  deviceSttAvailable,
  ensureRecognitionPermission,
  forgetRecognitionPermission,
  prewarmRecognition,
  recognitionPermissionGranted,
  recognitionPermissionKnown,
  startRecognition,
} from './deviceStt';
import { dropDictationNotice, needsPermissionRecheck, type DictationNoticeEvent } from './dictationNotice';
import type { RecognitionResult, RecognitionSession } from './deviceStt';
import { bridgeVoiceSupport, recognitionLocale, resolveSttEngine } from './engine';
import type { EngineUnavailable } from './engine';
import { meteringToLevel, pushLevel } from './format';
import { ensureMicPermission, forgetMicPermission, micPermissionGranted, micPermissionKnown, openAppSettings } from './permissions';
import { useVoiceSettings } from './settingsStore';
import { stopSpeaking } from './speaker';
import { isVoiceError, VOICE_LIMITS, voiceErrorText } from './types';
import type { SttApiSettings, SttEngine, SttLanguage, VoiceConn } from './types';
import { useVoiceConfig } from './useVoiceConfig';

/** Speech-tuned preset: mono AAC 64 kbit/s in .m4a (Android mpeg4/aac, iOS MPEG4AAC), metering on. */
export const SPEECH_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { ...RecordingPresets.HIGH_QUALITY.android, extension: '.m4a', outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { ...RecordingPresets.HIGH_QUALITY.ios, extension: '.m4a', audioQuality: AudioQuality.HIGH },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};

/** Dictionary key of the message shown when no UI bridge is configured (`t(NO_BRIDGE_KEY)`). */
export const NO_BRIDGE_KEY = 'voice.dictation.noBridge' as const;

export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing';
/** 'press': started on touch-down, not yet known whether it is a tap or a hold (MicButton resolves it) */
export type DictationMode = 'tap' | 'hold' | 'press';
/**
 * `partial`: live transcript (on-device engine only). `modelProgress`: 0..1 while the on-device language model
 * downloads before listening starts (iOS 26 SpeechAnalyzer, first use per language), else null.
 */
export type DictationMeter = { elapsedMs: number; levels: number[]; partial: string; modelProgress: number | null };

/** Message shown on tap when no engine is available. */
export const UNAVAILABLE_KEYS: Record<EngineUnavailable, TKey> = {
  no_bridge: 'voice.dictation.noBridge',
  no_device: 'voice.dictation.noDevice',
  no_key: 'voice.dictation.noKey',
  none: 'voice.dictation.noEngine',
};

type MeterStore = { get(): DictationMeter; set(m: DictationMeter): void; subscribe(fn: () => void): () => void };

function createMeterStore(): MeterStore {
  let v: DictationMeter = { elapsedMs: 0, levels: [], partial: '', modelProgress: null };
  const ls = new Set<() => void>();
  return {
    get: () => v,
    set: (m) => {
      v = m;
      for (const l of ls) l();
    },
    subscribe: (fn) => {
      ls.add(fn);
      return () => {
        ls.delete(fn);
      };
    },
  };
}

export type Dictation = {
  phase: DictationPhase;
  /** phase !== 'idle' → show <RecordingBar/> instead of the text input */
  active: boolean;
  mode: DictationMode | null;
  /** an engine is available (otherwise start() only explains why, see `unavailable`) */
  available: boolean;
  /** engine used by start() (null = unavailable) */
  engine: SttEngine | null;
  /** why no engine is available (null when available) */
  unavailable: EngineUnavailable | null;
  maxMs: number;
  /** message in the active language (permission, too short, network, …); null = none */
  error: string | null;
  /** permission permanently denied → show "Einstellungen öffnen" */
  permissionBlocked: boolean;
  /** last transcription failed but the recording was kept → retry() */
  canRetry: boolean;
  /** hold-to-talk: horizontal finger offset (≤ 0) for the "slide to cancel" hint */
  holdDragX: number;
  start(mode?: DictationMode): Promise<void>;
  /** stop recording and transcribe */
  stop(): Promise<void>;
  /** discard recording / abort upload */
  cancel(): void;
  retry(): Promise<void>;
  /** MicButton: finger lifted after a hold */
  releaseHold(): void;
  /**
   * MicButton: a start('press') turned out to be a tap (keep recording, tap mode), a hold (hold-to-talk) or was
   * aborted (touch cancelled by the system: discarded; a consent / permission dialog shown meanwhile ends with
   * its hint as for a hold)
   */
  resolvePress(as: 'tap' | 'hold' | 'abort'): void;
  setHoldDragX(dx: number): void;
  clearError(): void;
  /** drop a stale notice (chat screen left / chat switched); keeps a failed recording that can be retried */
  dismissNotice(ev: Extract<DictationNoticeEvent, { type: 'left' | 'chatChanged' }>['type']): void;
  openSettings(): void;
  /** @internal for useDictationMeter */
  meter: MeterStore;
};

export type UseDictationOptions = {
  /** UI bridge (voiceConnFromProfile(profile)); null → no bridge engine (device / own key may still work) */
  conn: VoiceConn | null;
  /** transcript → insert into the composer (e.g. with insertDictation) */
  onText(text: string): void;
  /** overrides the saved STT language */
  language?: SttLanguage;
  maxDurationMs?: number;
  /** waveform history length (bars) */
  levelBars?: number;
};

function deleteRecording(uri: string | null | undefined) {
  if (!uri) return;
  try {
    if (Platform.OS === 'web') {
      if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
      return;
    }
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}

function announce(msg: string) {
  if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(msg);
}

async function resetAudioMode() {
  await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
}

export function useDictation(opts: UseDictationOptions): Dictation {
  const recorder = useAudioRecorder(SPEECH_RECORDING_OPTIONS);
  const [settings] = useVoiceSettings();
  const keys = useVoiceApiKeys();
  const { locale } = useLocale();
  const bridgeCfg = useVoiceConfig(opts.conn);
  const language = opts.language ?? settings.sttLanguage;
  const maxMs = opts.maxDurationMs ?? VOICE_LIMITS.maxRecordingMs;
  const bars = opts.levelBars ?? 48;

  const [phase, setPhaseState] = useState<DictationPhase>('idle');
  const [mode, setModeState] = useState<DictationMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [holdDragX, setHoldDragXState] = useState(0);
  const [meter] = useState(createMeterStore);
  // the permission hint shown (dictationNotice.ts): cleared once the permission is granted later
  const permError = useRef<{ text: string; engine: SttEngine } | null>(null);
  const notice = useRef({ error, canRetry });
  notice.current = { error, canRetry };

  const phaseRef = useRef<DictationPhase>('idle');
  const modeRef = useRef<DictationMode | null>(null);
  const session = useRef(0);
  const startedAt = useRef(0);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadCtrl = useRef<AbortController | null>(null);
  const pendingStop = useRef(false);
  /** a 'press' start whose touch was cancelled while still starting: discard once the start gets that far */
  const pendingAbort = useRef(false);
  /** = cancel (defined further down): discards a start that is still in its 'starting' phase, silently */
  const abortStart = useRef<() => void>(() => undefined);
  const failedUri = useRef<string | null>(null);
  const recognition = useRef<RecognitionSession | null>(null);
  /** cancels an in-flight on-device start (model installation, native start) */
  const startCtrl = useRef<AbortController | null>(null);
  const stopGuard = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** session whose on-device recognition already ended (an early 'end' can arrive before start() resolved) */
  const deviceDone = useRef(-1);
  const sessionEngine = useRef<SttEngine>('bridge');
  const t = useT();
  const resolved = resolveSttEngine({
    choice: settings.sttEngine,
    bridge: bridgeVoiceSupport(!!opts.conn, bridgeCfg.config, 'stt', { configError: bridgeCfg.error }),
    device: deviceSttAvailable(),
    apiKey: keys.stt && isSttApiComplete(settings.sttApi),
  });
  const deviceLang = recognitionLocale(language, locale);
  const latest = useRef({ conn: opts.conn, onText: opts.onText, language, maxMs, bars, t, resolved, deviceLang, sttApi: settings.sttApi as SttApiSettings });
  useEffect(() => {
    latest.current = { conn: opts.conn, onText: opts.onText, language, maxMs, bars, t, resolved, deviceLang, sttApi: settings.sttApi };
  });

  const go = useCallback((p: DictationPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const setMode = useCallback((m: DictationMode | null) => {
    modeRef.current = m;
    setModeState(m);
  }, []);
  const clearPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    if (stopGuard.current) clearTimeout(stopGuard.current);
    stopGuard.current = null;
  };
  const dropFailed = () => {
    deleteRecording(failedUri.current);
    failedUri.current = null;
    setCanRetry(false);
  };

  const runTranscription = useCallback(
    async (my: number, uri: string) => {
      const conn = latest.current.conn;
      const tr = latest.current.t;
      const viaApi = sessionEngine.current === 'apikey';
      if (!conn && !viaApi) {
        deleteRecording(uri);
        go('idle');
        setError(tr(NO_BRIDGE_KEY));
        return;
      }
      go('transcribing');
      const ctrl = new AbortController();
      uploadCtrl.current = ctrl;
      let keep = false;
      try {
        const sttOpts = { language: latest.current.language, signal: ctrl.signal };
        const res = viaApi || !conn ? await transcribeWithApi(uri, latest.current.sttApi, sttOpts) : await transcribe(uri, conn, sttOpts);
        if (my !== session.current) return;
        latest.current.onText(res.text);
        haptic('success');
        announce(tr('voice.dictation.inserted'));
      } catch (e) {
        if (my !== session.current) return;
        const msg = isVoiceError(e) ? voiceErrorText(e, tr) : tr('voice.errors.dictationFailed');
        keep = isVoiceError(e) && ['network', 'timeout', 'server', 'rate_limited'].includes(e.code);
        setError(keep ? tr('voice.dictation.keepRecording', { message: msg }) : msg);
        haptic('warning');
        announce(msg);
      } finally {
        if (uploadCtrl.current === ctrl) uploadCtrl.current = null;
        if (keep && my === session.current) {
          failedUri.current = uri;
          setCanRetry(true);
        } else {
          deleteRecording(uri);
        }
        if (my === session.current) go('idle');
      }
    },
    [go]
  );

  // ── on-device recognition ──────────────────────────────────────────────────
  const finishDevice = (my: number, r: RecognitionResult) => {
    if (my !== session.current || deviceDone.current === my) return;
    deviceDone.current = my;
    clearPoll();
    recognition.current = null;
    void resetAudioMode();
    const tr = latest.current.t;
    const text = r.text.trim();
    if (text) {
      latest.current.onText(text);
      haptic('success');
      announce(tr('voice.dictation.inserted'));
    } else {
      const msg = r.error ? voiceErrorText(r.error, tr) : tr('voice.errors.noSpeech');
      setError(msg);
      permError.current = r.error?.code === 'permission' ? { text: msg, engine: 'device' } : null;
      if (r.error?.code === 'permission') forgetRecognitionPermission();
      setPermissionBlocked(!!r.error && r.error.code === 'permission' && Platform.OS !== 'web');
      haptic('warning');
      announce(msg);
    }
    setMode(null);
    go('idle');
  };
  const finishDeviceRef = useRef(finishDevice);
  useEffect(() => {
    finishDeviceRef.current = finishDevice;
  });

  const startDevice = async (my: number) => {
    const tr = latest.current.t;
    const ctrl = new AbortController();
    startCtrl.current = ctrl;
    try {
      const rec = await startRecognition(latest.current.deviceLang, {
        onPartial: (text) => {
          if (my === session.current) meter.set({ ...meter.get(), partial: text });
        },
        onLevel: (lv) => {
          if (my === session.current) {
            const prev = meter.get();
            meter.set({ ...prev, levels: pushLevel(prev.levels, lv, latest.current.bars) });
          }
        },
        onEnd: (r) => finishDeviceRef.current(my, r),
        onModelProgress: (p) => {
          if (my === session.current) meter.set({ ...meter.get(), modelProgress: p });
        },
      }, ctrl.signal);
      if (startCtrl.current === ctrl) startCtrl.current = null;
      if (my !== session.current) {
        rec.abort();
        return;
      }
      if (deviceDone.current === my) return; // ended already (error / no speech) → finishDevice handled it
      recognition.current = rec;
      if (pendingAbort.current) {
        abortStart.current(); // silent: still starting
        return;
      }
    } catch (e) {
      if (startCtrl.current === ctrl) startCtrl.current = null;
      if (my !== session.current) return;
      if (isVoiceError(e) && e.code === 'permission') forgetRecognitionPermission();
      await resetAudioMode();
      go('idle');
      setMode(null);
      setError(isVoiceError(e) ? voiceErrorText(e, tr) : tr('voice.dictation.startFailed'));
      haptic('warning');
      return;
    }
    startedAt.current = Date.now();
    go('recording');
    haptic('medium');
    announce(tr('voice.recording.label'));
    clearPoll();
    poll.current = setInterval(() => {
      if (my !== session.current) return clearPoll();
      const elapsed = Date.now() - startedAt.current;
      meter.set({ ...meter.get(), elapsedMs: elapsed });
      if (elapsed >= latest.current.maxMs) {
        haptic('warning');
        void stopRef.current();
      }
    }, 100);
    if (pendingStop.current) {
      pendingStop.current = false;
      void stopRef.current();
    }
  };

  const stop = useCallback(async () => {
    if (phaseRef.current === 'starting') {
      pendingStop.current = true; // stop as soon as the recorder runs
      return;
    }
    if (phaseRef.current !== 'recording') return;
    const my = session.current;
    clearPoll();
    if (sessionEngine.current === 'device') {
      // the engine delivers the final result, then 'end' → finishDevice; guard against a missing 'end'
      go('transcribing');
      haptic('light');
      recognition.current?.stop();
      stopGuard.current = setTimeout(() => {
        if (my === session.current && phaseRef.current === 'transcribing') {
          // settle with the partial transcript first, then tear the engine down (abort() detaches silently)
          const partial = meter.get().partial;
          finishDeviceRef.current(my, { text: partial, error: null });
          recognition.current?.abort();
        }
      }, 6000);
      return;
    }
    const elapsed = Math.max(meter.get().elapsedMs, Date.now() - startedAt.current);
    go('transcribing');
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      uri = recorder.uri;
    }
    await resetAudioMode();
    if (my !== session.current) {
      deleteRecording(uri);
      return;
    }
    const tr = latest.current.t;
    if (!uri) {
      go('idle');
      setError(tr('voice.dictation.recordingFailed'));
      return;
    }
    if (elapsed < VOICE_LIMITS.minRecordingMs) {
      deleteRecording(uri);
      go('idle');
      setError(modeRef.current === 'hold' ? tr('voice.dictation.tooShortHold') : tr('voice.dictation.tooShortTap'));
      haptic('warning');
      return;
    }
    haptic('light');
    await runTranscription(my, uri);
  }, [go, meter, recorder, runTranscription]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  const start = useCallback(
    async (m: DictationMode = 'tap') => {
      if (phaseRef.current !== 'idle') return;
      permError.current = null;
      setError(null);
      setPermissionBlocked(false);
      dropFailed();
      const tr = latest.current.t;
      const { resolved: r } = latest.current;
      if (!r.engine) {
        setError(tr(UNAVAILABLE_KEYS[r.reason]));
        haptic('warning');
        return;
      }
      const engine = r.engine;
      stopSpeaking();
      const my = ++session.current;
      sessionEngine.current = engine;
      pendingStop.current = false;
      pendingAbort.current = false;
      setMode(m);
      setHoldDragXState(0);
      meter.set({ elapsedMs: 0, levels: [], partial: '', modelProgress: null });
      go('starting');

      // a hold (or a press not yet resolved) is over once a dialog took the finger; a tap goes on after it
      const fingerGone = () => modeRef.current !== 'tap';

      // remote engines (bridge / own key) upload the recording: data-sharing consent first (consentGate.ts).
      // Known (accepted earlier, in memory) → no await at all
      if (!voiceConsentKnown(engine)) {
        const consent = await ensureVoiceConsent(engine);
        if (my !== session.current) return;
        if (!consent.ok) {
          go('idle');
          setMode(null);
          setError(voiceErrorText(consent.error, tr));
          haptic('warning');
          return;
        }
        if (consent.prompted && fingerGone()) {
          // the finger is long gone after the notice
          go('idle');
          setMode(null);
          setError(tr('voice.dictation.consentDone'));
          return;
        }
      }

      // granted before in this process → no native permission round trip
      if (!(engine === 'device' ? recognitionPermissionKnown() : micPermissionKnown())) {
        const perm = engine === 'device' ? await ensureRecognitionPermission() : await ensureMicPermission();
        if (my !== session.current) return;
        if (!perm.ok) {
          go('idle');
          setMode(null);
          const permMsg = perm.error ? voiceErrorText(perm.error, tr) : tr('voice.errors.permissionDenied');
          permError.current = { text: permMsg, engine };
          setError(permMsg);
          setPermissionBlocked(perm.blocked);
          haptic('warning');
          return;
        }
        if (perm.prompted && fingerGone()) {
          // the finger is long gone after the system dialog
          go('idle');
          setMode(null);
          setError(tr('voice.dictation.micAllowed'));
          return;
        }
      }
      if (pendingAbort.current) {
        abortStart.current(); // silent: still starting
        return;
      }
      if (engine === 'device') {
        await startDevice(my);
        return;
      }
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (my !== session.current) {
          await resetAudioMode();
          return;
        }
        if (pendingAbort.current) {
          abortStart.current(); // silent: still starting
          return;
        }
        recorder.record();
      } catch {
        if (my !== session.current) return;
        forgetMicPermission(); // revoked meanwhile (web site setting)? the next start asks the OS again
        await resetAudioMode();
        go('idle');
        setMode(null);
        setError(tr('voice.dictation.startFailed'));
        haptic('warning');
        return;
      }
      startedAt.current = Date.now();
      go('recording');
      haptic('medium');
      announce(tr('voice.recording.label'));
      clearPoll();
      poll.current = setInterval(() => {
        if (my !== session.current) return clearPoll();
        let st: { durationMillis: number; metering?: number } | null = null;
        try {
          st = recorder.getStatus();
        } catch {
          st = null;
        }
        const elapsed = st && st.durationMillis > 0 ? st.durationMillis : Date.now() - startedAt.current;
        const prev = meter.get();
        meter.set({ ...prev, elapsedMs: elapsed, levels: pushLevel(prev.levels, meteringToLevel(st?.metering), latest.current.bars) });
        if (elapsed >= latest.current.maxMs) {
          haptic('warning');
          void stop();
        }
      }, 100);
      if (pendingStop.current) {
        pendingStop.current = false;
        void stop();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [go, meter, recorder, setMode, stop]
  );

  const cancel = useCallback(() => {
    const ph = phaseRef.current;
    session.current++;
    clearPoll();
    pendingStop.current = false;
    pendingAbort.current = false;
    uploadCtrl.current?.abort();
    uploadCtrl.current = null;
    startCtrl.current?.abort(); // dictation cancelled while the on-device engine is still starting
    startCtrl.current = null;
    if (sessionEngine.current === 'device' && recognition.current) {
      recognition.current.abort();
      recognition.current = null;
      void resetAudioMode();
      if (ph === 'recording') {
        haptic('light');
        announce(latest.current.t('voice.recording.discarded'));
      }
    } else if (ph === 'recording') {
      recorder
        .stop()
        .then(() => deleteRecording(recorder.uri))
        .catch(() => undefined)
        .finally(() => void resetAudioMode());
      haptic('light');
      announce(latest.current.t('voice.recording.discarded'));
    } else if (ph === 'starting') {
      void resetAudioMode();
    }
    setHoldDragXState(0);
    setMode(null);
    if (ph !== 'idle') go('idle');
  }, [go, recorder, setMode]);

  const retry = useCallback(async () => {
    const uri = failedUri.current;
    if (!uri || phaseRef.current !== 'idle') return;
    failedUri.current = null;
    setCanRetry(false);
    setError(null);
    const my = ++session.current;
    await runTranscription(my, uri);
  }, [runTranscription]);

  const releaseHold = useCallback(() => {
    setHoldDragXState(0);
    if (modeRef.current !== 'hold') return;
    if (phaseRef.current === 'starting') pendingStop.current = true;
    else if (phaseRef.current === 'recording') void stop();
  }, [stop]);

  const resolvePress = useCallback(
    (as: 'tap' | 'hold' | 'abort') => {
      if (modeRef.current !== 'press') return;
      const ph = phaseRef.current;
      if (ph === 'idle') return setMode(null); // the start already ended (error, no engine)
      if (as === 'tap') setMode('tap');
      else if (as === 'hold') setMode('hold');
      else if (ph === 'starting') pendingAbort.current = true; // discarded once the start gets past its dialogs
      else cancel();
    },
    [cancel, setMode]
  );

  const setHoldDragX = useCallback((dx: number) => {
    const v = Math.min(0, Math.round(dx / 4) * 4);
    setHoldDragXState((old) => (old === v ? old : v));
  }, []);

  // app to background while recording → finish (iOS/Android stop the mic anyway)
  // back in the foreground with a permission hint showing → re-check (no prompt); granted → the hint goes
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' && phaseRef.current === 'recording') void stop();
      const p = permError.current;
      if (s !== 'active' || !p || !needsPermissionRecheck({ error: notice.current.error, permissionError: p.text })) return;
      void (p.engine === 'device' ? recognitionPermissionGranted() : micPermissionGranted()).then((granted) => {
        if (permError.current !== p) return;
        if (!dropDictationNotice({ error: notice.current.error, permissionError: p.text }, { type: 'appActive', granted })) return;
        permError.current = null;
        setError(null);
        setPermissionBlocked(false);
      });
    });
    return () => sub.remove();
  }, [stop]);

  const dismissNotice = useCallback((type: 'left' | 'chatChanged') => {
    const n = notice.current;
    if (!dropDictationNotice({ error: n.error, permissionError: permError.current?.text ?? null, canRetry: n.canRetry }, { type })) return;
    permError.current = null;
    setError(null);
    setPermissionBlocked(false);
  }, []);

  // unmount (chat closed) → discard everything
  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
    abortStart.current = cancel;
  });

  // idle-time warm-up (composer mounted, nothing prompts): consent state + permission without a dialog, Android's
  // offline recognition languages → the first press after opening a chat already takes the fast path. The
  // recorder / audio session is NOT prepared ahead: on iOS that activates a play-and-record session (stops the
  // user's music, re-routes read-aloud playback), so it stays on the press.
  const warmEngine = resolved.engine;
  useEffect(() => {
    if (!warmEngine) return;
    const timer = setTimeout(() => {
      if (warmEngine !== 'device') void isAiConsentCurrent().catch(() => undefined);
      if (warmEngine === 'device') void prewarmRecognition(latest.current.deviceLang).catch(() => undefined);
      else if (!micPermissionKnown()) void micPermissionGranted();
    }, 600);
    return () => clearTimeout(timer);
  }, [warmEngine]);
  useEffect(
    () => () => {
      cancelRef.current();
      deleteRecording(failedUri.current);
      failedUri.current = null;
    },
    []
  );

  return useMemo<Dictation>(
    () => ({
      phase,
      active: phase !== 'idle',
      mode,
      available: !!resolved.engine,
      engine: resolved.engine,
      unavailable: resolved.reason,
      maxMs,
      error,
      permissionBlocked,
      canRetry,
      holdDragX,
      start,
      stop,
      cancel,
      retry,
      releaseHold,
      resolvePress,
      setHoldDragX,
      clearError: () => {
        permError.current = null;
        setError(null);
        setPermissionBlocked(false);
        dropFailed();
      },
      dismissNotice,
      openSettings: openAppSettings,
      meter,
    }),
    [phase, mode, resolved.engine, resolved.reason, maxMs, error, permissionBlocked, canRetry, holdDragX, start, stop, cancel, retry, releaseHold, resolvePress, setHoldDragX, dismissNotice, meter]
  );
}

/** Timer + level history of a dictation (re-renders ~10×/s while recording). */
export function useDictationMeter(d: Pick<Dictation, 'meter'>): DictationMeter {
  return useSyncExternalStore(d.meter.subscribe, d.meter.get, d.meter.get);
}

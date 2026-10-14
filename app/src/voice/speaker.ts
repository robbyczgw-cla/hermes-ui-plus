/**
 * Global speaker ("Vorlesen"): exactly one message plays at a time across the app.
 *
 * Engines (chosen per settings `ttsEngine`, see engine.ts resolveTtsEngine):
 * - 'bridge': /bridge/tts per chunk (≤ 3500 chars, small first chunk), next chunk prefetched while the
 *   current one plays; files from the cache dir are played by one shared expo-audio player.
 * - 'apikey': own key, OpenAI-compatible /audio/speech or Deepgram – same chunk queue + player.
 * - 'device': expo-speech / speechSynthesis (chosen, or no bridge, or the bridge refuses TTS). Saved or best voice for the locale.
 *
 * Pause: player engines → player.pause(); device → stop + resume at the start of the interrupted (small) chunk.
 * The app going to the background pauses playback.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { TFn } from '../i18n/core.ts';
import { isTtsApiComplete, ttsApiChunkChars } from './apiCore';
import type { AppLang } from './apiCore';
import { getVoiceApiKey } from './apiKeys';
import { fetchApiTtsAudio } from './apiVoice';
import { cachedVoiceConfig, clearTtsCache, fetchTtsAudio } from './bridge';
import type { TtsAudio } from './bridge';
import { bridgeOrigin, resolveVoice } from './bridgeCore';
import { chunkText, overallProgress } from './chunking';
import { ensureVoiceConsent } from './consentGate';
import { deviceMaxChars, resolveDeviceVoice, speakOnDevice, stopDeviceSpeech } from './deviceTts';
import { bridgeVoiceSupport, resolveTtsEngine } from './engine';
import { runChunkQueue } from './queue';
import { getVoiceSettings } from './settingsStore';
import { toSpeechText } from './speechText';
import { isVoiceError, VOICE_LIMITS, VoiceError } from './types';
import type { TtsEngine, VoiceConn } from './types';

export type SpeakerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type SpeakerEngine = TtsEngine;

/** Engines that play downloaded audio files through the shared expo-audio player. */
const usesPlayer = (e: SpeakerEngine | null) => e === 'bridge' || e === 'apikey';

export type SpeakerState = {
  /** id passed to speak(); null when idle */
  messageId: string | null;
  status: SpeakerStatus;
  /** 0..1 over the whole message (weighted by chunk length) */
  progress: number;
  chunk: number;
  chunks: number;
  engine: SpeakerEngine | null;
  /** why playback failed when status === 'error' (render with voiceErrorText) */
  error: VoiceError | null;
};

export type SpeakRequest = {
  /** message id (or any key, e.g. `preview:<voice>`) */
  id: string;
  /** assistant markdown (hui/code blocks are summarised) – or plain text with `plain: true` */
  text: string;
  /** UI bridge; null → on-device voice */
  conn: VoiceConn | null;
  plain?: boolean;
  /** override the saved voice (null = bridge default) */
  voice?: string | null;
  /** override the saved speed */
  rate?: number;
  /** active translator: spoken hui summaries (toSpeechText) use the app language */
  t: TFn;
  /** active BCP47 locale, e.g. 'de-DE' / 'en-US': on-device voice language */
  locale: string;
  /** force an engine (settings preview); otherwise resolved from the settings */
  engine?: TtsEngine;
  /** override the saved on-device voice (preview) */
  deviceVoice?: string | null;
};

export const IDLE_SPEAKER: SpeakerState = Object.freeze({
  messageId: null,
  status: 'idle',
  progress: 0,
  chunk: 0,
  chunks: 0,
  engine: null,
  error: null,
}) as SpeakerState;

let state: SpeakerState = IDLE_SPEAKER;
const listeners = new Set<() => void>();
let session = 0;
let abortCtrl: AbortController | null = null;
let deviceCtrl: AbortController | null = null;
let paused = false;
let resumeWaiter: (() => void) | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;
let player: AudioPlayer | null = null;
let appStateHooked = false;
let cacheCleared = false;
/** origin → until (ms): the bridge said "no TTS" → use the device voice for a while */
const bridgeTtsOff = new Map<string, number>();

function set(next: Partial<SpeakerState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function getSpeakerState(): SpeakerState {
  return state;
}

export function subscribeSpeaker(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getPlayer(): AudioPlayer {
  if (!player) player = createAudioPlayer(null, { updateInterval: 200 });
  return player;
}

function hookAppState() {
  if (appStateHooked) return;
  appStateHooked = true;
  AppState.addEventListener('change', (s) => {
    if (s === 'background' && state.status === 'playing') pauseSpeaking();
  });
}

function isTtsOff(conn: VoiceConn): boolean {
  const until = bridgeTtsOff.get(bridgeOrigin(conn.baseUrl));
  return !!until && until > Date.now();
}

/** Stop whatever is playing and reset to idle. Call on new chat / conversation switch. */
export function stopSpeaking(): void {
  session++;
  abortCtrl?.abort();
  abortCtrl = null;
  deviceCtrl?.abort();
  deviceCtrl = null;
  paused = false;
  const w = resumeWaiter;
  resumeWaiter = null;
  w?.();
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = null;
  try {
    player?.pause();
  } catch {
    // ignore
  }
  stopDeviceSpeech();
  if (state !== IDLE_SPEAKER) {
    state = IDLE_SPEAKER;
    for (const l of listeners) l();
  }
}

export function pauseSpeaking(): void {
  if (state.status !== 'playing' && state.status !== 'loading') return;
  paused = true;
  if (usesPlayer(state.engine)) {
    try {
      player?.pause();
    } catch {
      // ignore
    }
  } else {
    deviceCtrl?.abort(); // restart this chunk on resume
  }
  set({ status: 'paused' });
}

export function resumeSpeaking(): void {
  if (state.status !== 'paused') return;
  paused = false;
  if (usesPlayer(state.engine)) {
    try {
      player?.play();
    } catch {
      // ignore
    }
  }
  const w = resumeWaiter;
  resumeWaiter = null;
  w?.();
  set({ status: 'playing' });
}

/** Change speed of the running playback (also persisted by the caller via settings). */
export function setSpeakerRate(rate: number): void {
  if (usesPlayer(state.engine) && player) applyRate(player, rate);
  currentRate = rate;
}

let currentRate = 1;

function applyRate(p: AudioPlayer, rate: number) {
  try {
    p.setPlaybackRate(rate, 'high');
  } catch {
    // unsupported → normal speed
  }
}

/** Tap on a speak button: start, pause, resume (or stop while loading). */
export function toggleSpeaking(req: SpeakRequest): void {
  if (state.messageId === req.id) {
    if (state.status === 'playing') return pauseSpeaking();
    if (state.status === 'paused') return resumeSpeaking();
    if (state.status === 'loading') return stopSpeaking();
  }
  void speak(req);
}

function fail(my: number, e: unknown) {
  if (my !== session) return;
  const error = isVoiceError(e) ? e : new VoiceError('unknown', 'voice.errors.speakFailed');
  set({ status: 'error', error });
  errorTimer = setTimeout(() => {
    if (my === session && state.status === 'error') stopSpeaking();
  }, 5000);
}


const appLang = (locale: string): AppLang => {
  const b = locale.toLowerCase().slice(0, 2);
  return b === 'en' || b === 'es' ? b : 'de';
};

/** Engine for this request (settings + what is available right now). */
async function pickEngine(req: SpeakRequest): Promise<TtsEngine | VoiceError> {
  if (req.engine) {
    return req.engine;
  }
  const settings = getVoiceSettings();
  const choice = settings.ttsEngine;
  const bridge = bridgeVoiceSupport(!!req.conn, cachedVoiceConfig(req.conn), 'tts', { off: !!req.conn && isTtsOff(req.conn) });
  const needsKey = choice === 'apikey';
  const apiKey = needsKey ? !!(await getVoiceApiKey('tts')) && isTtsApiComplete(settings.ttsApi, appLang(req.locale)) : false;
  const r = resolveTtsEngine({ choice, bridge, apiKey });
  if (r.engine) return r.engine;
  return r.reason === 'no_key' ? new VoiceError('unauthorized', 'voice.errors.apiNoKey', { op: 'tts' }) : new VoiceError('unavailable', 'voice.errors.ttsNoBridge');
}

/**
 * What is read: the whole text (speak) or a list that grows while the answer streams (speakLive). Every engine
 * run chunks it lazily with its own chunk size (chunkFeed).
 */
type SpeechFeed = { texts: string[]; ended: boolean; listeners: Set<() => void> };

function notifyFeed(feed: SpeechFeed) {
  for (const l of Array.from(feed.listeners)) l();
}

/** Lazily chunked view of a feed for one engine run (bridge / own key / device). */
function chunkFeed(feed: SpeechFeed, maxChars: number, firstMaxChars?: number) {
  const chunks: string[] = [];
  let taken = 0;
  const count = (need = Infinity) => {
    if (need >= chunks.length && taken < feed.texts.length) {
      // everything that arrived meanwhile becomes one text: fewer, fuller chunks (one TTS request each)
      const text = feed.texts.slice(taken).join('\n');
      taken = feed.texts.length;
      chunks.push(...chunkText(text, { maxChars, firstMaxChars: chunks.length === 0 ? firstMaxChars : undefined }));
    }
    return chunks.length;
  };
  const waitMore = (signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      if (feed.ended || signal.aborted) return resolve(false);
      const done = () => {
        feed.listeners.delete(done);
        signal.removeEventListener('abort', done);
        resolve(!signal.aborted);
      };
      feed.listeners.add(done);
      signal.addEventListener('abort', done);
    });
  const watch = (onGrow: () => void) => {
    feed.listeners.add(onGrow);
    return () => {
      feed.listeners.delete(onGrow);
    };
  };
  return { chunks, count, waitMore, watch };
}

/** Start reading `req.text` aloud (stops any other playback first). Never throws. */
export async function speak(req: SpeakRequest): Promise<void> {
  const speech = req.plain ? req.text.trim() : toSpeechText(req.text, req.t);
  await run(req, speech ? { texts: [speech], ended: true, listeners: new Set() } : null);
}

export type LiveSpeech = {
  /** more stable markdown of the answer (voice/streamRead.ts) */
  append(markdown: string): void;
  /** the answer is complete: play what is left, then stop */
  end(): void;
};

/**
 * Read an answer aloud while it is still streaming: starts with `first` (the first stable sentences) and plays
 * every appended piece in order. Stops any other playback first; a later speak()/stopSpeaking() ends it (appends
 * are then ignored).
 */
export function speakLive(req: Omit<SpeakRequest, 'text' | 'plain'>, first: string): LiveSpeech {
  const feed: SpeechFeed = { texts: [], ended: false, listeners: new Set() };
  const add = (markdown: string) => {
    if (feed.ended) return;
    const speech = toSpeechText(markdown, req.t);
    if (!speech) return;
    feed.texts.push(speech);
    notifyFeed(feed);
  };
  add(first);
  void run({ ...req, text: first }, feed);
  return {
    append: add,
    end() {
      if (feed.ended) return;
      feed.ended = true;
      notifyFeed(feed);
    },
  };
}

async function run(req: SpeakRequest, feed: SpeechFeed | null): Promise<void> {
  stopSpeaking();
  const my = session;
  const ctrl = new AbortController();
  abortCtrl = ctrl;
  hookAppState();

  if (!feed) {
    set({ messageId: req.id, engine: null });
    fail(my, new VoiceError('empty_text', 'voice.errors.nothingToRead'));
    return;
  }
  const settings = getVoiceSettings();
  currentRate = req.rate ?? settings.ttsRate;
  set({ messageId: req.id, status: 'loading', progress: 0, chunk: 0, chunks: 0, engine: null, error: null });
  const picked = await pickEngine(req);
  if (my !== session) return;
  if (isVoiceError(picked)) {
    fail(my, picked);
    return;
  }
  // the bridge recently said "no TTS" → device voice (as before)
  const engine: TtsEngine = picked === 'bridge' && (!req.conn || isTtsOff(req.conn)) ? 'device' : picked;
  const auto = !req.engine && settings.ttsEngine === 'auto';
  const deviceVoice = req.deviceVoice !== undefined ? req.deviceVoice : settings.deviceVoice;
  const device = async () => {
    const voice = await resolveDeviceVoice(deviceVoice, req.locale);
    if (my !== session) return;
    await runDevice(my, feed, req.locale, voice);
  };
  set({ engine });
  // remote engines (bridge / own key) send the text off the device → data-sharing consent first
  const consent = await ensureVoiceConsent(engine);
  if (my !== session) return;
  if (!consent.ok) {
    fail(my, consent.error);
    return;
  }

  try {
    if (engine === 'bridge' && req.conn && !isTtsOff(req.conn)) {
      const conn = req.conn;
      const voice = req.voice !== undefined ? req.voice : resolveVoice(cachedVoiceConfig(conn), settings.ttsVoice);
      try {
        await runRemote(my, ctrl.signal, feed, VOICE_LIMITS.ttsChunkChars, (text, sig) => fetchTtsAudio(text, conn, voice, sig));
      } catch (e) {
        if (!(isVoiceError(e) && e.code === 'unavailable') || my !== session) throw e;
        // bridge without TTS → device voice for this and the next 10 minutes
        bridgeTtsOff.set(bridgeOrigin(conn.baseUrl), Date.now() + 10 * 60_000);
        set({ engine: 'device', status: 'loading', progress: 0 });
        await device();
      }
    } else if (engine === 'apikey') {
      const api = settings.ttsApi;
      const lang = appLang(req.locale);
      await runRemote(my, ctrl.signal, feed, ttsApiChunkChars(api).maxChars, (text, sig) => fetchApiTtsAudio(text, api, lang, sig));
    } else {
      await device();
    }
    if (my === session) stopSpeaking();
  } catch (e) {
    fail(my, e);
  }
}

/** Chunk queue over a downloaded-audio engine (bridge / own key): prefetch 1, shared player. */
async function runRemote(my: number, signal: AbortSignal, feed: SpeechFeed, maxChars: number, load: (text: string, sig: AbortSignal) => Promise<TtsAudio>): Promise<void> {
  if (!cacheCleared) {
    cacheCleared = true;
    clearTtsCache();
  }
  const view = chunkFeed(feed, maxChars, VOICE_LIMITS.ttsFirstChunkChars);
  const { chunks } = view;
  const lengths = () => chunks.map((c) => c.length);
  set({ chunks: view.count() });
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'duckOthers', shouldPlayInBackground: false }).catch(() => undefined);
  await runChunkQueue(
    {
      count: view.count,
      waitMore: view.waitMore,
      watch: view.watch,
      prefetch: 1,
      load: (i, sig) => load(chunks[i], sig),
      release: (a) => a.release(),
      onWaiting: (i) => {
        if (my === session && !paused) set({ status: 'loading', chunk: i });
      },
      onChunkStart: (i) => {
        if (my === session) set({ status: paused ? 'paused' : 'playing', chunk: i, chunks: chunks.length, progress: overallProgress(lengths(), i, 0) });
      },
      play: (audio, i, sig) => playFile(my, audio.uri, (f) => {
        const p = overallProgress(lengths(), i, f);
        if (Math.abs(p - state.progress) >= 0.005) set({ progress: p });
      }, sig),
    },
    signal
  );
}

function playFile(my: number, uri: string, onFraction: (f: number) => void, signal: AbortSignal): Promise<void> {
  const p = getPlayer();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let sawPlaying = false;
    const startedAt = Date.now();
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      sub.remove();
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      try {
        p.pause();
      } catch {
        // ignore
      }
      finish();
    };
    const sub = p.addListener('playbackStatusUpdate', (st: AudioStatus) => {
      if (my !== session) return finish();
      if (st.error) return finish(new VoiceError('playback', 'voice.errors.playback'));
      if (st.playing) sawPlaying = true;
      if (st.duration > 0) onFraction(st.currentTime / st.duration);
      // ignore a late "finished" of the previous chunk right after replace()
      if (st.didJustFinish && (sawPlaying || Date.now() - startedAt > 400)) finish();
    });
    signal.addEventListener('abort', onAbort);
    try {
      p.replace({ uri });
      applyRate(p, currentRate);
      if (!paused) p.play();
    } catch {
      finish(new VoiceError('playback', 'voice.errors.playback'));
    }
  });
}

async function runDevice(my: number, feed: SpeechFeed, language: string, voice: string | null): Promise<void> {
  const max = Math.min(VOICE_LIMITS.deviceChunkChars, deviceMaxChars() - 100);
  const view = chunkFeed(feed, max);
  const { chunks } = view;
  const lengths = () => chunks.map((c) => c.length);
  set({ chunks: view.count() });
  let start = 0;
  let index = 0;
  for (;;) {
    if (my !== session) return;
    if (paused) {
      await new Promise<void>((r) => {
        resumeWaiter = r;
      });
      if (my !== session) return;
    }
    const ctrl = new AbortController();
    deviceCtrl = ctrl;
    const result = await runChunkQueue(
      {
        count: view.count,
        waitMore: view.waitMore,
        startAt: start,
        prefetch: 0,
        load: async (i) => chunks[i],
        onWaiting: (i) => {
          if (my === session && !paused) set({ status: 'loading', chunk: i });
        },
        onChunkStart: (i) => {
          index = i;
          if (my === session) set({ status: 'playing', chunk: i, chunks: chunks.length, progress: overallProgress(lengths(), i, 0) });
        },
        play: async (text, _i, sig) => {
          try {
            await speakOnDevice(text, { rate: currentRate, language, voice }, sig);
          } catch {
            throw new VoiceError('playback', 'voice.errors.deviceSpeech');
          }
        },
      },
      ctrl.signal
    );
    if (result === 'done') return;
    start = index; // paused (or stopped) → resume at the interrupted chunk
  }
}

// ── hooks ─────────────────────────────────────────────────────────────────────

/** Global speaker state (re-renders on every progress tick). */
export function useSpeakerState(): SpeakerState {
  return useSyncExternalStore(subscribeSpeaker, getSpeakerState, getSpeakerState);
}

/** Speaker state for one message: IDLE_SPEAKER unless this message is the active one. */
export function useSpeaker(id: string): SpeakerState {
  const get = () => (state.messageId === id ? state : IDLE_SPEAKER);
  return useSyncExternalStore(subscribeSpeaker, get, get);
}

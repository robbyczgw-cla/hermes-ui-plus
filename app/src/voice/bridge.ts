/**
 * Voice I/O against the UI bridge (contract in bridgeCore.ts).
 *
 * - transcribe(): native → expo-file-system `File.upload` (raw body, streams from disk);
 *   web → fetch with the recording blob.
 * - fetchTtsAudio(): POST /bridge/tts → mp3. expo-audio can send headers for remote sources, but only
 *   with GET; the bridge contract is POST+JSON, so each chunk is downloaded (expo/fetch bytes →
 *   cache file) and played locally. Web: blob URL.
 * - fetchVoiceConfig(): GET /bridge/voice/config, cached per origin for 5 min.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  bridgeOrigin,
  configHeaders,
  parseSttResponse,
  parseVoiceConfig,
  recordingMime,
  sttHeaders,
  sttUrl,
  ttsBody,
  ttsHeaders,
  ttsUrl,
  voiceConfigUrl,
  voiceHttpError,
  voiceTransportError,
} from './bridgeCore';
import { VOICE_LIMITS, VoiceError } from './types';
import type { SttLanguage, SttResult, VoiceConfig, VoiceConn } from './types';

const IS_WEB = Platform.OS === 'web';

export type Timed = { signal: AbortSignal; timedOut(): boolean; aborted(): boolean; dispose(): void };

/** AbortSignal that fires on the caller's signal or after `ms`. */
export function timed(outer: AbortSignal | undefined, ms: number): Timed {
  const ctrl = new AbortController();
  let didTimeout = false;
  const t = setTimeout(() => {
    didTimeout = true;
    ctrl.abort();
  }, ms);
  const onAbort = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener('abort', onAbort);
  return {
    signal: ctrl.signal,
    timedOut: () => didTimeout,
    aborted: () => ctrl.signal.aborted,
    dispose: () => {
      clearTimeout(t);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

// ── STT ────────────────────────────────────────────────────────────────────

export type TranscribeOptions = { language?: SttLanguage; signal?: AbortSignal };

/** Upload a recording to `POST /bridge/stt`. Throws VoiceError (see voiceErrorText). */
export async function transcribe(uri: string, conn: VoiceConn, opts: TranscribeOptions = {}): Promise<SttResult> {
  const t = timed(opts.signal, VOICE_LIMITS.sttTimeoutMs);
  const url = sttUrl(conn.baseUrl);
  try {
    if (IS_WEB) {
      const blob = await (await fetch(uri)).blob();
      const headers = sttHeaders(conn, recordingMime(uri, blob.type), opts.language ?? 'auto');
      const res = await fetch(url, { method: 'POST', headers, body: blob, signal: t.signal });
      return parseSttResponse(res.status, await res.text());
    }
    const mime = recordingMime(uri);
    const res = await new File(uri).upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers: sttHeaders(conn, mime, opts.language ?? 'auto'),
      mimeType: mime,
      signal: t.signal,
    });
    return parseSttResponse(res.status, res.body);
  } catch (e) {
    throw voiceTransportError('stt', e, t.aborted(), t.timedOut());
  } finally {
    t.dispose();
  }
}

// ── TTS ────────────────────────────────────────────────────────────────────

export type TtsAudio = { uri: string; release(): void };

const TTS_DIR = 'voice-tts';
let ttsSeq = 0;

function ttsDir(): Directory {
  const d = new Directory(Paths.cache, TTS_DIR);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** Delete leftover TTS cache files (e.g. after a crash). Never throws. */
export function clearTtsCache(): void {
  if (IS_WEB) return;
  try {
    const d = new Directory(Paths.cache, TTS_DIR);
    if (d.exists) d.delete();
  } catch {
    // ignore
  }
}

/** Native: write one mp3 chunk into `<cache>/voice-tts/` → playable uri; release() deletes it. */
export function saveTtsBytes(bytes: Uint8Array): TtsAudio {
  const file = new File(ttsDir(), `tts-${Date.now()}-${ttsSeq++}.mp3`);
  file.create({ overwrite: true });
  file.write(bytes);
  return {
    uri: file.uri,
    release: () => {
      try {
        if (file.exists) file.delete();
      } catch {
        // ignore
      }
    },
  };
}

/** `POST /bridge/tts` for one chunk (≤ 4000 chars) → local playable uri. */
export async function fetchTtsAudio(text: string, conn: VoiceConn, voice: string | null, signal?: AbortSignal): Promise<TtsAudio> {
  const t = timed(signal, VOICE_LIMITS.ttsTimeoutMs);
  const url = ttsUrl(conn.baseUrl);
  const init = { method: 'POST', headers: ttsHeaders(conn), body: ttsBody(text, voice), signal: t.signal };
  try {
    if (IS_WEB) {
      const res = await fetch(url, init);
      if (!res.ok) throw voiceHttpError('tts', res.status, await res.text().catch(() => ''));
      const blob = await res.blob();
      if (!blob.size) throw new VoiceError('bad_response', 'voice.errors.noAudio');
      const objectUrl = URL.createObjectURL(blob);
      return { uri: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
    }
    const res = await expoFetch(url, init);
    if (!res.ok) throw voiceHttpError('tts', res.status, await res.text().catch(() => ''));
    const bytes = await res.bytes();
    if (!bytes.byteLength) throw new VoiceError('bad_response', 'voice.errors.noAudio');
    return saveTtsBytes(bytes);
  } catch (e) {
    throw voiceTransportError('tts', e, t.aborted(), t.timedOut());
  } finally {
    t.dispose();
  }
}

// ── config ───────────────────────────────────────────────────────────────────

const CONFIG_TTL_MS = 5 * 60_000;
const configCache = new Map<string, { at: number; config: VoiceConfig }>();

export function cachedVoiceConfig(conn: VoiceConn | null): VoiceConfig | null {
  if (!conn) return null;
  return configCache.get(bridgeOrigin(conn.baseUrl))?.config ?? null;
}

/** `GET /bridge/voice/config` (cached 5 min per origin; `force` bypasses the cache). */
export async function fetchVoiceConfig(conn: VoiceConn, opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<VoiceConfig> {
  const key = bridgeOrigin(conn.baseUrl);
  const hit = configCache.get(key);
  if (!opts.force && hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.config;
  const t = timed(opts.signal, VOICE_LIMITS.configTimeoutMs);
  try {
    const res = await (IS_WEB ? fetch : expoFetch)(voiceConfigUrl(conn.baseUrl), { method: 'GET', headers: configHeaders(conn), signal: t.signal });
    const body = await res.text();
    if (!res.ok) throw voiceHttpError('config', res.status, body);
    const config = parseVoiceConfig(body);
    configCache.set(key, { at: Date.now(), config });
    return config;
  } catch (e) {
    throw voiceTransportError('config', e, t.aborted(), t.timedOut());
  } finally {
    t.dispose();
  }
}

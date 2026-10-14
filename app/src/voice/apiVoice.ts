/**
 * Own-API-key voice I/O (request shapes in apiCore.ts).
 * - transcribeWithApi(): native → expo-file-system `File.upload` MULTIPART (streams the recording from disk);
 *   web → fetch + FormData with the recording blob.
 * - fetchApiTtsAudio(): one mp3 chunk → cache file (native) / blob URL (web), like the bridge path.
 * Keys are read from the secure store per call and only put into the Authorization header.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { apiAudioFileName, apiHttpError, apiTransportError, buildSttApiRequest, buildTtsApiRequest, effectiveSttApi, parseApiSttResponse, STT_API_PRESETS } from './apiCore';
import type { AppLang } from './apiCore';
import { getVoiceApiKey } from './apiKeys';
import { saveTtsBytes, timed } from './bridge';
import type { TtsAudio } from './bridge';
import { recordingMime } from './bridgeCore';
import { VOICE_LIMITS, VoiceError } from './types';
import type { SttApiSettings, SttLanguage, SttResult, TtsApiSettings } from './types';

const IS_WEB = Platform.OS === 'web';

export async function transcribeWithApi(
  uri: string,
  settings: SttApiSettings,
  opts: { language?: SttLanguage; signal?: AbortSignal } = {},
): Promise<SttResult> {
  const key = await getVoiceApiKey('stt');
  if (!key) throw new VoiceError('unauthorized', 'voice.errors.apiNoKey', { op: 'stt' });
  const req = buildSttApiRequest(settings, key, opts.language ?? 'auto');
  const { model } = effectiveSttApi(settings);
  const provider = STT_API_PRESETS[settings.preset].label || 'API';
  const t = timed(opts.signal, VOICE_LIMITS.sttTimeoutMs);
  try {
    if (IS_WEB) {
      const blob = await (await fetch(uri)).blob();
      const mime = recordingMime(uri, blob.type);
      const form = new FormData();
      for (const [k, v] of Object.entries(req.fields)) form.append(k, v);
      form.append(req.fileField, new Blob([blob], { type: mime }), apiAudioFileName(mime));
      const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: form, signal: t.signal });
      return parseApiSttResponse(res.status, await res.text(), provider, model);
    }
    const mime = recordingMime(uri);
    const res = await new File(uri).upload(req.url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: req.fileField,
      mimeType: mime,
      parameters: req.fields,
      headers: req.headers,
      signal: t.signal,
    });
    return parseApiSttResponse(res.status, res.body, provider, model);
  } catch (e) {
    throw apiTransportError('stt', e, t.aborted(), t.timedOut());
  } finally {
    t.dispose();
  }
}

export async function fetchApiTtsAudio(text: string, settings: TtsApiSettings, lang: AppLang, signal?: AbortSignal): Promise<TtsAudio> {
  const key = await getVoiceApiKey('tts');
  if (!key) throw new VoiceError('unauthorized', 'voice.errors.apiNoKey', { op: 'tts' });
  const req = buildTtsApiRequest(settings, key, text, lang);
  const t = timed(signal, VOICE_LIMITS.ttsTimeoutMs);
  const init = { method: 'POST', headers: req.headers, body: req.body, signal: t.signal };
  try {
    if (IS_WEB) {
      const res = await fetch(req.url, init);
      if (!res.ok) throw apiHttpError('tts', res.status, await res.text().catch(() => ''));
      const blob = await res.blob();
      if (!blob.size) throw new VoiceError('bad_response', 'voice.errors.apiNoAudio');
      const objectUrl = URL.createObjectURL(blob);
      return { uri: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
    }
    const res = await expoFetch(req.url, init);
    if (!res.ok) throw apiHttpError('tts', res.status, await res.text().catch(() => ''));
    const bytes = await res.bytes();
    if (!bytes.byteLength) throw new VoiceError('bad_response', 'voice.errors.apiNoAudio');
    return saveTtsBytes(bytes);
  } catch (e) {
    throw apiTransportError('tts', e, t.aborted(), t.timedOut());
  } finally {
    t.dispose();
  }
}

// Voice: speech-to-text (POST /bridge/stt) and text-to-speech (POST /bridge/tts) in front of third-party
// providers, plus GET /bridge/voice/config. API keys stay on the server. Zero dependencies (Node 22 fetch).
// Contract, providers and deployment notes: docs/ROUTER.md, section "Voice (STT/TTS)".
import { randomBytes } from 'node:crypto';
import { silentLogger } from './log.mjs';
import { normalizeMime } from './uploads.mjs';
import { makeAuthorizer } from './auth.mjs';

export const VOICE_CONFIG_PATH = '/bridge/voice/config';
export const STT_PATH = '/bridge/stt';
export const TTS_PATH = '/bridge/tts';

export const DEFAULT_STT_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_TTS_MAX_CHARS = 4000;
const TTS_BODY_MAX_BYTES = 64 * 1024; // JSON envelope for <= 4000 chars (even all 4-byte code points: 16 KB) + slack

/** Accepted request Content-Types for /bridge/stt (bare media type, parameters ignored) -> file extension for the upstream. */
export const STT_MIME_EXT = {
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/x-aac': 'm4a',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
};

// ---------------------------------------------------------------------------------------------
// Providers. Voices: small curated lists; an unknown but well-formed voice id is passed through.
// Sources (checked 2026-10): developers.deepgram.com/docs/tts-models, elevenlabs.io/docs/api-reference/text-to-speech/stream,
// OpenAI "Text to speech" guide, console.groq.com/docs/speech-to-text.
// ---------------------------------------------------------------------------------------------
const dg = (id, name, note) => ({ id: `aura-2-${id}-de`, name: `${name} (${note})`, lang: 'de', provider: 'deepgram' });
export const VOICES = {
  deepgram: [
    dg('elara', 'Elara', 'ruhig, klar'),
    dg('fabian', 'Fabian', 'männlich, professionell'),
    dg('aurelia', 'Aurelia', 'locker, natürlich'),
    dg('lara', 'Lara', 'warm, herzlich'),
    dg('julius', 'Julius', 'männlich, freundlich'),
    dg('kara', 'Kara', 'warm, einfühlsam'),
    dg('viktoria', 'Viktoria', 'fröhlich'),
    { id: 'aura-2-thalia-en', name: 'Thalia (English)', lang: 'en', provider: 'deepgram' },
  ],
  elevenlabs: [
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (multilingual)', lang: 'de', provider: 'elevenlabs' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (multilingual)', lang: 'de', provider: 'elevenlabs' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (multilingual)', lang: 'de', provider: 'elevenlabs' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (multilingual)', lang: 'de', provider: 'elevenlabs' },
  ],
  openai: ['marin', 'cedar', 'alloy', 'coral', 'nova', 'onyx', 'sage', 'shimmer'].map((id) => ({
    id, name: `${id[0].toUpperCase()}${id.slice(1)} (multilingual)`, lang: 'de', provider: 'openai',
  })),
};
const DEFAULT_VOICE = { deepgram: 'aura-2-elara-de', elevenlabs: 'pNInz6obpgDQGcFmaJgB', openai: 'marin' };
const DEFAULT_TTS_MODEL = { deepgram: 'aura-2', elevenlabs: 'eleven_multilingual_v2', openai: 'gpt-4o-mini-tts' };
const TTS_KEY_ENV = { deepgram: 'DEEPGRAM_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY', openai: 'OPENAI_API_KEY' };
const TTS_ORDER = ['deepgram', 'elevenlabs', 'openai'];
const DEFAULT_STT_MODEL = { groq: 'whisper-large-v3-turbo', openai: 'whisper-1' };
const STT_KEY_ENV = { groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY' };
const BASE_URL = {
  groq: 'https://api.groq.com/openai/v1', deepgram: 'https://api.deepgram.com', elevenlabs: 'https://api.elevenlabs.io', openai: 'https://api.openai.com/v1',
};
const DEEPGRAM_MAX_CHARS = 1800; // Aura limit is 2000 characters per request; longer texts are split at sentence ends
const VOICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? d : Number(v));

/** @param {Record<string, string|undefined>} env */
export function loadVoiceConfig(env = process.env) {
  const keys = {
    groq: env.GROQ_API_KEY || '', openai: env.OPENAI_API_KEY || '', deepgram: env.DEEPGRAM_API_KEY || '', elevenlabs: env.ELEVENLABS_API_KEY || '',
  };
  const sttProvider = (env.BRIDGE_STT_PROVIDER || 'groq').toLowerCase();
  if (!['groq', 'openai'].includes(sttProvider)) throw new Error('BRIDGE_STT_PROVIDER must be groq|openai');
  let ttsProvider = (env.BRIDGE_TTS_PROVIDER || '').toLowerCase().replace('deepgram-aura', 'deepgram');
  if (ttsProvider && !TTS_ORDER.includes(ttsProvider)) throw new Error('BRIDGE_TTS_PROVIDER must be elevenlabs|deepgram|openai');
  if (!ttsProvider) ttsProvider = TTS_ORDER.find((p) => keys[p]) ?? 'deepgram'; // first provider with a key
  const baseUrl = (name, fallback) => (env[`${name}_BASE_URL`] || fallback).replace(/\/+$/, '');
  return {
    keys,
    baseUrls: {
      groq: baseUrl('GROQ', BASE_URL.groq), deepgram: baseUrl('DEEPGRAM', BASE_URL.deepgram),
      elevenlabs: baseUrl('ELEVENLABS', BASE_URL.elevenlabs), openai: baseUrl('OPENAI', BASE_URL.openai),
    },
    stt: {
      provider: sttProvider,
      model: env.BRIDGE_STT_MODEL || DEFAULT_STT_MODEL[sttProvider],
      maxBytes: Math.max(1, num(env.BRIDGE_STT_MAX_BYTES, DEFAULT_STT_MAX_BYTES)),
      timeoutMs: Math.max(1, num(env.BRIDGE_STT_TIMEOUT_MS, 30_000)),
    },
    tts: {
      provider: ttsProvider,
      model: env.BRIDGE_TTS_MODEL || '', // empty -> provider default
      voice: env.BRIDGE_TTS_VOICE || DEFAULT_VOICE[ttsProvider],
      maxChars: Math.max(1, num(env.BRIDGE_TTS_MAX_CHARS, DEFAULT_TTS_MAX_CHARS)),
      /** Time to first byte, then max silence between chunks. */
      timeoutMs: Math.max(1, num(env.BRIDGE_TTS_TIMEOUT_MS, 15_000)),
    },
  };
}

/** Split text into pieces of at most `max` chars, preferably at sentence ends, then at whitespace. */
export function splitText(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  const push = (s) => { if (s.trim()) out.push(s.trim()); };
  for (const sentence of text.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) ?? [text]) {
    if (cur.length + sentence.length <= max) { cur += sentence; continue; }
    push(cur); cur = '';
    let rest = sentence;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  push(cur);
  return out;
}

/** Whisper reports the language as a name ("german"); map to ISO 639-1 where we know it. */
const LANG_NAMES = {
  german: 'de', english: 'en', french: 'fr', spanish: 'es', italian: 'it', dutch: 'nl', portuguese: 'pt', polish: 'pl', turkish: 'tr',
  russian: 'ru', ukrainian: 'uk', czech: 'cs', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', japanese: 'ja', chinese: 'zh',
  korean: 'ko', arabic: 'ar', hindi: 'hi',
};
const isoLang = (s) => (typeof s === 'string' && s ? (LANG_NAMES[s.toLowerCase()] ?? s.toLowerCase()) : null);

class TooLarge extends Error {}
class ProviderError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** Upstream HTTP status -> what we tell the app. */
function mapUpstreamStatus(what, status) {
  if (status === 408 || status === 504) return new ProviderError(504, 'upstream_timeout', `${what} provider timed out`);
  if (status === 413) return new ProviderError(413, 'payload_too_large', `${what} provider rejected the input as too large`);
  if (status === 429) return new ProviderError(502, 'upstream_rate_limited', `${what} provider is rate limiting (429)`);
  if (status === 401 || status === 403) return new ProviderError(502, 'upstream_auth', `${what} provider rejected the bridge's API key (${status})`);
  return new ProviderError(502, 'upstream_error', `${what} provider returned HTTP ${status}`);
}

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[]}} bridgeConfig  loadConfig() result
 * @param {{env?: Record<string, string|undefined>, voice?: ReturnType<typeof loadVoiceConfig>,
 *   logger?: ReturnType<typeof import('./log.mjs').createLogger>, fetch?: typeof fetch}} [o]
 */
export function createVoice(bridgeConfig, o = {}) {
  const cfg = o.voice ?? loadVoiceConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const corsOrigins = bridgeConfig.corsOrigins ?? [];

  const authorized = makeAuthorizer(bridgeConfig); // BRIDGE_TOKEN or a device token (src/auth.mjs)

  const routeOf = (req) => {
    const p = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && p === VOICE_CONFIG_PATH) return 'config';
    if (req.method === 'POST' && p === STT_PATH) return 'stt';
    if (req.method === 'POST' && p === TTS_PATH) return 'tts';
    return null;
  };
  /** Only these three routes are ours; everything else (incl. OPTIONS preflight) stays with the bridge. */
  const matches = (req) => routeOf(req) !== null;

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !corsOrigins.length || !(corsOrigins.includes('*') || corsOrigins.includes(origin))) return {};
    return {
      'access-control-allow-origin': corsOrigins.includes('*') ? '*' : origin, vary: 'Origin',
      'access-control-expose-headers': 'X-TTS-Provider, X-TTS-Voice',
    };
  }

  function send(req, res, status, body, { close = false } = {}) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify(body));
    const headers = { 'content-type': 'application/json', 'content-length': buf.length, 'x-hermes-ui-bridge': '1', ...corsHeaders(req) };
    if (close) headers.connection = 'close';
    res.writeHead(status, headers);
    if (close) res.on('finish', () => req.socket?.destroy()); // request body not (fully) consumed
    res.end(buf);
  }
  const fail = (req, res, status, message, type, code, close = false) =>
    send(req, res, status, { error: { message, type, code: code ?? null } }, { close });
  const failProvider = (req, res, err, close = false) =>
    fail(req, res, err.status, err.message, err.status === 413 ? 'invalid_request_error' : 'bridge_error', err.code, close);

  // ----- config ---------------------------------------------------------------------------
  const ttsAvailable = () => TTS_ORDER.filter((p) => cfg.keys[p]);
  function voiceList() {
    const providers = ttsAvailable();
    if (!providers.includes(cfg.tts.provider)) providers.unshift(cfg.tts.provider); // nothing configured: still describe the default
    // Default provider first, so the app's picker starts with the recommended voices.
    providers.sort((a, b) => (a === cfg.tts.provider ? -1 : b === cfg.tts.provider ? 1 : 0));
    return providers.flatMap((p) => VOICES[p]);
  }
  function configBody() {
    const p = cfg.tts.provider;
    return {
      stt: {
        provider: cfg.stt.provider, model: cfg.stt.model, languages: ['de', 'en', 'fr', 'es', 'it', 'nl'],
        available: Boolean(cfg.keys[cfg.stt.provider]), maxBytes: cfg.stt.maxBytes,
      },
      tts: {
        provider: p, model: cfg.tts.model || DEFAULT_TTS_MODEL[p], voices: voiceList(), defaultVoice: cfg.tts.voice,
        available: Boolean(cfg.keys[p]), maxChars: cfg.tts.maxChars,
      },
    };
  }

  // ----- helpers --------------------------------------------------------------------------
  /** AbortController that fires on client disconnect or after `ms` without `touch()`. */
  function guard(res, ms) {
    const ac = new AbortController();
    const g = { signal: ac.signal, timedOut: false, closed: false, touch: null, stop: null, abort: () => ac.abort() };
    let timer;
    g.touch = () => { clearTimeout(timer); timer = setTimeout(() => { g.timedOut = true; ac.abort(); }, ms); };
    g.stop = () => clearTimeout(timer);
    res.on('close', () => { if (!res.writableFinished) { g.closed = true; ac.abort(); } g.stop(); });
    g.touch();
    return g;
  }
  const explain = (what, g, err) => {
    if (err instanceof ProviderError) return err;
    if (g.timedOut) return new ProviderError(504, 'upstream_timeout', `${what} provider timed out`);
    return new ProviderError(502, 'upstream_unreachable', `${what} provider unreachable`);
  };

  // ----- STT ------------------------------------------------------------------------------
  async function readAudio(req) {
    const chunks = [];
    let size = 0;
    await new Promise((resolve, reject) => {
      const done = (err) => {
        req.off('data', onData); req.off('end', onEnd); req.off('error', done); req.off('close', onClose);
        if (err) { req.pause(); reject(err); } else resolve(undefined);
      };
      const onData = (c) => { size += c.length; if (size > cfg.stt.maxBytes) return done(new TooLarge()); chunks.push(c); };
      const onEnd = () => done();
      const onClose = () => { if (!req.complete) done(Object.assign(new Error('client aborted'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })); };
      req.on('data', onData); req.on('end', onEnd); req.on('error', done); req.on('close', onClose);
    });
    return Buffer.concat(chunks, size);
  }

  async function handleStt(req, res, reqId) {
    const mime = normalizeMime(req.headers['content-type']);
    const ext = STT_MIME_EXT[mime];
    if (!ext) return fail(req, res, 415, `Unsupported audio type: ${mime || 'none'}`, 'invalid_request_error', 'unsupported_media_type', true);
    let language;
    const rawLang = req.headers['x-language'];
    if (typeof rawLang === 'string' && rawLang.trim()) {
      language = rawLang.trim().toLowerCase();
      if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(language)) return fail(req, res, 400, 'X-Language must be an ISO 639-1 code like "de"', 'invalid_request_error', 'invalid_language', true);
      language = language.split('-')[0];
    }
    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      const n = Number(declared);
      if (!Number.isFinite(n) || n < 0) return fail(req, res, 400, 'Invalid Content-Length', 'invalid_request_error', undefined, true);
      if (n === 0) return fail(req, res, 400, 'Empty audio body', 'invalid_request_error', 'empty_audio', true);
      if (n > cfg.stt.maxBytes) return fail(req, res, 413, `Audio exceeds ${cfg.stt.maxBytes} bytes`, 'invalid_request_error', 'payload_too_large', true);
    }
    let audio;
    try { audio = await readAudio(req); } catch (err) {
      if (err instanceof TooLarge) return fail(req, res, 413, `Audio exceeds ${cfg.stt.maxBytes} bytes`, 'invalid_request_error', 'payload_too_large', true);
      log.debug('stt_aborted', { reqId });
      return res.destroy();
    }
    if (!audio.length) return fail(req, res, 400, 'Empty audio body', 'invalid_request_error', 'empty_audio');

    const provider = cfg.stt.provider;
    const key = cfg.keys[provider];
    if (!key) return failProvider(req, res, new ProviderError(502, 'stt_not_configured', `Speech-to-text is not configured (${STT_KEY_ENV[provider]} missing)`));

    // verbose_json (a superset of json) also returns language + duration; gpt-4o-*-transcribe only supports json.
    const verbose = !/^gpt-4o/.test(cfg.stt.model);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `audio.${ext}`);
    form.append('model', cfg.stt.model);
    form.append('response_format', verbose ? 'verbose_json' : 'json');
    if (language) form.append('language', language);

    const g = guard(res, cfg.stt.timeoutMs);
    const t0 = performance.now();
    try {
      const r = await doFetch(`${cfg.baseUrls[provider]}/audio/transcriptions`, {
        method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: g.signal,
      });
      if (!r.ok) {
        const detail = (await r.text().catch(() => '')).slice(0, 200);
        log.warn('stt_upstream_error', { reqId, provider, status: r.status, detail });
        if (r.status === 400) throw new ProviderError(400, 'invalid_audio', 'The speech-to-text provider could not process this audio');
        throw mapUpstreamStatus('Speech-to-text', r.status);
      }
      const j = await r.json().catch(() => null);
      if (!j || typeof j.text !== 'string') throw new ProviderError(502, 'upstream_error', 'Speech-to-text provider returned an unexpected response');
      g.stop();
      log.info('stt', { reqId, provider, bytes: audio.length, ms: Math.round(performance.now() - t0) });
      return send(req, res, 200, {
        text: j.text.trim(),
        language: language ?? isoLang(j.language),
        durationMs: Number.isFinite(j.duration) ? Math.round(j.duration * 1000) : null,
        provider, model: cfg.stt.model,
      });
    } catch (err) {
      if (g.closed) return; // client went away
      const pe = explain('Speech-to-text', g, err);
      if (!(err instanceof ProviderError)) log.warn('stt_failed', { reqId, provider, error: String(err?.cause?.code ?? err?.name ?? err).slice(0, 80) });
      return failProvider(req, res, pe);
    } finally { g.stop(); }
  }

  // ----- TTS ------------------------------------------------------------------------------
  async function readSmallBody(req, max) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > max) throw new TooLarge();
      chunks.push(c);
    }
    return Buffer.concat(chunks, size);
  }

  /** Voice id -> provider. Curated voices of any configured provider route to their provider; others use the default one. */
  function resolveVoice(voice) {
    if (!voice) return { provider: cfg.tts.provider, voice: cfg.tts.voice };
    const hit = ttsAvailable().find((p) => VOICES[p].some((v) => v.id === voice));
    return { provider: hit ?? cfg.tts.provider, voice };
  }

  /** Upstream requests (sequential; more than one only for long texts on Deepgram). */
  function ttsRequests(provider, voice, text) {
    const key = cfg.keys[provider];
    const base = cfg.baseUrls[provider];
    const json = (headers, body) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const model = cfg.tts.model || DEFAULT_TTS_MODEL[provider];
    switch (provider) {
      case 'deepgram': // the voice IS the model (aura-2-<name>-<lang>)
        return splitText(text, DEEPGRAM_MAX_CHARS).map((part) => ({
          url: `${base}/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3`,
          init: json({ authorization: `Token ${key}`, accept: 'audio/mpeg' }, { text: part }),
        }));
      case 'elevenlabs':
        return [{
          url: `${base}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`,
          init: json({ 'xi-api-key': key, accept: 'audio/mpeg' }, { text, model_id: model }),
        }];
      default: // openai
        return [{
          url: `${base}/audio/speech`,
          init: json({ authorization: `Bearer ${key}` }, { model, input: text, voice, response_format: 'mp3' }),
        }];
    }
  }

  async function handleTts(req, res, reqId) {
    let payload;
    try {
      const raw = await readSmallBody(req, TTS_BODY_MAX_BYTES);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (err) {
      if (err instanceof TooLarge) return fail(req, res, 413, 'Request body too large', 'invalid_request_error', 'payload_too_large', true);
      return fail(req, res, 400, 'Body must be JSON {"text": string, "voice"?: string, "format"?: "mp3"}', 'invalid_request_error', 'invalid_json');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(req, res, 400, 'Body must be a JSON object', 'invalid_request_error', 'invalid_json');
    const { text, voice, format } = payload;
    if (typeof text !== 'string' || !text.trim()) return fail(req, res, 400, '"text" must be a non-empty string', 'invalid_request_error', 'invalid_text');
    if (text.length > cfg.tts.maxChars) return fail(req, res, 413, `Text exceeds ${cfg.tts.maxChars} characters`, 'invalid_request_error', 'payload_too_large');
    if (format !== undefined && format !== 'mp3') return fail(req, res, 400, 'Only format "mp3" is supported', 'invalid_request_error', 'unsupported_format');
    if (voice !== undefined && (typeof voice !== 'string' || !VOICE_ID_RE.test(voice))) return fail(req, res, 400, '"voice" is not a valid voice id', 'invalid_request_error', 'invalid_voice');

    const target = resolveVoice(voice);
    if (!cfg.keys[target.provider]) {
      return failProvider(req, res, new ProviderError(502, 'tts_not_configured', `Text-to-speech is not configured (${TTS_KEY_ENV[target.provider]} missing)`));
    }
    const reqs = ttsRequests(target.provider, target.voice, text.trim());
    const g = guard(res, cfg.tts.timeoutMs);
    const t0 = performance.now();
    let started = false;
    let bytes = 0;
    try {
      for (const [i, step] of reqs.entries()) {
        const r = await doFetch(step.url, { ...step.init, signal: g.signal });
        g.touch();
        if (!r.ok) {
          const detail = (await r.text().catch(() => '')).slice(0, 200);
          log.warn('tts_upstream_error', { reqId, provider: target.provider, status: r.status, detail });
          throw mapUpstreamStatus('Text-to-speech', r.status);
        }
        if (!r.body) throw new ProviderError(502, 'upstream_error', 'Text-to-speech provider returned no audio');
        const reader = r.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            g.touch();
            if (!started) {
              // Headers go out with the first audio chunk, so failures before any audio still become clean JSON errors.
              res.writeHead(200, {
                'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1',
                'x-tts-provider': target.provider, 'x-tts-voice': target.voice, ...corsHeaders(req),
              });
              started = true;
              log.info('tts_first_byte', { reqId, provider: target.provider, ms: Math.round(performance.now() - t0), chunks: reqs.length });
            }
            bytes += value.length;
            if (!res.write(value)) { // backpressure: stop reading upstream until the client catches up
              g.stop();
              await new Promise((resolve) => { const done2 = () => { res.off('drain', done2); res.off('close', done2); resolve(undefined); }; res.on('drain', done2); res.on('close', done2); });
              g.touch();
            }
          }
        } finally { reader.cancel().catch(() => {}); }
        if (!started && i === reqs.length - 1) throw new ProviderError(502, 'upstream_error', 'Text-to-speech provider returned empty audio');
      }
      g.stop();
      log.info('tts', { reqId, provider: target.provider, voice: target.voice, chars: text.length, bytes, ms: Math.round(performance.now() - t0) });
      res.end();
    } catch (err) {
      if (g.closed) return;
      const pe = explain('Text-to-speech', g, err);
      if (!(err instanceof ProviderError)) log.warn('tts_failed', { reqId, provider: target.provider, error: String(err?.cause?.code ?? err?.name ?? err).slice(0, 80) });
      if (started) { log.warn('tts_truncated', { reqId, code: pe.code }); return res.destroy(); } // audio already on the wire: cut the stream
      return failProvider(req, res, pe);
    } finally { g.stop(); }
  }

  async function handle(req, res, reqId = randomBytes(4).toString('hex')) {
    const route = routeOf(req);
    const started = performance.now();
    res.on('finish', () => log.info('http', { reqId, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Math.round(performance.now() - started) }));
    // Auth first, before the body is read.
    if (!authorized(req)) return fail(req, res, 401, 'Invalid bridge token', 'invalid_request_error', 'invalid_api_key', route !== 'config');
    if (route === 'config') return send(req, res, 200, configBody());
    if (route === 'stt') return handleStt(req, res, reqId);
    return handleTts(req, res, reqId);
  }

  return { config: cfg, matches, handle };
}

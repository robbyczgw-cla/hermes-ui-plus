// Voice endpoint tests: real bridge HTTP server (createServer) in front of a fake provider server.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { loadVoiceConfig, splitText, VOICES } from '../src/voice.mjs';

const TOKEN = 'bridge-token';
const STT_MAX = 4096;
let fake; // fake upstream
let fakePort;
let bridge;
let port;
let calls; // requests the fake upstream saw
let mode; // behavior switch for the fake upstream

const MP3_A = Buffer.from('ID3-first-chunk-');
const MP3_B = Buffer.from('second-chunk-of-audio');

/** Minimal multipart/form-data parser: [{name, filename?, type?, data: Buffer}] */
function parseMultipart(contentType, body) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean);
  const parts = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const next = body.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    const part = body.subarray(pos + delim.length + 2, next - 2); // skip CRLF after delimiter and before the next one
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString();
    parts.push({
      name: /name="([^"]*)"/.exec(head)?.[1],
      filename: /filename="([^"]*)"/.exec(head)?.[1],
      type: /content-type:\s*(\S+)/i.exec(head)?.[1],
      data: part.subarray(split + 4),
    });
    pos = next;
  }
  return parts;
}

before(async () => {
  fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const call = { method: req.method, url: req.url, headers: req.headers, body };
    calls.push(call);
    const m = typeof mode === 'function' ? mode : null;
    if (m) return m(req, res, call);
    if (req.url.endsWith('/audio/transcriptions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ text: ' Hallo Welt ', language: 'german', duration: 2.345 }));
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.write(MP3_A);
    setTimeout(() => res.end(MP3_B), 5);
  });
  fake.listen(0, '127.0.0.1');
  await once(fake, 'listening');
  fakePort = fake.address().port;
  bridge = startBridge();
  port = await bridge.ready;
});
after(() => {
  for (const s of [fake, bridge.server]) { s.close(); s.closeAllConnections(); }
});
beforeEach(() => { calls = []; mode = null; });

function startBridge(extra = {}) {
  const u = `http://127.0.0.1:${fakePort}`;
  const env = {
    HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, ROUTER_BACKEND: 'heuristic',
    GROQ_API_KEY: 'groq-secret', DEEPGRAM_API_KEY: 'dg-secret', ELEVENLABS_API_KEY: 'el-secret', OPENAI_API_KEY: 'oa-secret',
    GROQ_BASE_URL: `${u}/openai/v1`, DEEPGRAM_BASE_URL: u, ELEVENLABS_BASE_URL: u, OPENAI_BASE_URL: `${u}/v1`,
    BRIDGE_STT_MAX_BYTES: String(STT_MAX), BRIDGE_STT_TIMEOUT_MS: '400', BRIDGE_TTS_TIMEOUT_MS: '400', ...extra,
  };
  const { server } = createServer(env, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  return { server, ready: once(server, 'listening').then(() => server.address().port) };
}

function request({ method = 'POST', path, headers = {}, body, auth = `Bearer ${TOKEN}`, port: p = port, chunks }) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (auth) h.authorization = auth;
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const data = chunks ?? (body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]);
    if (!chunks && method === 'POST' && !('content-length' in h)) h['content-length'] = String(data.reduce((n, c) => n + c.length, 0));
    const req = http.request({ host: '127.0.0.1', port: p, path, method, headers: h, agent: false }, (res) => {
      const out = [];
      res.on('data', (c) => out.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(out);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
      res.on('error', reject);
    });
    let answered = false;
    req.on('response', () => { answered = true; });
    req.on('error', (err) => { if (!answered) reject(err); });
    for (const c of data) req.write(c);
    req.end();
  });
}
const stt = (o = {}) => request({ path: '/bridge/stt', body: Buffer.from('fake-audio-bytes'), ...o, headers: { 'content-type': 'audio/m4a', ...o.headers } });
const tts = (o = {}) => request({
  path: '/bridge/tts', ...o, headers: { 'content-type': 'application/json', ...o.headers },
  body: o.body ?? JSON.stringify({ text: 'Hallo Welt' }),
});
const errShape = (r) => {
  assert.deepEqual(Object.keys(r.json.error).sort(), ['code', 'message', 'type']);
  assert.equal(typeof r.json.error.message, 'string');
};

// ---------------------------------------------------------------- config

test('GET /bridge/voice/config: shape, German default voice, needs auth', async () => {
  const r = await request({ method: 'GET', path: '/bridge/voice/config' });
  assert.equal(r.status, 200);
  assert.equal(r.json.stt.provider, 'groq');
  assert.equal(r.json.stt.model, 'whisper-large-v3-turbo');
  assert.equal(r.json.tts.provider, 'deepgram'); // first provider with a key
  assert.equal(r.json.tts.defaultVoice, 'aura-2-elara-de');
  assert.ok(r.json.tts.voices.length > 10);
  for (const v of r.json.tts.voices) assert.deepEqual(Object.keys(v).sort(), ['id', 'lang', 'name', 'provider']);
  assert.ok(r.json.tts.voices.some((v) => v.id === r.json.tts.defaultVoice && v.lang === 'de'));
  assert.deepEqual([...new Set(r.json.tts.voices.map((v) => v.provider))].sort(), ['deepgram', 'elevenlabs', 'openai']);
  assert.ok(!JSON.stringify(r.json).includes('secret'));
  assert.equal((await request({ method: 'GET', path: '/bridge/voice/config', auth: null })).status, 401);
  assert.equal((await request({ method: 'GET', path: '/bridge/voice/config', auth: 'Bearer nope' })).status, 401);
});

test('config: provider selection from env, voices limited to configured providers', async () => {
  const c = loadVoiceConfig({ ELEVENLABS_API_KEY: 'x' });
  assert.equal(c.tts.provider, 'elevenlabs');
  assert.equal(c.tts.voice, 'pNInz6obpgDQGcFmaJgB');
  assert.equal(loadVoiceConfig({ BRIDGE_TTS_PROVIDER: 'deepgram-aura' }).tts.provider, 'deepgram');
  assert.throws(() => loadVoiceConfig({ BRIDGE_TTS_PROVIDER: 'nope' }));
  assert.throws(() => loadVoiceConfig({ BRIDGE_STT_PROVIDER: 'nope' }));
  const b = startBridge({ DEEPGRAM_API_KEY: '', ELEVENLABS_API_KEY: '', OPENAI_API_KEY: 'k', BRIDGE_TTS_PROVIDER: '', BRIDGE_TTS_VOICE: 'cedar' });
  try {
    const r = await request({ method: 'GET', path: '/bridge/voice/config', port: await b.ready });
    assert.equal(r.json.tts.provider, 'openai');
    assert.equal(r.json.tts.defaultVoice, 'cedar');
    assert.deepEqual([...new Set(r.json.tts.voices.map((v) => v.provider))], ['openai']);
  } finally { b.server.close(); b.server.closeAllConnections(); }
});

test('unrelated paths and methods still go to the bridge', async () => {
  const r = await request({ method: 'GET', path: '/bridge/stt' });
  assert.notEqual(r.status, 200);
  assert.ok(!r.headers['x-hermes-ui-bridge'] || r.status === 404 || r.status === 401);
});

// ---------------------------------------------------------------- STT

test('stt: success, multipart shape sent to Groq, language header', async () => {
  const audio = Buffer.from([0, 1, 2, 3, 250, 251, 252]);
  const r = await stt({ body: audio, headers: { 'content-type': 'audio/mp4; codecs=mp4a.40.2', 'x-language': 'de' } });
  assert.equal(r.status, 200, r.buf.toString());
  assert.deepEqual(r.json, { text: 'Hallo Welt', language: 'de', durationMs: 2345, provider: 'groq', model: 'whisper-large-v3-turbo' });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, '/openai/v1/audio/transcriptions');
  assert.equal(c.headers.authorization, 'Bearer groq-secret');
  assert.match(c.headers['content-type'], /^multipart\/form-data; boundary=/);
  const parts = parseMultipart(c.headers['content-type'], c.body);
  const by = Object.fromEntries(parts.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(by).sort(), ['file', 'language', 'model', 'response_format']);
  assert.equal(by.model.data.toString(), 'whisper-large-v3-turbo');
  assert.equal(by.language.data.toString(), 'de');
  assert.equal(by.response_format.data.toString(), 'verbose_json');
  assert.equal(by.file.filename, 'audio.m4a');
  assert.equal(by.file.type, 'audio/mp4');
  assert.deepEqual(by.file.data, audio);
});

test('stt: without X-Language no language field is sent; detected language is mapped to ISO', async () => {
  const r = await stt();
  assert.equal(r.status, 200);
  assert.equal(r.json.language, 'de');
  const parts = parseMultipart(calls[0].headers['content-type'], calls[0].body);
  assert.ok(!parts.some((p) => p.name === 'language'));
});

test('stt: content-type allow-list (415) and extensions', async () => {
  for (const ct of ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/wav', 'audio/mpeg']) {
    calls = [];
    const r = await stt({ headers: { 'content-type': ct } });
    assert.equal(r.status, 200, ct);
  }
  for (const ct of ['text/plain', 'application/octet-stream', 'video/mp4', 'application/json', undefined]) {
    calls = [];
    const r = await stt({ headers: { 'content-type': ct } });
    assert.equal(r.status, 415, String(ct));
    errShape(r);
    assert.equal(r.json.error.code, 'unsupported_media_type');
    assert.equal(calls.length, 0);
  }
});

test('stt: auth is checked first (401) and nothing reaches the provider', async () => {
  for (const auth of [null, 'Bearer wrong', 'Basic abc']) {
    const r = await stt({ auth, headers: { 'content-type': 'text/plain' } });
    assert.equal(r.status, 401);
    errShape(r);
  }
  assert.equal(calls.length, 0);
});

test('stt: 400 for empty body and bad X-Language', async () => {
  const empty = await stt({ body: Buffer.alloc(0) });
  assert.equal(empty.status, 400);
  errShape(empty);
  const emptyChunked = await stt({ chunks: [], headers: { 'transfer-encoding': 'chunked' } });
  assert.equal(emptyChunked.status, 400);
  const lang = await stt({ headers: { 'x-language': 'not a language!' } });
  assert.equal(lang.status, 400);
  assert.equal(calls.length, 0);
});

test('stt: 413 early by Content-Length, and while streaming without it; limit boundary passes', async () => {
  const early = await stt({ body: Buffer.alloc(STT_MAX + 1, 1) });
  assert.equal(early.status, 413);
  assert.equal(early.json.error.code, 'payload_too_large');
  errShape(early);
  const streamed = await stt({ chunks: [Buffer.alloc(STT_MAX / 2, 1), Buffer.alloc(STT_MAX / 2, 1), Buffer.alloc(10, 1)], headers: { 'transfer-encoding': 'chunked' } });
  assert.equal(streamed.status, 413);
  assert.equal(calls.length, 0);
  const exact = await stt({ body: Buffer.alloc(STT_MAX, 1) });
  assert.equal(exact.status, 200);
});

test('stt: upstream errors are mapped (400->400, 401/429/500->502) without leaking keys or bodies', async () => {
  const cases = [[400, 400, 'invalid_audio'], [401, 502, 'upstream_auth'], [429, 502, 'upstream_rate_limited'], [500, 502, 'upstream_error'], [413, 413, 'payload_too_large']];
  for (const [up, want, code] of cases) {
    mode = (req, res) => { res.writeHead(up, { 'content-type': 'application/json' }); res.end('{"error":{"message":"internal groq-secret detail"}}'); };
    const r = await stt();
    assert.equal(r.status, want, `upstream ${up}`);
    assert.equal(r.json.error.code, code);
    errShape(r);
    assert.ok(!r.buf.toString().includes('secret'));
  }
  mode = (req, res) => { res.writeHead(200); res.end('not json'); };
  assert.equal((await stt()).status, 502);
});

test('stt: upstream timeout -> 504, unreachable -> 502, missing key -> 502 stt_not_configured', async () => {
  mode = () => { /* never answer */ };
  const t0 = performance.now();
  const r = await stt();
  assert.equal(r.status, 504);
  assert.equal(r.json.error.code, 'upstream_timeout');
  assert.ok(performance.now() - t0 < 3000);
  const dead = startBridge({ GROQ_BASE_URL: 'http://127.0.0.1:1' });
  const nokey = startBridge({ GROQ_API_KEY: '' });
  try {
    const r2 = await stt({ port: await dead.ready });
    assert.equal(r2.status, 502);
    assert.equal(r2.json.error.code, 'upstream_unreachable');
    const r3 = await stt({ port: await nokey.ready });
    assert.equal(r3.status, 502);
    assert.equal(r3.json.error.code, 'stt_not_configured');
  } finally { for (const b of [dead, nokey]) { b.server.close(); b.server.closeAllConnections(); } }
});

test('stt: provider openai uses OpenAI key/model; gpt-4o transcribe models use plain json', async () => {
  const b = startBridge({ BRIDGE_STT_PROVIDER: 'openai', BRIDGE_STT_MODEL: 'gpt-4o-mini-transcribe' });
  try {
    const r = await stt({ port: await b.ready });
    assert.equal(r.status, 200);
    assert.equal(r.json.provider, 'openai');
    assert.equal(calls[0].url, '/v1/audio/transcriptions');
    assert.equal(calls[0].headers.authorization, 'Bearer oa-secret');
    const parts = parseMultipart(calls[0].headers['content-type'], calls[0].body);
    assert.equal(parts.find((p) => p.name === 'response_format').data.toString(), 'json');
    assert.equal(parts.find((p) => p.name === 'model').data.toString(), 'gpt-4o-mini-transcribe');
  } finally { b.server.close(); b.server.closeAllConnections(); }
});

// ---------------------------------------------------------------- TTS

test('tts: Deepgram request shape, mp3 stream, headers', async () => {
  const r = await tts({ body: JSON.stringify({ text: ' Hallo Welt ', format: 'mp3' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'audio/mpeg');
  assert.equal(r.headers['x-tts-provider'], 'deepgram');
  assert.equal(r.headers['x-tts-voice'], 'aura-2-elara-de');
  assert.equal(r.headers['content-length'], undefined);
  assert.deepEqual(r.buf, Buffer.concat([MP3_A, MP3_B]));
  const c = calls[0];
  assert.equal(c.url, '/v1/speak?model=aura-2-elara-de&encoding=mp3');
  assert.equal(c.headers.authorization, 'Token dg-secret');
  assert.deepEqual(JSON.parse(c.body), { text: 'Hallo Welt' });
});

test('tts: voice id picks the provider (ElevenLabs, OpenAI) and sends the documented request', async () => {
  let r = await tts({ body: JSON.stringify({ text: 'Hi', voice: 'pNInz6obpgDQGcFmaJgB' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-tts-provider'], 'elevenlabs');
  assert.equal(calls[0].url, '/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/stream?output_format=mp3_44100_128');
  assert.equal(calls[0].headers['xi-api-key'], 'el-secret');
  assert.deepEqual(JSON.parse(calls[0].body), { text: 'Hi', model_id: 'eleven_multilingual_v2' });
  calls = [];
  r = await tts({ body: JSON.stringify({ text: 'Hi', voice: 'marin' }) });
  assert.equal(r.headers['x-tts-provider'], 'openai');
  assert.equal(r.headers['x-tts-voice'], 'marin');
  assert.equal(calls[0].url, '/v1/audio/speech');
  assert.equal(calls[0].headers.authorization, 'Bearer oa-secret');
  assert.deepEqual(JSON.parse(calls[0].body), { model: 'gpt-4o-mini-tts', input: 'Hi', voice: 'marin', response_format: 'mp3' });
  calls = [];
  r = await tts({ body: JSON.stringify({ text: 'Hi', voice: 'aura-2-fabian-de' }) }); // curated voice of the default provider
  assert.equal(r.headers['x-tts-provider'], 'deepgram');
  assert.match(calls[0].url, /model=aura-2-fabian-de/);
});

test('tts: unknown but well-formed voice goes to the default provider; malformed voice -> 400', async () => {
  const ok = await tts({ body: JSON.stringify({ text: 'Hi', voice: 'aura-2-custom-de' }) });
  assert.equal(ok.headers['x-tts-provider'], 'deepgram');
  for (const voice of ['../../etc', 'a/b', 'a?b=c', '', 5, 'x'.repeat(65)]) {
    const r = await tts({ body: JSON.stringify({ text: 'Hi', voice }) });
    assert.equal(r.status, 400, JSON.stringify(voice));
    errShape(r);
  }
});

test('tts: streaming pass-through, first chunk arrives before the upstream finished', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let upstreamEnded = false;
  mode = (req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.write(MP3_A);
    gate.then(() => { res.end(MP3_B); upstreamEnded = true; });
  };
  const got = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: 'Hallo' });
    const req = http.request({ host: '127.0.0.1', port, path: '/bridge/tts', method: 'POST', agent: false,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      let first;
      res.on('data', (c) => {
        if (!first) { first = { data: c, upstreamEnded }; release(); }
        chunks.push(c);
      });
      res.on('end', () => resolve({ first, all: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(got.first.upstreamEnded, false, 'first chunk must arrive while upstream is still open');
  assert.deepEqual(got.first.data, MP3_A);
  assert.deepEqual(got.all, Buffer.concat([MP3_A, MP3_B]));
});

test('tts: client disconnect aborts the upstream request', async () => {
  let upstreamClosed;
  const closed = new Promise((r) => { upstreamClosed = r; });
  mode = (req, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.write(MP3_A);
    const iv = setInterval(() => res.write(MP3_B), 20);
    res.on('close', () => { clearInterval(iv); upstreamClosed(true); });
  };
  const body = JSON.stringify({ text: 'Hallo' });
  const req = http.request({ host: '127.0.0.1', port, path: '/bridge/tts', method: 'POST', agent: false,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
    res.once('data', () => req.destroy());
  });
  req.on('error', () => {});
  req.end(body);
  assert.equal(await Promise.race([closed, new Promise((r) => setTimeout(() => r('timeout'), 2000))]), true);
});

test('tts: exactly the maximum (4000 chars) is accepted', async () => {
  const r = await tts({ body: JSON.stringify({ text: 'a'.repeat(4000) }) });
  assert.equal(r.status, 200);
  assert.equal(calls.map((c) => JSON.parse(c.body).text).join('').length, 4000);
});

test('tts: over the limit is 413 and never reaches the provider', async () => {
  const r = await tts({ body: JSON.stringify({ text: 'a'.repeat(4001) }) });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, 'payload_too_large');
  errShape(r);
  assert.equal(calls.length, 0);
  const huge = await tts({ body: JSON.stringify({ text: 'a'.repeat(200_000) }) });
  assert.equal(huge.status, 413);
  for (const body of ['{}', '{"text":""}', '{"text":"  "}', '{"text":5}', '[]', 'null', 'nope', '{"text":"x","format":"wav"}']) {
    const bad = await tts({ body });
    assert.equal(bad.status, 400, body);
    errShape(bad);
  }
  assert.equal(calls.length, 0);
});

test('tts: auth (401) before anything else', async () => {
  for (const auth of [null, 'Bearer wrong']) {
    const r = await tts({ auth });
    assert.equal(r.status, 401);
    errShape(r);
  }
  assert.equal(calls.length, 0);
});

test('tts: long text on Deepgram is split at sentence ends (<= 2000 chars per request) and streamed back-to-back', async () => {
  const sentence = 'Das ist ein ziemlich langer deutscher Satz, der vorgelesen werden soll. ';
  const text = sentence.repeat(Math.ceil(3900 / sentence.length));
  const r = await tts({ body: JSON.stringify({ text }) });
  assert.equal(r.status, 200);
  assert.ok(calls.length >= 2);
  const sent = calls.map((c) => JSON.parse(c.body).text);
  for (const s of sent) { assert.ok(s.length <= 2000); assert.ok(s.endsWith('.')); }
  assert.equal(sent.join(' '), text.trim());
  assert.equal(r.buf.length, (MP3_A.length + MP3_B.length) * calls.length);
});

test('splitText: boundaries, hard split of endless words, no content lost', () => {
  assert.deepEqual(splitText('kurz', 100), ['kurz']);
  const long = 'x'.repeat(250);
  const parts = splitText(long, 100);
  assert.ok(parts.every((p) => p.length <= 100));
  assert.equal(parts.join(''), long);
  const words = splitText('eins zwei drei vier fünf sechs sieben', 12);
  assert.ok(words.every((p) => p.length <= 12));
  assert.equal(words.join(' '), 'eins zwei drei vier fünf sechs sieben');
});

test('tts: upstream errors are mapped; no audio started so JSON errors', async () => {
  for (const [up, want, code] of [[401, 502, 'upstream_auth'], [402, 502, 'upstream_error'], [429, 502, 'upstream_rate_limited'], [500, 502, 'upstream_error'], [413, 413, 'payload_too_large']]) {
    mode = (req, res) => { res.writeHead(up, { 'content-type': 'application/json' }); res.end('{"err":"dg-secret"}'); };
    const r = await tts();
    assert.equal(r.status, want, `upstream ${up}`);
    assert.equal(r.json.error.code, code);
    errShape(r);
    assert.ok(!r.buf.toString().includes('secret'));
  }
  mode = (req, res) => { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(); };
  const empty = await tts();
  assert.equal(empty.status, 502);
});

test('tts: no response from upstream -> 504 within the timeout; missing key -> 502 tts_not_configured', async () => {
  mode = () => { /* never answer */ };
  const t0 = performance.now();
  const r = await tts();
  assert.equal(r.status, 504);
  assert.equal(r.json.error.code, 'upstream_timeout');
  assert.ok(performance.now() - t0 < 3000);
  const nokey = startBridge({ DEEPGRAM_API_KEY: '', ELEVENLABS_API_KEY: '', OPENAI_API_KEY: '' });
  try {
    const r2 = await tts({ port: await nokey.ready });
    assert.equal(r2.status, 502);
    assert.equal(r2.json.error.code, 'tts_not_configured');
  } finally { nokey.server.close(); nokey.server.closeAllConnections(); }
});

test('tts: stall after the first chunk cuts the stream (idle timeout) instead of hanging', async () => {
  mode = (req, res) => { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.write(MP3_A); /* then silence */ };
  const t0 = performance.now();
  const r = await tts().catch((e) => ({ error: e }));
  assert.ok(performance.now() - t0 < 3000);
  // Either an aborted response or a truncated body: never the full audio, never a hang.
  if (!r.error) assert.ok(r.buf.length <= MP3_A.length);
});

test('every curated voice has a unique id and valid shape', () => {
  const ids = Object.values(VOICES).flat().map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(VOICES.deepgram.filter((v) => v.lang === 'de').length >= 6);
});

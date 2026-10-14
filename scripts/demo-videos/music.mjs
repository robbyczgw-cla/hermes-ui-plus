#!/usr/bin/env node
// Background music for the demo videos via the ElevenLabs Music API (POST https://api.elevenlabs.io/v1/music,
// docs: https://elevenlabs.io/docs/api-reference/music/compose). Few tracks on purpose (subscription limits):
// one trailer track plus two short beds that the demos share (encode.mjs loops/trims them).
//
//   node scripts/demo-videos/music.mjs            # only tracks that are missing
//   node scripts/demo-videos/music.mjs --force    # regenerate all
//   node scripts/demo-videos/music.mjs trailer    # one track
//
// Key: ELEVENLABS_API_KEY from the environment or $HUI_PRIVATE_DIR/.env.local (default ~/work/hermesiui-private).
// The key is only ever put into the request header – never printed or logged.
// Output: dist/share/demos/music/<id>.mp3 + music.json (prompts, model, song ids).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const MUSIC_DIR = process.env.DEMO_MUSIC_DIR || join(ROOT, 'dist', 'share', 'demos', 'music');
const API = 'https://api.elevenlabs.io/v1/music';
const FORMAT = 'mp3_44100_192';
const MODELS = (process.env.DEMO_MUSIC_MODEL || 'music_v1').split(',');

export const TRACKS = [
  {
    id: 'trailer',
    ms: 75000,
    prompt:
      'Uplifting modern electronic instrumental for a product trailer, minimal and clean, 100 bpm, crisp synth plucks, soft sidechained pads, ' +
      'light punchy drums, warm sub bass. Starts sparse and airy, builds steadily with small lifts every 8 bars, ' +
      'confident full-energy final section, then a clean resolved outro ending on a sustained chord. No vocals, no risers that sound cheesy.',
  },
  {
    id: 'bed-bright',
    ms: 40000,
    prompt:
      'Light, friendly modern electronic background loop for an app demo, 100 bpm, clean synth plucks, soft claps, gentle bass, ' +
      'optimistic and unobtrusive, steady energy without big drops, loopable. Instrumental, no vocals.',
  },
  {
    id: 'bed-calm',
    ms: 40000,
    prompt:
      'Calm minimal electronic background for a product walkthrough, 96 bpm, soft marimba-like plucks, warm pads, subtle hi-hats, ' +
      'focused and relaxed, steady texture, loopable. Instrumental, no vocals.',
  },
];

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const dir = (process.env.HUI_PRIVATE_DIR || join(process.env.HOME || '', 'work', 'hermesiui-private')).replace(/^~(?=\/)/, process.env.HOME || '');
  const f = join(dir, '.env.local');
  if (!existsSync(f)) return null;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2').trim() || null;
  }
  return null;
}

async function compose(key, track) {
  let lastErr = '';
  for (const model of MODELS) {
    const res = await fetch(`${API}?output_format=${FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ prompt: track.prompt, music_length_ms: track.ms, model_id: model, force_instrumental: true }),
      signal: AbortSignal.timeout(300000),
    });
    if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), model, songId: res.headers.get('song-id') || res.headers.get('x-song-id') || null };
    // error bodies never contain the key; keep them short
    lastErr = `HTTP ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`;
    if (res.status === 401) break;
  }
  throw new Error(lastErr);
}

export async function makeMusic(ids = [], { force = false } = {}) {
  const key = apiKey();
  if (!key) {
    console.error('ELEVENLABS_API_KEY not found (env or $HUI_PRIVATE_DIR/.env.local) – no music generated.');
    return false;
  }
  mkdirSync(MUSIC_DIR, { recursive: true });
  const metaFile = join(MUSIC_DIR, 'music.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
  for (const t of TRACKS.filter((x) => !ids.length || ids.includes(x.id))) {
    const out = join(MUSIC_DIR, `${t.id}.mp3`);
    if (existsSync(out) && !force) {
      console.log(`  ${t.id}.mp3 exists (use --force to regenerate)`);
      continue;
    }
    console.log(`  composing ${t.id} (${t.ms / 1000} s) …`);
    const r = await compose(key, t);
    writeFileSync(out, r.audio);
    meta[t.id] = { file: `${t.id}.mp3`, ms: t.ms, model: r.model, songId: r.songId, prompt: t.prompt, format: FORMAT, created: new Date().toISOString(), source: 'ElevenLabs Music API' };
    writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
    console.log(`  → ${out} (${(r.audio.length / 1e6).toFixed(2)} MB, ${r.model})`);
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ok = await makeMusic(args.filter((a) => !a.startsWith('--')), { force: args.includes('--force') });
  if (!ok) process.exitCode = 1;
}

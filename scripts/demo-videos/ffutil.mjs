// Shared ffmpeg helpers for encode.mjs and trailer.mjs (kept separate: encode.mjs runs its CLI with a
// top-level await, so trailer.mjs must not import it – that would deadlock the module graph).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC_DIR } from './music.mjs';
import { VIEWPORT } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const WORK = process.env.DEMO_WORK || '/tmp/hermes-demo-videos';
export const OUT = process.env.DEMO_OUT || join(ROOT, 'dist', 'share', 'demos');
export const ASSETS = join(WORK, 'assets');
export const FPS = 60;
/** raw screen size (2× points) */
export const RAW = { w: VIEWPORT.width * 2, h: VIEWPORT.height * 2 };
const LUFS = Number(process.env.DEMO_LUFS || -16);
export const mkdir = (d) => (existsSync(d) || mkdirSync(d, { recursive: true }), d);
const meminfoGB = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] || 0) / 1048576;
function waitForMemory(minGB = Number(process.env.DEMO_MIN_AVAIL_GB || 6)) {
  for (let i = 0; i < 60; i++) {
    if (meminfoGB() >= minGB) return;
    if (i === 0) console.log(`  waiting for MemAvailable > ${minGB} GB …`);
    spawnSync('sleep', ['10']);
  }
  throw new Error(`MemAvailable stayed below ${minGB} GB – aborting`);
}
const scope = () =>
  process.env.DEMO_NO_SCOPE === '1' || !existsSync('/usr/bin/systemd-run') ? [] : ['systemd-run', '--user', '--scope', '--quiet', '-p', 'MemoryMax=4G', '-p', 'MemorySwapMax=0'];
const scopeEnv = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus' };
/** heavy ffmpeg run: memory check, cgroup cap, nice, 2 threads */
export function ff(args, { capture = false } = {}) {
  waitForMemory();
  const argv = [...scope(), 'nice', '-n', '10', 'ffmpeg', '-hide_banner', '-loglevel', capture ? 'info' : 'error', '-nostats', '-y', '-threads', '2', '-filter_threads', '2', '-filter_complex_threads', '2', ...args];
  const r = spawnSync(argv[0], argv.slice(1), { env: scopeEnv, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr || '').split('\n').filter(Boolean).slice(-6).join('\n')}`);
  return r.stderr || '';
}
export const probeDuration = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
export const X264 = (crf = 18) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart'];

/** 1) screencast frames (VFR, timestamps kept) → raw.mp4: constant 60 fps, 2× points, near-lossless */
export function encodeRaw(dir) {
  const list = join(dir, 'frames', 'list.ffconcat');
  if (!existsSync(list)) return false;
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=${RAW.w}:${RAW.h}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-threads', '2', join(dir, 'raw.mp4')]);
  return true;
}

/** raw.mp4 range (raw seconds) → filter prefix for a screen of w×h with trim/speed */
export const screenChain = (input, { from = 0, to, speed = 1, w, h }) =>
  `[${input}:v]trim=start=${from}${to ? `:end=${to}` : ''},setpts=(PTS-STARTPTS)/${speed},fps=${FPS},scale=${w}:${h}:flags=lanczos,format=rgba`;

export function musicFile(track) {
  const f = join(MUSIC_DIR, `${track}.mp3`);
  return existsSync(f) ? f : null;
}

/**
 * Music under a (silent) video: bed from `offset`, looped if needed, trimmed to the video, fade in/out, then
 * two-pass loudnorm to ≈ LUFS (−16 default). The videos have no voice/SFX track, so the bed is the only audio;
 * "ducking" is the soft fade-in under the first interaction and the long fade-out under the end.
 */
export function mixMusic(video, track, out, { offset = 0, fadeIn = 0.8, fadeOut = 1.8, lufs = LUFS } = {}) {
  const dur = probeDuration(video);
  const pre = `[1:a]atrim=start=${offset}:end=${(offset + dur).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut}`;
  const inputs = ['-i', video, '-stream_loop', '-1', '-i', track];
  const log = ff([...inputs, '-filter_complex', `${pre},loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json[a]`, '-map', '[a]', '-t', dur.toFixed(3), '-f', 'null', '-'], { capture: true });
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  const ln = `loudnorm=I=${lufs}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const tmp = out + '.tmp.mp4';
  ff([...inputs, '-filter_complex', `${pre},${ln},aresample=48000[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', dur.toFixed(3), '-movflags', '+faststart', tmp]);
  renameSync(tmp, out);
  return out;
}

/** loudness of a finished file (integrated LUFS) */
export function measureLufs(f) {
  const log = ff(['-i', f, '-map', '0:a', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { capture: true });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf('Summary')));
  return m ? Number(m[1]) : null;
}


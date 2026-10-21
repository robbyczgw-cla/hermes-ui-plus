// node --test scripts/make-hero.test.mjs: website/make-hero.sh --raw cuts the hero loop from the recorder's raw takes.
// Synthetic takes made with ffmpeg (skipped without ffmpeg); nothing real.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SH = join(ROOT, 'website', 'make-hero.sh');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'hero-test-')); dirs.push(d); return d; };
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const take = (dir, name, color, seconds) => {
  const f = join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=156x338:r=60:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
  return f;
};
const run = (args, env = {}) => spawnSync('bash', [SH, ...args], { encoding: 'utf8', env: { ...process.env, HERO_NO_SCOPE: '1', WIDTH: '78', ...env } });
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,sample_aspect_ratio:format=duration', '-of', 'csv=p=0', f]).toString().trim().split('\n');

test('make-hero --raw: scenes from several raw takes are joined in order, scaled to WIDTH, with a poster', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const d = tmp(); const out = tmp();
  const a = take(d, 'a.mp4', 'red', 3); const b = take(d, 'b.mp4', 'blue', 3);
  const r = run(['--raw', `${a}@0.5-2.5`, `${b}@1-3`], { OUT: out });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const [stream, format] = probe(join(out, 'hero-loop.mp4'));
  assert.match(stream, /^78,170,1:1,60\/1$/, 'scaled to WIDTH, square pixels (a 1898:1899 SAR made browsers show 1169 px), 60 fps from raw takes');
  assert.ok(Math.abs(Number(format) - 4) < 0.3, `two 2 s scenes, got ${format}`);
  assert.ok(existsSync(join(out, 'hero-loop.jpg')), 'poster = first frame');
  // the poster is the first frame of the first scene (red), the clip joins red then blue
  const px = (t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', join(out, 'hero-loop.mp4'), '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-']).toJSON().data;
  const [r0, , b0] = px(0.2); const [r1, , b1] = px(3.5);
  assert.ok(r0 > b0 && b1 > r1, 'first scene red, last scene blue');
});

test('make-hero --raw: bad scenes are refused with a message', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const d = tmp(); const out = tmp();
  const a = take(d, 'a.mp4', 'red', 2);
  assert.match(run(['--raw'], { OUT: out }).stderr, /usage/);
  assert.match(run(['--raw', `${a}`], { OUT: out }).stderr, /bad scene/);
  assert.match(run(['--raw', `${a}@2-1`], { OUT: out }).stderr, /ends before it starts/);
  assert.match(run(['--raw', `${a}@0-9`], { OUT: out }).stderr, /past the end/);
  assert.match(run(['--raw', `${join(d, 'nope.mp4')}@0-1`], { OUT: out }).stderr, /no such (take|file)/);
  assert.equal(existsSync(join(out, 'hero-loop.mp4')), false);
});

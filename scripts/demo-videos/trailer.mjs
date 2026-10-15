// Trailer: fast montage of the best moments of the recorded clips (their raw.mp4 screens), framed on a dark
// gradient with short English captions, an opening title card and an end card, joined with xfade transitions.
// Two cuts: 16:9 1920×1080 (dist/share/demos/trailer.mp4) and 9:16 1080×1920 (trailer-vertical.mp4).
// Music: dist/share/demos/music/trailer.mp3, aligned so the track's outro lands on the end card.
// Icon / name / tagline come from cards.mjs at encode time (re-run `node scripts/demo-videos/encode.mjs --no-clips`).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS, FPS, OUT, WORK, ff, mixMusic, musicFile, probeDuration, screenChain } from './ffutil.mjs';
import { bgPng, endCardPng, framePng, maskPng, sideCaptionPng, titleCardPng, topCaptionPng } from './cards.mjs';

/**
 * Montage list: `from` = start in the clip's raw.mp4 (seconds of the recording), `len` = seconds on screen,
 * `speed` = playback speed of that excerpt. Captions are English (the trailer's audience is international).
 */
export const SEGMENTS = [
  { id: 'freigabe', from: 9.5, len: 5.4, speed: 1.3, kicker: 'Approvals', title: 'Approve from your phone', sub: 'See the command and the risk, then allow once – or deny.' },
  { id: 'langtask', from: 19, len: 7.5, speed: 2.4, kicker: 'Long tasks', title: 'Leave the chat', sub: 'Hermes keeps working – the finished answer is waiting when you’re back.' },
  { id: 'toolsteps', from: 9, len: 6.4, speed: 2.6, kicker: 'Transparency', title: 'Every tool step, live', sub: 'Terminal, files, web search – then a compact result.' },
  { id: 'befehle', from: 4.5, len: 5.0, speed: 1.6, kicker: 'Your setup', title: 'Your sessions, your models', sub: 'Pick the model per chat, set reasoning effort – just type “/”.' },
  { id: 'produkte', from: 14, len: 5.6, speed: 1.6, kicker: 'And answers look great', title: 'Top 5, ranked', sub: 'Scores per category, images, then compare side by side.' },
  { id: 'umformen', from: 14, len: 5.0, speed: 1.5, kicker: 'One tap', title: '“As a table”', sub: 'Reshape any answer: shorter, simpler, a list, a table.' },
  { id: 'orte', from: 11.5, len: 5.2, speed: 1.6, kicker: 'Places', title: 'Place cards', sub: 'Photos, ratings, opening hours – and all of them on a map.' },
];
/**
 * Highlight trailer of 2026-10-15 (`DEMO_TRAILER_SET=1015`): the best moments of the clips since the consumer set plus a few
 * older favourites. `mark` = interaction mark of the recorded timeline (+ `offset` seconds), so a changed prompt or answer
 * never shifts the excerpt.
 */
export const SEGMENTS_1015 = [
  { id: 'freigabe', mark: 'card', offset: -2.4, len: 4.8, speed: 1.3, kicker: 'Approvals', title: 'Approve from your phone', sub: 'See the command and the risk, then allow once.' },
  { id: 'schnell', mark: 'answer1', offset: -0.3, len: 6.0, speed: 2.0, kicker: 'New · Quick answers ⚡', title: 'Answers in seconds', sub: 'Need real data? Continue with Hermes in one tap.' },
  { id: 'bots', mark: 'picker', offset: -0.4, len: 4.6, speed: 1.4, kicker: 'New · Bots', title: 'A bot for every job', sub: 'Pick a Hermes profile in the model menu.' },
  { id: 'wege', mark: 'rows', offset: 0.2, len: 5.0, speed: 1.6, kicker: 'New · Paths', title: 'Compare your options', sub: 'Chains with a verdict – one tap picks.' },
  { id: 'bausteine', mark: 'blocks', offset: -0.6, len: 4.2, speed: 1.1, kicker: 'New · Blocks', title: 'Setups at a glance', sub: 'A diagram instead of a wall of text.' },
  { id: 'orte', mark: 'cards', offset: 0, len: 4.8, speed: 1.6, kicker: 'Places', title: 'Place cards', sub: 'Photos, ratings, opening hours – all on a map.' },
  { id: 'bilder', mark: 'loading', offset: -1.2, len: 4.8, speed: 1.2, kicker: 'Improved · Products', title: 'Photos that stay put', sub: 'Cards keep their size while images load.' },
  { id: 'rezept', mark: 'timer', offset: -3.0, len: 4.4, speed: 1.4, kicker: 'Cook along', title: 'Timers and a shopping list', sub: 'Scale servings, start a timer, tick off the list.' },
  { id: 'fluessig', mark: 'start', offset: -0.6, len: 5.4, speed: 1.5, kicker: 'New · Smooth', title: 'Long answers, no stutter', sub: 'Live text, cards fading in – at 60 frames per second.' },
  { id: 'nichtgesendet', mark: 'notsent', offset: -1.6, len: 4.8, speed: 1.3, kicker: 'New · Safe', title: 'Nothing gets lost', sub: 'Closed mid-send? “Send again” brings it back.' },
];
// Use actual interaction marks so translated prompts and streaming never shift the montage into typing.
const MOMENTS = {
  orte: ['cards', 0], produkte: ['picked', -2], umformen: ['table', -5], befehle: ['palette', -1], freigabe: ['card', -2.2],
  langtask: ['running', -1.5], toolsteps: ['live', -1.5],
};
function markedStart(seg, duration) {
  const file = join(WORK, seg.id, 'timeline.json');
  if (!existsSync(file)) return seg.from;
  const [name, offset] = seg.mark ? [seg.mark, seg.offset ?? 0] : MOMENTS[seg.id];
  const mark = JSON.parse(readFileSync(file, 'utf8')).find((m) => m.name === name);
  return mark ? Math.max(0, Math.min(mark.seconds + offset, duration - seg.len * (seg.speed ?? 1))) : seg.from;
}
const TRAILER_SEGMENTS = process.env.DEMO_TRAILER_SET === '1015' ? SEGMENTS_1015 : SEGMENTS;
const XF = 0.45;
const TITLE_LEN = 3.6;
const END_LEN = 5.2;

const LAYOUTS = {
  wide: { W: 1920, H: 1080, screen: { x: 1186, y: 70, w: 434, h: 940, bezel: 13, r: 52 }, cap: { x: 150, y: 0, w: 960, h: 1080 }, out: 'trailer.mp4' },
  tall: { W: 1080, H: 1920, screen: { x: 168, y: 262, w: 744, h: 1610, bezel: 16, r: 84 }, cap: { x: 0, y: 10, w: 1080, h: 240 }, out: 'trailer-vertical.mp4' },
};
const X264 = (crf) => ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-threads', '2'];
const loop = (f) => ['-loop', '1', '-framerate', String(FPS), '-i', f];

async function segment(L, seg, out) {
  const raw = join(WORK, seg.id, 'raw.mp4');
  const s = L.screen;
  const dir = join(ASSETS, 'trailer');
  const bg = await bgPng(ASSETS, L.W, L.H, true);
  const frame = await framePng(ASSETS, L.W, L.H, s, true);
  const mask = await maskPng(ASSETS, s.w, s.h, s.r);
  const cap = L.W > L.H ? await sideCaptionPng(join(dir, seg.id), L.cap.w, L.cap.h, seg) : await topCaptionPng(join(dir, seg.id), L.cap.w, L.cap.h, seg);
  const speed = seg.speed ?? 1;
  const rawDuration = probeDuration(raw);
  const from = markedStart(seg, rawDuration);
  const to = Math.min(rawDuration, from + seg.len * speed);
  // the caption slides in a little (x/y offset easing to 0) while it fades in
  const slide = L.W > L.H ? `x='${L.cap.x}-40*max(0\\,1-t/0.5)':y=${L.cap.y}` : `x=${L.cap.x}:y='${L.cap.y}+24*max(0\\,1-t/0.5)'`;
  const filter =
    `${screenChain(2, { from, to, speed, w: s.w, h: s.h })}[s];[3:v]format=gray,scale=${s.w}:${s.h}[m];[s][m]alphamerge[sr];` +
    `[0:v][sr]overlay=${s.x}:${s.y}:shortest=1[b1];[b1][1:v]overlay=0:0[b2];` +
    `[4:v]format=rgba,fade=t=in:st=0.15:d=0.45:alpha=1[c];[b2][c]overlay=${slide}:eval=frame,format=yuv420p[v]`;
  ff([...loop(bg), ...loop(frame), '-i', raw, ...loop(mask), ...loop(cap), '-filter_complex', filter, '-map', '[v]', '-t', seg.len.toFixed(3), '-r', String(FPS), ...X264(14), out]);
}

/** title / end card: transparent card over the dark background, gentle scale-in */
async function card(L, png, len, out) {
  const bg = await bgPng(ASSETS, L.W, L.H, true);
  const filter =
    `[1:v]format=rgba,scale=w='iw*(0.94+0.06*min(1\\,t/1.2))':h=-1:eval=frame,fade=t=in:st=0.1:d=0.6:alpha=1[c];` +
    `[0:v][c]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame,format=yuv420p[v]`;
  ff([...loop(bg), ...loop(png), '-filter_complex', filter, '-map', '[v]', '-t', String(len), '-r', String(FPS), ...X264(14), out]);
}

async function build(name, L, { withMusic }) {
  const dir = join(WORK, 'trailer', name);
  mkdirSync(dir, { recursive: true });
  const parts = [];
  const title = join(dir, '00-title.mp4');
  await card(L, await titleCardPng(join(ASSETS, 'trailer'), L.W, L.H), TITLE_LEN, title);
  parts.push({ f: title, len: TITLE_LEN, tr: 'fade' });
  const transitions = ['smoothleft', 'smoothup', 'smoothleft', 'slideleft'];
  let i = 0;
  for (const seg of TRAILER_SEGMENTS) {
    if (!existsSync(join(WORK, seg.id, 'raw.mp4'))) {
      console.log(`  trailer: skip ${seg.id} (not recorded)`);
      continue;
    }
    const f = join(dir, `${String(++i).padStart(2, '0')}-${seg.id}.mp4`);
    await segment(L, seg, f);
    parts.push({ f, len: seg.len, tr: transitions[i % transitions.length] });
  }
  const end = join(dir, '99-end.mp4');
  await card(L, await endCardPng(join(ASSETS, 'trailer'), L.W, L.H), END_LEN, end);
  parts.push({ f: end, len: END_LEN, tr: 'fade' });
  // xfade chain (all parts share size / fps / timebase)
  let chain = parts.map((_, k) => `[${k}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[n${k}];`).join('');
  let last = '[n0]';
  let offset = parts[0].len - XF;
  for (let k = 1; k < parts.length; k++) {
    chain += `${last}[n${k}]xfade=transition=${parts[k].tr}:duration=${XF}:offset=${offset.toFixed(3)}[x${k}];`;
    last = `[x${k}]`;
    offset += parts[k].len - XF;
  }
  chain += `${last}fade=t=out:st=${(offset + XF - 0.6).toFixed(3)}:d=0.6[v]`;
  const silent = join(dir, 'silent.mp4');
  ff([...parts.flatMap((p) => ['-i', p.f]), '-filter_complex', chain, '-map', '[v]', '-r', String(FPS), ...X264(19), '-movflags', '+faststart', silent]);
  const out = join(OUT, L.out);
  const track = withMusic ? musicFile('trailer') : null;
  if (track) {
    const vd = probeDuration(silent);
    const md = probeDuration(track);
    mixMusic(silent, track, out, { offset: Math.max(0, md - vd - 0.3), fadeIn: 0.3, fadeOut: 1.2 });
  } else copyFileSync(silent, out);
  console.log(`  ${L.out}: ${probeDuration(out).toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(1)} MB${track ? ', music' : ''}`);
  return out;
}

export async function buildTrailers({ withMusic = true } = {}) {
  const wide = await build('wide', LAYOUTS.wide, { withMusic });
  // poster for the gallery: a frame from the first feature segment
  ff(['-ss', String(TITLE_LEN + 0.2), '-i', wide, '-frames:v', '1', '-q:v', '3', join(OUT, 'trailer-poster.jpg')]);
  await build('tall', LAYOUTS.tall, { withMusic });
}

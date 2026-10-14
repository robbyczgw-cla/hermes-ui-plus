#!/usr/bin/env node
// ffmpeg post-processing for the v4 demos (see README.md):
//   screencast frames → raw.mp4 (60 fps CFR, 2× points)                         [record.mjs → encodeRaw]
//   raw.mp4 → master.mp4: 1080×1920 portrait, phone frame on a gradient, English caption (silent)
//   master.mp4 + music bed → dist/share/demos/<file>.mp4 (fade in/out, two-pass loudnorm ≈ −16 LUFS)
//   previews (animated WebP for all, GIF for `gif: true`), trailer 16:9 + 9:16 (trailer.mjs), gallery index.html.
//
//   node scripts/demo-videos/encode.mjs                 # re-encode all recorded clips + trailer + gallery
//   node scripts/demo-videos/encode.mjs --with-music    # same, and require the music (fails without it)
//   node scripts/demo-videos/encode.mjs --no-music      # silent versions
//   options: --clips <id,id> --no-trailer --no-clips
// Heavy ffmpeg runs go through `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0` (DEMO_NO_SCOPE=1 to
// skip), with `nice -n 10` and `-threads 2`; before each, MemAvailable must be > 6 GB (waits up to 10 min).
import { chmodSync, copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIPS } from './clips.mjs';
import { BRAND, bgPng, captionPng, closeCards, framePng, maskPng } from './cards.mjs';
import { MUSIC_DIR } from './music.mjs';
import { ASSETS, FPS, OUT, RAW, WORK, X264, encodeRaw, ff, measureLufs, mkdir, mixMusic, musicFile, probeDuration, screenChain } from './ffutil.mjs';
export { ASSETS, FPS, OUT, RAW, WORK, encodeRaw, ff, measureLufs, mixMusic, musicFile, probeDuration, screenChain };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DOCS_MEDIA = join(ROOT, 'docs', 'media');
// portrait demo canvas: caption band on top, phone below
const P = { W: 1080, H: 1920, screen: { x: 168, y: 236, w: 744, h: 1610, bezel: 16, r: 84 }, capH: 220 };
const MAX_GIF = 8e6;

/** 2) raw.mp4 → portrait master (silent) */
export async function encodeMaster(clip) {
  const dir = join(WORK, clip.id);
  const raw = join(dir, 'raw.mp4');
  if (!existsSync(raw)) throw new Error(`${clip.id}: no raw.mp4 – record it first`);
  const s = P.screen;
  const bg = await bgPng(ASSETS, P.W, P.H);
  const frame = await framePng(ASSETS, P.W, P.H, s);
  const mask = await maskPng(ASSETS, s.w, s.h, s.r);
  const cap = await captionPng(join(ASSETS, clip.id), P.W, P.capH, clip.titleEn, clip.captionEn);
  const from = clip.trimStart ?? 0.4;
  const rawDur = probeDuration(raw);
  const to = rawDur - (clip.trimEnd ?? 0);
  const speed = Math.max(clip.speed ?? 1, clip.maxDuration ? (to - from) / clip.maxDuration : 1);
  const dur = (to - from) / speed;
  const fadeOut = Math.max(0, dur - 0.45);
  const filter =
    `${screenChain(2, { from, to, speed, w: s.w, h: s.h })}[s];[3:v]format=gray,scale=${s.w}:${s.h}[m];[s][m]alphamerge[sr];` +
    `[0:v][sr]overlay=${s.x}:${s.y}:shortest=1[b1];[b1][1:v]overlay=0:0[b2];` +
    `[4:v]format=rgba,fade=t=in:st=0.15:d=0.5:alpha=1[c];[b2][c]overlay=0:4[b3];` +
    `[b3]fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.45,format=yuv420p[v]`;
  const out = join(dir, 'master.mp4');
  ff(['-loop', '1', '-framerate', String(FPS), '-i', bg, '-loop', '1', '-framerate', String(FPS), '-i', frame, '-i', raw, '-loop', '1', '-framerate', String(FPS), '-i', mask, '-loop', '1', '-framerate', String(FPS), '-i', cap,
    '-filter_complex', filter, '-map', '[v]', '-t', dur.toFixed(3), '-r', String(FPS), ...X264(18), out]);
  return out;
}

/** previews: animated WebP (all clips) + GIF (gif: true, ≤ 8 MB) */
function previews(clip, src) {
  const base = join(OUT, clip.file);
  // gallery poster: a frame from the middle of the clip (the first frame is the same empty chat everywhere)
  ff(['-ss', String(clip.posterAt ?? (probeDuration(src) * 0.62).toFixed(2)), '-i', src, '-frames:v', '1', '-vf', 'scale=540:-2:flags=lanczos', '-q:v', '3', `${base}.jpg`]);
  ff(['-i', src, '-vf', 'fps=15,scale=360:-2:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '72', '-compression_level', '5', '-loop', '0', '-an', `${base}.webp`]);
  if (!clip.gif) return;
  let fps = 12, colors = 160;
  for (;;) {
    ff(['-i', src, '-filter_complex', `fps=${fps},scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', `${base}.gif`]);
    if (statSync(`${base}.gif`).size <= MAX_GIF || colors <= 64) break;
    if (fps > 10) fps -= 2;
    else colors -= 32;
  }
}

/** master → OUT/<file>.mp4 (+ music) + previews */
export async function finishClip(clip, { withMusic = true, index = 0 } = {}) {
  mkdir(OUT);
  const master = await encodeMaster(clip);
  const out = join(OUT, `${clip.file}.mp4`);
  const track = withMusic ? musicFile(clip.music || 'bed-bright') : null;
  if (track) mixMusic(master, track, out, { offset: clip.musicOffset ?? (index * 5) % 15 });
  else copyFileSync(master, out);
  previews(clip, master);
  return { id: clip.id, mp4: out, bytes: statSync(out).size, duration: probeDuration(out), music: !!track };
}

/** record.mjs hook: frames → raw → finished clip */
export async function encodeClip(clip, dir, opts = {}) {
  encodeRaw(dir);
  return finishClip(clip, { ...opts, index: CLIPS.indexOf(clip) });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mb = (f) => (statSync(f).size / 1e6).toFixed(1);

/** gallery order: Hermes Agent strengths first, then "answers that look great"; recipe/vocab/workout/mind map last */
const AGENT_IDS = ['freigabe', 'langtask', 'toolsteps', 'befehle'];
const ANSWER_IDS = ['produkte', 'umformen', 'orte', 'anleitung', 'designs', 'training', 'vokabeln', 'mindmap', 'rezept'];
const INTRO_EN = 'The mobile app for your Hermes Agent: approvals, live tool steps, the finished answer waiting when you’re back (web app: push when it’s done), and answers that aren’t walls of text.';
const INTRO_DE = 'Die mobile App für deinen Hermes Agent: Freigaben, Werkzeug-Schritte live, die fertige Antwort wartet auf dich (Web-App: Push, wenn sie fertig ist) – und Antworten, die keine Textwände sind.';

export function gallery() {
  const order = [...AGENT_IDS, ...ANSWER_IDS];
  const rank = (c) => (order.includes(c.id) ? order.indexOf(c.id) : order.length);
  const items = CLIPS.filter((c) => existsSync(join(OUT, `${c.file}.mp4`))).sort((x, y) => rank(x) - rank(y));
  const trailer = join(OUT, 'trailer.mp4');
  const trailerV = join(OUT, 'trailer-vertical.mp4');
  const card = (c) => {
      const f = join(OUT, `${c.file}.mp4`);
      const poster = existsSync(join(OUT, `${c.file}.jpg`)) ? ` poster="${c.file}.jpg"` : '';
      const extra = [`<a href="${c.file}.mp4" download>MP4</a>`, existsSync(join(OUT, `${c.file}.webp`)) ? `<a href="${c.file}.webp">WebP</a>` : '', existsSync(join(OUT, `${c.file}.gif`)) ? `<a href="${c.file}.gif">GIF</a>` : ''].filter(Boolean).join(' · ');
      return `<figure>
  <video src="${c.file}.mp4"${poster} controls muted loop playsinline preload="none"></video>
  <figcaption><b><span lang="de">${esc(c.title)}</span><span lang="en">${esc(c.titleEn)}</span></b>
    <span class="d" lang="de">${esc(c.blurb)}</span><span class="d" lang="en">${esc(c.blurbEn)}</span>
    <small>${probeDuration(f).toFixed(0)} s · ${mb(f)} MB · ${extra}</small></figcaption>
</figure>`;
  };
  const agentCards = items.filter((c) => AGENT_IDS.includes(c.id)).map(card).join('\n');
  const answerCards = items.filter((c) => !AGENT_IDS.includes(c.id)).map(card).join('\n');
  const tr = existsSync(trailer)
    ? `<section class="trailer">
  <video src="trailer.mp4" controls playsinline preload="metadata" poster="trailer-poster.jpg"></video>
  <div class="meta"><h2><span lang="de">Trailer</span><span lang="en">Trailer</span></h2>
    <p><span lang="de">Die schönsten Momente in ${probeDuration(trailer).toFixed(0)} Sekunden.</span><span lang="en">The best moments in ${probeDuration(trailer).toFixed(0)} seconds.</span></p>
    <p class="dl"><a href="trailer.mp4" download>16:9 MP4 · ${mb(trailer)} MB</a>${existsSync(trailerV) ? ` · <a href="trailer-vertical.mp4" download>9:16 MP4 · ${mb(trailerV)} MB</a>` : ''}</p></div>
</section>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(BRAND.name)} – Demos</title>
<meta name="description" content="${esc(INTRO_EN)}">
<style>
:root{color-scheme:light dark;--bg:#f4f6fb;--card:#fff;--muted:#5b6476;--text:#111827;--accent:#4f46e5;--ring:rgba(79,70,229,.18)}
@media(prefers-color-scheme:dark){:root{--bg:#0d1020;--card:#161a2e;--muted:#9aa4b8;--text:#eef1f7;--accent:#8b8cf8;--ring:rgba(139,140,248,.25)}}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
main{max-width:1240px;margin:0 auto;padding:40px 22px 72px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:26px}
h1{margin:0;font-size:34px;letter-spacing:-.02em}header p{margin:6px 0 0;color:var(--muted)}
.lang{display:inline-flex;border:1px solid var(--ring);border-radius:999px;overflow:hidden}.lang button{border:0;background:none;color:var(--muted);padding:7px 14px;font:inherit;cursor:pointer}
.lang button[aria-pressed=true]{background:var(--accent);color:#fff}
body:not(.en) [lang=en]{display:none}body.en [lang=de]{display:none}
.trailer{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr);gap:26px;align-items:center;margin:8px 0 44px}
.trailer video{width:100%;border-radius:18px;background:#000;box-shadow:0 20px 50px rgba(15,23,42,.25)}
.trailer h2{margin:0 0 6px;font-size:26px}.trailer p{margin:0 0 10px;color:var(--muted)}
@media(max-width:820px){.trailer{grid-template-columns:1fr}}
h3{font-size:20px;margin:0 0 14px}h3.next{margin-top:40px}header .sub{font-size:14px;margin-top:4px}header>div:first-child{max-width:760px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px}
figure{margin:0;background:var(--card);border-radius:20px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.07),0 8px 24px rgba(15,23,42,.05)}
figure video{width:100%;aspect-ratio:9/16;border-radius:14px;display:block;background:#0b0e19;object-fit:cover}
figcaption{display:flex;flex-direction:column;gap:4px;padding:12px 4px 2px}figcaption .d{color:var(--muted);font-size:14px}figcaption small{color:var(--muted);font-size:12px}
a{color:var(--accent)}footer{margin-top:44px;color:var(--muted);font-size:13px}
</style></head><body class="en"><main>
<header><div><h1>${esc(BRAND.name)}</h1>
<p><span lang="de">${esc(INTRO_DE)}</span><span lang="en">${esc(INTRO_EN)}</span></p>
<p class="sub"><span lang="de">Kurze Aufnahmen der App (Web-Build, iPhone-Größe). Alle Inhalte sind vorbereitete Beispiele, keine echten Daten.</span><span lang="en">Short recordings of the app (web build, iPhone size). All content is prepared sample data, nothing real.</span></p>
<p class="sub">${esc(BRAND.disclaimer)}</p></div>
<div class="lang" role="group" aria-label="Language"><button data-l="en">English</button><button data-l="de">Deutsch</button></div></header>
${tr}
<p><a href="../demos-de/index.html">Original German recordings / Deutsche Aufnahmen</a></p>
<h3><span lang="de">Für deinen Hermes Agent</span><span lang="en">For your Hermes Agent</span></h3>
<div class="grid">
${agentCards}
</div>
<h3 class="next"><span lang="de">Und Antworten, die gut aussehen</span><span lang="en">And answers that look great</span></h3>
<div class="grid">
${answerCards}
</div>
<footer><p>${esc(BRAND.disclaimer)}. <span lang="de">Fotos: CC0 (Wikimedia Commons), Produktbilder generiert; Musik: ElevenLabs Music. Details in music/music.json und CREDITS.json.</span><span lang="en">Photos: CC0 (Wikimedia Commons), product images generated; music: ElevenLabs Music. Details in music/music.json and CREDITS.json.</span></p></footer>
</main><script>
const set=(l)=>{document.body.classList.toggle('en',l==='en');document.documentElement.lang=l;document.querySelectorAll('.lang button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.l===l)));try{localStorage.setItem('demo-lang',l)}catch{}};
document.querySelectorAll('.lang button').forEach(b=>b.onclick=()=>set(b.dataset.l));
let l='en';try{l=localStorage.getItem('demo-lang')||'en'}catch{}set(l);
</script></body></html>
`;
  writeFileSync(join(OUT, 'index.html'), html);
}

export async function finalizeAll({ withMusic = true, trailer = true } = {}) {
  mkdir(OUT);
  if (trailer) {
    const { buildTrailers } = await import('./trailer.mjs');
    await buildTrailers({ withMusic });
  }
  await closeCards();
  const credits = join(HERE, 'media', 'CREDITS.json');
  if (existsSync(credits)) copyFileSync(credits, join(OUT, 'CREDITS.json'));
  gallery();
  chmodSync(OUT, 0o755);
  for (const f of readdirSync(OUT)) if (statSync(join(OUT, f)).isFile()) chmodSync(join(OUT, f), 0o644);
  // docs/media: small GIF previews + the trailer (≤ 15 MB)
  mkdir(DOCS_MEDIA);
  for (const c of CLIPS.filter((x) => x.gif)) {
    const g = join(OUT, `${c.file}.gif`);
    if (existsSync(g) && statSync(g).size <= MAX_GIF) copyFileSync(g, join(DOCS_MEDIA, `demo-${c.file}.gif`));
  }
  const t = join(OUT, 'trailer.mp4');
  if (existsSync(t) && statSync(t).size <= 15e6) copyFileSync(t, join(DOCS_MEDIA, 'hermes-interactive-ui-trailer.mp4'));
  console.log(`\nGallery: ${join(OUT, 'index.html')}`);
}

// CLI: re-encode from the kept raw.mp4 files (no recording), e.g. after an icon / caption / music change
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const pick = argv.includes('--clips') ? argv[argv.indexOf('--clips') + 1].split(',') : null;
  const withMusic = !has('--no-music');
  if (has('--with-music') && !['trailer', 'bed-bright', 'bed-calm'].every((t) => musicFile(t))) {
    console.error(`Music missing in ${MUSIC_DIR} – run: node scripts/demo-videos/music.mjs`);
    process.exit(1);
  }
  if (!has('--no-clips')) {
    for (const [i, c] of CLIPS.entries()) {
      if (pick && !pick.includes(c.id)) continue;
      if (!existsSync(join(WORK, c.id, 'raw.mp4'))) {
        console.log(`  skip ${c.id} (not recorded)`);
        continue;
      }
      const r = await finishClip(c, { withMusic, index: i });
      console.log(`  ${c.file}.mp4  ${r.duration.toFixed(1)} s  ${(r.bytes / 1e6).toFixed(2)} MB${r.music ? '  ♪' : ''}`);
    }
  }
  await finalizeAll({ withMusic, trailer: !has('--no-trailer') });
}

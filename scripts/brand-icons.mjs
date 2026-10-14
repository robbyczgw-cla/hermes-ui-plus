#!/usr/bin/env node
// Official (FLAVOR=hermes) app icons from the hand-written SVG concepts in app/brand/icon/<concept>.svg.
// Each concept SVG has three marked sections: <!--defs-->…<!--/defs-->, <!--bg-->…<!--/bg--> (full-bleed field) and
// <!--mark-->…<!--/mark--> (glyph, designed for the full 1024 icon). This script composes them per platform.
// Optional: <!--mono-->…<!--/mono--> (glyph for the themed monochrome previews, default = mark) and
// <!--meta {"round":2,"title":"…","palette":"…","rationale":"…"}--> (design round, default 1, plus preview-page texts).
//
// Usage: node scripts/brand-icons.mjs [--concept <id>] [--previews-only] [--no-previews]
//   --concept       default: "icon" of app/brand/identity.json
//   writes          app/assets/{icon,android-icon-foreground,android-icon-background,android-icon-monochrome,
//                   splash-icon,favicon}.png, app/public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png,
//                   desktop/src-tauri/icons/{app-icon-source,tray-template,32x32,128x128,128x128@2x,icon}.png + icon.icns
//                   (via desktop/node_modules/.bin/tauri icon when installed: `cd desktop && npm ci`)
//   previews        dist/share/design/brand/ (round-1 concepts + index.html) and dist/share/design/brand/round2/
//                   (round-2 concepts: per-platform previews, home-screen mocks, small-size sheets, index.html);
//                   not part of the repo. Previews only (no app assets touched): --previews-only
// Needs: ImageMagick `convert`, and @resvg/resvg-js (not a repo dependency, the SVGs use masks/gradients the
//        ImageMagick renderer gets wrong): `npm i --prefix /tmp/hui-brand-tools @resvg/resvg-js` and
//        RESVG_DIR=/tmp/hui-brand-tools (default), or have it resolvable from the repo.
// The personal flavor is not touched (its icons come from $HUI_PRIVATE_DIR/app/identity.json).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'app', 'brand');
const ID = JSON.parse(readFileSync(join(BRAND, 'identity.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const CONCEPT = opt('--concept') || ID.icon;
const CONCEPTS = readdirSync(join(BRAND, 'icon')).filter((f) => f.endsWith('.svg')).map((f) => basename(f, '.svg')).sort();
if (!CONCEPTS.includes(CONCEPT)) throw new Error(`unknown concept ${CONCEPT} (have: ${CONCEPTS.join(', ')})`);

function loadResvg() {
  const dirs = [process.env.RESVG_DIR || '/tmp/hui-brand-tools', ROOT, join(ROOT, 'app')];
  for (const d of dirs) {
    try {
      return createRequire(join(d, 'package.json'))('@resvg/resvg-js').Resvg;
    } catch {
      /* next */
    }
  }
  throw new Error('@resvg/resvg-js not found: npm i --prefix /tmp/hui-brand-tools @resvg/resvg-js (or set RESVG_DIR)');
}
const Resvg = loadResvg();
const FONT = { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' };

function sections(concept) {
  const src = readFileSync(join(BRAND, 'icon', `${concept}.svg`), 'utf8');
  const part = (k) => {
    const m = new RegExp(`<!--${k}-->([\\s\\S]*?)<!--/${k}-->`).exec(src);
    if (!m) throw new Error(`${concept}.svg: section <!--${k}--> missing`);
    return m[1];
  };
  const mono = /<!--mono-->([\s\S]*?)<!--\/mono-->/.exec(src);
  const meta = /<!--meta (\{[\s\S]*?\})-->/.exec(src);
  return { defs: part('defs'), bg: part('bg'), mark: part('mark'), mono: mono ? mono[1] : part('mark'), meta: { round: 1, ...(meta ? JSON.parse(meta[1]) : {}) } };
}
const META = Object.fromEntries(CONCEPTS.map((c) => [c, sections(c).meta]));
/** glyph in one colour (themed monochrome): masks live in defs, so only the mark's own paint is replaced */
const recolor = (mark, color) =>
  mark.replace(/fill="(?!none)[^"]*"/g, `fill="${color}"`).replace(/stroke="(?!none)[^"]*"/g, `stroke="${color}"`);

const C = 512;
const scaled = (inner, s) => (s === 1 ? inner : `<g transform="translate(${C} ${C}) scale(${s}) translate(${-C} ${-C})">${inner}</g>`);
const svgDoc = (body, extraDefs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${extraDefs}${body}</svg>`;

/** variant SVGs of one concept (1024 grid) */
function variants(concept) {
  const { defs, bg, mark } = sections(concept);
  const roundClip = '<defs><clipPath id="hui-round"><rect width="1024" height="1024" rx="230"/></clipPath></defs>';
  const circleClip = '<defs><clipPath id="hui-circle"><circle cx="512" cy="512" r="512"/></clipPath></defs>';
  const macDefs =
    '<defs><clipPath id="hui-mac"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>' +
    '<filter id="hui-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs>';
  return {
    full: svgDoc(defs + bg + mark),
    round: svgDoc(defs + `<g clip-path="url(#hui-round)">${bg}${mark}</g>`, roundClip),
    circle: svgDoc(defs + `<g clip-path="url(#hui-circle)">${bg}${mark}</g>`, circleClip),
    // Android adaptive: 108 dp canvas, 72 dp visible → the visible part shows the mark at full-icon scale
    foreground: svgDoc(defs + scaled(mark, 72 / 108)),
    background: svgDoc(defs + bg),
    markOnly: svgDoc(defs + mark),
    // maskable (web): safe zone = circle of 40 % radius
    maskable: svgDoc(defs + bg + scaled(mark, 0.9)),
    // macOS Big Sur grid: 824 squircle on a 1024 canvas with a soft shadow
    mac: svgDoc(
      defs +
        '<rect x="100" y="112" width="824" height="824" rx="185" fill="#000" fill-opacity="0.32" filter="url(#hui-shadow)"/>' +
        `<g clip-path="url(#hui-mac)"><g transform="translate(100 100) scale(${824 / 1024})">${bg}${mark}</g></g>`,
      macDefs,
    ),
  };
}

function png(svg, size, out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: FONT }).render().asPng());
  return out;
}
const im = (...a) => execFileSync('convert', a, { stdio: ['ignore', 'ignore', 'inherit'] });
const opaque = (f, bgColor = ID.colors.ink) => im(f, '-background', bgColor, '-alpha', 'remove', '-alpha', 'off', f);
/** all visible pixels → one colour, alpha kept (Android monochrome / macOS template) */
const tint = (f, color) => im(f, '-fill', color, '-colorize', '100', f);

function writeAppIcons(concept) {
  const v = variants(concept);
  const A = join(ROOT, 'app', 'assets');
  const P = join(ROOT, 'app', 'public', 'icons');
  opaque(png(v.full, 1024, join(A, 'icon.png')));
  png(v.foreground, 1024, join(A, 'android-icon-foreground.png'));
  opaque(png(v.background, 1024, join(A, 'android-icon-background.png')));
  tint(png(v.foreground, 1024, join(A, 'android-icon-monochrome.png')), '#FFFFFF');
  png(v.foreground, 1024, join(A, 'splash-icon.png'));
  png(v.round, 48, join(A, 'favicon.png'));
  png(v.round, 192, join(P, 'icon-192.png'));
  png(v.round, 512, join(P, 'icon-512.png'));
  opaque(png(v.maskable, 512, join(P, 'icon-maskable-512.png')));
  opaque(png(v.full, 180, join(P, 'apple-touch-icon.png')));

  const D = join(ROOT, 'desktop', 'src-tauri', 'icons');
  const src = png(v.mac, 1024, join(D, 'app-icon-source.png'));
  tint(png(v.markOnly, 44, join(D, 'tray-template.png')), '#000000');
  const tauri = join(ROOT, 'desktop', 'node_modules', '.bin', 'tauri');
  const want = ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.icns'];
  if (existsSync(tauri)) {
    const tmp = mkdtempSync(join(tmpdir(), 'hui-tauri-icon-'));
    execFileSync(tauri, ['icon', src, '-o', tmp], { cwd: join(ROOT, 'desktop'), stdio: 'pipe' });
    for (const f of want) copyFileSync(join(tmp, f), join(D, f));
    rmSync(tmp, { recursive: true, force: true });
    console.log('desktop icons: tauri icon');
  } else {
    for (const [f, s] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512]]) png(v.mac, s, join(D, f));
    // a stale icon.icns would ship the OLD branding next to the new PNGs; without it scripts/build-desktop-mac.sh
    // regenerates it from app-icon-source.png on the Mac (tauri icon)
    rmSync(join(D, 'icon.icns'), { force: true });
    console.warn('desktop icons: PNGs via resvg; icon.icns DELETED (stale) – the desktop build regenerates it, or: cd desktop && npm ci, then re-run');
  }
  console.log(`app icons written from concept "${concept}"`);
}

// ------------------------------------------------------------------ previews (dist/share/design/brand)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** home-screen mockup: iOS squircle, Android circle + squircle, Android 13 themed (monochrome), label below */
function mockup(concept, dark) {
  const { defs, bg, mark, mono: monoMark } = sections(concept);
  const wall = dark ? '#0B0B12' : '#EEF0F6';
  const text = dark ? '#FFFFFF' : '#1B1B22';
  const icon = (x, clip, inner) =>
    `<g transform="translate(${x} 40)"><defs>${clip}</defs><g clip-path="url(#c${x})"><g transform="scale(${120 / 1024})">${inner}</g></g>` +
    `<text x="60" y="152" font-family="DejaVu Sans" font-size="13" fill="${text}" text-anchor="middle">${esc(ID.shortName)}</text></g>`;
  const sq = (x) => `<clipPath id="c${x}"><rect width="120" height="120" rx="27"/></clipPath>`;
  const ci = (x) => `<clipPath id="c${x}"><circle cx="60" cy="60" r="60"/></clipPath>`;
  const themedBg = dark ? '#2A2B3D' : '#DCE1FF';
  const themedFg = dark ? '#C8CCFF' : '#24275C';
  const mono = `<rect width="1024" height="1024" fill="${themedBg}"/><g style="filter:none">${recolor(monoMark, themedFg)}</g>`;
  const body =
    `<rect width="760" height="210" fill="${wall}"/>${defs}` +
    icon(40, sq(40), bg + mark) +
    icon(220, ci(220), bg + mark) +
    icon(400, `<clipPath id="c400"><rect width="120" height="120" rx="40"/></clipPath>`, bg + mark) +
    icon(580, ci(580), mono);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 210" width="760" height="210">${body}</svg>`;
}

function writePreviews() {
  const OUT = join(ROOT, 'dist', 'share', 'design', 'brand');
  rmSync(OUT, { recursive: true, force: true });
  const cards = [];
  for (const c of CONCEPTS.filter((k) => META[k].round === 1)) {
    const v = variants(c);
    const d = join(OUT, c);
    mkdirSync(d, { recursive: true });
    copyFileSync(join(BRAND, 'icon', `${c}.svg`), join(d, `${c}.svg`));
    opaque(png(v.full, 512, join(d, 'ios-512.png')));
    png(v.circle, 256, join(d, 'android-circle-256.png'));
    png(v.maskable, 256, join(d, 'maskable-256.png'));
    png(v.mac, 256, join(d, 'macos-256.png'));
    tint(png(v.foreground, 256, join(d, 'monochrome-256.png')), '#FFFFFF');
    for (const s of [16, 32, 48]) png(v.round, s, join(d, `favicon-${s}.png`));
    png(mockup(c, false), 760, join(d, 'home-light.png'));
    png(mockup(c, true), 760, join(d, 'home-dark.png'));
    cards.push(
      `<section id="${c}" class="card${c === CONCEPT ? ' chosen' : ''}"><h2>${esc(c)}${c === CONCEPT ? ' <span class="badge">default</span>' : ''}</h2>` +
        `<div class="row"><img src="${c}/ios-512.png" width="160" alt="${c} iOS"><img src="${c}/android-circle-256.png" width="128" alt="">` +
        `<img src="${c}/maskable-256.png" width="128" alt=""><img src="${c}/macos-256.png" width="128" alt="">` +
        `<img class="mono" src="${c}/monochrome-256.png" width="128" alt=""><span class="fav">` +
        [16, 32, 48].map((s) => `<img src="${c}/favicon-${s}.png" width="${s}" height="${s}" alt="">`).join('') +
        `</span></div><img class="mock" src="${c}/home-light.png" alt=""><img class="mock" src="${c}/home-dark.png" alt="">` +
        `<p class="src">Source: <code>app/brand/icon/${c}.svg</code> · apply: <code>node scripts/brand-icons.mjs --concept ${c}</code></p></section>`,
    );
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ID.name)} – icon concepts</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:#f6f6fa;color:#15151c}
h1{margin:0 0 .3rem} .sub{color:#555;margin:0 0 2rem} .card{background:#fff;border-radius:16px;padding:1.2rem 1.4rem;margin:0 0 1.6rem;box-shadow:0 1px 3px #0002}
.card.chosen{outline:3px solid #5EF0C8} .badge{font-size:.8rem;background:#14143A;color:#5EF0C8;border-radius:99px;padding:.15rem .6rem;vertical-align:middle}
.row{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap} .row img{border-radius:0} .mono{background:#3b3f5c;border-radius:50%}
.fav{display:flex;gap:.6rem;align-items:end} .mock{display:block;max-width:100%;margin-top:1rem;border-radius:12px} .src{color:#555;font-size:.9rem}
code{background:#eef;padding:.05rem .3rem;border-radius:4px}
@media(prefers-color-scheme:dark){body{background:#0d0d12;color:#eee}.card{background:#191921}.sub,.src{color:#aaa}code{background:#262636}}
</style></head><body><h1>${esc(ID.name)}</h1><p class="sub">${esc(ID.tagline)} · home-screen label “${esc(ID.shortName)}” ·
iOS 1024, Android adaptive (circle / squircle / themed monochrome), web maskable, macOS, favicons 16/32/48.
· <a href="round2/">Round 2 concepts →</a></p>
${cards.join('\n')}
</body></html>`;
  writeFileSync(join(OUT, 'index.html'), html);
  console.log(`previews: ${OUT}/index.html`);
  writeRound2(join(OUT, 'round2'));
}

// ------------------------------------------------------------------ round 2 (dist/share/design/brand/round2)
const R2 = { lightWall: '#EEF0F6', darkWall: '#0B0B12', themed: { light: ['#DCE1FF', '#24275C'], dark: ['#2A2B3D', '#C8CCFF'] } };

/** Android 13+ themed icon: launcher circle in the theme colour, glyph recoloured */
function themedSvg(concept, dark) {
  const { defs, mono } = sections(concept);
  const [bgc, fg] = R2.themed[dark ? 'dark' : 'light'];
  return svgDoc(
    defs + `<g clip-path="url(#hui-circle)"><rect width="1024" height="1024" fill="${bgc}"/>${recolor(mono, fg)}</g>`,
    '<defs><clipPath id="hui-circle"><circle cx="512" cy="512" r="512"/></clipPath></defs>',
  );
}

/** home screen at real icon size (60 pt, rendered @2x): iOS, Android circle, Android squircle, Android themed */
function homeMock(concept, dark) {
  const { defs, bg, mark, mono } = sections(concept);
  const S = 120; // 60 pt @2x
  const text = dark ? '#FFFFFF' : '#1B1B22';
  const [tbg, tfg] = R2.themed[dark ? 'dark' : 'light'];
  const slots = [
    ['ios', `<rect width="${S}" height="${S}" rx="${S * 0.225}"/>`, bg + mark],
    ['circle', `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}"/>`, bg + mark],
    ['squircle', `<rect width="${S}" height="${S}" rx="${S / 3}"/>`, bg + mark],
    ['themed', `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}"/>`, `<rect width="1024" height="1024" fill="${tbg}"/>${recolor(mono, tfg)}`],
  ];
  const W = 190;
  const body = slots
    .map(
      ([id, clip, inner], i) =>
        `<g transform="translate(${35 + i * W} 36)"><defs><clipPath id="m-${id}">${clip}</clipPath></defs>` +
        `<g clip-path="url(#m-${id})"><g transform="scale(${S / 1024})">${inner}</g></g>` +
        `<text x="${S / 2}" y="${S + 34}" font-family="DejaVu Sans" font-size="23" fill="${text}" text-anchor="middle">${esc(ID.shortName)}</text></g>`,
    )
    .join('');
  const wall = dark
    ? `<linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A1830"/><stop offset="1" stop-color="${R2.darkWall}"/></linearGradient>`
    : `<linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7F4FF"/><stop offset="1" stop-color="#DDE3F0"/></linearGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 230" width="760" height="230"><defs>${wall}</defs>${defs}<rect width="760" height="230" fill="url(#wall)"/>${body}</svg>`;
}

const SMALL = [64, 48, 40, 32, 29, 16];

function writeRound2(OUT) {
  const list = CONCEPTS.filter((k) => META[k].round === 2);
  if (!list.length) return;
  mkdirSync(OUT, { recursive: true });
  for (const c of list) {
    const v = variants(c);
    const d = join(OUT, c);
    mkdirSync(d, { recursive: true });
    copyFileSync(join(BRAND, 'icon', `${c}.svg`), join(d, `${c}.svg`));
    png(v.round, 512, join(d, 'ios-512.png'));
    png(v.round, 180, join(d, 'ios-180.png'));
    png(v.circle, 256, join(d, 'android-circle-256.png'));
    png(svgDoc(`<defs><clipPath id="sq"><rect width="1024" height="1024" rx="340"/></clipPath></defs>` + sections(c).defs + `<g clip-path="url(#sq)">${sections(c).bg}${sections(c).mark}</g>`), 256, join(d, 'android-squircle-256.png'));
    tint(png(v.foreground, 256, join(d, 'monochrome-256.png')), '#FFFFFF');
    png(themedSvg(c, false), 256, join(d, 'themed-light-256.png'));
    png(themedSvg(c, true), 256, join(d, 'themed-dark-256.png'));
    png(v.mac, 256, join(d, 'macos-256.png'));
    for (const s of [16, 32, 48]) png(v.round, s, join(d, `favicon-${s}.png`));
    for (const s of SMALL) png(v.round, s, join(d, `ios-${s}.png`));
    png(homeMock(c, false), 760, join(d, 'home-light.png'));
    png(homeMock(c, true), 760, join(d, 'home-dark.png'));
  }
  // contact sheets: every concept at real small sizes (1:1 pixels) on light and dark walls
  for (const [name, wall] of [['light', R2.lightWall], ['dark', R2.darkWall]]) {
    const rowH = 84;
    const a = ['-size', `${40 + SMALL.reduce((x, s) => x + s + 24, 0)}x${rowH * list.length + 16}`, `xc:${wall}`];
    list.forEach((c, r) => {
      let x = 20;
      for (const s of SMALL) {
        a.push(join(OUT, c, `ios-${s}.png`), '-geometry', `+${x}+${16 + r * rowH + (64 - s) / 2}`, '-composite');
        x += s + 24;
      }
    });
    im(...a, join(OUT, `sizes-${name}.png`));
  }
  const r1 = CONCEPTS.filter((k) => META[k].round === 1);
  const img = (src, w, cls = '', alt = '') => `<img src="${src}" width="${w}" height="${w}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''}>`;
  const grid = list
    .map((c) => {
      const m = META[c];
      return `<figure class="concept">${img(`${c}/ios-512.png`, 200, 'big', `${m.title} 512 preview`)}<figcaption><b>${esc(m.title)}</b> <code>${c}</code>` +
        `<span class="why">${esc(m.rationale || '')}</span><span class="pal">${esc(m.palette || '')}</span></figcaption></figure>`;
    })
    .join('\n');
  const smallRows = list
    .map(
      (c) =>
        `<tr><th>${esc(META[c].title)}</th>${[64, 48, 40, 29].map((s) => `<td>${img(`${c}/ios-${s}.png`, s)}</td>`).join('')}` +
        `<td class="fav">${img(`${c}/favicon-32.png`, 32)}</td><td class="fav">${img(`${c}/favicon-16.png`, 16)}</td></tr>`,
    )
    .join('\n');
  const details = list
    .map((c) => {
      const m = META[c];
      return `<section class="card" id="${c}"><h2>${esc(m.title)} <small>${esc(m.palette || '')}</small></h2><p class="why">${esc(m.rationale || '')}</p>` +
        `<div class="row"><figure>${img(`${c}/ios-512.png`, 160)}<figcaption>iOS</figcaption></figure>` +
        `<figure>${img(`${c}/android-circle-256.png`, 128)}<figcaption>Android circle</figcaption></figure>` +
        `<figure>${img(`${c}/android-squircle-256.png`, 128)}<figcaption>Android squircle</figcaption></figure>` +
        `<figure>${img(`${c}/themed-light-256.png`, 128)}<figcaption>themed (light)</figcaption></figure>` +
        `<figure>${img(`${c}/themed-dark-256.png`, 128)}<figcaption>themed (dark)</figcaption></figure>` +
        `<figure>${img(`${c}/macos-256.png`, 128)}<figcaption>macOS</figcaption></figure>` +
        `<figure class="fav">${img(`${c}/favicon-32.png`, 32)}${img(`${c}/favicon-16.png`, 16)}<figcaption>favicon 32 / 16</figcaption></figure></div>` +
        `<div class="mocks"><img src="${c}/home-light.png" width="380" alt="home screen light"><img src="${c}/home-dark.png" width="380" alt="home screen dark"></div>` +
        `<p class="src">Large: <a href="${c}/ios-512.png">512 PNG</a> · <a href="${c}/${c}.svg">SVG</a> · source <code>app/brand/icon/${c}.svg</code> · ` +
        `apply: <code>node scripts/brand-icons.mjs --concept ${c}</code></p></section>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ID.shortName)} – icon concepts, round 2</title><style>
:root{--bg:#f4f4f9;--fg:#15151c;--card:#fff;--mute:#5a5a6a;--code:#ececf8;--wall:${R2.lightWall}}
body.dark{--bg:#0d0d12;--fg:#eee;--card:#181820;--mute:#a4a4b4;--code:#262636;--wall:${R2.darkWall}}
body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:var(--bg);color:var(--fg);transition:background .2s}
a{color:inherit} h1{margin:0 0 .3rem} .sub{color:var(--mute);margin:0 0 1.4rem;max-width:62rem}
header{display:flex;gap:1rem;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
button{font:inherit;border:1px solid var(--mute);background:var(--card);color:var(--fg);border-radius:99px;padding:.4rem 1rem;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));max-width:1100px;gap:1.2rem;margin:0 0 2rem}
.concept{margin:0;background:var(--card);border-radius:18px;padding:1rem;box-shadow:0 1px 3px #0002}
.concept .big{display:block;margin:0 auto .7rem} figcaption{font-size:.9rem} .why{display:block;color:var(--mute);margin:.3rem 0}
.pal{display:block;font-size:.8rem;color:var(--mute)} code{background:var(--code);padding:.05rem .3rem;border-radius:4px;font-size:.85em}
table{border-collapse:separate;border-spacing:0;background:var(--wall);border-radius:14px;margin:0 0 2rem;overflow:hidden}
th{font-weight:600;text-align:left;padding:.4rem 1rem;font-size:.9rem} td{padding:.4rem .9rem;text-align:center;vertical-align:middle}
thead th{font-weight:500;color:var(--mute);font-size:.8rem;text-align:center} td.fav{background:#0000000d}
.card{background:var(--card);border-radius:16px;padding:1.1rem 1.3rem;margin:0 0 1.4rem;box-shadow:0 1px 3px #0002}
.card h2{margin:0} .card h2 small{font-weight:400;font-size:.85rem;color:var(--mute)}
.row{display:flex;gap:1.1rem;align-items:flex-end;flex-wrap:wrap} .row figure{margin:0;text-align:center} .row figcaption{color:var(--mute);font-size:.75rem;margin-top:.3rem}
.row .fav img{margin:0 .3rem} .mocks{display:flex;gap:1rem;flex-wrap:wrap;margin-top:1rem} .mocks img{border-radius:14px}
.r1{display:flex;gap:.8rem;align-items:center} .r1 img{border-radius:12px} .src{color:var(--mute);font-size:.85rem}
.sheet img{max-width:100%;border-radius:12px;image-rendering:auto}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}body{padding:1rem}}
</style></head><body><header><div><h1>${esc(ID.name)} · icon round 2</h1>
<p class="sub">Hermes motif (messenger wing, winged sandal, winged hat) × interactive-UI motif (bubble, check, pointer, toggle, UI bars).
One shared hand-drawn wing, bold silhouettes, 2–3 colours. Home-screen label “${esc(ID.shortName)}”. Round 1 for comparison:
<a href="../">round 1 page</a>.</p></div>
<button id="mode" type="button">Dark / light</button></header>
<div class="grid">${grid}</div>
<h2>Small sizes (1:1 pixels) and favicon size</h2>
<table><thead><tr><th></th><th>64</th><th>48</th><th>40</th><th>29</th><th>favicon 32</th><th>favicon 16</th></tr></thead><tbody>
${smallRows}
</tbody></table>
<p class="sheet"><b>Contact sheet</b> (all concepts, 64 / 48 / 40 / 32 / 29 / 16 px on light and dark walls):<br>
<img src="sizes-light.png" alt="contact sheet light"> <img src="sizes-dark.png" alt="contact sheet dark"></p>
<h2>Round 1 (“H+”), for comparison</h2>
<p class="r1">${r1.map((c) => `<a href="../#${c}">${img(`../${c}/ios-512.png`, 72, '', c)}</a>`).join('')}</p>
<h2>Per concept</h2>
${details}
<script>
const b=document.body,k='hui-icons-mode',s=localStorage.getItem(k);
if(s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches)b.classList.add('dark');
document.getElementById('mode').onclick=()=>{b.classList.toggle('dark');localStorage.setItem(k,b.classList.contains('dark')?'dark':'light')};
</script></body></html>`;
  writeFileSync(join(OUT, 'index.html'), html);
  console.log(`previews: ${OUT}/index.html (${list.join(', ')})`);
}

if (!args.includes('--previews-only')) writeAppIcons(CONCEPT);
if (!args.includes('--no-previews')) writePreviews();

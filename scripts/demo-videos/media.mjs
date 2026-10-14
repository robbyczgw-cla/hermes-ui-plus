#!/usr/bin/env node
// Demo media for the v4 clips (served by mock.mjs under /media/ and through the fake image search).
//  - CC0 photos from Wikimedia Commons: the license is re-checked through the Commons API on every download
//    (only "CC0" / "Public domain" pass), then cropped to 4:3 JPEGs. Credits → media/CREDITS.json.
//  - Product images are GENERATED (SVG → PNG through Chromium): fictional headphones, no product photos.
//
//   node scripts/demo-videos/media.mjs            # only what is missing
//   node scripts/demo-videos/media.mjs --force    # everything again
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(HERE, 'media');
const FORCE = process.argv.includes('--force');
const UA = 'HermesInteractiveUI-demo-media/1.0 (reproducible demo assets; CC0 only)';
const OK_LICENSES = /^(cc0|public domain|pd)/i;

/** name → Commons file (CC0 at selection time; re-verified on download) */
export const PHOTOS = [
  { name: 'pizza', title: 'File:Pizza Margherita - San Francisco, CA.jpg' },
  { name: 'gelato', title: 'File:Gelato ice cream.jpg' },
  { name: 'espresso', title: 'File:Espresso Coffee 01.jpg' },
  { name: 'cacio', title: 'File:Spaghetti, cacio e pepe & bitter leaf salad - Tutto 2024-04-04.jpg' },
  { name: 'carbonara', title: 'File:Carbonara - Amo 2026-05-18.jpg' },
  { name: 'spaghetti', title: 'File:Spaghetti2.jpg' },
  { name: 'shakshuka', title: 'File:Shakshuka (Unsplash).jpg' },
  { name: 'bike-tires', title: 'File:Bicycle Tires (Unsplash).jpg' },
  { name: 'bike-brake', title: 'File:Bicycle tire wheel brake (Unsplash).jpg' },
  { name: 'bike-mantel', title: 'File:Fahrrad-mantel.jpg' },
];

/** fictional headphones: [file, cup colour, band colour, accent, background from, background to] */
export const PRODUCTS = [
  ['hp-aurel', '#2b2f36', '#1c1f24', '#c9a46a', '#eef1f6', '#d9dee8'],
  ['hp-nordwell', '#e9e4da', '#cfc7b8', '#7b8794', '#f4efe6', '#e2d9c8'],
  ['hp-kiro', '#2f4a7a', '#22375c', '#7fb2ff', '#e8eefb', '#cfdcf5'],
  ['hp-halden', '#5b6b52', '#45523e', '#d8c38a', '#eef2ea', '#d5dfcd'],
  ['hp-vela', '#d9534f', '#b8403c', '#ffd2c2', '#fbeeea', '#f3d6cd'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function commonsInfo(title) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', format: 'json', titles: title, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1400', iiextmetadatafilter: 'LicenseShortName|Artist|LicenseUrl' }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const page = Object.values((await r.json()).query?.pages ?? {})[0];
      const ii = page?.imageinfo?.[0];
      if (!ii) throw new Error(`not found on Commons: ${title}`);
      const m = ii.extmetadata ?? {};
      return { url: ii.thumburl || ii.url, page: ii.descriptionurl, license: strip(m.LicenseShortName?.value), artist: strip(m.Artist?.value) };
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`Commons API failed for ${title}`);
}

async function photos(credits) {
  for (const p of PHOTOS) {
    const out = join(MEDIA, `${p.name}.jpg`);
    if (existsSync(out) && !FORCE && credits[p.name]) continue;
    const info = await commonsInfo(p.title);
    if (!OK_LICENSES.test(info.license)) throw new Error(`${p.title}: license "${info.license}" is not CC0/PD – pick another file`);
    const r = await fetch(info.url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`download ${info.url}: HTTP ${r.status}`);
    const tmp = join(MEDIA, `.${p.name}.src`);
    writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    execFileSync('convert', [tmp, '-auto-orient', '-resize', '960x720^', '-gravity', 'center', '-extent', '960x720', '-strip', '-quality', '86', out]);
    rmSync(tmp);
    credits[p.name] = { file: `${p.name}.jpg`, source: info.page, title: p.title.replace(/^File:/, ''), author: info.artist, license: info.license };
    console.log(`  photo ${p.name}.jpg  (${info.license}, ${info.artist})`);
    await sleep(1500);
  }
}

function headphonesSvg([, cup, band, accent, bg1, bg2]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <linearGradient id="cup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${cup}" stop-opacity="0.85"/><stop offset="0.55" stop-color="${cup}"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="960" height="720" fill="url(#bg)"/>
  <ellipse cx="480" cy="612" rx="300" ry="34" fill="url(#shadow)"/>
  <path d="M250 430 C 250 170, 710 170, 710 430" fill="none" stroke="${band}" stroke-width="46" stroke-linecap="round"/>
  <path d="M262 418 C 268 196, 692 196, 698 418" fill="none" stroke="url(#hl)" stroke-width="10" stroke-linecap="round"/>
  <path d="M300 300 C 330 215, 630 215, 660 300" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round" opacity="0.9"/>
  <rect x="232" y="380" width="36" height="110" rx="14" fill="${band}"/>
  <rect x="692" y="380" width="36" height="110" rx="14" fill="${band}"/>
  <g>
    <rect x="168" y="420" width="150" height="196" rx="66" fill="url(#cup)"/>
    <rect x="292" y="438" width="44" height="160" rx="22" fill="#1d1f23" opacity="0.85"/>
    <rect x="186" y="440" width="40" height="120" rx="20" fill="url(#hl)"/>
    <circle cx="243" cy="518" r="16" fill="${accent}" opacity="0.9"/>
  </g>
  <g>
    <rect x="642" y="420" width="150" height="196" rx="66" fill="url(#cup)"/>
    <rect x="624" y="438" width="44" height="160" rx="22" fill="#1d1f23" opacity="0.85"/>
    <rect x="660" y="440" width="40" height="120" rx="20" fill="url(#hl)"/>
    <circle cx="717" cy="518" r="16" fill="${accent}" opacity="0.9"/>
  </g>
</svg>`;
}

async function products() {
  const todo = PRODUCTS.filter((p) => FORCE || !existsSync(join(MEDIA, `${p[0]}.jpg`)));
  if (!todo.length) return;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    for (const p of todo) {
      await page.setContent(`<html><body style="margin:0">${headphonesSvg(p)}</body></html>`);
      const png = join(MEDIA, `.${p[0]}.png`);
      await page.screenshot({ path: png });
      execFileSync('convert', [png, '-quality', '88', join(MEDIA, `${p[0]}.jpg`)]);
      rmSync(png);
      console.log(`  generated ${p[0]}.jpg`);
    }
  } finally {
    await browser.close();
  }
}

export async function buildMedia() {
  mkdirSync(MEDIA, { recursive: true });
  const credFile = join(MEDIA, 'CREDITS.json');
  const credits = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};
  await photos(credits);
  await products();
  for (const p of PRODUCTS) credits[p[0]] = { file: `${p[0]}.jpg`, source: 'generated by scripts/demo-videos/media.mjs (fictional product)', license: 'CC0' };
  credits['hafen'] = credits['hafen'] ?? { file: 'hafen.jpg', title: 'Copenhagen, Nyhavn', source: 'https://commons.wikimedia.org', license: 'CC0' };
  writeFileSync(credFile, JSON.stringify(credits, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildMedia();

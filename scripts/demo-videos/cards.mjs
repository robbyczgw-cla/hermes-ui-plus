// Still assets for the encoder, rendered as PNG through Chromium (HTML/CSS, Inter from ./fonts, real font weights):
// backgrounds, phone bezel + screen mask, caption overlays, title / end cards. The app icon is read at encode
// time from app/assets/icon.png (or $DEMO_ICON, e.g. a brand SVG) so a new icon only needs a re-encode.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FONT = join(HERE, 'fonts', 'Inter.ttf');
export const ICON = process.env.DEMO_ICON || join(ROOT, 'app', 'assets', 'icon.png');
export const BRAND = {
  name: process.env.DEMO_BRAND_NAME || 'Hermes Interactive UI+',
  tagline: process.env.DEMO_TAGLINE || 'The mobile app for your Hermes Agent',
  disclaimer: 'Unofficial community client · not affiliated with Nous Research',
  repo: process.env.DEMO_REPO_URL || 'github.com/robbyczgw-cla/hermes-ui-plus',
};

let browser = null;
async function getPage() {
  if (!browser) {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch({ headless: true });
  }
  return browser.newPage();
}
export async function closeCards() {
  await browser?.close();
  browser = null;
}

const fontCss = () => `@font-face{font-family:Inter;src:url(data:font/ttf;base64,${readFileSync(FONT).toString('base64')}) format('truetype');font-weight:100 900}
*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent;font-family:Inter,'DejaVu Sans',sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01'}`;
const iconData = () => {
  if (!existsSync(ICON)) return null;
  const type = extname(ICON) === '.svg' ? 'image/svg+xml' : 'image/png';
  return `data:${type};base64,${readFileSync(ICON).toString('base64')}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** render `body` HTML (+css) at w×h to `dir/<name>-<hash>.png`; cached by content (icon included) */
export async function renderPng(dir, name, w, h, body, css = '') {
  mkdirSync(dir, { recursive: true });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss()}${css}</style></head><body style="width:${w}px;height:${h}px;overflow:hidden">${body}</body></html>`;
  const icon = html.includes('__ICON__') ? iconData() ?? '' : '';
  const hash = createHash('sha1').update(html).update(icon).digest('hex').slice(0, 10);
  const out = join(dir, `${name}-${hash}.png`);
  if (existsSync(out)) return out;
  const page = await getPage();
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html.replaceAll('__ICON__', icon), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  return out;
}

// ── palettes ──
export const LIGHT_BG = `background:
  radial-gradient(1200px 900px at 15% 10%, rgba(129,140,248,.35), transparent 60%),
  radial-gradient(1000px 800px at 90% 85%, rgba(45,212,191,.30), transparent 60%),
  linear-gradient(160deg,#f5f7ff 0%,#eaf0fb 45%,#e3f4f1 100%);`;
// Dark (trailer / title / end cards): "Bote" brand colours from app/brand/identity.json – ink → inkRaised with a
// very faint brass glow behind the phone; eyebrow labels in brass, headlines in glyph, body in a muted warm grey.
const IDENTITY = JSON.parse(readFileSync(join(ROOT, 'app', 'brand', 'identity.json'), 'utf8')).colors;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
export const INK = { bg: IDENTITY.ink, raised: IDENTITY.inkRaised, text: IDENTITY.glyph, accent: IDENTITY.accent, muted: 'rgba(214,207,192,.82)', faint: 'rgba(214,207,192,.62)' };
export const DARK_BG = `background:
  radial-gradient(1000px 760px at 78% 32%, rgba(${rgb(IDENTITY.accent)},.07), transparent 65%),
  linear-gradient(160deg,${IDENTITY.ink} 0%,${IDENTITY.inkRaised} 100%);`;

export const bgPng = (dir, w, h, dark = false) => renderPng(dir, `bg-${w}x${h}-${dark ? 'dark' : 'light'}`, w, h, `<div style="width:100%;height:100%;${dark ? DARK_BG : LIGHT_BG}"></div>`);

/** phone bezel (shadow + frame) with a transparent screen hole; geometry in output pixels */
export function framePng(dir, W, H, g, dark = false) {
  const { x, y, w, h, bezel, r } = g;
  const shadow = dark ? '0 40px 90px rgba(0,0,0,.55), 0 10px 30px rgba(0,0,0,.4)' : '0 40px 90px rgba(30,41,90,.28), 0 10px 30px rgba(30,41,90,.18)';
  // the frame is a thick border around the screen box; inner radius = r
  return renderPng(
    dir,
    `frame-${W}x${H}-${x}-${y}-${w}x${h}${dark ? '-d' : ''}`,
    W,
    H,
    `<div style="position:absolute;left:${x - bezel}px;top:${y - bezel}px;width:${w + 2 * bezel}px;height:${h + 2 * bezel}px;border-radius:${r + bezel}px;
      border:${bezel}px solid #15171c;box-shadow:${shadow},inset 0 0 0 2px #2b2e36;outline:2px solid ${dark ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.65)'};outline-offset:-1px"></div>`,
  );
}
/** white rounded rect on black = alpha mask for the screen */
export const maskPng = (dir, w, h, r) => renderPng(dir, `mask-${w}x${h}-${r}`, w, h, `<div style="width:100%;height:100%;background:#000"><div style="width:100%;height:100%;border-radius:${r}px;background:#fff"></div></div>`);

/** two-line English caption (title + description) for the portrait demos */
export const captionPng = (dir, W, H, title, description, dark = false) =>
  renderPng(
    dir,
    'caption',
    W,
    H,
    `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:0 60px">
      <div style="font-size:52px;font-weight:750;letter-spacing:-.02em;color:${dark ? INK.text : '#0f172a'};line-height:1.1">${esc(title)}</div>
      ${description ? `<div style="font-size:30px;font-weight:500;color:${dark ? INK.muted : '#475569'};line-height:1.2">${esc(description)}</div>` : ''}
    </div>`,
  );

/** trailer side caption (16:9): small kicker, big title, sub line – white on the dark background */
export const sideCaptionPng = (dir, W, H, { kicker, title, sub }) =>
  renderPng(
    dir,
    'side',
    W,
    H,
    `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:18px;padding:0 0 0 8px">
      ${kicker ? `<div style="font-size:24px;font-weight:650;letter-spacing:.14em;text-transform:uppercase;color:${INK.accent}">${esc(kicker)}</div>` : ''}
      <div style="font-size:76px;font-weight:780;letter-spacing:-.03em;line-height:1.02;color:${INK.text}">${esc(title)}</div>
      ${sub ? `<div style="font-size:32px;font-weight:450;line-height:1.3;color:${INK.muted};max-width:720px">${esc(sub)}</div>` : ''}
    </div>`,
  );

/** portrait trailer caption: kicker + title, centred, white */
export const topCaptionPng = (dir, W, H, { kicker, title }) =>
  renderPng(
    dir,
    'top',
    W,
    H,
    `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:0 50px">
      ${kicker ? `<div style="font-size:26px;font-weight:650;letter-spacing:.14em;text-transform:uppercase;color:${INK.accent}">${esc(kicker)}</div>` : ''}
      <div style="font-size:58px;font-weight:780;letter-spacing:-.025em;line-height:1.05;color:${INK.text}">${esc(title)}</div>
    </div>`,
  );

/** opening title card (transparent, laid over the background): icon, name, tagline */
export const titleCardPng = (dir, W, H) => {
  const s = Math.min(W, H) / 1080;
  return renderPng(
    dir,
    'title',
    W,
    H,
    `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${28 * s}px;text-align:center">
      <img src="__ICON__" style="width:${170 * s}px;height:${170 * s}px;border-radius:${40 * s}px;box-shadow:0 20px 60px rgba(0,0,0,.45)">
      <div style="font-size:${Math.min(104 * s, W / 13.5)}px;font-weight:800;letter-spacing:-.035em;color:${INK.text};line-height:1">${esc(BRAND.name)}</div>
      <div style="font-size:${42 * s}px;font-weight:450;color:${INK.muted}">${esc(BRAND.tagline)}</div>
    </div>`,
  );
};

/** end card: icon + name, a few feature words, repo URL, disclaimer */
export const endCardPng = (dir, W, H) => {
  const s = Math.min(W, H) / 1080;
  const portrait = H > W;
  return renderPng(
    dir,
    'end',
    W,
    H,
    `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${26 * s}px;text-align:center;padding:0 ${60 * s}px">
      <div style="display:flex;${portrait ? 'flex-direction:column;' : ''}align-items:center;gap:${30 * s}px">
        <img src="__ICON__" style="width:${130 * s}px;height:${130 * s}px;border-radius:${30 * s}px;box-shadow:0 16px 50px rgba(0,0,0,.45)">
        <div style="font-size:${Math.min(84 * s, W / 14)}px;font-weight:800;letter-spacing:-.03em;color:${INK.text};line-height:1.02">${esc(BRAND.name)}</div>
      </div>
      <div style="font-size:${36 * s}px;font-weight:450;color:${INK.muted}">${esc(BRAND.tagline)}</div>
      <div style="margin-top:${14 * s}px;font-size:${34 * s}px;font-weight:600;color:${INK.accent};padding:${14 * s}px ${30 * s}px;border:${2 * s}px solid rgba(${rgb(IDENTITY.accent)},.5);border-radius:${999}px">${esc(BRAND.repo)}</div>
      <div style="margin-top:${26 * s}px;font-size:${26 * s}px;font-weight:450;color:${INK.faint}">${esc(BRAND.disclaimer)}</div>
    </div>`,
  );
};

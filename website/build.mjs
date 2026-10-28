#!/usr/bin/env node
// Generates the static pages of the project website (website/*.html) from the repository's own sources:
//   privacy.html  <- ../PRIVACY.md      (the same text, rendered; the app links it)
//   security.html <- ../SECURITY.md
//   index.html, support.html, 404.html  (written below; the agent setup prompt comes from ../docs/SETUP-WITH-AGENT.md)
// Facts (name, URLs, contact) come from ../app/brand/identity.json. No dependencies, no network.
//
//   node website/build.mjs           write the pages
//   node website/build.mjs --check   fail if the committed pages differ from what the sources produce
//
// scripts/website.test.mjs runs the check, so a changed PRIVACY.md cannot ship with a stale privacy page.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// the released app version (all version fields agree, scripts/release-version-check.mjs)
const VERSION = JSON.parse(read('app/package.json')).version;
const MINOR = VERSION.split('.').slice(0, 2).join('.'); // "0.2" for the alpha badge and "in 0.2" notes
const ID = JSON.parse(read('app/brand/identity.json'));

const SITE = ID.homepage.replace(/\/+$/, '');
const REPO = ID.repoUrl.replace(/\/+$/, '');
const MAIL = ID.supportEmail;
const NAME = ID.name;
// the app's on-device and store name (HUI+), introduced once per page as "HUI+ (Hermes UI+)"
const APP = ID.displayName;
const APP_INTRO = `${APP} (${ID.shortName})`;
// Videos are too large for git (see website/README.md). Posters (media/*.jpg) are committed.
const OG_ALT = `${APP} on a phone: Hermes asks where the city break should go, with four destinations to pick from`;
const MEDIA = (process.env.WEBSITE_MEDIA_BASE || '/media/').replace(/([^/])$/, '$1/');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── minimal Markdown renderer (only what PRIVACY.md / SECURITY.md use) ──────────────────────────────────────────
function repoLink(url) {
  if (/^(https?:|mailto:|#)/.test(url)) return url;
  return `${REPO}/blob/main/${url.replace(/^\.?\//, '')}`; // relative repo path -> GitHub
}
function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(repoLink(u.replace(/&amp;/g, '&')))}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}
const slug = (t) => t.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function markdown(md, { h1 = false } = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      flush();
      const lvl = m[1].length;
      if (lvl === 1 && !h1) { i++; continue; } // the page title is written by the layout
      const text = inline(m[2]);
      out.push(`<h${lvl} id="${slug(text)}">${text}</h${lvl}>`);
      i++; continue;
    }
    if (/^\|/.test(l) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push('<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on narrow screens"><table>' +
        `<thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${r.map((c, k) => (k === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('') +
        '</tbody></table></div>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      flush();
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (/^\s*[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s+/, '')); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(l)) {
      flush();
      const items = [];
      while (i < lines.length && (/^\d+\.\s+/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (/^\d+\.\s+/.test(lines[i])) items.push(lines[i].replace(/^\d+\.\s+/, '')); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(q.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^---+\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    para.push(l.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

// ── layout ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Design: "The Messenger". Warm paper, ink, brass and one sealing-wax red for live/approval moments; Gloock (display),
// Atkinson Hyperlegible Next (text) and JetBrains Mono (commands), self-hosted under fonts/. CSS only, no JavaScript.
const NAV = [
  ['/#new', `New in ${MINOR}`, 'new'],
  ['/#features', 'Features', 'features'],
  ['/#demos', 'Demos', 'demos'],
  ['/#platforms', 'Platforms', 'platforms'],
  ['/#self-hosting', 'Self-hosting', 'self-hosting'],
];
const DOWNLOAD = `${REPO}/releases/latest`;

// The icon's wing (app/brand/icon, website/icon.svg): one leading edge, three feather scallops, root at (0,0).
const WING = 'M0 -60 C -60 -130 -160 -220 -300 -262 C -352 -277 -380 -222 -342 -194 C -310 -170 -282 -154 -258 -142 C -312 -136 -328 -84 -290 -64 C -262 -50 -232 -40 -205 -34 C -248 -22 -250 34 -206 44 C -140 60 -70 64 0 56 Z';
const BUBBLE = 'M432 390 H592 A140 140 0 0 1 732 530 V600 A140 140 0 0 1 592 740 H470 L386 800 Q370 811 373 792 L380 736 A140 140 0 0 1 292 600 V530 A140 140 0 0 1 432 390 Z';
// A quill feather (the line motif), drawn from numbers: a gently bent shaft and barbs that follow the vane's outline.
// Every path has pathLength=1 so the hero can ink it in with one stroke-dashoffset animation.
function feather() {
  const f = (n) => Math.round(n * 10) / 10;
  const shaft = (t) => [26 * t * t, 500 - 1000 * t];
  const vane = (t) => (t < 0.16 ? 0 : Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.16) / 0.86)), 0.62));
  const d = [`M${shaft(0).map(f).join(' ')} Q${f(4)} -${f(10)} ${shaft(1).map(f).join(' ')}`];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const t = 0.17 + (0.8 * i) / N;
    if (i === 13 || i === 29) continue; // two splits in the vane, as on a real feather
    const [sx, sy] = shaft(t);
    const lift = 70 + 40 * t;
    for (const [side, w] of [[-1, 112], [1, 150]]) {
      const len = w * vane(t);
      if (len < 6) continue;
      const ex = sx + side * len, ey = sy - lift * (0.5 + 0.5 * vane(t));
      d.push(`M${f(sx)} ${f(sy)} Q${f(sx + side * len * 0.55)} ${f(sy - lift * 0.18)} ${f(ex)} ${f(ey)}`);
    }
  }
  return d.map((x) => `<path pathLength="1" d="${x}"/>`).join('');
}
// Shared symbols: the winged bubble (seal, wordmark), the feather and a tick. Colours come from CSS.
const SPRITE = `<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
<symbol id="mk" viewBox="130 270 764 560"><path class="mk-w" transform="translate(410 470) scale(0.72)" d="${WING}"/><path class="mk-w" transform="translate(614 470) scale(-0.72 0.72)" d="${WING}"/><path class="mk-gap" transform="translate(0 -30)" d="${BUBBLE}"/><path class="mk-b" transform="translate(0 -30)" d="${BUBBLE}"/><g class="mk-d"><circle cx="420" cy="535" r="38"/><circle cx="512" cy="535" r="38"/><circle cx="604" cy="535" r="38"/></g></symbol>
<symbol id="feather" viewBox="-170 -560 360 1080">${feather()}</symbol>
<symbol id="tick" viewBox="0 0 16 16"><path d="M3.2 8.4 6.5 11.6 12.8 4.6"/></symbol>
</svg>`;
const featherLine = (cls) => `<svg class="feather ${cls}" aria-hidden="true" focusable="false"><use href="#feather"/></svg>`;
const MARK = '<svg viewBox="0 0 764 560" focusable="false"><use href="#mk"/></svg>';
const seal = (cls = '') => `<span class="seal ${cls}" aria-hidden="true"><span class="seal-disc">${MARK}</span></span>`;
const plus = (s) => esc(s).replace(/\+$/, '<span class="plus">+</span>');

function page({ file, path, title, description, current, body, kind = 'prose', noindex = false, jsonld = '' }) {
  const full = file === 'index.html' ? APP_INTRO + ' – interactive chat for Hermes Agent' : `${title} – ${APP_INTRO}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f1f0ec">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE}${path}">`}
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/gloock-regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/atkinson-hyperlegible-next-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(NAME)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
${noindex ? '' : `<meta property="og:url" content="${SITE}${path}">\n`}<meta property="og:image" content="${SITE}/media/trailer-02-poster.jpg">
<meta property="og:image:width" content="1920">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image:alt" content="${esc(OG_ALT)}">
${jsonld ? `<script type="application/ld+json">${jsonld}</script>\n` : ''}</head>
<body class="page-${kind}">
${SPRITE}
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<div class="frame bar">
<a class="brand" href="/"><img src="/icon.svg" alt="" width="34" height="34"><span class="brand-text"><span>${plus(APP)}</span><span class="brand-sub">${esc(NAME)}</span></span></a>
<nav aria-label="Main"><ul>
${NAV.map(([href, label, key]) => `<li><a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n')}
<li><a class="gh" href="${REPO}">GitHub</a></li>
</ul></nav>
</div>
</header>
${kind === 'prose' ? `<div class="letterhead" aria-hidden="true">${featherLine('wl-letter')}</div>\n` : ''}<main id="main" class="${kind === 'home' ? 'home' : 'frame prose'}" tabindex="-1">
${body}
</main>
<footer class="foot">
<div class="frame">
<p class="wordmark" aria-hidden="true"><span class="wm-mark">${MARK}</span>${plus(APP)}</p>
<p class="wordmark-sub" aria-hidden="true">${esc(APP)} · ${esc(NAME)}</p>
<div class="foot-cols">
<p class="disclaimer">${esc(APP)} (${esc(NAME)}) is an unofficial, open-source community client for the Hermes Agent. It is not affiliated with, endorsed by or supported by Nous Research. No accounts, no analytics, no cookies, no trackers on this site.</p>
<ul class="foot-links">
<li><a href="${DOWNLOAD}">Download</a></li>
<li><a href="/privacy"${current === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a></li>
<li><a href="/support"${current === 'support' ? ' aria-current="page"' : ''}>Support</a></li>
<li><a href="/security"${current === 'security' ? ' aria-current="page"' : ''}>Security</a></li>
<li><a href="/imprint"${current === 'imprint' ? ' aria-current="page"' : ''}>Imprint</a></li>
<li><a href="${REPO}">Source code</a></li>
<li><a href="${REPO}/blob/main/LICENSE">MIT license</a></li>
</ul>
</div>
</div>
</footer>
</body>
</html>
`;
}

// ── pages ───────────────────────────────────────────────────────────────────────────────────────────────────────
const CLIPS = [
  ['For your Hermes Agent', [
    ['09-freigabe', 'Approvals', 'Hermes wants to delete old files: see the exact command, the risk and the deadline, then tap “Allow once” – from your phone.', 21],
    ['12-langtask', 'Long task, answer waiting', 'A research task with several tool steps: switch to another chat, Hermes keeps working, and the app tells you when the answer – summary and sources – is ready. (Web app: push notification; Android: keeps running in the background.)', 29],
    ['13-toolsteps', 'Live tool steps', 'A server check: terminal commands, a file read and a web search appear live in “Tools & activity”, then a compact table.', 22],
    ['18-schnellfrage', 'Quick answers ⚡', 'The ⚡ in the composer: a fast model answers in a couple of seconds. When it needs real data, one tap continues as a normal Hermes chat. (Needs the optional Hermes plugin on your server.)', 39],
    ['bots-02', 'A bot for every job', 'Your Hermes bots are contacts in the Bots tab, each with its own chat, memory and routines. When one wants to run a command, it asks you first, by name. (Bots are Hermes profiles on your server; recorded in the offline demo.)', 27, 'music'],
    ['08-befehle', 'Models & slash commands', 'Type “/” for the command palette: pick the model for this chat, set reasoning effort, see every command.', 18],
    ['20-modellsperre', 'Model per chat, locked in', 'The model you pick is locked on the Hermes session for that chat; the header shows a lock.', 12],
  ]],
  ['Answers you work with', [
    ['14-wege', 'Compare your options', 'Where should the family photos live? Four ways as chains with a verdict; one tap picks, and Hermes answers with a plan.', 28],
    ['02-produkte', 'Product top 5 & compare', 'Headphone ranking with category scores, compare two models, details and “I’ll take this”.', 30],
    ['15-bausteine', 'Setup at a glance', 'A question about home Wi-Fi: the answer arrives as a building-blocks diagram with columns, devices and a shared base.', 18],
    ['07-umformen', 'Transform bar', 'A long answer about e-bike commuting: one tap on “As a table” and Hermes reshapes it.', 28],
    ['01-orte', 'Place cards', 'Restaurants near the Pantheon as cards: swipe, save, details with opening hours, all on a map.', 33],
    ['03-anleitung', 'Step-by-step guide', 'Changing a bike tube: tick off steps; at step 3 tap “I’m stuck here” and Hermes helps with that step.', 34],
    ['11-designs', 'Themes', 'Settings → Appearance: Standard, OLED black, Paper, Nord, switched live.', 27],
    ['04-training', 'Workout with rest timer', 'Full-body session: tapping a set starts the rest countdown; a summary at the end.', 33],
    ['05-vokabeln', 'Vocabulary trainer', 'English to Spanish: flip cards, multiple choice and forgiving typing with Leitner boxes.', 26],
    ['06-mindmap', 'Mind map', 'A heat pump as a mind map: zoom in, pan, tap a node and ask for more with “Dig deeper”.', 25],
    ['10-rezept', 'Recipe with timers & shopping list', 'Shakshuka: scale servings, start a timer, send ingredients to a shopping list and tick them off.', 33],
  ]],
  ['Fast and reliable', [
    ['19-fluessig', 'Fluid streaming', 'Even long answers stream at a steady 60 frames per second: text appears live and cards fade in softly.', 26],
    ['16-bilder', 'Product cards that stay put', 'Even on a slow connection, product cards keep their size: photos fade in, the text below stays where it is, and reopening the chat is instant.', 34],
    ['21-nichtgesendet', 'Nothing gets lost', 'If the app closes before the server confirmed a message, it is kept: “Not sent”, with “Send again”.', 15],
  ]],
];
// A demo clip is the app recorded inside its own phone frame (1080×1920). The plate crops the empty margin at the sides.
const clip = ([id, title, text, secs, sound]) => `<figure class="plate">
<div class="plate-media">
<video controls muted loop playsinline preload="none" poster="/media/${id}.webp" width="540" height="960" aria-label="${esc(title)}: demo recording, ${sound ? `with ${sound}, starts muted` : 'no sound'}">
<source src="${esc(MEDIA)}${id}.mp4" type="video/mp4">
<a href="${esc(MEDIA)}${id}.mp4">Download the demo video (MP4)</a>
</video>
</div>
<figcaption><span class="plate-title">${esc(title)}</span> <span class="plate-secs">${secs} s</span><span class="plate-text">${esc(text)}</span></figcaption>
</figure>`;

// The hero clip (website/make-hero.sh) is the app's screen only; its poster's pixel size sets the phone's proportions.
function jpegSize(file) {
  const b = readFileSync(join(HERE, file));
  for (let i = 2; i < b.length - 9;) {
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error(`${file}: no JPEG frame header`);
}
const HERO_NAME = 'hero-loop-03'; // new name per changed clip: /media is cached for 30 days (website/README.md)
const HERO = jpegSize(`media/${HERO_NAME}.jpg`);

// The one canonical "set up with your agent" prompt lives in docs/SETUP-WITH-AGENT.md between these markers; the README
// carries a verbatim copy (scripts/website.test.mjs), and the page below shows it, so the three cannot drift.
export function agentPrompt() {
  const m = /<!-- agent-setup-prompt:begin -->\n```text\n([\s\S]*?)\n```\n<!-- agent-setup-prompt:end -->/.exec(read('docs/SETUP-WITH-AGENT.md'));
  if (!m) throw new Error('docs/SETUP-WITH-AGENT.md: agent-setup-prompt block not found');
  return m[1];
}
// Commands in backticks get the brass tone; the backticks stay, so a copy is the prompt verbatim.
// Each line is an inline-block (hanging indent for "1." and "- " lines); inline boxes add no characters to a copy.
const promptHtml = (s) => s.split('\n').map((l) => {
  const cls = /^\d+\.\s/.test(l) ? ' pl-n' : /^-\s/.test(l) ? ' pl-b' : '';
  return `<span class="pl${cls}">${esc(l).replace(/`[^`]+`/g, (c) => `<span class="pc">${c}</span>`)}</span>`;
}).join('\n');

const no = (n) => `<span class="no" aria-hidden="true">№ ${String(n).padStart(2, '0')}</span>`;
const tick = '<svg class="tk" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><use href="#tick"/></svg>';

const FEATURES = [
  ['f-approve', 'Approvals', 'When Hermes asks before running a command, you see the exact command, the risk and the deadline, and allow or deny it from wherever you are.',
    `<div class="app ap-lg">
<div class="ap-top"><span class="ap-warn" aria-hidden="true">!</span><p><strong>Hermes wants to run something</strong><span class="risk">Elevated risk (estimate)</span></p></div>
<div class="ap-deadline"><span>Deadline approx.</span><span class="m">4:58</span><i></i></div>
<p class="ap-why">Deletes files in ~/Downloads that are older than 90 days.</p>
<code class="ap-code">find ~/Downloads -type f -mtime +90 -delete</code>
<div class="ap-opts"><span class="opt opt-allow">Allow once<small>This one command only</small></span><span class="opt">For this task<small>Similar commands until this answer is done</small></span><span class="opt opt-deny">Deny</span></div>
</div>`],
  ['f-tools', 'Live tool steps', 'A timeline shows what ran and how long it took while the answer streams in, so you can step in early.',
    `<div class="app tl">
<p class="tl-head">Tools &amp; activity <span>4 steps</span></p>
<ol>
<li class="ok">${tick}<b>terminal</b><code>uptime</code><span>0.3 s</span></li>
<li class="ok">${tick}<b>read_file</b><code>nginx.conf</code><span>0.1 s</span></li>
<li class="ok">${tick}<b>web_search</b><code>nginx 1.27 changelog</code><span>1.2 s</span></li>
<li class="run"><i class="spin"></i><b>Writing the answer</b><span class="dots"><i></i><i></i><i></i></span></li>
</ol>
</div>`],
  ['f-away', 'Leave the app', `Switch chats or lock the phone: Hermes keeps working, and the finished answer waits for you. The web app sends a push notification. Android keeps running in the background, with no remote push in ${MINOR}: no notification while the app is closed.`,
    `<div class="app lock">
<span class="stamp-delivered" aria-hidden="true">Delivered</span>
<p class="lock-time">9:41</p>
<p class="lock-date">Thursday</p>
<div class="note"><img src="/icon.svg" alt="" width="30" height="30"><p><span class="note-app">${esc(APP)} <span>now</span></span><strong>Your answer is ready</strong>Lisbon long weekend: the plan, a budget and 6 sources.</p></div>
</div>`],
  ['f-answers', 'Interactive answers', '51 components, 25 of them interactive: tick checklists, make choices, compare products, fill in forms, vote, rank. Your taps go back to Hermes as the next message.',
    `<div class="app pick">
<p class="pick-q">Where should the family photos live?</p>
<ul>
<li><i></i>Only on your phone <em class="tag tag-bad">Avoid</em></li>
<li><i></i>External hard drive <em class="tag">Baseline</em></li>
<li><i></i>Home storage box <em class="tag">Interesting</em></li>
<li class="on"><i></i>Encrypted cloud copy <em class="tag tag-good">Recommended</em></li>
</ul>
<p class="pick-send"><span>Sending “Encrypted cloud copy”</span><b>Undo</b></p>
</div>`],
  ['f-live', 'Live cards', 'A shopping list, trip plan or watchlist that Hermes keeps up to date over many messages. It stays pinned in the chat, shows what changed, and your own ticks go along with your next message. Needs the hermes-ui skill 0.7.1.',
    `<div class="app rows">
<p class="rows-head">Pinned · Barbecue on Saturday <span class="live-v">v3 · 2 of 9</span></p>
<dl>
<div><dt>Charcoal</dt><dd>Added by Hermes</dd></div>
<div><dt>Halloumi</dt><dd>Added by Hermes</dd></div>
<div><dt>Tomatoes</dt><dd>Ticked by you</dd></div>
</dl>
</div>`],
  ['f-local', 'Local-first', 'Conversations stay on your device and your own server. No accounts, no telemetry.',
    `<div class="app rows">
<p class="rows-head">On this phone</p>
<dl>
<div><dt>Chats</dt><dd>Stored on the device</dd></div>
<div><dt>Account</dt><dd>None needed</dd></div>
<div><dt>Analytics</dt><dd class="off">Off, always</dd></div>
<div><dt>Crash reports</dt><dd class="off">None sent</dd></div>
</dl>
</div>`],
  ['f-server', 'Your server only', 'The app talks to your bridge, never to a service of ours. The bridge holds the Hermes API key.',
    `<div class="app pair">
<span class="qr" aria-hidden="true"><i></i><i></i><i></i></span>
<div><p class="pair-ok">${tick}Paired with your bridge</p><code>your-bridge.example.com</code>
<p class="route"><span>Phone</span><span>Bridge</span><span>Hermes</span></p></div>
</div>`],
];

const PLATFORMS = [
  ['Android', `Signed APK from <a href="${DOWNLOAD}">GitHub Releases</a>, or add the repository to <a href="https://obtainium.imranr.dev">Obtainium</a> for automatic updates (turn on “Include prereleases”). Google Play: internal testing only, not public yet. Android 7.0 or newer, 64-bit ARM (it does not start on x86 emulators or x86 ChromeOS; use the web app there). No remote push in ${MINOR}: no notification while the app is closed.`, 'Alpha', ''],
  ['Web app (PWA)', `Prebuilt bundle from GitHub Releases, served by your own bridge, installable to the home screen. <a href="${REPO}/blob/main/docs/WEB-APP.md">Install guide</a>.`, 'Alpha', ''],
  ['macOS', `Native desktop app for Apple Silicon (macOS 13+) from <a href="${DOWNLOAD}">GitHub Releases</a> (DMG), signed and notarized: menus and shortcuts, approval actions in notifications, dock badge, menu bar mode, Touch ID lock. See the <a href="${REPO}/blob/main/desktop/README.md">desktop notes</a>.`, 'Notarized', 'st-ink'],
  ['Linux', `Desktop app as AppImage or .deb (x86_64, Ubuntu 22.04 / Debian 12 or newer) from <a href="${DOWNLOAD}">GitHub Releases</a>, see the <a href="${REPO}/blob/main/desktop/README.md">desktop notes</a>. Still alpha.`, 'Alpha', ''],
  ['iOS', 'Use the web app for now: installable, with push. A native app is prepared for TestFlight.', 'Soon', 'st-soon'],
];

const indexBody = `<section class="hero frame" aria-labelledby="h-title">
<div class="hero-copy">
<h1 id="h-title"><span class="l1">Answers</span> <span class="l2">you can</span> <span class="l3">act on.</span></h1>
<p class="lead">${esc(APP)} (${esc(NAME)}) is an unofficial app for Hermes Agent. Tick, choose, compare and fill in right inside the answer, approve commands from your phone, and every tap goes back to Hermes as your next message.</p>
<p class="cta">
<a class="btn btn-ink" href="${DOWNLOAD}">Download</a>
<a class="btn btn-line" href="#self-hosting">Run the bridge</a>
<a class="btn-text" href="#agent-setup">Set up with your agent <span aria-hidden="true">→</span></a>
</p>
<ul class="meta" aria-label="Release">
<li>Alpha ${esc(MINOR)}</li><li>Open source</li><li>Unofficial</li><li class="meta-p">Android</li><li class="meta-p">Web</li><li class="meta-p">macOS</li><li class="meta-p">Linux</li>
</ul>
<p class="req">For people who run <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a> (v0.21 or newer) and talk to it through Telegram or the terminal today. You run a small bridge next to it.</p>
</div>
<div class="stage">
${featherLine('wl-hero')}
<div class="phone">
<div class="screen">
<img src="/media/${HERO_NAME}.webp" alt="" width="${HERO[0]}" height="${HERO[1]}">
<video autoplay muted loop playsinline preload="metadata" poster="/media/${HERO_NAME}.webp" width="${HERO[0]}" height="${HERO[1]}" aria-label="The app on a phone: approvals, quick answers, bots and interactive answers. No sound.">
<source src="${esc(MEDIA)}${HERO_NAME}.mp4" type="video/mp4">
</video>
</div>
</div>
<div class="slip slip-approve" aria-hidden="true">
<p class="sa-head"><span class="live"></span>Hermes wants to run</p>
<code>rm -rf ~/old-logs</code>
<p class="sa-meta"><span>Elevated risk</span><span class="m">4:58</span></p>
<p class="sa-btns"><span class="sa-allow"><span class="lbl-a">Allow once</span><span class="lbl-b">${tick}Allowed</span><i class="tap"></i></span><span class="sa-deny">Deny</span></p>
</div>
<div class="slip slip-check" aria-hidden="true">
<p class="sc-head">Change a bike tube <span>2 / 3</span></p>
<ul>
<li class="done"><i>${tick}</i>Take the wheel off</li>
<li class="ticking"><i>${tick}</i>Find the puncture</li>
<li><i>${tick}</i>Fit the new tube</li>
</ul>
</div>
<div class="slip slip-choice" aria-hidden="true">
<p class="sx-q">Where do the photos go?</p>
<p class="sx-chips"><span>Phone</span><span>NAS</span><span class="pick">Cloud<i class="tap"></i></span></p>
<p class="sx-sent">→ sent to Hermes</p>
</div>
<div class="slip slip-tool" aria-hidden="true"><span class="st-globe"></span><b>web_search</b><span class="st-sep"></span><span class="st-time">1.2 s</span><span class="st-state"><i class="spin"></i>${tick}</span></div>
${seal('seal-hero')}
</div>
</section>

<section id="new" class="film film-new" aria-labelledby="h-new">
<div class="frame film-grid">
<header class="film-head">
${no(1)}
<h2 id="h-new">New in ${esc(MINOR)}</h2>
<p>Your Hermes bots as contacts, each with its own chat, and approvals that name the bot. Lists that Hermes keeps up to date over many messages. Reminders that reach you, and a look at what your agent knows and can do. 62 seconds, with voice and music.</p>
<p class="credits">Recorded in the app's offline demo with invented content; some features need the bridge, the hermes-ui skill or the plugin on your server (<a href="${REPO}/releases/tag/v${esc(VERSION)}">release notes</a>). Voice and music made with ElevenLabs. Also as a <a href="${esc(MEDIA)}new-in-02-vertical.mp4">vertical video (MP4)</a>.</p>
</header>
<figure class="screen-169">
<video controls playsinline preload="none" poster="/media/new-in-02-poster.webp" width="1920" height="1080" aria-label="What is new in ${esc(MINOR)}, 62 seconds, with voice and music">
<source src="${esc(MEDIA)}new-in-02.mp4" type="video/mp4">
<a href="${esc(MEDIA)}new-in-02.mp4">Download the video (MP4)</a>
</video>
</figure>
</div>
</section>

<section id="features" class="sec feats frame" aria-labelledby="h-what">
<header class="sec-head">
${no(2)}
<h2 id="h-what">What it does</h2>
<p class="sec-lead">Hermes already does the work. Here you steer it: approve a command, pick an option, tick off a step, and Hermes carries on from your tap.</p>
</header>
${featherLine('wl-feats')}
<ul class="feat-list">
${FEATURES.map(([id, h, p, card]) => `<li class="feat ${id}">
${card}
<h3>${h}</h3>
<p>${p}</p>
</li>`).join('\n')}
</ul>
</section>

<section id="demos" class="sec demos" aria-labelledby="h-demos">
<header class="sec-head frame">
${no(3)}
<h2 id="h-demos">Demos</h2>
<p class="sec-lead">Short recordings of the app (web build, phone size). All content is prepared sample data, nothing real. The videos have no sound; scroll each row sideways.</p>
</header>
${CLIPS.map(([h, items], k) => `<div class="reel">
<h3 id="clips-${k + 1}" class="frame reel-head">${esc(h)} <span>${items.length} clips</span></h3>
<div class="strip" tabindex="0" role="region" aria-labelledby="clips-${k + 1}">
${items.map(clip).join('\n')}
</div>
</div>`).join('\n')}
</section>

<section id="film" class="film" aria-labelledby="h-film">
<div class="frame film-grid">
<header class="film-head">
${no(4)}
<h2 id="h-film">The film</h2>
<p>The app in 66 seconds, with voice and music: interactive answers, sources, bots, live cards and the offline demo.</p>
<p class="credits">Recorded in the app's offline demo with invented content. Voice and music made with ElevenLabs. The demo clips use CC0 photos (Wikimedia Commons) and generated product images; per-file sources are in <a href="${REPO}/blob/main/scripts/demo-videos/media/CREDITS.json">CREDITS.json</a>. Also as a <a href="${esc(MEDIA)}trailer-02-vertical.mp4">vertical video (MP4)</a>.</p>
</header>
<figure class="screen-169">
<video controls playsinline preload="none" poster="/media/trailer-02-poster.webp" width="1920" height="1080" aria-label="Trailer, 66 seconds, with voice and music">
<source src="${esc(MEDIA)}trailer-02.mp4" type="video/mp4">
<a href="${esc(MEDIA)}trailer-02.mp4">Download the trailer (MP4)</a>
</video>
</figure>
</div>
</section>

<section id="platforms" class="sec plats frame" aria-labelledby="h-platforms">
<header class="sec-head">
${no(5)}
<h2 id="h-platforms">Where it runs</h2>
<p class="sec-lead">The current version is ${esc(VERSION)}, still an early release. Expect rough edges. It is not in the public Google Play Store or the Apple App Store yet.</p>
<p><a class="btn btn-ink" href="${DOWNLOAD}">Download the latest release</a></p>
</header>
<div class="receipt"><div class="rc-paper">
<p class="rc-head"><span>${esc(APP)}</span><span>${esc(VERSION)}</span></p>
<ul class="rc-rows">
${PLATFORMS.map(([name, how, status, cls]) => `<li><h3>${name}</h3><p>${how}</p><span class="stamp ${cls}">${status}</span></li>`).join('\n')}
</ul>
<p class="rc-foot">No account. No store. Your server.</p>
</div></div>
</section>

<section id="self-hosting" class="sec host frame" aria-labelledby="h-self">
<div class="host-panel">
<header class="sec-head">
${no(6)}
<h2 id="h-self">Run the bridge</h2>
<p class="sec-lead">There is no hosted service. You run a small Node.js service, the <em>bridge</em>, next to your Hermes (Node.js 22+ or Docker). It authenticates your devices, routes presentation, handles uploads, voice and push, and pairs a new phone with a QR code. We strongly recommend reaching it over <a href="https://tailscale.com">Tailscale</a> and never exposing it to the public internet.</p>
</header>
<div class="term" role="group" aria-label="Setup command">
<p class="term-bar"><span>on the machine that runs Hermes</span></p>
<pre><code><span class="pr" aria-hidden="true">$ </span>npx ${esc(ID.bridgePackage)} setup<span class="caret" aria-hidden="true"></span></code></pre>
</div>
<ol class="steps">
<li><span>Turn on the Hermes API server and start the Hermes gateway.</span></li>
<li><span>Run the setup wizard on that machine: <code>npx ${esc(ID.bridgePackage)} setup</code>.</span></li>
<li><span>Install the app and scan the pairing QR code.</span></li>
</ol>
<ul class="host-links">
<li><a href="${REPO}/blob/main/docs/SELF-HOSTING.md">Self-hosting guide</a> <span>bridge, Tailscale, tokens, push, updating</span></li>
<li><a href="${REPO}/blob/main/docs/WEB-APP.md">Install the web app</a> <span>PWA served by your bridge</span></li>
<li><a href="${REPO}#quick-start">Quick start</a> <span>about ten minutes</span></li>
<li><a href="#agent-setup">Let an agent set it up</a> <span>Hermes or a coding agent</span></li>
<li><a href="${REPO}/blob/main/docs/BRIDGE.md">Why the bridge exists</a> <span>and how it is secured</span></li>
</ul>
</div>
</section>

<section id="agent-setup" class="sec agent frame" aria-labelledby="h-agent">
<header class="sec-head">
${no(7)}
<h2 id="h-agent">Give this to your agent</h2>
<p class="sec-lead">Hermes can run shell commands, so it can set up its own bridge. Paste this prompt into a direct chat with your Hermes (Telegram, Hermes CLI) or into a coding agent with a terminal on the same machine.</p>
<ul class="agent-rules">
<li>${tick}Checks the prerequisites first and tells you what is missing</li>
<li>${tick}Asks before installing packages or restarting Hermes</li>
<li>${tick}Stays on your tailnet: no funnel, no port forwarding</li>
<li>${tick}Never shows keys or tokens; hands you the one-time pair link</li>
<li>${tick}Ends with what it installed, where, and how to undo it</li>
</ul>
<p class="agent-more">Variants for Hermes and for coding agents, plus diagnosis and update prompts: <a href="${REPO}/blob/main/docs/SETUP-WITH-AGENT.md">SETUP-WITH-AGENT.md</a></p>
</header>
<figure class="dispatch">
<figcaption class="dispatch-bar"><span class="dispatch-to">To: your agent</span><span class="dispatch-hint">Click to select, then copy</span></figcaption>
<pre class="prompt" aria-label="Setup prompt for your agent">${promptHtml(agentPrompt())}</pre>
</figure>
</section>

<section id="privacy" class="sec priv frame" aria-labelledby="h-priv">
<div class="letter">
${no(8)}
<h2 id="h-priv">Privacy in short</h2>
<p>The developers collect no data. There are no accounts, no analytics, no advertising and no crash reporting. Your messages go from your device to your bridge, then to your Hermes, and from there to the model providers you configured. Nowhere else.</p>
<p><a href="/privacy">Read the full privacy policy</a></p>
${seal('seal-letter')}
</div>
</section>`;

// Imprint: disclosure under § 25 of the Austrian Media Act and § 5 of the E-Commerce Act, for a private, non-commercial site.
const imprintBody = `<h1>Imprint</h1>
<p>Disclosure pursuant to § 25 of the Austrian Media Act (Mediengesetz) and information pursuant to § 5 of the Austrian E-Commerce Act (ECG).</p>
<ul>
<li>Media owner and publisher: Robert (Robby) Czesany</li>
<li>Place of residence: Graz, Austria</li>
<li>Contact: <a href="mailto:${MAIL}">${MAIL}</a></li>
<li>Nature of the site: private, non-commercial project page for the free, open-source app ${esc(NAME)}. No goods or services are sold, no advertising.</li>
<li>Editorial direction: information about ${esc(NAME)}, its download and its documentation.</li>
</ul>
<p>Operated by a private individual, not a company. No commercial register entry, no VAT number and no supervisory authority apply.</p>
<p>Privacy: see the <a href="/privacy">privacy policy</a>. Supervisory authority for data protection: Austrian Data Protection Authority, Barichgasse 40–42, 1030 Vienna, <a href="mailto:dsb@dsb.gv.at">dsb@dsb.gv.at</a>.</p>
<p>The software is provided as is, without warranty of any kind, under the MIT licence. Hermes Agent is a project of Nous Research; ${esc(NAME)} is not affiliated with it.</p>`;

const supportBody = `<h1>Support</h1>
<p>${esc(NAME)} is a volunteer project. Replies can take a few days.</p>

<h2 id="questions-and-bugs">Questions and bug reports</h2>
<p>Use the <a href="${REPO}/issues">GitHub issue tracker</a>. It is public, so please redact tokens, host names and anything personal (use placeholders), and include the app and bridge versions and your platform. Search the existing issues first.</p>

<h2 id="documentation">Documentation</h2>
<ul>
<li><a href="${REPO}#quick-start">Quick start</a></li>
<li><a href="${REPO}/blob/main/docs/SELF-HOSTING.md">Self-hosting guide</a>, including troubleshooting</li>
<li><a href="${REPO}/blob/main/docs/SETUP-WITH-AGENT.md">Set up with an agent</a></li>
<li><a href="${REPO}/blob/main/docs/WEB-APP.md">Web app (PWA)</a></li>
<li><a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a></li>
</ul>

<h2 id="email">E-mail</h2>
<p>For anything that is not suitable for a public issue, write to <a href="mailto:${MAIL}">${MAIL}</a>. That is also the contact address for privacy questions.</p>

<h2 id="security-issues">Security problems</h2>
<p>Please do not open a public issue for a vulnerability. See <a href="/security">Security</a> for how to report it privately.</p>

<h2 id="not-affiliated">Hermes Agent itself</h2>
<p>This app is an unofficial client and is not affiliated with Nous Research. Problems with Hermes Agent itself belong to <a href="https://github.com/NousResearch/hermes-agent">its own project</a>.</p>`;

const notFoundBody = `<p class="rts" aria-hidden="true">Return to sender</p>
<h1>Page not found</h1>
<p>This page does not exist. Go to the <a href="/">start page</a>, the <a href="/privacy">privacy policy</a> or <a href="/support">support</a>.</p>`;

// Structured data for the start page. Inert data (no script runs), so the CSP needs no script-src.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: APP_INTRO,
  alternateName: NAME,
  url: `${SITE}/`,
  description: `${ID.tagline}: approvals, live tool steps and interactive answers. Unofficial and open source.`,
  applicationCategory: 'CommunicationApplication',
  isAccessibleForFree: true,
  license: 'https://opensource.org/licenses/MIT',
  codeRepository: REPO,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
});

// sitemap.xml lists every indexable page (no lastmod: the pages are generated, a date here would only go stale)
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/privacy', '/security', '/support', '/imprint'].map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`;

export function build() {
  const priv = read('PRIVACY.md');
  const sec = read('SECURITY.md');
  const pages = {
    'index.html': page({ file: 'index.html', path: '/', title: NAME, description: `${ID.tagline}. An unofficial, open-source mobile and web app for Hermes Agent: approvals, live tool steps, interactive answers and lists that stay up to date. No accounts, no tracking.`, current: '', body: indexBody, kind: 'home', jsonld: JSON_LD }),
    'privacy.html': page({ file: 'privacy.html', path: '/privacy', title: 'Privacy policy', description: `Privacy policy of ${NAME}: the developers collect no data; your data goes only to the server you set up.`, current: 'privacy', body: `<h1>${esc(/^#\s+(.*)$/m.exec(priv)[1])}</h1>\n${markdown(priv)}` }),
    'security.html': page({ file: 'security.html', path: '/security', title: 'Security', description: `Security policy and threat model of ${NAME}, and how to report a vulnerability.`, current: 'security', body: `<h1>${esc(/^#\s+(.*)$/m.exec(sec)[1])}</h1>\n${markdown(sec)}` }),
    'imprint.html': page({ file: 'imprint.html', path: '/imprint', title: 'Imprint', description: `Imprint and disclosure for ${NAME} under Austrian law.`, current: 'imprint', body: imprintBody }),
    'support.html': page({ file: 'support.html', path: '/support', title: 'Support', description: `Get help with ${NAME}: GitHub issues, documentation and the contact address.`, current: 'support', body: supportBody }),
    'sitemap.xml': SITEMAP,
    '404.html': page({ file: '404.html', path: '/404', title: 'Page not found', description: 'Page not found.', current: '', body: notFoundBody, noindex: true }),
  };
  return pages;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = build();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(pages).filter(([f, c]) => !existsSync(join(HERE, f)) || readFileSync(join(HERE, f), 'utf8') !== c).map(([f]) => f);
    if (stale.length) { console.error(`website: stale pages (run node website/build.mjs): ${stale.join(', ')}`); process.exit(1); }
    console.log('website: pages are up to date');
  } else {
    for (const [f, c] of Object.entries(pages)) writeFileSync(join(HERE, f), c);
    console.log(`website: wrote ${Object.keys(pages).join(', ')}`);
  }
}

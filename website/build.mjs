#!/usr/bin/env node
// Generates the static pages of the project website (website/*.html) from the repository's own sources:
//   privacy.html  <- ../PRIVACY.md      (the same text, rendered; the app links it)
//   security.html <- ../SECURITY.md
//   index.html, support.html, 404.html  (written below)
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
const ID = JSON.parse(read('app/brand/identity.json'));

const SITE = ID.homepage.replace(/\/+$/, '');
const REPO = ID.repoUrl.replace(/\/+$/, '');
const MAIL = ID.supportEmail;
const NAME = ID.name;
// Videos are too large for git (see website/README.md). Posters (media/*.jpg) are committed.
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
const NAV = [
  ['/#demos', 'Demos', 'demos'],
  ['/#platforms', 'Platforms', 'platforms'],
  ['/#self-hosting', 'Self-hosting', 'self-hosting'],
  ['/privacy', 'Privacy', 'privacy'],
  ['/support', 'Support', 'support'],
  ['/security', 'Security', 'security'],
];
function page({ file, path, title, description, current, body, wide = false }) {
  const full = file === 'index.html' ? NAME + ' – interactive chat for Hermes Agent' : `${title} – ${NAME}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0F131A">
<link rel="canonical" href="${SITE}${path}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}/media/trailer-poster.jpg">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<div class="wrap bar">
<a class="brand" href="/"><img src="/icon.svg" alt="" width="32" height="32"><span>${esc(ID.shortName)}</span></a>
<nav aria-label="Main"><ul>
${NAV.map(([href, label, key]) => `<li><a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n')}
<li><a href="${REPO}">GitHub</a></li>
</ul></nav>
</div>
</header>
<main id="main" class="${wide ? 'wrap' : 'wrap prose'}" tabindex="-1">
${body}
</main>
<footer class="foot">
<div class="wrap">
<p>${esc(NAME)} is an unofficial, open-source community client for the Hermes Agent. It is not affiliated with, endorsed by or supported by Nous Research. No accounts, no analytics, no cookies, no trackers on this site.</p>
<p><a href="/privacy">Privacy</a> · <a href="/support">Support</a> · <a href="/security">Security</a> · <a href="${REPO}">Source code</a> · <a href="${REPO}/blob/main/LICENSE">MIT license</a></p>
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
    ['08-befehle', 'Models & slash commands', 'Type “/” for the command palette: pick the model for this chat, set reasoning effort, see every command.', 18],
  ]],
  ['And answers that look great', [
    ['02-produkte', 'Product top 5 & compare', 'Headphone ranking with category scores, compare two models, details and “I’ll take this”.', 30],
    ['07-umformen', 'Transform bar', 'A long answer about e-bike commuting: one tap on “As a table” and Hermes reshapes it.', 28],
    ['01-orte', 'Place cards', 'Restaurants near the Pantheon as cards: swipe, save, details with opening hours, all on a map.', 33],
    ['03-anleitung', 'Step-by-step guide', 'Changing a bike tube: tick off steps; at step 3 tap “I’m stuck here” and Hermes helps with that step.', 34],
    ['11-designs', 'Themes', 'Settings → Appearance: Standard, OLED black, Paper, Nord, switched live.', 27],
    ['04-training', 'Workout with rest timer', 'Full-body session: tapping a set starts the rest countdown; a summary at the end.', 33],
    ['05-vokabeln', 'Vocabulary trainer', 'English to Spanish: flip cards, multiple choice and forgiving typing with Leitner boxes.', 26],
    ['06-mindmap', 'Mind map', 'A heat pump as a mind map: zoom in, pan, tap a node and ask for more with “Dig deeper”.', 25],
    ['10-rezept', 'Recipe with timers & shopping list', 'Shakshuka: scale servings, start a timer, send ingredients to a shopping list and tick them off.', 33],
  ]],
];
const clip = ([id, title, text, secs]) => `<figure class="clip">
<video controls muted loop playsinline preload="none" poster="/media/${id}.jpg" width="540" height="960" aria-label="${esc(title)}: demo recording, no sound">
<source src="${esc(MEDIA)}${id}.mp4" type="video/mp4">
<a href="${esc(MEDIA)}${id}.mp4">Download the demo video (MP4)</a>
</video>
<figcaption><strong>${esc(title)}</strong> <span class="dim">${secs} s</span><br>${esc(text)}</figcaption>
</figure>`;

const indexBody = `<section class="hero" aria-labelledby="h-title">
<p class="eyebrow">Alpha · open source · unofficial community client</p>
<h1 id="h-title">${esc(NAME)}</h1>
<p class="lead">${esc(ID.tagline)}. Approve commands from your phone, watch every tool step live, leave the app while Hermes keeps working, and get answers that are not walls of text.</p>
<p class="cta">
<a class="btn primary" href="${REPO}/releases">Get the Android alpha</a>
<a class="btn" href="#self-hosting">Self-hosting</a>
<a class="btn" href="${REPO}">View source on GitHub</a>
</p>
<p class="dim">Made for people who run <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a> and talk to it through Telegram or the terminal today. Requires Hermes Agent v0.21 or newer and a small bridge that you run yourself.</p>
</section>

<section aria-labelledby="h-what">
<h2 id="h-what">What it does</h2>
<ul class="cards">
<li><h3>Approvals</h3><p>When Hermes asks before running a command, you see the command and answer in the app.</p></li>
<li><h3>Live tool steps</h3><p>A timeline shows what ran and how long it took, while the answer streams in.</p></li>
<li><h3>Leave the app</h3><p>Hermes keeps working in the background; the finished answer waits for you.</p></li>
<li><h3>Interactive answers</h3><p>About 50 components: tables, charts, checklists, maps, recipes, quizzes, timers. Your taps go back to Hermes as the next message.</p></li>
<li><h3>Local-first</h3><p>Conversations stay on your device and your own server. No accounts, no telemetry.</p></li>
<li><h3>Your server only</h3><p>The app talks to your bridge, never to a service of ours. The bridge holds the Hermes API key.</p></li>
</ul>
</section>

<section id="demos" aria-labelledby="h-demos">
<h2 id="h-demos">Demos</h2>
<p>Short recordings of the app (web build, phone size). All content is prepared sample data, nothing real. The videos have no sound.</p>
<figure class="trailer">
<video controls playsinline preload="none" poster="/media/trailer-poster.jpg" width="1920" height="1080" aria-label="Trailer, 45 seconds">
<source src="${esc(MEDIA)}trailer.mp4" type="video/mp4">
<a href="${esc(MEDIA)}trailer.mp4">Download the trailer (MP4)</a>
</video>
<figcaption><strong>Trailer</strong> <span class="dim">45 s</span><br>The best moments in 45 seconds.</figcaption>
</figure>
${CLIPS.map(([h, items], k) => `<h3 id="clips-${k + 1}">${esc(h)}</h3>\n<div class="gallery">\n${items.map(clip).join('\n')}\n</div>`).join('\n')}
</section>

<section id="platforms" aria-labelledby="h-platforms">
<h2 id="h-platforms">Platforms</h2>
<p>The current version is an alpha (0.1.0-alpha.1). Expect rough edges. It is not in the Google Play Store or the Apple App Store.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Platforms, scrolls sideways on narrow screens"><table>
<thead><tr><th scope="col">Platform</th><th scope="col">How to get it</th><th scope="col">Status</th></tr></thead>
<tbody>
<tr><th scope="row">Android</th><td>Signed APK from <a href="${REPO}/releases">GitHub Releases</a>, or add the repository to <a href="https://obtainium.imranr.dev">Obtainium</a> for automatic updates (turn on “Include prereleases”). Android 7.0 or newer, 64-bit ARM.</td><td>Alpha</td></tr>
<tr><th scope="row">Web app (PWA)</th><td>Prebuilt bundle from GitHub Releases, served by your own bridge, installable to the home screen. <a href="${REPO}/blob/main/docs/WEB-APP.md">Install guide</a>.</td><td>Alpha</td></tr>
<tr><th scope="row">iOS</th><td>Use the web app for now (installable, with push). A native app is prepared for TestFlight.</td><td>Web app now</td></tr>
<tr><th scope="row">Linux</th><td>Desktop app as AppImage or .deb (x86_64, Ubuntu 22.04 / Debian 12 or newer), see the <a href="${REPO}/blob/main/desktop/README.md">desktop notes</a>.</td><td>Alpha</td></tr>
<tr><th scope="row">macOS</th><td>Native desktop app for Apple Silicon (macOS 13+), signed and notarized: menus and shortcuts, approval actions in notifications, dock badge, menu bar mode, Touch ID lock. See the <a href="${REPO}/blob/main/desktop/README.md">desktop notes</a>.</td><td>Alpha</td></tr>
</tbody></table></div>
</section>

<section id="self-hosting" aria-labelledby="h-self">
<h2 id="h-self">Install and self-hosting</h2>
<p>There is no hosted service. You run a small Node.js service, the <em>bridge</em>, next to your Hermes (Node.js 22+ or Docker). It authenticates your devices, routes presentation, handles uploads, voice and push, and pairs a new phone with a QR code. We strongly recommend reaching it over <a href="https://tailscale.com">Tailscale</a> and never exposing it to the public internet.</p>
<ol class="steps">
<li>Turn on the Hermes API server and start the Hermes gateway.</li>
<li>Run the setup wizard on that machine: <code>npx hermes-ui-plus-bridge setup</code>.</li>
<li>Install the app and scan the pairing QR code.</li>
</ol>
<ul>
<li><a href="${REPO}#quick-start-5-minutes">Quick start (5 minutes)</a></li>
<li><a href="${REPO}/blob/main/docs/SELF-HOSTING.md">Self-hosting guide: bridge, Tailscale, tokens, push, updating</a></li>
<li><a href="${REPO}/blob/main/docs/SETUP-WITH-AGENT.md">Let Hermes or a coding agent set it up for you</a></li>
<li><a href="${REPO}/blob/main/docs/WEB-APP.md">Install the web app</a></li>
<li><a href="${REPO}/blob/main/docs/BRIDGE.md">Why the bridge exists and how it is secured</a></li>
</ul>
</section>

<section aria-labelledby="h-priv">
<h2 id="h-priv">Privacy in short</h2>
<p>The developers collect no data. There are no accounts, no analytics, no advertising and no crash reporting. Your messages go from your device to your bridge, then to your Hermes, and from there to the model providers you configured. Nowhere else. Read the <a href="/privacy">full privacy policy</a>.</p>
</section>`;

const supportBody = `<h1>Support</h1>
<p>${esc(NAME)} is a volunteer project. Replies can take a few days.</p>

<h2 id="questions-and-bugs">Questions and bug reports</h2>
<p>Use the <a href="${REPO}/issues">GitHub issue tracker</a>. It is public, so please redact tokens, host names and anything personal (use placeholders), and include the app and bridge versions and your platform. Search the existing issues first.</p>

<h2 id="documentation">Documentation</h2>
<ul>
<li><a href="${REPO}#quick-start-5-minutes">Quick start</a></li>
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

const notFoundBody = `<h1>Page not found</h1>
<p>This page does not exist. Go to the <a href="/">start page</a>, the <a href="/privacy">privacy policy</a> or <a href="/support">support</a>.</p>`;

export function build() {
  const priv = read('PRIVACY.md');
  const sec = read('SECURITY.md');
  const pages = {
    'index.html': page({ file: 'index.html', path: '/', title: NAME, description: `${ID.tagline}. An unofficial, open-source mobile and web app for Hermes Agent: approvals, live tool steps and interactive answers. No accounts, no tracking.`, current: '', body: indexBody, wide: true }),
    'privacy.html': page({ file: 'privacy.html', path: '/privacy', title: 'Privacy policy', description: `Privacy policy of ${NAME}: the developers collect no data; your data goes only to the server you set up.`, current: 'privacy', body: `<h1>${esc(/^#\s+(.*)$/m.exec(priv)[1])}</h1>\n${markdown(priv)}` }),
    'security.html': page({ file: 'security.html', path: '/security', title: 'Security', description: `Security policy and threat model of ${NAME}, and how to report a vulnerability.`, current: 'security', body: `<h1>${esc(/^#\s+(.*)$/m.exec(sec)[1])}</h1>\n${markdown(sec)}` }),
    'support.html': page({ file: 'support.html', path: '/support', title: 'Support', description: `Get help with ${NAME}: GitHub issues, documentation and the contact address.`, current: 'support', body: supportBody }),
    '404.html': page({ file: '404.html', path: '/404', title: 'Page not found', description: 'Page not found.', current: '', body: notFoundBody }),
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

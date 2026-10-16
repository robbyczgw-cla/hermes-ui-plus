// The project website (website/): pages are generated from PRIVACY.md / SECURITY.md / identity.json, must not drift,
// must stay free of third-party requests and scripts, and every local reference must exist (videos excepted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, agentPrompt } from '../website/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'website');
const pages = build();

test('website: committed pages equal the generated pages (run node website/build.mjs)', () => {
  for (const [f, content] of Object.entries(pages)) {
    assert.ok(existsSync(join(SITE, f)), `${f} missing`);
    assert.equal(readFileSync(join(SITE, f), 'utf8'), content, `${f} is stale: run node website/build.mjs`);
  }
});

const plain = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
const text = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

for (const [page, md] of [['privacy.html', 'PRIVACY.md'], ['security.html', 'SECURITY.md']]) {
  test(`website: ${page} carries the full text of ${md}`, () => {
    const body = /<main[^>]*>([\s\S]*)<\/main>/.exec(pages[page])[1];
    assert.equal(text(body), plain(readFileSync(join(ROOT, md), 'utf8')));
  });
}

test('website: no scripts, no third-party resources, no inline handlers', () => {
  for (const [f, rawHtml] of Object.entries(pages)) {
    const html = rawHtml.replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, ''); // inert structured data, see the CSP test
    assert.ok(!/<script|\son\w+\s*=|<iframe|<link[^>]+rel="?(preconnect|dns-prefetch)/i.test(html), `${f}: script/iframe/handler`);
    for (const m of html.matchAll(/\s(src|poster)="([^"]+)"/g)) assert.ok(!/^(https?:)?\/\//.test(m[2]) || m[2].startsWith(process.env.WEBSITE_MEDIA_BASE ?? '\0'), `${f}: external ${m[1]} ${m[2]}`);
    for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) assert.ok(!/^https?:\/\/(?!hermesui\.xyz)/.test(m[1]) || /rel="canonical"/.test(m[0]), `${f}: external link tag ${m[1]}`);
  }
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(readFileSync(join(SITE, 'style.css'), 'utf8')));
});

test('website: local references resolve (demo videos are copied in at deploy time)', () => {
  const clean = new Set(['/privacy', '/support', '/security', '/']);
  for (const [f, html] of Object.entries(pages)) {
    for (const m of html.matchAll(/\s(?:src|href|poster)="(\/[^"#]*)(?:#[^"]*)?"/g)) {
      const p = m[1];
      if (clean.has(p) || p.endsWith('.mp4')) continue;
      assert.ok(existsSync(join(SITE, p)), `${f}: ${p} does not exist in website/`);
    }
    for (const m of html.matchAll(/\shref="#([^"]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), `${f}: #${m[1]} has no target`);
  }
  for (const m of pages['index.html'].matchAll(/href="\/#([^"]+)"/g)) assert.ok(pages['index.html'].includes(`id="${m[1]}"`), `nav #${m[1]}`);
});

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('website: pages use the project identity and the public contact only', () => {
  const id = JSON.parse(readFileSync(join(ROOT, 'app/brand/identity.json'), 'utf8'));
  assert.ok(pages['support.html'].includes(`mailto:${id.supportEmail}`));
  assert.ok(pages['support.html'].includes(`${id.repoUrl}/issues`));
  assert.ok(pages['privacy.html'].includes(`${id.homepage}/privacy`));
  assert.equal(new URL(id.privacyUrl).pathname, '/privacy');
  // 0.1.1 naming: the app is HUI+ (on-device + store name), introduced once as "HUI+ (Hermes UI+)"; the project stays Hermes UI+
  for (const [f, html] of Object.entries(pages).filter(([f]) => f.endsWith('.html'))) {
    assert.match(html, new RegExp(`<title>[^<]*${esc(id.displayName)} \\(${esc(id.shortName)}\\)[^<]*</title>`), `${f}: title`);
    assert.ok(html.includes(`<span>HUI<span class="plus">+</span></span><span class="brand-sub">${id.name}</span>`), `${f}: header wordmark`);
  }
  assert.match(pages['index.html'], /<h1 id="h-title">[^\n]*Answers[^\n]*you can[^\n]*act on\.<\/span><\/h1>/, 'hero');
  const names = readdirSync(SITE);
  for (const n of ['vercel.json', 'style.css', 'icon.svg', '404.html']) assert.ok(names.includes(n), n);
  assert.equal(JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8')).cleanUrls, true);
});

// fresh-user test of 0.1.0-alpha.1: README said 48 components, the website "about 50"; desktop downloads contradicted
test('website + README: one component count (the protocol node types) and consistent platform facts', () => {
  const types = readFileSync(join(ROOT, 'app/src/protocol/types.ts'), 'utf8');
  const list = /export const HUI_NODE_TYPES[^=]*=\s*\[([\s\S]*?)\];/.exec(types)[1];
  const n = new Set([...list.matchAll(/'([a-z0-9_-]+)'/g)].map((m) => m[1])).size;
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const site = text(pages['index.html']);
  assert.ok(readme.includes(`**${n} native answer components**`), `README: ${n} components`);
  assert.ok(site.includes(`${n}components`), `website: ${n} components`);
  for (const [name, s] of [['README', readme.toLowerCase()], ['website', site]]) {
    assert.ok(!/about\s*50\s*components|~\s*50\s*components/.test(s), `${name}: approximate count`);
  }
  for (const f of ['README.md', 'desktop/README.md']) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(s, /not attached to the GitHub release|maintainer's download page/, f);
  }
  assert.match(readme, /no remote push in 0\.1/i);
  assert.ok(site.includes('noremotepushin01'), 'website: Android has no remote push in 0.1');
});

// One canonical "set up with your agent" prompt (docs/SETUP-WITH-AGENT.md): README and website carry it verbatim.
test('agent setup prompt: README and website show the text from docs/SETUP-WITH-AGENT.md', () => {
  const prompt = agentPrompt();
  assert.ok(prompt.split('\n').length >= 10, 'prompt block found');
  assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes('```text\n' + prompt + '\n```'), 'README.md: copy the block from docs/SETUP-WITH-AGENT.md');
  const pre = /<pre class="prompt"[^>]*>([\s\S]*?)<\/pre>/.exec(pages['index.html'])[1];
  const shown = pre.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(shown, prompt);
  assert.match(pages['index.html'], /href="#agent-setup"/);
  for (const rule of ['tailscale funnel', 'port forwarding', 'Ask before installing', '--dry-run', 'how to undo']) assert.ok(prompt.includes(rule), rule);
});

test('website: crawl and share metadata (canonical, sitemap, noindex 404, image alt, structured data)', () => {
  for (const [f, html] of Object.entries(pages)) {
    if (!f.endsWith('.html')) continue;
    const meta = (re) => re.exec(html)?.[1];
    if (f === '404.html') {
      assert.match(html, /<meta name="robots" content="noindex">/);
      assert.doesNotMatch(html, /rel="canonical"|og:url/);
      continue;
    }
    assert.ok(meta(/<link rel="canonical" href="([^"]+)"/)?.startsWith('https://hermesui.xyz'), `${f}: canonical`);
    assert.equal(meta(/og:url" content="([^"]+)"/), meta(/<link rel="canonical" href="([^"]+)"/), `${f}: og:url = canonical`);
    assert.match(html, /og:image:alt" content="[^"]{20,}"/, `${f}: og:image:alt`);
    assert.match(html, /og:image:width" content="1920"/);
  }
  const urls = [...pages['sitemap.xml'].matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(urls, ['/', '/privacy', '/security', '/support'].map((p) => `https://hermesui.xyz${p}`));
  assert.match(readFileSync(join(SITE, 'robots.txt'), 'utf8'), /^Sitemap: https:\/\/hermesui\.xyz\/sitemap\.xml$/m);
  const ld = JSON.parse(/<script type="application\/ld\+json">([^<]+)<\/script>/.exec(pages['index.html'])[1]);
  assert.equal(ld['@type'], 'SoftwareApplication');
  assert.equal(ld.url, 'https://hermesui.xyz/');
});

test('website: CSP stays strict (nothing but self, no script-src, fonts and media from self)', () => {
  const v = JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /^default-src 'none';/);
  assert.match(csp, /font-src 'self';/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-|script-src|https?:|\*/);
});

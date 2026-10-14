// The project website (website/): pages are generated from PRIVACY.md / SECURITY.md / identity.json, must not drift,
// must stay free of third-party requests and scripts, and every local reference must exist (videos excepted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../website/build.mjs';

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
  for (const [f, html] of Object.entries(pages)) {
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

test('website: pages use the project identity and the public contact only', () => {
  const id = JSON.parse(readFileSync(join(ROOT, 'app/brand/identity.json'), 'utf8'));
  assert.ok(pages['support.html'].includes(`mailto:${id.supportEmail}`));
  assert.ok(pages['support.html'].includes(`${id.repoUrl}/issues`));
  assert.ok(pages['privacy.html'].includes(`${id.homepage}/privacy`));
  assert.equal(new URL(id.privacyUrl).pathname, '/privacy');
  const names = readdirSync(SITE);
  for (const n of ['vercel.json', 'style.css', 'icon.svg', '404.html']) assert.ok(names.includes(n), n);
  assert.equal(JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8')).cleanUrls, true);
});

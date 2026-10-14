/// <reference types="node" />
// Pure parts of the image resolver, tested against recorded Wikimedia API responses
// (fixtures/*.json, fetched once with curl; untrusted data, only parsed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileKey, htmlToText, parseImageInfo, parseSearchPages, parseTitleLookup, resizeThumb, safeWikimediaUrl } from './parse.ts';
import { acceptableFile, normalizeText, pickCommonsFile, pickWikiPage, titleScore, wantsNonPhoto } from './rank.ts';
import { createLruCache } from './cache.ts';
import { attributionText, attributionUrl, isInternalHost } from './attribution.ts';

const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const REQUESTED = ['Kolosseum', 'Trevi-Brunnen', 'Pantheon (Rom)', 'Petersdom', 'spanische Treppe', 'Forum Romanum', 'iPhone 17', 'Pixel 10', 'Wärmepumpe', 'Eiffelturm', 'Hund', 'Tiramisu', 'Mona Lisa', 'Albert Einstein', 'Galaxy S25', 'Engelsburg', 'Rom', 'Spaghetti carbonara', 'Pantheon'];

test('parseTitleLookup follows normalization + redirects, marks missing', () => {
  const m = parseTitleLookup(fx('wiki-titles-de.json'), REQUESTED);
  assert.equal(m.size, REQUESTED.length);
  assert.equal(m.get('Kolosseum')?.file, 'Colosseo_2020.jpg');
  assert.equal(m.get('spanische Treppe')?.title, 'Spanische Treppe'); // normalized (case)
  assert.equal(m.get('Hund')?.title, 'Haushund'); // redirect
  assert.equal(m.get('Spaghetti carbonara')?.title, 'Carbonara'); // redirect
  assert.equal(m.get('iPhone 17')?.title, 'IPhone 17'); // normalized first letter
  assert.equal(m.get('Galaxy S25'), null); // missing
  const k = m.get('Kolosseum')!;
  assert.ok(k.thumb && k.thumb.url.startsWith('https://') && k.thumb.width > 0 && k.thumb.height > 0);
  assert.equal(k.disambiguation, false);
});

test('title lookup + acceptableFile: photos accepted, SVG product drawings / wordmarks rejected', () => {
  const m = parseTitleLookup(fx('wiki-titles-de.json'), REQUESTED);
  const ok = REQUESTED.filter((q) => {
    const p = m.get(q);
    return !!p && !p.disambiguation && !!p.file && acceptableFile(p.file, q);
  });
  assert.deepEqual(
    ok.sort(),
    ['Albert Einstein', 'Eiffelturm', 'Engelsburg', 'Forum Romanum', 'Hund', 'Kolosseum', 'Mona Lisa', 'Pantheon', 'Pantheon (Rom)', 'Petersdom', 'Rom', 'Spaghetti carbonara', 'Tiramisu', 'Trevi-Brunnen', 'Wärmepumpe', 'spanische Treppe'].sort(),
  );
});

test('parseSearchPages sorts by rank; pickWikiPage prefers the exact article', () => {
  const pages = parseSearchPages(fx('wiki-search-de-kolosseum.json'));
  assert.deepEqual(pages.map((p) => p.index), [1, 2, 3, 4, 5]);
  assert.equal(pickWikiPage(pages, 'Kolosseum')?.title, 'Kolosseum');
  // reversed order: still the title match wins over the higher-ranked unrelated page
  const shuffled = pages.map((p) => ({ ...p, index: 6 - p.index }));
  assert.equal(pickWikiPage(shuffled, 'Kolosseum')?.title, 'Kolosseum');
});

test('pickWikiPage: model numbers must match, SVG/wordmark pages skipped', () => {
  // dewiki "Pixel 10": [Pixel 10 → wordmark.svg, Google Pixel → old phones photo, GrapheneOS logo …]
  assert.equal(pickWikiPage(parseSearchPages(fx('wiki-search-de-pixel10.json')), 'Pixel 10'), null);
  // dewiki "iPhone 17": all iPhone 17 pages have SVG drawings; "iPhone 17e" must not count as "iPhone 17"
  const p = pickWikiPage(parseSearchPages(fx('wiki-search-de-iphone17.json')), 'iPhone 17');
  assert.ok(p === null || /iphone 17$/i.test(normalizeText(p.title)), String(p?.title));
});

test('Commons search fallback finds real product photos with license metadata', () => {
  const ip = pickCommonsFile(parseImageInfo(fx('commons-search-iphone17.json')), 'iPhone 17');
  assert.ok(ip, 'iPhone 17 found');
  assert.match(ip!.name, /iPhone 17/);
  assert.match(ip!.mime, /^image\/(jpeg|png|webp)$/);
  assert.equal(ip!.license, 'CC0');
  assert.ok(ip!.descriptionUrl?.startsWith('https://commons.wikimedia.org/wiki/File:'));
  const px = pickCommonsFile(parseImageInfo(fx('commons-search-pixel10.json')), 'Pixel 10');
  assert.ok(px, 'Pixel 10 found');
  assert.match(px!.name, /Pixel 10/);
  assert.doesNotMatch(px!.name, /Landsat|Comparison/); // contains both tokens but it's a graphic
});

test('parseImageInfo: attribution from extmetadata, HTML stripped', () => {
  const files = parseImageInfo(fx('wiki-imageinfo-de.json'));
  assert.equal(files.length, 8);
  const col = files.find((f) => f.name === 'Colosseo 2020.jpg')!;
  assert.equal(col.author, 'FeaturedPics');
  assert.equal(col.license, 'CC BY-SA 4.0');
  assert.equal(col.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0');
  assert.equal(col.descriptionUrl, 'https://commons.wikimedia.org/wiki/File:Colosseo_2020.jpg');
  assert.equal(col.thumb?.width, 960);
  for (const f of files) {
    assert.doesNotMatch(f.author ?? '', /[<>]/, f.name);
    assert.ok(f.license, f.name);
  }
  // pageimage name ↔ imageinfo title ("Datei:…" namespace, spaces vs underscores)
  assert.equal(fileKey('Colosseo_2020.jpg'), fileKey('Datei:Colosseo 2020.jpg', true));
  assert.equal(fileKey("St._Peter's_Basilica_Rome_-_20140808_2350.jpg"), "St. Peter's Basilica Rome - 20140808 2350.jpg");
});

test('htmlToText / safeWikimediaUrl / resizeThumb', () => {
  assert.equal(htmlToText('<a href="//x">Jakub Ha&#322;un</a> &amp; <b>Co</b>'), 'Jakub Hałun & Co');
  assert.equal(htmlToText('<script>alert(1)</script>Bob'), 'alert(1)Bob'); // text only, never executed/rendered as HTML
  assert.ok(htmlToText('x'.repeat(200)).length <= 80);
  assert.equal(safeWikimediaUrl('//upload.wikimedia.org/a.jpg'), 'https://upload.wikimedia.org/a.jpg');
  assert.equal(safeWikimediaUrl('https://evil.example/a.jpg'), undefined);
  assert.equal(safeWikimediaUrl('http://upload.wikimedia.org/a.jpg'), undefined);
  assert.equal(safeWikimediaUrl('https://wikimedia.org.evil.com/a.jpg'), undefined);
  assert.equal(
    resizeThumb('https://thumb.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/960px-Colosseo_2020.jpg?utm_source=x', 330),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/330px-Colosseo_2020.jpg?utm_source=x',
  );
  assert.equal(resizeThumb('https://upload.wikimedia.org/wikipedia/commons/d/de/X.jpg', 330), 'https://upload.wikimedia.org/wikipedia/commons/d/de/X.jpg');
});

test('ranking helpers', () => {
  assert.equal(normalizeText('Trevi-Brunnen'), 'trevi brunnen');
  assert.equal(normalizeText('Wärmepumpe Straße'), 'warmepumpe strasse');
  assert.equal(titleScore('Kolosseum', 'kolosseum'), 100);
  assert.equal(titleScore('IPhone 17e', 'iPhone 17'), 0); // "17" missing as a token
  assert.equal(titleScore('Google Pixel', 'Pixel 10'), 0);
  assert.ok(titleScore('Haushund', 'Hund') > 0);
  assert.ok(titleScore('Avant du Google Pixel 10 Pro', 'Pixel 10') > titleScore('Landsat 10 Pixel Comparison Graphic', 'Pixel 10'));
  assert.equal(wantsNonPhoto('Karte von Rom'), true);
  assert.equal(wantsNonPhoto('Kolosseum'), false);
  assert.equal(acceptableFile('Rome_location_map.png', 'Rom'), false);
  assert.equal(acceptableFile('Rome_location_map.png', 'Karte Rom'), true);
  assert.equal(acceptableFile('Coat_of_arms_of_Rome.svg', 'Rom'), false);
  assert.equal(acceptableFile('Pixel_wordmark.svg', 'Pixel 10'), false);
  assert.equal(acceptableFile('Colosseo_2020.jpg', 'Kolosseum'), true);
  assert.equal(acceptableFile('Animated.gif', 'Hund'), false);
});

test('LRU cache: capacity, recency, expiry, dump/load round-trip with validation', () => {
  let t = 1000;
  const c = createLruCache<number | null>(3, () => t);
  c.set('a', 1, 100);
  c.set('b', 2, 100);
  c.set('c', null, 100);
  assert.deepEqual(c.get('a'), { value: 1 }); // refresh a → b is now oldest
  c.set('d', 4, 100);
  assert.equal(c.get('b'), undefined);
  assert.deepEqual(c.get('c'), { value: null }); // null (known miss) is a real value
  t += 101;
  assert.equal(c.get('a'), undefined);
  assert.equal(c.size, 2); // expired a removed lazily
  c.set('e', 5, 1000);
  const dumped = c.dump();
  assert.deepEqual(dumped.map((e) => e[0]), ['e']); // c, d expired
  const c2 = createLruCache<number | null>(3, () => t);
  c2.set('x', 9, 1000);
  c2.load([...JSON.parse(JSON.stringify(dumped)), ['bad', 'str', t + 5], ['old', 1, t - 1], 'garbage', ['x', 1, t + 9999]], (v): v is number | null => v === null || typeof v === 'number');
  assert.deepEqual(c2.get('e'), { value: 5 });
  assert.deepEqual(c2.get('x'), { value: 9 }); // in-memory entry wins over persisted one
  assert.equal(c2.get('bad'), undefined);
  assert.equal(c2.get('old'), undefined);
});

test('attributionText', () => {
  assert.equal(attributionText({ author: 'FeaturedPics', license: 'CC BY-SA 4.0', sourceUrl: 'https://x', provider: 'wikipedia' }), 'Foto: FeaturedPics · CC BY-SA 4.0 · Wikimedia');
  assert.equal(attributionText({ license: 'CC0', sourceUrl: 'https://x', provider: 'commons' }), 'Foto: CC0 · Wikimedia Commons');
  assert.equal(attributionText({ author: 'Unknown author', sourceUrl: 'https://x', provider: 'wikipedia' }), 'Foto: Wikimedia');
  assert.equal(attributionText({ sourceUrl: 'https://www.example.org/a.jpg', provider: 'source' }), 'Bild: example.org');
  assert.ok(attributionText({ author: 'A'.repeat(60), sourceUrl: 'https://x', provider: 'wikipedia' }).length < 50);
});

test('image credits never show internal hosts (hermes.local, LAN, tailnet, IPs)', () => {
  for (const h of ['hermes.local', 'localhost', 'nas', '192.168.1.20', '10.0.0.5', '[::1]', 'hermes-host.example.ts.net', 'box.home.arpa', 'pi.lan']) assert.ok(isInternalHost(h), h);
  for (const h of ['example.org', 'upload.wikimedia.org', 'cdn.spiegel.de']) assert.ok(!isInternalHost(h), h);
  // proxied through the user's bridge: credit + link use the original host
  const proxied = { sourceUrl: 'http://hermes.local:8787/bridge/images/proxy?url=https%3A%2F%2Fwww.example.org%2Fa.jpg', provider: 'source' as const };
  assert.equal(attributionText(proxied), 'Bild: example.org');
  assert.equal(attributionUrl(proxied), 'https://www.example.org/a.jpg');
  // proxied Wikimedia file → provider name
  assert.equal(attributionText({ sourceUrl: 'http://hermes.local/p?url=https%3A%2F%2Fupload.wikimedia.org%2Fx.jpg', provider: 'source' }), 'Foto: Wikimedia Commons');
  // internal only: no credit, no link
  const local = { sourceUrl: 'http://hermes.local/media/abc.png', provider: 'source' as const };
  assert.equal(attributionText(local), '');
  assert.equal(attributionUrl(local), null);
  // web search result without a public host → generic provider credit
  assert.equal(attributionText({ sourceUrl: 'https://10.0.0.2/x', provider: 'web', domain: 'hermes.local' }), 'Bild: Bildersuche');
  assert.equal(attributionText({ sourceUrl: 'https://10.0.0.2/x', provider: 'web', domain: 'www.zeit.de' }), 'Bild: zeit.de');
  assert.equal(attributionUrl({ sourceUrl: 'https://www.zeit.de/a', provider: 'web' }), 'https://www.zeit.de/a');
});

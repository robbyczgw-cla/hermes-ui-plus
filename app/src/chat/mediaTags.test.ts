/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAG_RE, extractMedia, hasMediaMarker, maskProtected, mediaMime, mediaRefOf, mediaUrl, createMediaTagCache, extractMediaCached, type MediaTagCache } from './mediaTags.ts';

const paths = (text: string, streaming = false) => extractMedia(text, streaming).refs.map((r) => r.path);

test('detects a plain tag and strips it from the text', () => {
  const r = extractMedia('Hier ist das Diagramm:\nMEDIA:/root/.hermes/cache/images/chart-1.png\nViel Spaß!');
  assert.deepEqual(r.refs.map((x) => [x.path, x.name, x.kind, x.inlineImage]), [['/root/.hermes/cache/images/chart-1.png', 'chart-1.png', 'image', true]]);
  assert.equal(r.text, 'Hier ist das Diagramm:\nViel Spaß!');
});

test('types: pdf, audio, sheet, archive, svg is a file not an inline image', () => {
  const kinds = (p: string) => extractMedia(`MEDIA:${p}`).refs[0];
  assert.equal(kinds('/tmp/a.pdf').kind, 'pdf');
  assert.equal(kinds('/tmp/a.mp3').kind, 'audio');
  assert.equal(kinds('/tmp/a.xlsx').kind, 'sheet');
  assert.equal(kinds('/tmp/a.tar.gz').kind, 'archive');
  assert.equal(kinds('/tmp/a.svg').kind, 'image');
  assert.equal(kinds('/tmp/a.svg').inlineImage, false);
  assert.equal(kinds('/tmp/A.PNG').inlineImage, true);
});

test('quotes, emphasis, spaces in the path, sentence punctuation, several tags', () => {
  assert.deepEqual(paths('**MEDIA:/tmp/report.pdf**'), ['/tmp/report.pdf']);
  assert.deepEqual(paths('MEDIA:`/tmp/mit leerzeichen.pdf`'), ['/tmp/mit leerzeichen.pdf']);
  assert.deepEqual(paths('MEDIA:/tmp/mit leerzeichen/bericht neu.pdf fertig'), ['/tmp/mit leerzeichen/bericht neu.pdf']);
  assert.deepEqual(paths('Datei: MEDIA:/tmp/data.csv.'), ['/tmp/data.csv']);
  assert.deepEqual(paths('MEDIA:/tmp/a.png MEDIA:/tmp/b.png'), ['/tmp/a.png', '/tmp/b.png']);
  assert.deepEqual(paths('MEDIA:/tmp/a.pngMEDIA:/tmp/b.png'), ['/tmp/a.png', '/tmp/b.png']);
  assert.deepEqual(paths('(MEDIA:/tmp/a.png)'), ['/tmp/a.png']);
  assert.deepEqual(paths('MEDIA:~/out/a.png'), ['~/out/a.png']);
  assert.deepEqual(paths('MEDIA:C:\\out\\a.png'), ['C:\\out\\a.png']);
  assert.deepEqual(paths('MEDIA:/tmp/a.png\nMEDIA:/tmp/a.png'), ['/tmp/a.png']); // duplicates collapse
});

test('no false positives: fenced code, inline code examples, blockquotes, prose, relative paths, unknown types', () => {
  const fenced = 'So geht es:\n```\nMEDIA:/tmp/beispiel.png\n```\nEnde';
  assert.deepEqual(extractMedia(fenced), { refs: [], text: fenced });
  const tilde = '~~~md\nMEDIA:/tmp/beispiel.png\n~~~';
  assert.deepEqual(paths(tilde), []);
  const open = 'Code:\n```python\nprint("MEDIA:/tmp/x.png")';
  assert.deepEqual(paths(open), []); // still streaming
  // the whole body is code, not only its first line (closed and still open)
  assert.deepEqual(paths('```\nimport x\nprint("MEDIA:/tmp/x.png")\n```\nMEDIA:/tmp/y.png'), ['/tmp/y.png']);
  assert.deepEqual(paths('Code:\n```sh\ncd /tmp\n\nopen MEDIA:/tmp/x.png\nls'), []);
  assert.deepEqual(paths('Schreibe `MEDIA:` gefolgt vom Pfad'), []);
  assert.deepEqual(paths('Beispiel: `Pfad MEDIA:/tmp/x.png im Text`'), []);
  assert.deepEqual(paths('> MEDIA:/tmp/zitat.png'), []);
  assert.deepEqual(paths('Das MEDIA: Tag wird unterstützt.'), []);
  assert.deepEqual(paths('MEDIA:relativ/x.png'), []);
  assert.deepEqual(paths('MEDIA:/tmp/script.sh'), []);
  assert.deepEqual(paths('MEDIA:/tmp/x.pngx'), []);
  assert.equal(extractMedia('kein Tag hier').text, 'kein Tag hier');
  // a tag after a closed code block is still found
  assert.deepEqual(paths('```\nMEDIA:/tmp/a.png\n```\nMEDIA:/tmp/b.png'), ['/tmp/b.png']);
});

test('a whole tag in inline code is a tag (models format paths as code)', () => {
  const r = extractMedia('Fertig: `MEDIA:/tmp/chart.png`');
  assert.deepEqual(r.refs.map((x) => x.path), ['/tmp/chart.png']);
  assert.equal(r.text, 'Fertig:');
  assert.deepEqual(paths('Fertig: MEDIA:`/tmp/chart.png`'), ['/tmp/chart.png']);
});

test('maskProtected keeps offsets', () => {
  const text = 'a ```\nMEDIA:/x.png\n``` b `code` > c\n> quote';
  assert.equal(maskProtected(text).length, text.length);
});

test('text cleanup: tag-only lines vanish, blank runs collapse, voice marker removed', () => {
  assert.equal(extractMedia('A\n\nMEDIA:/tmp/a.png\n\nB').text, 'A\n\nB');
  assert.equal(extractMedia('MEDIA:/tmp/a.png').text, '');
  assert.equal(extractMedia('[[audio_as_voice]]\nMEDIA:/tmp/a.mp3').text, '');
  assert.equal(extractMedia('Bild: MEDIA:/tmp/a.png danke').text, 'Bild: danke');
});

test('streaming: an incomplete tag at the end is hidden, a complete one is extracted', () => {
  assert.equal(extractMedia('Ich erstelle es.\nMEDIA:/tmp/ch', true).text, 'Ich erstelle es.');
  assert.equal(extractMedia('Ich erstelle es.\nMEDIA:', true).text, 'Ich erstelle es.');
  assert.deepEqual(extractMedia('Ich erstelle es.\nMEDIA:/tmp/chart.png', true).refs.map((r) => r.path), ['/tmp/chart.png']);
  assert.equal(extractMedia('Ich erstelle es.\nMEDIA:/tmp/chart.png', true).text, 'Ich erstelle es.');
  // not streaming: a fragment stays visible text
  assert.equal(extractMedia('Ich erstelle es.\nMEDIA:/tmp/ch', false).text, 'Ich erstelle es.\nMEDIA:/tmp/ch');
  // prose containing the word in the middle of a streaming line is untouched
  assert.equal(extractMedia('Das MEDIA: Tag', true).text, 'Das');
});

test('mediaRefOf, mediaMime, mediaUrl', () => {
  assert.equal(mediaRefOf('/tmp/Caddyfile'), null);
  assert.equal(mediaRefOf('"/tmp/a b.PDF"')?.name, 'a b.PDF');
  assert.equal(mediaRefOf('C:\\x\\y.docx')?.name, 'y.docx');
  assert.equal(mediaMime({ ext: 'pdf' }), 'application/pdf');
  assert.equal(mediaMime({ ext: 'weird' }), 'application/octet-stream');
  assert.equal(mediaUrl('http://hermes-host:8790/v1/', '/a b/ü.png'), 'http://hermes-host:8790/bridge/media?path=%2Fa%20b%2F%C3%BC.png');
});

// ---------------------------------------------------------------- performance rewrites: same results as before

/** the previous maskProtected (one full copy of the text per masked range), as the reference */
function maskProtectedReference(text: string): string {
  const blank = (s: string, from: number, to: number) => s.slice(0, from) + s.slice(from, to).replace(/[^\n]/g, ' ') + s.slice(to);
  let out = text;
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\1[ \t]*(?=\n|$)|(?![\s\S]))/gm;
  for (const m of text.matchAll(fence)) out = blank(out, m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const m of text.matchAll(/^[ \t]{0,3}>.*$/gm)) out = blank(out, m.index ?? 0, (m.index ?? 0) + m[0].length);
  const inline = /(`+)([^`\n]|[^`\n][^\n]*?[^`\n])\1(?!`)/g;
  for (const m of out.matchAll(inline)) {
    const start = m.index ?? 0;
    if (/MEDIA:\s*$/i.test(out.slice(Math.max(0, start - 20), start))) continue;
    if (/^\s*MEDIA:/i.test(m[2])) continue;
    out = blank(out, start, start + m[0].length);
  }
  return out;
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

const PIECES = ['MEDIA:', 'media:', 'MeDiA:', ' ', '\n', '`', '``', '```', '~~~', '> ', 'x', 'medi', 'a:', ':', '/tmp/a.png', '"/tmp/b c.pdf"', '**', 'ſ', 'K', 'İ', 'mEDIA', '\u0130'];

test('maskProtected: one-pass masking equals the range-by-range reference (fuzz)', () => {
  const r = rng(7);
  for (let k = 0; k < 3000; k++) {
    let text = '';
    const n = 1 + Math.floor(r() * 40);
    for (let i = 0; i < n; i++) text += PIECES[Math.floor(r() * PIECES.length)];
    assert.equal(maskProtected(text), maskProtectedReference(text), JSON.stringify(text));
  }
  const tricky = '`x MEDIA:` `/tmp/a.png` and MEDIA: `/tmp/b.png`\n> MEDIA:/q.png\n```\n`MEDIA:/c.png`\n```\n`` MEDIA:/d.png ``';
  assert.equal(maskProtected(tricky), maskProtectedReference(tricky));
});

test('maskProtected: many inline code spans + a tag (one-pass masking, same tags found)', () => {
  // 4 000 code spans: the old version copied the whole text once per span (quadratic on Hermes, which has no ropes)
  const text = 'word `code` '.repeat(4000) + '\nMEDIA:/tmp/report.pdf';
  const masked = maskProtected(text);
  assert.equal(masked.length, text.length);
  assert.equal(masked, maskProtectedReference(text));
  assert.deepEqual(extractMedia(text).refs.map((x) => x.path), ['/tmp/report.pdf']);
});

test('hasMediaMarker equals /media:/i (ASCII case folding only, colon at any position)', () => {
  for (const t of ['', 'media', 'media:', 'MEDIA:', 'xMeDiA:y', ':media', 'medi:a:', 'mediA :', 'ſedia:', 'medıa:', 'MEDİA:', 'a\nmedia:\n', '::::media::']) {
    assert.equal(hasMediaMarker(t), /media:/i.test(t), JSON.stringify(t));
  }
  const r = rng(11);
  const alphabet = ['m', 'M', 'e', 'E', 'd', 'D', 'i', 'I', 'a', 'A', ':', ' ', 'ı', 'ſ', 'x', '\n', '@', '`'];
  for (let k = 0; k < 20000; k++) {
    let t = '';
    const n = Math.floor(r() * 14);
    for (let i = 0; i < n; i++) t += alphabet[Math.floor(r() * alphabet.length)];
    assert.equal(hasMediaMarker(t), /media:/i.test(t), JSON.stringify(t));
  }
});

test('hasMediaMarker on a growing (streaming) text: a marker split across updates is found', () => {
  const r = rng(5);
  const alphabet = ['m', 'M', 'e', 'd', 'i', 'a', 'A', ':', ' ', 'x', '\n'];
  for (let k = 0; k < 400; k++) {
    let t = '';
    for (let step = 0; step < 30; step++) {
      // grow by 1–3 chars, sometimes restart with an unrelated text
      if (r() < 0.05) t = '';
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) t += alphabet[Math.floor(r() * alphabet.length)];
      assert.equal(hasMediaMarker(t), /media:/i.test(t), JSON.stringify(t));
    }
  }
  assert.equal(hasMediaMarker('Hier ist die Datei: ME'), false);
  assert.equal(hasMediaMarker('Hier ist die Datei: MEDI'), false);
  assert.equal(hasMediaMarker('Hier ist die Datei: MEDIA:'), true);
});

/** the previous extractMedia (full-text regex scans, range-by-range masking) as the reference */
function extractMediaReference(text: string, streaming = false): { refs: string[]; text: string } {
  if (!/media:/i.test(text)) return { refs: [], text };
  const masked = maskProtectedReference(text);
  const refs: string[] = [];
  const cuts: [number, number][] = [];
  for (const m of masked.matchAll(new RegExp(TAG_RE.source, TAG_RE.flags))) {
    const ref = mediaRefOf(m[1]);
    if (!ref) continue;
    const from = m.index ?? 0;
    cuts.push([from, from + m[0].length]);
    if (!refs.includes(ref.path)) refs.push(ref.path);
  }
  if (streaming) {
    const tail = /(?:^|[\s`"'*_(])(MEDIA:[^\n]*)$/i.exec(masked);
    if (tail && tail.index !== undefined) {
      const from = tail.index + tail[0].length - tail[1].length;
      if (!cuts.some(([a, b]) => from >= a && from < b)) cuts.push([from, text.length]);
    }
  }
  if (!cuts.length) return { refs, text };
  cuts.sort((x, y) => x[0] - y[0]);
  let out = '';
  let pos = 0;
  let toEnd = false;
  for (let [a, b] of cuts) {
    if (a < pos) continue;
    const lineStart = text.lastIndexOf('\n', a - 1) + 1;
    const rest = /^[ \t]*(\n|$)/.exec(text.slice(b));
    if (rest && text.slice(lineStart, a).trim() === '') {
      a = lineStart;
      b += rest[0].length;
    } else if (text[a - 1] === ' ' && text[b] === ' ') {
      b++;
    }
    out += text.slice(pos, a);
    pos = b;
    toEnd = b >= text.length;
  }
  out += text.slice(pos);
  if (toEnd && streaming) out = out.trimEnd();
  if (refs.length) out = out.replace(/\[\[audio_as_voice\]\]\s*/gi, '');
  out = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  return { refs, text: out.trim() === '' ? '' : out.replace(/^\n+/, '') };
}

const TAG_PIECES = [
  'MEDIA:/tmp/a.png', 'media: /tmp/b c.pdf', 'MEDIA:"/tmp/q r.mp3"', 'MEDIA:`/x/y.csv`', 'MEDIA:/tmp/ch', 'MEDIA:', 'Media:',
  ' ', ' ', '\n', '\n\n', '`', '```', '```\n', '> ', '**', '"', "'", '_', 'text', '.', ',', '(', 'x.png', '/tmp/', '[[audio_as_voice]]', '\t',
];

test('extractMedia: same refs and text as the previous full-scan version (fuzz, streaming and final)', () => {
  const r = rng(23);
  for (let k = 0; k < 4000; k++) {
    let text = '';
    const n = 1 + Math.floor(r() * 24);
    for (let i = 0; i < n; i++) text += TAG_PIECES[Math.floor(r() * TAG_PIECES.length)];
    for (const streaming of [false, true]) {
      const got = extractMedia(text, streaming);
      const want = extractMediaReference(text, streaming);
      assert.deepEqual({ refs: got.refs.map((x) => x.path), text: got.text }, want, JSON.stringify([text, streaming]));
    }
  }
  // streaming growth of one answer (the per-tick path, incl. the marker-free prefix memo)
  const answer = 'Intro `code` text.\n\n```\nMEDIA:/in/code.png\n```\n> MEDIA:/quoted.png\nHere: MEDIA:/tmp/out/chart.png and **MEDIA:/tmp/x.pdf**.\nLast MEDIA:/tmp/fin';
  for (let i = 1; i <= answer.length; i++) {
    const t = answer.slice(0, i);
    const got = extractMedia(t, true);
    assert.deepEqual({ refs: got.refs.map((x) => x.path), text: got.text }, extractMediaReference(t, true), JSON.stringify(t));
  }
});

// ---------------------------------------------------------------- streaming: incremental == full scan

const LINE_PIECES = [
  ...TAG_PIECES, '\n', '\n', '\n', '```\n', '```js\n', '~~~\n', '````\n', '> ', '> quote MEDIA:/q/a.png\n', '  > ', 'MEDIA:\n', 'MEDIA:\n\n',
  '/tmp/next.png\n', '`/tmp/code.png`', '[[audio_as_voice]]\n', '[[AUDIO_AS_VOICE]]  \n', '   \n', 'Absatz\n', ' ', '\r\n', ' \n',
];

const view = (m: { refs: { path: string }[]; text: string }) => ({ refs: m.refs.map((r) => r.path), text: m.text });

function assertSame(cache: MediaTagCache, text: string, streaming: boolean, why: string) {
  assert.deepEqual(view(extractMediaCached(text, streaming, cache)), view(extractMedia(text, streaming)), JSON.stringify([why, text, streaming]));
}

test('extractMediaCached: equals extractMedia at every step of a growing answer (fuzz incl. fences, quotes, tags across lines)', () => {
  const r = rng(31);
  for (let k = 0; k < 1500; k++) {
    let text = '';
    const n = 1 + Math.floor(r() * 40);
    for (let i = 0; i < n; i++) text += LINE_PIECES[Math.floor(r() * LINE_PIECES.length)];
    for (const streaming of [true, false]) {
      const cache = createMediaTagCache();
      for (let i = 0; i < text.length; ) {
        i = Math.min(text.length, i + 1 + Math.floor(r() * 12));
        assertSame(cache, text.slice(0, i), streaming, `grow ${i}`);
      }
    }
  }
});

test('extractMediaCached: equals extractMedia for every split point (one update before, one after the cut)', () => {
  const r = rng(47);
  for (let k = 0; k < 300; k++) {
    let text = '';
    const n = 4 + Math.floor(r() * 30);
    for (let i = 0; i < n; i++) text += LINE_PIECES[Math.floor(r() * LINE_PIECES.length)];
    for (let cut = 0; cut <= text.length; cut++) {
      const streaming = cut % 2 === 0;
      const cache = createMediaTagCache();
      assertSame(cache, text.slice(0, cut), streaming, `before ${cut}`);
      assertSame(cache, text, streaming, `after ${cut}`);
    }
  }
});

test('extractMediaCached: constructs across the freeze point', () => {
  const cases = [
    // fence opened before the cut, tag-like line inside it after the cut, tag after the fence
    'Intro\n```sh\ncd /tmp\nopen MEDIA:/tmp/in.png\n```\nHier: MEDIA:/tmp/out.png\nEnde\n',
    // `MEDIA:` with its path on a later line (the tag regex's `\s*` spans lines), also across a blanked fence
    'Datei:\nMEDIA:\n\n\n/tmp/later.png\nweiter\n',
    'MEDIA:\n```\ncode\n```\n/tmp/afterfence.png\nweiter\n',
    // quote lines on both sides of the cut, voice marker before the cut, blank-line runs across it
    '> MEDIA:/q.png\n> noch\nMEDIA:/tmp/a.png\n[[audio_as_voice]]\n\n\n\nText\n\n\n\nMEDIA:/tmp/b.png\n',
    // inline code path whose `MEDIA:` is on the line before
    'Siehe MEDIA:\n`/tmp/code path.pdf`\nok\n',
    // a tag alone on the last line while it streams (trim reaches into the frozen part: full-scan fallback)
    'Erst Text.\n\nMEDIA:/tmp/zuletzt.png',
  ];
  for (const text of cases) {
    for (const streaming of [true, false]) {
      const cache = createMediaTagCache();
      for (let i = 1; i <= text.length; i++) assertSame(cache, text.slice(0, i), streaming, 'grow');
    }
  }
});

test('extractMediaCached: a replaced answer (not an extension of the frozen text) starts over', () => {
  const cache = createMediaTagCache();
  assertSame(cache, 'Zeile eins\nMEDIA:/tmp/a.png\nZeile drei\nnoch', true, 'first');
  assert.ok(cache.end > 0);
  assertSame(cache, 'Ganz anders\nohne Tag\n', true, 'replaced');
  assertSame(cache, 'Zei', true, 'shorter');
  assertSame(cache, 'Zeile eins\nMEDIA:/tmp/b.png\nx', true, 'again');
});

test('extractMediaCached: the frozen part is not scanned again (a long answer only re-scans its last line)', () => {
  const cache = createMediaTagCache();
  let text = 'MEDIA:/tmp/first.png\n';
  for (let i = 0; i < 200; i++) text += `Zeile ${i} mit etwas Text.\n`;
  extractMediaCached(text + 'letzte Zei', true, cache);
  assert.equal(cache.end, text.length);
  assert.deepEqual(cache.refs.map((r) => r.path), ['/tmp/first.png']);
});

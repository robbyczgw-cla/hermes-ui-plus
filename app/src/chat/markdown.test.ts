import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, safeHref, inlineToPlain } from './markdown.ts';

test('headings, paragraphs, hr', () => {
  const b = parseMarkdown('# Titel\n\nHallo\nWelt\n\n---\n## Zwei ##');
  assert.deepEqual(
    b.map((x) => x.type),
    ['heading', 'paragraph', 'hr', 'heading'],
  );
  assert.equal(b[0].type === 'heading' && b[0].level, 1);
  assert.equal(b[1].type === 'paragraph' && b[1].text, 'Hallo\nWelt');
  assert.equal(b[3].type === 'heading' && b[3].text, 'Zwei');
});

test('fenced code, closed and open (streaming)', () => {
  const b = parseMarkdown('Text\n```ts\nconst a = 1;\n```\nnach');
  assert.equal(b[1].type, 'code');
  if (b[1].type === 'code') {
    assert.equal(b[1].lang, 'ts');
    assert.equal(b[1].code, 'const a = 1;');
    assert.equal(b[1].closed, true);
  }
  assert.equal(b[2].type, 'paragraph');
  const open = parseMarkdown('```py\nprint(1)\n');
  assert.equal(open[0].type === 'code' && open[0].closed, false);
  assert.equal(open[0].type === 'code' && open[0].code, 'print(1)\n');
});

test('lists: bullets, ordered start, nesting, tasks', () => {
  const b = parseMarkdown('- a\n- b\n  - b1\n  - b2\n- [x] c\n\n3. drei\n4. vier');
  assert.equal(b.length, 2);
  const ul = b[0];
  assert.ok(ul.type === 'list' && !ul.ordered);
  if (ul.type === 'list') {
    assert.equal(ul.items.length, 3);
    assert.equal(ul.items[1].text, 'b');
    const sub = ul.items[1].children[0];
    assert.ok(sub && sub.type === 'list' && sub.items.length === 2);
    assert.equal(ul.items[2].checked, true);
    assert.equal(ul.items[2].text, 'c');
  }
  const ol = b[1];
  assert.ok(ol.type === 'list' && ol.ordered && ol.start === 3 && ol.items.length === 2);
});

test('list followed by paragraph', () => {
  const b = parseMarkdown('1. eins\n2. zwei\n\nDanach.');
  assert.deepEqual(b.map((x) => x.type), ['list', 'paragraph']);
});

test('table with alignment', () => {
  const b = parseMarkdown('| Name | Wert |\n|:---|---:|\n| a | 1 |\n| b \\| c | 2 |\n\nx');
  assert.equal(b[0].type, 'table');
  if (b[0].type === 'table') {
    assert.deepEqual(b[0].header, ['Name', 'Wert']);
    assert.deepEqual(b[0].align, ['left', 'right']);
    assert.deepEqual(b[0].rows, [['a', '1'], ['b | c', '2']]);
  }
  assert.equal(b[1].type, 'paragraph');
});

test('block quote', () => {
  const b = parseMarkdown('> Zitat\n> **fett**\n\nnormal');
  assert.equal(b[0].type, 'quote');
  if (b[0].type === 'quote') assert.equal(b[0].blocks[0].type, 'paragraph');
});

test('inline: bold, italic, code, strike, link, autolink', () => {
  const r = parseInline('**fett** und *kursiv* mit `code`, ~~weg~~ [Link](https://a.de) https://b.de/x.');
  const types = r.map((x) => x.t);
  assert.deepEqual(types, ['strong', 'text', 'em', 'text', 'code', 'text', 'del', 'text', 'link', 'text', 'link', 'text']);
  const last = r[10];
  assert.ok(last.t === 'link' && last.href === 'https://b.de/x');
  assert.equal(inlineToPlain(r), 'fett und kursiv mit code, weg Link https://b.de/x.');
});

test('inline: nested and triple emphasis', () => {
  const r = parseInline('***beides*** und **a *b* c**');
  assert.ok(r[0].t === 'strong' && r[0].c[0].t === 'em');
  const s = r[2];
  assert.ok(s.t === 'strong' && s.c.some((x) => x.t === 'em'));
});

test('inline: literal asterisks, snake_case, escapes', () => {
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ t: 'text', s: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('snake_case_name'), [{ t: 'text', s: 'snake_case_name' }]);
  assert.deepEqual(parseInline('\\*kein\\*'), [{ t: 'text', s: '*kein*' }]);
});

test('inline: partial streaming hides open markers', () => {
  const r = parseInline('Das ist **wich', { partial: true });
  assert.ok(r[1].t === 'strong');
  const lit = parseInline('Das ist **wich');
  assert.deepEqual(lit, [{ t: 'text', s: 'Das ist **wich' }]);
  const c = parseInline('Rufe `npm i', { partial: true });
  assert.ok(c[1].t === 'code' && c[1].s === 'npm i');
});

test('inline: line breaks', () => {
  const r = parseInline('a\nb');
  assert.deepEqual(r.map((x) => x.t), ['text', 'br', 'text']);
});

test('safeHref', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://x.de'), 'https://x.de');
  assert.equal(safeHref('www.x.de'), 'https://www.x.de');
});

test('inline image token: ![alt](url), with title and inside text', () => {
  const n = parseInline('Sieh ![Ein Bild](https://a.b/x.png "Titel") an');
  assert.deepEqual(n, [
    { t: 'text', s: 'Sieh ' },
    { t: 'image', href: 'https://a.b/x.png', alt: 'Ein Bild' },
    { t: 'text', s: ' an' },
  ]);
  assert.equal(inlineToPlain(n), 'Sieh Ein Bild an');
  // plain link and lone "!" are untouched
  assert.deepEqual(parseInline('Hi! [x](https://a.b)')[0], { t: 'text', s: 'Hi! ' });
  assert.deepEqual(parseInline('![a](/v1/attachments/tok.en)'), [{ t: 'image', href: '/v1/attachments/tok.en', alt: 'a' }]);
});

test('standalone image paragraph becomes an images block', () => {
  const b = parseMarkdown('Text davor\n\n![a](https://x/a.png)\n\n![b](https://x/b.png)\n![c](/v1/attachments/c)\n\nDanach');
  assert.deepEqual(
    b.map((x) => x.type),
    ['paragraph', 'images', 'images', 'paragraph'],
  );
  const g = b[2];
  assert.ok(g.type === 'images');
  assert.deepEqual(g.items, [
    { alt: 'b', href: 'https://x/b.png' },
    { alt: 'c', href: '/v1/attachments/c' },
  ]);
});

test('image mixed with text stays an inline paragraph; link-only paragraph is not an image', () => {
  const b = parseMarkdown('Hier: ![a](https://x/a.png)');
  assert.equal(b[0].type, 'paragraph');
  assert.equal(parseMarkdown('[a](https://x/a.png)')[0].type, 'paragraph');
  assert.equal(parseMarkdown('![unvollständig](https://x/a')[0].type, 'paragraph');
});

// GPT review #4: unbounded nesting overflowed the stack (and blanked the message on every reopen).
import { expectBounded } from '../testing/runBounded.test.ts';
import { MAX_BLOCK_DEPTH, MAX_INLINE_DEPTH, type Inline, type MdBlock } from './markdown.ts';
test('nesting budget: 5 000 quote levels / 3 000 nested link labels render literally past the cap (time-bounded)', async () => {
  const mod = new URL('./markdown.ts', import.meta.url).href;
  const quotes = await expectBounded<MdBlock[]>(mod, 'parseMarkdown', ['> '.repeat(5000) + 'x'], 10000);
  let depth = 0;
  let b: MdBlock | undefined = quotes[0];
  while (b && b.type === 'quote') {
    depth++;
    b = b.blocks[0];
  }
  assert.equal(depth, MAX_BLOCK_DEPTH + 1);
  assert.ok(b && b.type === 'paragraph' && b.text.endsWith('x'));
  const label = '['.repeat(3000) + 'x' + '](u)'.repeat(3000);
  const links = await expectBounded<Inline[]>(mod, 'parseInline', [label], 10000);
  let d = 0;
  let cur: Inline[] = links;
  while (cur.length && cur[0].t === 'link') {
    d++;
    cur = (cur[0] as Extract<Inline, { t: 'link' }>).c;
  }
  assert.ok(d >= 1 && d <= MAX_INLINE_DEPTH, String(d));
  const deepList = Array.from({ length: 400 }, (_, i) => ' '.repeat(i * 2) + '- a').join('\n');
  assert.ok((await expectBounded<MdBlock[]>(mod, 'parseMarkdown', [deepList], 10000)).length === 1);
});

test('parseInline: plain-text runs copied at once, bracket / paren tables (URL starts, escapes, nesting, blank lines)', () => {
  // pinned outputs of the char-by-char scanner (the run copying / native table building must not change them)
  const link = (href: string, c: unknown[]) => ({ t: 'link', href, c });
  const text = (s: string) => ({ t: 'text', s });
  assert.deepEqual(parseInline('see http://example.com/a and Http://example.com/b'), [
    text('see '),
    link('http://example.com/a', [text('http://example.com/a')]),
    text(' and Http://example.com/b'),
  ]);
  assert.deepEqual(parseInline('hhttp://x.y/z (https://example.com/(a)b).'), [
    text('hhttp://x.y/z ('),
    link('https://example.com/(a)b', [text('https://example.com/(a)b')]),
    text(').'),
  ]);
  assert.deepEqual(parseInline('a \\[x](y) [l](u) \\'), [text('a [x](y) '), link('u', [text('l')]), text(' \\')]);
  assert.deepEqual(parseInline('[a [b](c) d](e)'), [link('e', [text('a '), link('c', [text('b')]), text(' d')])]);
  assert.deepEqual(parseInline('x\n\n[a\n\nb](c)'), [text('x'), { t: 'br' }, { t: 'br' }, text('[a'), { t: 'br' }, { t: 'br' }, text('b](c)')]);
  assert.deepEqual(parseInline('plain text with h and H only'), [text('plain text with h and H only')]);
});

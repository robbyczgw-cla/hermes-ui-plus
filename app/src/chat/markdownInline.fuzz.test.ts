/// <reference types="node" />
// Differential fuzz + perf test for the linear-time inline parser (chat/markdown.ts parseInline).
// The reference below is a frozen copy of the previous (quadratic on unclosed `*` / `[`) implementation:
// the new one must produce identical output, and stay fast on adversarial paragraphs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, type Inline } from './markdown.ts';
import { assertLinear } from '../testing/scaling.test.ts';

/** `unit` repeated to at least n chars (input builder for assertLinear) */
const repeatTo = (unit: string) => (n: number) => unit.repeat(Math.ceil(n / unit.length));

// ---------------------------------------------------------------- frozen reference (pre-2026-10-11)
const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const URL_RE = /^https?:\/\/[^\s<>()]*(?:\([^\s<>()]*\)[^\s<>()]*)*/;


function refParseInline(src: string, opts: { partial?: boolean } = {}): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      const last = out[out.length - 1];
      if (last && last.t === 'text') last.s += buf;
      else out.push({ t: 'text', s: buf });
      buf = '';
    }
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];

    if (ch === '\\' && i + 1 < n) {
      const nx = src[i + 1];
      if (nx === '\n') {
        push({ t: 'br' });
        i += 2;
        continue;
      }
      if (PUNCT.includes(nx)) {
        buf += nx;
        i += 2;
        continue;
      }
    }

    if (ch === '\n') {
      buf = buf.replace(/ +$/, '');
      push({ t: 'br' });
      i++;
      while (src[i] === ' ') i++;
      continue;
    }

    if (ch === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const ticks = src.slice(i, k);
      const close = findTicks(src, k, ticks.length);
      if (close >= 0) {
        let code = src.slice(k, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        push({ t: 'code', s: code });
        i = close + ticks.length;
        continue;
      }
      if (opts.partial && ticks.length === 1) {
        push({ t: 'code', s: src.slice(k) });
        i = n;
        continue;
      }
      buf += ticks;
      i = k;
      continue;
    }

    if (ch === '!' && src[i + 1] === '[') {
      const img = matchLink(src, i + 1);
      if (img && img.href) {
        push({ t: 'image', href: img.href, alt: refInlineToPlain(refParseInline(img.label)) });
        i = img.end;
        continue;
      }
    }

    if (ch === '[') {
      const link = matchLink(src, i);
      if (link) {
        push({ t: 'link', href: link.href, c: refParseInline(link.label, opts) });
        i = link.end;
        continue;
      }
    }

    if ((ch === 'h' || ch === 'H') && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      const m = URL_RE.exec(src.slice(i));
      if (m && m[0].length > 8) {
        const url = m[0].replace(/[.,;:!?'"]+$/, '');
        push({ t: 'link', href: url, c: [{ t: 'text', s: url }] });
        i += url.length;
        continue;
      }
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      let k = i;
      while (src[k] === ch) k++;
      const run = k - i;
      const prev = i > 0 ? src[i - 1] : ' ';
      const next = src[k] ?? ' ';
      const canOpen = next.trim() !== '' && !(ch === '_' && /[A-Za-z0-9]/.test(prev));
      if (ch === '~') {
        if (run === 2 && canOpen) {
          const close = findDelim(src, k, '~~', ch);
          if (close >= 0) {
            push({ t: 'del', c: refParseInline(src.slice(k, close), opts) });
            i = close + 2;
            continue;
          }
        }
        buf += src.slice(i, k);
        i = k;
        continue;
      }
      if (canOpen && run <= 3) {
        const use = run;
        const delim = ch.repeat(use);
        const close = findDelim(src, i + use, delim, ch);
        if (close >= 0) {
          const inner = refParseInline(src.slice(i + use, close), opts);
          push(wrap(use, inner));
          i = close + use;
          continue;
        }
        if (opts.partial && use >= 2 && !src.slice(i + use).includes(delim)) {
          const rest = src.slice(i + use);
          if (rest.trim()) push(wrap(use, refParseInline(rest, opts)));
          i = n;
          continue;
        }
      }
      buf += src.slice(i, k);
      i = k;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

function wrap(n: number, c: Inline[]): Inline {
  if (n === 1) return { t: 'em', c };
  if (n === 2) return { t: 'strong', c };
  return { t: 'strong', c: [{ t: 'em', c }] };
}

function findTicks(src: string, from: number, len: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === '`') {
      let k = i;
      while (src[k] === '`') k++;
      if (k - i === len) return i;
      i = k;
    } else i++;
  }
  return -1;
}

/** Find a closing delimiter run of exactly `delim` (not preceded by whitespace), skipping code spans. */
function findDelim(src: string, from: number, delim: string, ch: string): number {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const close = findTicks(src, k, k - i);
      i = close >= 0 ? close + (k - i) : k;
      continue;
    }
    if (c === ch) {
      let k = i;
      while (src[k] === ch) k++;
      const run = k - i;
      const prev = src[i - 1] ?? ' ';
      const after = src[k] ?? ' ';
      const okBoundary = ch !== '_' || !/[A-Za-z0-9]/.test(after);
      if (i > from && prev.trim() !== '' && okBoundary) {
        if (run === delim.length) return i;
        // e.g. closing "***" for "**": the delimiter is at the end of the run
        if (run > delim.length && delim.length >= 2) return k - delim.length;
      }
      i = k;
      continue;
    }
    i++;
  }
  return -1;
}

function matchLink(src: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    } else if (c === '\n' && src[i + 1] === '\n') return null;
  }
  if (depth !== 0 || src[i + 1] !== '(') return null;
  const label = src.slice(start + 1, i);
  let j = i + 2;
  let paren = 1;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '(') paren++;
    else if (c === ')') {
      paren--;
      if (paren === 0) break;
    } else if (c === '\n') return null;
  }
  if (paren !== 0) return null;
  let target = src.slice(i + 2, j).trim();
  // strip optional title: (url "title")
  const tm = /^(\S+)\s+["'(].*["')]$/.exec(target);
  if (tm) target = tm[1];
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  return { label, href: target, end: j + 1 };
}

/** Plain text of inline markdown (for copy / accessibility). */
function refInlineToPlain(nodes: Inline[]): string {
  return nodes
    .map((x) => (x.t === 'text' || x.t === 'code' ? x.s : x.t === 'br' ? '\n' : x.t === 'image' ? x.alt : x.t === 'fn' ? x.raw : refInlineToPlain(x.c)))
    .join('');
}


// ---------------------------------------------------------------- tests

test('parseInline matches the reference implementation on random adversarial input', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const alpha = ['*', '*', '_', '~', '`', '[', ']', '(', ')', '\\', '\n', ' ', ' ', 'a', 'b', 'h', 'http://x.de/a', '!', '**', '~~', '](', 'https://example.com/(x)', '\n\n', '.'];
  for (let it = 0; it < 20000; it++) {
    const len = 1 + Math.floor(rnd() * 30);
    let s = '';
    for (let k = 0; k < len; k++) s += alpha[Math.floor(rnd() * alpha.length)];
    for (const partial of [false, true]) {
      assert.deepEqual(parseInline(s, { partial }), refParseInline(s, { partial }), JSON.stringify(s) + (partial ? ' (partial)' : ''));
    }
  }
});

test('parseInline stays linear on unclosed openers / brackets / many h-words', () => {
  const build = (unit: string, every: number) => (n: number) => {
    let s = '';
    let k = 0;
    while (s.length < n) s += k++ % every === 0 ? unit : 'wort ';
    return s;
  };
  // quadratic before: ~0.3 s (JIT) / several s (jitless) per 100 KB string; linear now: a few ms.
  // CPU-time ratio 12.5 KB vs 200 KB (testing/scaling.test.ts) instead of an absolute budget: robust on a loaded host.
  for (const [unit, every] of [['*hinweis ', 8], ['[a ', 10], ['hier haben ', 2], ['**fett ', 6]] as const) {
    assertLinear(unit, build(unit, every), (s) => {
      parseInline(s, { partial: true });
      parseInline(s);
    });
  }
});

test('reference sanity: both agree on common markdown', () => {
  const s = 'Hallo **fett** und *kursiv*, `code`, [Link](https://a.de/x_(y)) ~~weg~~ https://example.com/a. ![Bild](u.png)';
  assert.deepEqual(parseInline(s), refParseInline(s));
  assert.equal(refInlineToPlain(parseInline(s)).includes('fett'), true);
});

// ---------------------------------------------------------------- v4: footnote refs `[^n]` / `【n】`

/** fn nodes back to their raw text (adjacent texts merged) → comparable with the pre-footnote reference */
function unFn(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const m: Inline = n.t === 'fn' ? { t: 'text', s: n.raw } : 'c' in n ? ({ ...n, c: unFn(n.c) } as Inline) : n;
    const last = out[out.length - 1];
    if (m.t === 'text' && last && last.t === 'text') out[out.length - 1] = { t: 'text', s: last.s + m.s };
    else out.push(m);
  }
  return out;
}

test('footnotes: [^n] / 【n】 become fn nodes, everything else parses exactly as before', () => {
  assert.deepEqual(parseInline('Rom[^1] und Paris【2】.'), [
    { t: 'text', s: 'Rom' },
    { t: 'fn', n: 1, raw: '[^1]' },
    { t: 'text', s: ' und Paris' },
    { t: 'fn', n: 2, raw: '【2】' },
    { t: 'text', s: '.' },
  ]);
  // not footnotes: no digits, 0, > 3 digits, unclosed, escaped
  for (const s of ['[^a]', '[^0]', '[^1234]', '[^12', '\\[^1]', '【】', '【x】']) {
    assert.equal(parseInline(s).some((n) => n.t === 'fn'), false, s);
  }
  assert.deepEqual(parseInline('**fett[^3]**')[0], { t: 'strong', c: [{ t: 'text', s: 'fett' }, { t: 'fn', n: 3, raw: '[^3]' }] });
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // no "(" → a `[^1]` can never have been a link label before
  const alpha = ['*', '_', '~', '`', '[', ']', '\\', '\n', ' ', 'a', '^', '1', '23', '[^1]', '[^', '【', '】', '【4】', '**', '~~', 'https://example.com/x'];
  for (let it = 0; it < 20000; it++) {
    const len = 1 + Math.floor(rnd() * 30);
    let s = '';
    for (let k = 0; k < len; k++) s += alpha[Math.floor(rnd() * alpha.length)];
    for (const partial of [false, true]) {
      assert.deepEqual(unFn(parseInline(s, { partial })), refParseInline(s, { partial }), JSON.stringify(s) + (partial ? ' (partial)' : ''));
    }
  }
});

test('footnotes: linear on many refs / unclosed refs', () => {
  // CPU-time ratio 12.5 KB vs 200 KB (testing/scaling.test.ts) instead of an absolute budget: robust on a loaded host
  for (const unit of ['[^1] ', '[^12 ', '【3】', '【99 ', '[^']) {
    assertLinear(unit, repeatTo(unit + 'wort '), (s) => {
      parseInline(s, { partial: true });
      parseInline(s);
    });
  }
});

// ---------------------------------------------------------------- B3: Hermes numeric citations `[n]` (opt-in via `cites`)

test('cites: [n] / [1][2] / [1, 2] become fn nodes only with the option and n ≤ cites', () => {
  assert.deepEqual(parseInline('Wien [1][2] und Graz [1, 3].', { cites: 3 }), [
    { t: 'text', s: 'Wien ' },
    { t: 'fn', n: 1, raw: '[1]' },
    { t: 'fn', n: 2, raw: '[2]' },
    { t: 'text', s: ' und Graz ' },
    { t: 'fn', n: 1, raw: '[1, 3]' },
    { t: 'fn', n: 3, raw: '' },
    { t: 'text', s: '.' },
  ]);
  // without the option (no closing sources list) plain "[1]" stays text
  assert.equal(parseInline('Siehe [1] und arr[2]').some((n) => n.t === 'fn'), false);
  // out of range, 0, links, letters, escaped, unclosed → text / link as before
  for (const s of ['[4]', '[0]', '[1, 9]', '[1](https://example.com)', '[a]', '\\[1]', '[1', '[1,]', '[1234]']) {
    assert.equal(parseInline(s, { cites: 3 }).some((n) => n.t === 'fn'), false, s);
  }
  assert.deepEqual(parseInline('[1](https://example.com/x)', { cites: 3 })[0], { t: 'link', href: 'https://example.com/x', c: [{ t: 'text', s: '1' }] });
  // a chain stops before a link label
  assert.deepEqual(parseInline('a[1][2](https://example.com)', { cites: 3 }).map((n) => n.t), ['text', 'fn', 'link']);
  // inside emphasis and link labels too, never inside code
  assert.deepEqual(parseInline('**fett [2]**', { cites: 2 })[0], { t: 'strong', c: [{ t: 'text', s: 'fett ' }, { t: 'fn', n: 2, raw: '[2]' }] });
  assert.deepEqual(parseInline('`x[1]`', { cites: 2 }), [{ t: 'code', s: 'x[1]' }]);
});

test('cites: fn nodes back to raw text equal the parse without the option (fuzz)', () => {
  let seed = 23;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const alpha = ['*', '_', '`', '[', ']', '(', ')', '\\', '\n', ' ', 'a', '1', '2', '9', ',', ', ', '[1]', '[2]', '[1, 2]', '[3,4]', '[^1]', '**', 'https://example.com/x', '](', '[1](u)'];
  for (let it = 0; it < 20000; it++) {
    const len = 1 + Math.floor(rnd() * 30);
    let s = '';
    for (let k = 0; k < len; k++) s += alpha[Math.floor(rnd() * alpha.length)];
    for (const partial of [false, true]) {
      assert.deepEqual(unFn(parseInline(s, { partial, cites: 5 })), unFn(parseInline(s, { partial })), JSON.stringify(s) + (partial ? ' (partial)' : ''));
    }
  }
});

test('cites: linear on many / unclosed / long citation groups', () => {
  for (const unit of ['[1] ', '[1][2][3] ', '[1, 2, 3, 4] ', '[1, 2, ', '[12', '[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] ', '[1](']) {
    assertLinear(unit, repeatTo(unit + 'wort '), (s) => {
      parseInline(s, { partial: true, cites: 20 });
      parseInline(s, { cites: 20 });
    });
  }
});

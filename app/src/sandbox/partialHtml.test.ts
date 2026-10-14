import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processHtml, readAttr, extractCompleteStyles, hasVisibleContent } from './partialHtml.ts';

test('drops an incomplete trailing tag while streaming', () => {
  assert.equal(processHtml('<div class="card"><p>Hallo</p><butt', false).body, '<div class="card"><p>Hallo</p>');
  assert.equal(processHtml('<div class="a', false).body, '');
});

test('keeps text and lets the DOM parser close open elements', () => {
  assert.equal(processHtml('<div><p>Hallo We', false).body, '<div><p>Hallo We');
});

test('drops incomplete trailing entity while streaming only', () => {
  assert.equal(processHtml('<p>A &am', false).body, '<p>A');
  assert.equal(processHtml('<p>A &amp; B', false).body, '<p>A &amp; B');
});

test('scripts are never returned while streaming, complete or not', () => {
  const p = processHtml('<p>x</p><script>alert(1)</script><p>y</p><script>var a = 1 < 2', false);
  assert.equal(p.body, '<p>x</p><p>y</p>');
  assert.deepEqual(p.scripts, []);
});

test('partial closing script tag is hidden', () => {
  assert.equal(processHtml('<p>x</p><script>foo()</scr', false).body, '<p>x</p>');
});

test('complete: extracts scripts in order (inline, src, module), strips them from body', () => {
  const p = processHtml(
    '<div id="a"></div><script src="https://cdn.jsdelivr.net/npm/x.js"></script><script>init()</script><script type="module">import x from "y"</script><script type="application/json">{"a":1}</script>',
    true,
  );
  assert.equal(p.body, '<div id="a"></div>');
  assert.deepEqual(p.scripts, [
    { src: 'https://cdn.jsdelivr.net/npm/x.js', code: '', module: false },
    { code: 'init()', module: false },
    { code: 'import x from "y"', module: true },
  ]);
});

test('complete styles are hoisted into css, incomplete style is hidden', () => {
  const p = processHtml('<style>.a{color:red}</style><p class="a">x</p><style>.b{col', false);
  assert.equal(p.css, '.a{color:red}');
  assert.equal(p.body, '<p class="a">x</p>');
});

test('full documents: head dropped (stylesheet links kept), body extracted', () => {
  const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title><link rel="stylesheet" href="https://unpkg.com/l.css"><style>body{margin:0}</style><script src="https://unpkg.com/l.js"></script></head><body class="x"><h1>Hi</h1></body></html>';
  const p = processHtml(doc, true);
  assert.equal(p.body, '<link rel="stylesheet" href="https://unpkg.com/l.css"><h1>Hi</h1>');
  assert.equal(p.css, 'body{margin:0}');
  assert.deepEqual(p.scripts, [{ src: 'https://unpkg.com/l.js', code: '', module: false }]);
});

test('streaming a document whose head is still open shows nothing', () => {
  assert.equal(processHtml('<!DOCTYPE html><html><head><title>T</title><st', false).body, '');
});

test('base / meta / comments are removed', () => {
  const p = processHtml('<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><!-- hi --><p>x</p>', true);
  assert.equal(p.body, '<p>x</p>');
});

test('unterminated comment hides the rest while streaming', () => {
  assert.equal(processHtml('<p>a</p><!-- todo <p>b', false).body, '<p>a</p>');
});

test('strips an accidental surrounding code fence', () => {
  assert.equal(processHtml('```html\n<p>x</p>\n```', true).body, '<p>x</p>');
});

test('readAttr handles quoting styles and boolean attributes', () => {
  assert.equal(readAttr(' src="a.js" defer', 'src'), 'a.js');
  assert.equal(readAttr(" src='b.js'", 'src'), 'b.js');
  assert.equal(readAttr(' type=module', 'type'), 'module');
  assert.equal(readAttr(' async', 'async'), '');
  assert.equal(readAttr(' data-src="x"', 'src'), undefined);
  assert.equal(readAttr(' src="a.js?x=1&amp;y=2"', 'src'), 'a.js?x=1&y=2');
});

test('extractCompleteStyles joins blocks', () => {
  assert.equal(extractCompleteStyles('<style>a{}</style>x<style media="x">b{}</style>'), 'a{}\nb{}');
});

test('hasVisibleContent ignores whitespace and lone stylesheet links', () => {
  assert.equal(hasVisibleContent(processHtml('  <style>a{}</style>  ', false)), false);
  assert.equal(hasVisibleContent(processHtml('<link rel="stylesheet" href="x">', true)), false);
  assert.equal(hasVisibleContent(processHtml('<p>x</p>', false)), true);
});

test('every streamed prefix of a sample is processable and never exposes script text', async () => {
  const { SANDBOX_SAMPLES } = await import('./sandboxSamples.ts');
  for (const s of SANDBOX_SAMPLES) {
    for (let i = 0; i <= s.html.length; i += 7) {
      const p = processHtml(s.html.slice(0, i), false);
      assert.ok(!/<script/i.test(p.body), `${s.id}@${i}: script leaked`);
      assert.ok(!/<style/i.test(p.body), `${s.id}@${i}: style leaked`);
      assert.ok(!/<[^>]*$/.test(p.body), `${s.id}@${i}: dangling tag`);
    }
    const done = processHtml(s.html, true);
    assert.ok(done.scripts.length >= (s.id === 'flow-diagram' ? 0 : 1), s.id);
  }
});

// Security review L10: <link rel=preconnect|dns-prefetch|prefetch|preload> could reach hosts outside the CSP list.
test('only stylesheet <link>s survive, in head and body', () => {
  const p = processHtml('<head><link rel="dns-prefetch" href="//x.evil"><link rel="stylesheet" href="https://unpkg.com/a.css"></head><body><link rel=preconnect href="https://d.evil"><link rel="prefetch" href="https://e.evil/?d=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/b.css"><p>hi</p></body>', true);
  const all = p.body;
  assert.ok(!/evil/.test(all), all);
  assert.match(all, /unpkg\.com\/a\.css/);
  assert.match(all, /cdn\.jsdelivr\.net\/b\.css/);
});

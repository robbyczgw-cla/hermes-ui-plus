import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSandboxMessage as parse, normalizeOpenUrl, injectionFor, isAllowedNavigation, LIMITS } from './messages.ts';

test('rejects garbage', () => {
  for (const raw of [null, undefined, 5, '', 'nope', '[]', '{}', '{"t":"nope"}', [], { t: 1 }]) assert.equal(parse(raw), null, String(raw));
});

test('drops oversized raw strings before parsing', () => {
  const big = JSON.stringify({ t: 'action', action: { type: 'send', text: 'x'.repeat(LIMITS.rawMessage) } });
  assert.equal(parse(big), null);
});

test('simple lifecycle messages', () => {
  assert.deepEqual(parse('{"t":"ready"}'), { t: 'ready' });
  assert.deepEqual(parse({ t: 'paint', junk: 1 }), { t: 'paint' });
  assert.deepEqual(parse('{"t":"done"}'), { t: 'done' });
});

test('height is finite, rounded up and clamped', () => {
  assert.deepEqual(parse('{"t":"height","h":120.2}'), { t: 'height', h: 121 });
  assert.deepEqual(parse({ t: 'height', h: -5 }), { t: 'height', h: 0 });
  assert.deepEqual(parse({ t: 'height', h: 1e9 }), { t: 'height', h: LIMITS.maxHeight });
  assert.equal(parse({ t: 'height', h: Infinity }), null);
  assert.equal(parse({ t: 'height', h: NaN }), null);
  assert.equal(parse({ t: 'height', h: '100' }), null);
});

test('error messages are cleaned and truncated', () => {
  assert.deepEqual(parse({ t: 'error', message: 'a\nb' }), { t: 'error', message: 'a b' });
  assert.equal((parse({ t: 'error', message: 'x'.repeat(1000) }) as { message: string }).message.length, LIMITS.errorMessage);
  assert.deepEqual(parse({ t: 'error' }), { t: 'error', message: '' });
});

test('send / copy actions: trimmed, non-empty, length-limited', () => {
  assert.deepEqual(parse({ t: 'action', action: { type: 'send', text: '  Hallo  ' } }), { t: 'action', action: { type: 'send', text: 'Hallo' } });
  assert.equal(parse({ t: 'action', action: { type: 'send', text: '   ' } }), null);
  assert.equal(parse({ t: 'action', action: { type: 'send', text: 42 } }), null);
  assert.equal(parse({ t: 'action', action: { type: 'send', text: 'x'.repeat(LIMITS.sendText + 1) } }), null);
  assert.deepEqual(parse({ t: 'action', action: { type: 'copy', text: 'a\u0000b' } }), { t: 'action', action: { type: 'copy', text: 'ab' } });
  assert.equal(parse({ t: 'action', action: { type: 'submit' } }), null);
  assert.equal(parse({ t: 'action', action: { type: 'eval', code: 'x' } }), null);
});

test('open_url only allows absolute http(s)/mailto without credentials', () => {
  assert.equal(normalizeOpenUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeOpenUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeOpenUrl('mailto:a@b.de'), 'mailto:a@b.de');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'intent://x#Intent;end', 'file:///etc/passwd', 'data:text/html,x', 'tel:123',
    '/relative', 'example.com', 'https://user:pw@bank.example.com', 'https://a.com/\nb', 'https://a b.com', 'https://x.com/' + 'a'.repeat(LIMITS.url), 42, null]) {
    assert.equal(normalizeOpenUrl(bad), null, String(bad));
  }
  assert.equal(parse({ t: 'action', action: { type: 'open_url', url: 'javascript:alert(1)' } }), null);
});

test('injectionFor produces a single safe call with a JSON string argument', () => {
  const js = injectionFor({ t: 'render', body: '</script><img onerror=x>" ', css: '', final: false, scripts: [] });
  assert.match(js, /^window\.__hui&&window\.__hui\.receive\(".*"\);true;$/s);
  const arg = JSON.parse(js.slice('window.__hui&&window.__hui.receive('.length, -');true;'.length));
  assert.equal(JSON.parse(arg).body, '</script><img onerror=x>" ');
});

test('navigation policy only allows the shell document', () => {
  assert.equal(isAllowedNavigation('about:blank'), true);
  assert.equal(isAllowedNavigation('about:blank#top'), true);
  assert.equal(isAllowedNavigation('about:srcdoc'), true);
  for (const u of ['https://example.com', 'http://localhost:8081', 'file:///data', 'tel:1', 'about:blankx', 'javascript:1', undefined]) assert.equal(isAllowedNavigation(u), false, String(u));
});

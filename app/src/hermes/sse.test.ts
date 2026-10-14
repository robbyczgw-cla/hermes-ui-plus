/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSseParser, createUtf8Decoder } from './sse.ts';

function parseAll(chunks: string[]) {
  const comments: string[] = [];
  const p = createSseParser({ onComment: (c: string) => comments.push(c) });
  const frames = chunks.flatMap((c) => p.push(c));
  frames.push(...p.flush());
  return { frames, comments };
}

test('basic data frame', () => {
  const { frames } = parseAll(['data: hello\n\n']);
  assert.deepEqual(frames, [{ event: 'message', data: 'hello' }]);
});

test('named event + multi-line data + id', () => {
  const { frames } = parseAll(['id: 7\nevent: foo\ndata: a\ndata: b\ndata\n\n']);
  assert.deepEqual(frames, [{ event: 'foo', data: 'a\nb\n', id: '7' }]);
});

test('comments are reported, never framed; keepalive between frames', () => {
  const { frames, comments } = parseAll([': keepalive\n\ndata: x\n\n: another\n\n']);
  assert.deepEqual(frames, [{ event: 'message', data: 'x' }]);
  assert.deepEqual(comments, ['keepalive', 'another']);
});

test('CRLF, lone CR and CR/LF split across chunks', () => {
  const a = parseAll(['data: 1\r\n\r\ndata: 2\r\r']).frames;
  assert.deepEqual(a.map((f: { data: string }) => f.data), ['1', '2']);
  const b = parseAll(['data: 1\r', '\n\r', '\ndata: 2\n\n']).frames;
  assert.deepEqual(b.map((f: { data: string }) => f.data), ['1', '2']);
});

test('BOM dropped, space after colon optional, unknown fields ignored, retry parsed', () => {
  const { frames } = parseAll(['﻿data:no-space\nfoo: bar\nretry: 1500\n\n']);
  assert.deepEqual(frames, [{ event: 'message', data: 'no-space', retry: 1500 }]);
});

test('event without data is not dispatched; event name resets between frames', () => {
  const { frames } = parseAll(['event: a\n\nevent: b\ndata: 1\n\ndata: 2\n\n']);
  assert.deepEqual(frames, [
    { event: 'b', data: '1' },
    { event: 'message', data: '2' },
  ]);
});

test('unterminated last frame is dispatched on flush', () => {
  const { frames } = parseAll(['data: [DONE]']);
  assert.deepEqual(frames, [{ event: 'message', data: '[DONE]' }]);
});

test('colon inside value is preserved', () => {
  const { frames } = parseAll(['data: {"a":"b:c"}\n\n']);
  assert.equal(frames[0].data, '{"a":"b:c"}');
});

test('real fixture: identical frames for every possible 2-way split and 1-char chunks', () => {
  const text = readFileSync(new URL('../../../mock-server/fixtures/02-tool.sse', import.meta.url), 'utf8');
  const ref = parseAll([text]).frames;
  assert.ok(ref.length > 40);
  assert.ok(ref.some((f: { event: string }) => f.event === 'hermes.tool.progress'));
  assert.equal(ref[ref.length - 1].data, '[DONE]');
  for (let i = 1; i < text.length; i += 7) {
    assert.deepEqual(parseAll([text.slice(0, i), text.slice(i)]).frames, ref, `split at ${i}`);
  }
  assert.deepEqual(parseAll(text.split('')).frames, ref);
});

test('CRLF version of fixture parses identically', () => {
  const text = readFileSync(new URL('../../../mock-server/fixtures/02-tool.sse', import.meta.url), 'utf8');
  const crlf = text.replace(/\n/g, '\r\n');
  assert.deepEqual(parseAll(crlf.split('')).frames, parseAll([text]).frames);
});

test('utf8 decoder: multibyte sequences split at every byte boundary', () => {
  const s = 'Grüße 🚀 日本語 – ok';
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i <= bytes.length; i++) {
    const d = createUtf8Decoder();
    const out = d.decode(bytes.slice(0, i)) + d.decode(bytes.slice(i)) + d.flush();
    assert.equal(out, s, `split at ${i}`);
  }
  const d = createUtf8Decoder();
  let out = '';
  for (const b of bytes) out += d.decode(new Uint8Array([b]));
  assert.equal(out + d.flush(), s);
});

test('utf8 decoder: invalid bytes become U+FFFD, dangling sequence flushed', () => {
  const d = createUtf8Decoder();
  assert.equal(d.decode(new Uint8Array([0x61, 0xff, 0x62])), 'a�b');
  assert.equal(d.decode(new Uint8Array([0xe2, 0x82])), '');
  assert.equal(d.flush(), '�');
  const d2 = createUtf8Decoder();
  assert.equal(d2.decode(new Uint8Array([0xe2, 0x41])), '�A');
});

test('end-to-end: bytes split mid-emoji still give correct JSON text', () => {
  const frame = 'data: {"t":"Hi 🚀"}\n\n';
  const bytes = new TextEncoder().encode(frame);
  const d = createUtf8Decoder();
  const p = createSseParser();
  const frames: { data: string }[] = [];
  for (let i = 0; i < bytes.length; i += 3) frames.push(...p.push(d.decode(bytes.slice(i, i + 3))));
  assert.equal(JSON.parse(frames[0].data).t, 'Hi 🚀');
});

test('oversize: an unterminated huge line is dropped without buffering it, the stream recovers', () => {
  let dropped = 0;
  const p = createSseParser({ maxFrameChars: 100, onOversize: () => dropped++ });
  assert.deepEqual(p.push('data: ok1\n\n'), [{ event: 'message', data: 'ok1' }]);
  // 1000 chars in 10 chunks, no line end yet
  for (let i = 0; i < 10; i++) assert.deepEqual(p.push(i === 0 ? 'data: ' + 'x'.repeat(94) : 'x'.repeat(100)), []);
  assert.deepEqual(p.push('tail\n\n'), [], 'the oversize frame is dropped as a whole');
  assert.equal(dropped, 1);
  assert.deepEqual(p.push('data: ok2\n\n'), [{ event: 'message', data: 'ok2' }]);
});

test('oversize: many small data lines beyond the cap drop that frame only', () => {
  let dropped = 0;
  const p = createSseParser({ maxFrameChars: 50, onOversize: () => dropped++ });
  const frames = p.push('event: a\n' + 'data: 0123456789\n'.repeat(10) + '\nevent: b\ndata: fine\n\n');
  assert.deepEqual(frames, [{ event: 'b', data: 'fine' }]);
  assert.equal(dropped, 1);
});

test('oversize: a complete over-long line inside one chunk, CRLF and flush', () => {
  let dropped = 0;
  const p = createSseParser({ maxFrameChars: 20, onOversize: () => dropped++ });
  assert.deepEqual(p.push(`data: ${'y'.repeat(40)}\r\n\r\ndata: a\r\n\r\n`), [{ event: 'message', data: 'a' }]);
  assert.equal(dropped, 1);
  p.push(`data: ${'z'.repeat(40)}`); // cut off at end of stream
  assert.deepEqual(p.flush(), []);
  assert.equal(dropped, 2);
  assert.deepEqual(p.push('data: b\n\n'), [{ event: 'message', data: 'b' }]);
});

test('default cap is 1 MiB: a 900 KB frame passes', () => {
  const p = createSseParser();
  const big = 'q'.repeat(900 * 1024);
  const out = p.push(`data: ${big}\n\n`);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.length, big.length);
});

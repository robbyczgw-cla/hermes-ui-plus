import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, createAssistantCollector, sseFrame, asciiJson } from '../src/sse.mjs';

const STREAM = [
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
  ': keepalive\n\n',
  'event: hermes.tool.progress\ndata: {"tool":"web_search","status":"running","label":"Suche … Ümläute"}\n\n',
  'data: {"choices":[{"delta":{"content":"Grüß "}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"dich 👋"}}]}\r\n\r\n',
  'data: [DONE]\n\n',
].join('');

function events(chunks) {
  const out = [];
  const p = createSseParser((e) => out.push(e));
  for (const c of chunks) p.push(c);
  p.end();
  return out;
}

test('sse parser: identical events for every chunk boundary (incl. inside UTF-8 and CRLF)', () => {
  const bytes = Buffer.from(STREAM);
  const whole = events([bytes]);
  assert.equal(whole.length, 5);
  assert.equal(whole[1].event, 'hermes.tool.progress');
  for (let i = 1; i < bytes.length; i++) {
    assert.deepEqual(events([bytes.subarray(0, i), bytes.subarray(i)]), whole, `split at ${i}`);
  }
  const single = [];
  for (let i = 0; i < bytes.length; i++) single.push(bytes.subarray(i, i + 1));
  assert.deepEqual(events(single), whole);
});

test('assistant collector concatenates delta.content only', () => {
  const c = createAssistantCollector();
  const bytes = Buffer.from(STREAM);
  for (let i = 0; i < bytes.length; i += 7) c.push(bytes.subarray(i, i + 7));
  assert.equal(c.end(), 'Grüß dich 👋');
});

test('route frame is ASCII and parseable', () => {
  const f = sseFrame('hermes.ui.route', { format: 'chart', reason: 'Größe 👍' });
  assert.match(f, /^event: hermes\.ui\.route\ndata: \{.*\}\n\n$/);
  assert.ok(/^[\x00-\x7f]*$/.test(f));
  const ev = events([Buffer.from(f)]);
  assert.equal(JSON.parse(ev[0].data).reason, 'Größe 👍');
  assert.equal(JSON.parse(asciiJson({ a: 'ü' })).a, 'ü');
});

// Review finding (medium): the side-channel parsers must not buffer an unbounded line / frame.
test('frame cap: an over-long line is dropped without buffering, metadata reported, later frames still parsed', () => {
  const out = [];
  const big = [];
  const p = createSseParser((e) => out.push(e), { maxFrameChars: 1000, onOversize: (m) => big.push(m) });
  p.push(Buffer.from('event: a\ndata: ok1\n\n'));
  p.push(Buffer.from('event: huge\ndata: '));
  for (let i = 0; i < 50; i++) p.push(Buffer.from('x'.repeat(500))); // 25 000 chars, no newline yet
  p.push(Buffer.from('yyy\n\ndata: ok2\r\n\r\n'));
  p.end();
  assert.deepEqual(out.map((e) => e.data), ['ok1', 'ok2']);
  assert.equal(big.length, 1);
  assert.equal(big[0].event, 'huge');
  assert.ok(big[0].chars > 1000);
  assert.ok(!JSON.stringify(big).includes('xxx'), 'metadata only');
});

test('frame cap: many data lines adding up over the cap drop the frame; CR terminator after a skipped line', () => {
  const out = [];
  const big = [];
  const p = createSseParser((e) => out.push(e), { maxFrameChars: 100, onOversize: (m) => big.push(m) });
  p.push(Buffer.from(`${'data: 0123456789012345678901234567890123456789\n'.repeat(5)}\n`));
  p.push(Buffer.from(`data: ${'z'.repeat(150)}`));
  p.push(Buffer.from('\r\n\r\ndata: after\n\n'));
  p.end();
  assert.deepEqual(out.map((e) => e.data), ['after']);
  assert.equal(big.length, 2);
  const c = createAssistantCollector(8000);
  c.push(Buffer.from(`data: {"choices":[{"delta":{"content":"${'a'.repeat(2 * 1024 * 1024)}"}}]}\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n`));
  assert.equal(c.end(), 'ok');
});

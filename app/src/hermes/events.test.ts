/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSseParser } from './sse.ts';
import { mapFrame } from './events.ts';
import type { HermesEvent } from './types';

function fixtureEvents(name: string): HermesEvent[] {
  const text = readFileSync(new URL(`../../../mock-server/fixtures/${name}`, import.meta.url), 'utf8');
  const p = createSseParser();
  return [...p.push(text), ...p.flush()].flatMap((f) => mapFrame(f));
}

test('plain fixture: start, text, finish(stop)+usage, done', () => {
  const evs = fixtureEvents('01-plain.sse');
  assert.equal(evs[0].type, 'start');
  assert.match((evs[0] as { completionId: string }).completionId, /^chatcmpl-/);
  assert.deepEqual(evs[1], { type: 'text', text: 'OK' });
  const fin = evs.find((e) => e.type === 'finish') as Extract<HermesEvent, { type: 'finish' }>;
  assert.equal(fin.reason, 'stop');
  assert.equal(fin.usage?.promptTokens, 21524);
  assert.equal(evs[evs.length - 1].type, 'done');
});

test('tool fixture: running then done with label/emoji, reasoning separated from text', () => {
  const evs = fixtureEvents('02-tool.sse');
  const tools = evs.filter((e) => e.type === 'tool') as Extract<HermesEvent, { type: 'tool' }>[];
  assert.equal(tools.length, 2);
  assert.deepEqual(
    { n: tools[0].name, s: tools[0].status, l: tools[0].label, id: tools[0].callId },
    { n: 'terminal', s: 'running', l: 'date', id: tools[1].callId }
  );
  assert.equal(tools[0].emoji, '\u{1F4BB}');
  assert.equal(tools[1].status, 'done');
  const reasoning = evs.filter((e) => e.type === 'reasoning').map((e) => (e as { text: string }).text).join('');
  assert.equal(reasoning, 'Der Nutzer fragt nach der aktuellen Uhrzeit.');
  const text = evs.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
  assert.match(text, /Ich hole die aktuelle Uhrzeit direkt vom System\.\n\nSamstag, 10\. Oktober 2026/);
  assert.ok(!text.includes('Der Nutzer'));
});

test('hermes.text.replace -> textReplace (empty text clears); replace_fallback chunks carry no text', () => {
  assert.deepEqual(mapFrame({ event: 'hermes.text.replace', data: '{"text":"Neu"}' }), [{ type: 'textReplace', text: 'Neu' }]);
  assert.deepEqual(mapFrame({ event: 'hermes.text.replace', data: '{"text":""}' }), [{ type: 'textReplace', text: '' }]);
  assert.deepEqual(mapFrame({ event: 'hermes.text.replace', data: '{"text":7}' }), []);
  const chunk = (extra: object) =>
    JSON.stringify({ id: 'c', choices: [{ index: 0, delta: { content: 'rest' }, finish_reason: null }], ...extra });
  assert.deepEqual(mapFrame({ event: 'message', data: chunk({ hermes: { replace_fallback: true } }) }), []);
  assert.deepEqual(mapFrame({ event: 'message', data: chunk({}) }), [{ type: 'text', text: 'rest' }]);
});

test('hermes.ui.route, hermes.status, approval.request', () => {
  const route = { format: 'chart', confidence: 0.9, reason: 'r', model: 'm', ms: 120 };
  assert.deepEqual(mapFrame({ event: 'hermes.ui.route', data: JSON.stringify(route) }), [{ type: 'route', route }]);
  assert.deepEqual(mapFrame({ event: 'hermes.status', data: '{"kind":"lifecycle","text":"Warte auf Provider"}' }), [
    { type: 'status', kind: 'lifecycle', text: 'Warte auf Provider' },
  ]);
  const [ap] = mapFrame({
    event: 'approval.request',
    data: JSON.stringify({
      event: 'approval.request',
      run_id: 'chatcmpl-1',
      request_id: 'abc',
      command: 'rm -rf /tmp/x',
      description: 'delete',
      pattern_key: 'rm',
      choices: ['once', 'deny', 'bogus'],
      timestamp: 1.5,
    }),
  }) as Extract<HermesEvent, { type: 'approval' }>[];
  assert.equal(ap.type, 'approval');
  assert.deepEqual(ap.approval, {
    runId: 'chatcmpl-1',
    requestId: 'abc',
    command: 'rm -rf /tmp/x',
    description: 'delete',
    patternKey: 'rm',
    choices: ['once', 'deny'],
    smartDenied: undefined,
    timestamp: 1.5,
  });
});

test('finish with error and hermes extras (length / error)', () => {
  const chunk = (finish: string, extra: object) =>
    mapFrame({
      event: 'message',
      data: JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], ...extra }),
    });
  assert.deepEqual(
    chunk('length', { hermes: { partial: true, error_code: 'output_truncated', error: 'truncated' } }),
    [{ type: 'finish', reason: 'length', usage: undefined, error: 'truncated', errorCode: 'output_truncated', partial: true }]
  );
  const [e] = chunk('error', { error: { message: 'boom', type: 'agent_error' } }) as Extract<HermesEvent, { type: 'finish' }>[];
  assert.equal(e.reason, 'error');
  assert.equal(e.error, 'boom');
});

test('error envelope, unknown events, garbage and keepalive-like frames are tolerated', () => {
  assert.deepEqual(mapFrame({ event: 'message', data: '{"error":{"message":"x","code":"c"}}' }), [
    { type: 'error', message: 'x', code: 'c' },
  ]);
  assert.deepEqual(mapFrame({ event: 'something.else', data: '{"a":1}' }), []);
  assert.deepEqual(mapFrame({ event: 'message', data: 'not json' }), []);
  assert.deepEqual(mapFrame({ event: 'hermes.tool.progress', data: '{"status":"running"}' }), []);
  assert.deepEqual(mapFrame({ event: 'message', data: ' [DONE] ' }), [{ type: 'done' }]);
});

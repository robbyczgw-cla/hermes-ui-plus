import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationMeta } from '../conversations/types.ts';
import type { FetchLike, FetchResponseLike } from '../hermes/stream.ts';
import { fetchPushConfig, readInbox, registerDevice, unregisterDevice, PushApiError } from './api.ts';
import {
  backoffMs,
  inboxUrl,
  mergeInboxMessage,
  normalizeTime,
  parseInboxEvent,
  parseTarget,
  pickConversation,
  pushBaseUrl,
  pushServerKind,
  registrationBody,
  vapidKeyBytes,
  DEFAULT_PUSH_SETTINGS,
} from './model.ts';

const hermesBridge = { id: 'p-h', kind: 'hermes', baseUrl: 'https://hermes-host.example.ts.net:8790/v1/', apiKey: 'k', bridge: true };



test('time input normalization', () => {
  assert.equal(normalizeTime('7:5'), '07:05');
  assert.equal(normalizeTime('2230'), '22:30');
  assert.equal(normalizeTime('7'), '07:00');
  assert.equal(normalizeTime('24:00'), null);
  assert.equal(normalizeTime('abc'), null);
});

test('notification data from Android (JSON string), iOS (`body` object) and web', () => {
  const data = { v: '1', kind: 'message', profileId: 'p-a', src: 'hermes', agent: 'kiwi', messageId: 'm_1' };
  assert.deepEqual(parseTarget(JSON.stringify(data)), { src: 'hermes', profileId: 'p-a', sessionId: undefined, agent: 'kiwi', source: undefined, messageId: 'm_1' });
  assert.equal(parseTarget({ body: data })?.agent, 'kiwi');
  assert.equal(parseTarget({ body: JSON.stringify({ ...data, src: 'hermes', sessionId: 'cron_x' }) })?.sessionId, 'cron_x');
  assert.equal(parseTarget({ profileId: 'p', src: 'evil' }), null);
  assert.equal(parseTarget('not json'), null);
  assert.equal(parseTarget(null), null);
});

const conv = (o: Partial<ConversationMeta>): ConversationMeta => ({
  id: 'c', title: 't', titleSource: 'auto', profileId: 'p-a', profileKind: 'hermes', createdAt: 0, updatedAt: 0, preview: 'x', messageCount: 2, ...o,
});


test('inbox events: parsing and de-duplicated merge', () => {
  const ev = parseInboxEvent('{"id":"m_1","content":"Bild fertig","timestamp":5,"agent":"dm-with-alice","sessionId":null}');
  assert.ok(ev);
  assert.equal(parseInboxEvent('{"id":1}'), null);
  const base = [{ id: 'u', role: 'user' as const, text: 'Bild bitte', tools: [], status: 'done' as const, createdAt: 1 }];
  const merged = mergeInboxMessage(base, ev!);
  assert.equal(merged?.length, 2);
  assert.equal(merged?.[1].text, 'Bild fertig');
  assert.equal(mergeInboxMessage(merged!, ev!), null, 'same id twice');
  assert.equal(mergeInboxMessage([...base, { ...merged![1], id: 'turn-1' }], ev!), null, 'already shown by the turn stream');
});

test('VAPID key bytes and backoff', () => {
  const k = 'BIAhkLeo_rT3PAvXaVlHjmf58amTbELDS_r1TpRCO_Qm7Pn64Ib0-Yck2RqJIQTXmkRCuTwoMW3x6Sn8Y0gItkY';
  const b = vapidKeyBytes(k);
  assert.equal(b.length, 65);
  assert.equal(b[0], 4);
  assert.equal(backoffMs(0), 1000);
  assert.equal(backoffMs(20), 60000);
});

function res(status: number, body: string, chunks?: string[]): FetchResponseLike {
  const enc = new TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    body: chunks
      ? new ReadableStream<Uint8Array>({
          start(c) {
            for (const ch of chunks) c.enqueue(enc.encode(ch));
            c.close();
          },
        })
      : null,
  };
}


test('inbox reader: ready + messages across split chunks, keepalives ignored, HTTP errors thrown', async () => {
  const frames = [': keepalive\n\nevent: hui.rea', 'dy\ndata: {}\n\n', 'event: hui.message\ndata: {"id":"m_1","content":"Hallo ', 'Welt","timestamp":1}\n\n'];
  const got: string[] = [];
  let ready = 0;
  const f: FetchLike = async () => res(200, '', frames);
  const r = await readInbox(f, 'https://x/v1/inbox/stream', 'k', { signal: new AbortController().signal, onEvent: (e) => got.push(e.content), onReady: () => ready++ });
  assert.equal(r, 'ended');
  assert.equal(ready, 1);
  assert.deepEqual(got, ['Hallo Welt']);
  await assert.rejects(readInbox(async () => res(401, ''), 'u', 'k', { signal: new AbortController().signal, onEvent: () => {} }), (e: unknown) => e instanceof PushApiError && e.status === 401);
});


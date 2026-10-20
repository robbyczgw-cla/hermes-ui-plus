/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRemoteMessages, sameUserText, splitStoredExtras, userTextCore } from './sessionMapping.ts';
import { splitTurnExtras, withTurnNote } from './turnOverride.ts';
import { withLiveTrailer } from '../live/trailer.ts';
import type { RemoteMessage } from './sessions.ts';

const BATCHES = { einkauf: { v: 2, ops: [{ check: 'milch' as const }], bid: 'b-test' } } as never;
const SENT = withLiveTrailer(withTurnNote('Pack noch Senf dazu.', 'kurz bitte'), BATCHES);

test('splitTurnExtras cuts the trailer (after a note) and returns its batches without the chip flag', () => {
  const r = splitTurnExtras(SENT);
  assert.equal(r.text, 'Pack noch Senf dazu.');
  assert.deepEqual(r.extras, { note: true });
  assert.deepEqual(r.live, BATCHES);
  assert.deepEqual(splitTurnExtras(withLiveTrailer('Hallo', BATCHES)), { text: 'Hallo', live: BATCHES });
});

test('transcript matching ignores the trailer', () => {
  assert.equal(userTextCore(SENT).core, 'Pack noch Senf dazu.');
  assert.ok(sameUserText(SENT, 'Pack noch Senf dazu.'));
});

test('stored text: trailer before the [Bild] marker lines is cut, markers stay', () => {
  const r = splitStoredExtras(`${withLiveTrailer('Schau mal', BATCHES)}\n[Bild]`);
  assert.equal(r.text, 'Schau mal\n[Bild]');
  assert.deepEqual(r.live, BATCHES);
});

test('remote user rows: the bubble never shows the raw trailer, note or context; live batches are kept', () => {
  const rows: RemoteMessage[] = [
    { id: '1', role: 'user', content: SENT, timestamp: 1 },
    { id: '2', role: 'assistant', content: 'Senf ist drauf.', timestamp: 2 },
    { id: '3', role: 'user', content: withLiveTrailer('', BATCHES), timestamp: 3 },
  ] as RemoteMessage[];
  const m = mapRemoteMessages(rows);
  assert.equal(m[0].text, 'Pack noch Senf dazu.');
  assert.deepEqual(m[0].live, BATCHES);
  assert.deepEqual(m[0].turnExtras, { note: true });
  assert.equal(m[2].text, '');
  assert.deepEqual(m[2].live, BATCHES);
});

test('remote rows: a hidden row (compaction scaffolding) marks the next message that starts after it `contextCut`; a turn with one inside stays one bubble', () => {
  const rows: RemoteMessage[] = [
    { id: '1', role: 'user', content: 'Mach mir eine Liste', timestamp: 1 },
    { id: '2', role: 'assistant', content: 'Hier ist sie.', timestamp: 2 },
    { id: '3', role: 'user', content: '', displayKind: 'hidden', timestamp: 3 },
    { id: '4', role: 'user', content: 'Weiter', timestamp: 4 },
    { id: '5', role: 'assistant', content: 'Teil 1', timestamp: 5 },
    { id: '6', role: 'assistant', content: '', displayKind: 'hidden', timestamp: 6 },
    { id: '7', role: 'assistant', content: 'Teil 2', timestamp: 7 },
  ];
  const out = mapRemoteMessages(rows);
  assert.deepEqual(out.map((m) => [m.id, !!m.contextCut]), [['hu-1', false], ['ha-2', false], ['hu-4', true], ['ha-5', false]]);
  assert.equal(mapRemoteMessages([...rows, { id: '8', role: 'user', content: 'Und?', timestamp: 8 }])[4].contextCut, true);
  assert.equal(out[3].text, 'Teil 1\n\nTeil 2');
});

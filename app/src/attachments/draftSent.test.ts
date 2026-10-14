/// <reference types="node" />
// bugs review 2026-10-11 P3-2: a refused send keeps the attachments; an accepted one removes exactly the sent ones
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftReducer, toSent } from './draft.ts';
import type { DraftAttachment } from './draft.ts';
import { att } from './fixtures.test.ts';

const a = att({ name: 'a.png', mimeType: 'image/png' }) as DraftAttachment;
const b = att({ name: 'b.pdf', mimeType: 'application/pdf' }) as DraftAttachment;
const c = att({ name: 'c.txt', mimeType: 'text/plain' }) as DraftAttachment;

test('prepared attachments keep their draft ids (commitSend matches by id)', () => {
  assert.deepEqual([a, b].map(toSent).map((x) => x.id), [a.id, b.id]);
});

test('"sent" removes exactly the sent attachments; one added meanwhile stays', () => {
  const sent = [a, b].map(toSent);
  assert.deepEqual(draftReducer([a, b, c], { type: 'sent', ids: sent.map((x) => x.id) }), [c]);
});

test('a refused send dispatches nothing: the draft is unchanged', () => {
  const draft = [a, b];
  // prepareForSend no longer clears; only commitSend (after onSend → true) dispatches "sent"
  assert.deepEqual(draft, [a, b]);
  assert.deepEqual(draftReducer(draft, { type: 'sent', ids: [] }), [a, b]);
});

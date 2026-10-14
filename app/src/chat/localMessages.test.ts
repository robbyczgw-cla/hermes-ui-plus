import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalMessage, localChecklistMessage } from './localMessages.ts';
import { parseMessage } from '../protocol/streamParser.ts';

test('local checklist message parses into one checklist node', () => {
  const m = localChecklistMessage({ title: 'Einkaufsliste', kind: 'shopping', items: ['Milch', ' ', 'Eier '] }, 1000, () => 0.5);
  assert.equal(m.role, 'assistant');
  assert.equal(m.status, 'done');
  assert.ok(isLocalMessage(m));
  const segs = parseMessage(m.text);
  assert.equal(segs.length, 1);
  const seg = segs[0];
  assert.equal(seg.kind, 'hui');
  const node = (seg as { node?: { type: string; title: string; items: { text: string }[] } }).node;
  assert.equal(node?.type, 'checklist');
  assert.deepEqual(node?.items.map((i) => i.text), ['Milch', 'Eier']);
});

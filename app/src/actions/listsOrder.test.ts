/// <reference types="node" />
// bugs review 2026-10-11 P2-3: add_to_list picks the latest list by MESSAGE time, not by first render
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistCreatedAt, pickChecklist, withMessageCreatedAt, type ChecklistNodeState } from './lists.ts';
import { stateFromNode } from '../ui/components/modules/a/checklistModel.ts';
import type { ConversationRecord } from '../nodestate/model.ts';

const MSG_A = Date.UTC(2026, 9, 1, 9); // early message with list A
const MSG_B = Date.UTC(2026, 9, 1, 18); // recent message with list B

test('B renders first, A mounts later (scrolling up): B is still the latest list', () => {
  const renderB = Date.UTC(2026, 9, 11, 10, 0);
  const renderA = renderB + 60_000; // A materialises AFTER B
  const b = stateFromNode({ title: 'B', items: ['Milch'] }, checklistCreatedAt(MSG_B, renderB));
  const a = stateFromNode({ title: 'A', items: ['Brot'] }, checklistCreatedAt(MSG_A, renderA));
  const rec: ConversationRecord = {
    'mB:list': { v: 1, data: b, updatedAt: renderB },
    'mA:list': { v: 1, data: a, updatedAt: renderA },
  } as ConversationRecord;
  assert.equal(pickChecklist(rec)?.key, 'mB:list');
});

test('outside a message scope the time of materialisation is used', () => {
  assert.equal(checklistCreatedAt(undefined, 123), 123);
  assert.equal(checklistCreatedAt(Number.NaN, 123), 123);
  assert.equal(checklistCreatedAt(5, 123), 5);
});

test('lists stored by older builds (first-render time) are re-stamped with the message time', () => {
  const old = { kind: 'checklist', createdAt: Date.UTC(2026, 9, 11), items: [] } as ChecklistNodeState;
  assert.equal(withMessageCreatedAt(old, MSG_A)?.createdAt, MSG_A);
  assert.equal(withMessageCreatedAt({ ...old, createdAt: MSG_A }, MSG_A), null);
  assert.equal(withMessageCreatedAt(old, undefined), null);
});

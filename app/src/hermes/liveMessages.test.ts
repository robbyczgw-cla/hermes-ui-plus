/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createAssistantMessage, createUserMessage, finalize } from './chatState.ts';
import { CHECKPOINT_MS, freshest, liveMessages, liveOnlyTick } from './liveMessages.ts';
import type { ApprovalRequest, ChatMessage, HermesEvent } from './types';

const user = createUserMessage('Frage', 1000);

/** [user, assistant] after `evs`, plus a helper to step the assistant with one more event */
function turn(evs: HermesEvent[]): { list: ChatMessage[]; step: (ev: HermesEvent) => ChatMessage[] } {
  let m = createAssistantMessage(1000);
  let t = 1000;
  for (const e of evs) m = applyEvent(m, e, (t += 10));
  const list = [user, m];
  return { list, step: (ev) => [user, applyEvent(m, ev, (t += 10))] };
}

const fresh = 10; // ms since the last commit (below the checkpoint)

test('a tick that only grows the streaming text or reasoning is live-only', () => {
  const a = turn([{ type: 'text', text: 'Hallo' }]);
  assert.equal(liveOnlyTick(a.list, a.step({ type: 'text', text: ' Welt' }), fresh), true);
  const r = turn([{ type: 'reasoning', text: 'Ich denke' }]);
  // reasoning grows its trace step and the text stays empty: still live-only
  assert.equal(liveOnlyTick(r.list, r.step({ type: 'reasoning', text: ' weiter' }), fresh), true);
  // several deltas between two ticks
  let m = a.list[1];
  for (const s of [' a', ' b', ' c']) m = applyEvent(m, { type: 'text', text: s }, 2000);
  assert.equal(liveOnlyTick(a.list, [user, m], fresh), true);
});

test('commit boundaries: first text, first reasoning, fences, replaced text, checkpoint', () => {
  const empty = turn([]);
  assert.equal(liveOnlyTick(empty.list, empty.step({ type: 'text', text: 'Erstes' }), fresh), false, 'first text');
  assert.equal(liveOnlyTick(empty.list, empty.step({ type: 'reasoning', text: 'denke' }), fresh), false, 'first reasoning');
  const a = turn([{ type: 'text', text: 'Hier kommt ein Block:\n' }]);
  assert.equal(liveOnlyTick(a.list, a.step({ type: 'text', text: '```hui\n{"type":' }), fresh), false, 'an interactive block opens');
  assert.equal(liveOnlyTick(a.list, a.step({ type: 'text', text: '```python\nx = 1' }), fresh), false, 'a code block opens');
  const open = turn([{ type: 'text', text: 'x\n```hui\n{"type":"choice"}\n`' }]);
  assert.equal(liveOnlyTick(open.list, open.step({ type: 'text', text: '``\nweiter' }), fresh), false, 'a fence split across two ticks');
  assert.equal(liveOnlyTick(a.list, a.step({ type: 'textReplace', text: 'Ganz neu' }), fresh), false, 'replaced text');
  assert.equal(liveOnlyTick(a.list, a.step({ type: 'text', text: 'mehr' }), CHECKPOINT_MS), false, 'checkpoint');
  assert.equal(liveOnlyTick(a.list, a.step({ type: 'text', text: 'mehr' }), CHECKPOINT_MS - 1), true);
});

test('commit boundaries: start, tool steps, status, route, approval, finish, error, stop, connection notes', () => {
  const a = turn([{ type: 'text', text: 'Hallo' }]);
  const approval: ApprovalRequest = { runId: 'run-test', command: 'ls', description: 'list', choices: ['once', 'deny'], timestamp: 1 };
  const events: [string, HermesEvent][] = [
    ['start', { type: 'start', completionId: 'chatcmpl-test' }],
    ['tool start', { type: 'tool', callId: 'c1', name: 'web_search', status: 'running' }],
    ['status', { type: 'status', kind: 'retry', text: 'Neuer Versuch' }],
    ['route', { type: 'route', route: { format: 'table' } as never }],
    ['approval', { type: 'approval', approval }],
    ['finish', { type: 'finish', reason: 'stop' }],
    ['finish error', { type: 'finish', reason: 'error', error: 'kaputt' }],
    ['error', { type: 'error', message: 'kaputt' }],
  ];
  for (const [name, ev] of events) assert.equal(liveOnlyTick(a.list, a.step(ev), fresh), false, name);
  const toolRunning = turn([{ type: 'tool', callId: 'c1', name: 'web_search', status: 'running' }, { type: 'text', text: 'x' }]);
  assert.equal(liveOnlyTick(toolRunning.list, toolRunning.step({ type: 'tool', callId: 'c1', name: 'web_search', status: 'done' }), fresh), false, 'tool done');
  const m = a.list[1];
  assert.equal(liveOnlyTick(a.list, [user, finalize(m, 'stopped', undefined, 5000)], fresh), false, 'stop');
  assert.equal(liveOnlyTick(a.list, [user, { ...m, reconnecting: 5000 }], fresh), false, 'connection lost');
  assert.equal(liveOnlyTick(a.list, [user, { ...m, resumable: true }], fresh), false, 'resumable');
  const { reconnecting: _r, ...resumed } = { ...m, reconnecting: 1 };
  assert.equal(liveOnlyTick([user, { ...m, reconnecting: 1 }], [user, { ...resumed, text: m.text }], fresh), false, 'connection back');
});

test('commit boundaries: the list itself changed', () => {
  const a = turn([{ type: 'text', text: 'Hallo' }]);
  const grown = a.step({ type: 'text', text: '!' });
  assert.equal(liveOnlyTick(a.list, a.list, fresh), false, 'nothing changed: a plain (no-op) commit');
  assert.equal(liveOnlyTick(a.list, [...grown, createUserMessage('neu', 2000)], fresh), false, 'a message added');
  assert.equal(liveOnlyTick(a.list, [{ ...user, text: 'bearbeitet' }, grown[1]], fresh), false, 'an older message changed');
  assert.equal(liveOnlyTick(a.list, [user, { ...grown[1], id: 'a-other' }], fresh), false, 'another answer');
  assert.equal(liveOnlyTick([user, finalize(a.list[1], 'done', undefined, 3000)], grown, fresh), false, 'the committed answer was not streaming');
  assert.equal(liveOnlyTick([], [], fresh), false);
});

test('commit boundaries: a grown text without an append run is checked by its tail', () => {
  const base: ChatMessage = { id: 'a-plain', role: 'assistant', text: 'Anfang des Textes', tools: [], status: 'streaming', createdAt: 1 };
  assert.equal(liveOnlyTick([base], [{ ...base, text: 'Anfang des Textes und mehr' }], fresh), true);
  assert.equal(liveOnlyTick([base], [{ ...base, text: 'Anders begonnen und länger' }], fresh), false);
});

test('store: a live tick notifies only the subscribers of its answer', () => {
  const a = turn([{ type: 'text', text: 'Hallo' }]);
  const tracked = liveMessages.commit(null, a.list);
  assert.equal(tracked, a.list[1].id);
  assert.equal(liveMessages.get(a.list[1].id), a.list[1], 'the commit sets the entry to the committed answer');
  let mine = 0;
  let other = 0;
  const off1 = liveMessages.subscribe(a.list[1].id, () => mine++);
  const off2 = liveMessages.subscribe('a-someone-else', () => other++);
  const next = a.step({ type: 'text', text: ' Welt' });
  liveMessages.publish(next[1]);
  liveMessages.publish(next[1]); // the same state again: no re-render
  assert.equal(mine, 1);
  assert.equal(other, 0);
  assert.equal(liveMessages.get(a.list[1].id)?.text, 'Hallo Welt');
  assert.equal(freshest(a.list[1]).text, 'Hallo Welt', 'the committed answer resolves to its newer live state');
  off1();
  liveMessages.publish(a.step({ type: 'text', text: '!' })[1]);
  assert.equal(mine, 1, 'unsubscribed');
  off2();
  // the finished answer is committed: the entry goes (silently), freshest() is the committed message itself
  const done = [user, finalize(next[1], 'done', undefined, 3000)];
  assert.equal(liveMessages.commit(tracked, done), null);
  assert.equal(liveMessages.get(a.list[1].id), undefined);
  assert.equal(freshest(done[1]), done[1]);
});

test('store: a commit moves the entry to the new streaming answer and drop() clears it', () => {
  const first = turn([{ type: 'text', text: 'eins' }]);
  const t1 = liveMessages.commit(null, first.list);
  const second = createAssistantMessage(4000);
  const t2 = liveMessages.commit(t1, [...first.list, createUserMessage('zwei', 4000), second]);
  assert.equal(t2, second.id);
  assert.equal(liveMessages.get(first.list[1].id), undefined, 'the older answer lost its entry');
  assert.equal(liveMessages.get(second.id), second);
  assert.equal(liveMessages.commit(t2, []), null, 'new session');
  assert.equal(liveMessages.get(second.id), undefined);
  const t3 = liveMessages.commit(null, [second]);
  liveMessages.drop(t3);
  assert.equal(liveMessages.get(second.id), undefined, 'unmount');
  liveMessages.drop(null);
});

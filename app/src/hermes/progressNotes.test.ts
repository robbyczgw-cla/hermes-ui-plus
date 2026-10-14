/// <reference types="node" />
// UX1: interim notes before tool calls → timeline status lines; the answer is the text after the last tool round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEvent, createAssistantMessage } from './chatState.ts';
import { createSseParser } from './sse.ts';
import { mapFrame } from './events.ts';
import { answerText, splitProgressNotes } from './progressNotes.ts';
import { mapRemoteMessages } from './sessionMapping.ts';
import { applyInboxAnswer, recoveredMessage } from './recovery.ts';
import { previewOf } from '../conversations/messages.ts';
import { notificationBody } from '../background/notice.ts';
import { buildTimeline, rowDetail, timelineHeader } from '../chat/toolTimeline.ts';
import { makeT } from '../i18n/core.ts';
import type { ChatMessage, HermesEvent } from './types';
import type { RemoteMessage } from './sessions';

const text = (t: string): HermesEvent => ({ type: 'text', text: t });
const tool = (callId: string, status: 'running' | 'done', name = 'web_search', label = 'q'): HermesEvent => ({ type: 'tool', callId, name, label, status });
const finish: HermesEvent = { type: 'finish', reason: 'stop' };

function run(events: HermesEvent[]): ChatMessage[] {
  let m = createAssistantMessage(1000);
  const states: ChatMessage[] = [];
  events.forEach((e, i) => {
    m = applyEvent(m, e, 1000 + i * 10);
    states.push(m);
  });
  return states;
}

test('live stream: notes before tool starts leave the answer, the final answer is the text after the last tool round', () => {
  const states = run([
    text('Ich lade kurz das UI-Format…'),
    tool('c1', 'running', 'skill_view', 'hermes-ui'),
    tool('c1', 'done', 'skill_view', 'hermes-ui'),
    text('Die Shortlist ist da, ich prüfe noch die Preise.'),
    tool('c2', 'running'),
    tool('c3', 'running'), // parallel call: same cut
    tool('c2', 'done'),
    tool('c3', 'done'),
    text('## Ergebnis\n\nDrei Modelle passen.'),
    finish,
  ]);
  // before the first tool starts the text is (still) the answer
  assert.equal(splitProgressNotes(states[0]).answer, 'Ich lade kurz das UI-Format…');
  // the tool started: the text becomes a note, the answer is empty (waiting indicator + note as status line)
  const s1 = splitProgressNotes(states[1]);
  assert.equal(s1.answer, '');
  assert.deepEqual(s1.notes.map((n) => n.text), ['Ich lade kurz das UI-Format…']);
  assert.equal(s1.notes[0].toolId, 'c1');
  assert.equal(s1.notes[0].at, states[1].tools[0].startedAt);
  const last = states[states.length - 1];
  const done = splitProgressNotes(last);
  assert.equal(done.answer, '## Ergebnis\n\nDrei Modelle passen.');
  assert.deepEqual(done.notes.map((n) => [n.toolId, n.text]), [
    ['c1', 'Ich lade kurz das UI-Format…'],
    ['c2', 'Die Shortlist ist da, ich prüfe noch die Preise.'],
  ]);
  // nothing lost: the stored text is complete
  assert.ok(last.text.startsWith('Ich lade kurz das UI-Format…Die Shortlist'));
  assert.ok(last.text.endsWith('Drei Modelle passen.'));
});

test('real Hermes fixture (02-tool.sse): note + tool + answer', () => {
  const sse = readFileSync(new URL('../../../mock-server/fixtures/02-tool.sse', import.meta.url), 'utf8');
  const p = createSseParser();
  const events = [...p.push(sse), ...p.flush()].flatMap((f) => mapFrame(f));
  const states = run(events);
  const m = states[states.length - 1];
  const s = splitProgressNotes(m);
  assert.deepEqual(s.notes.map((n) => n.text), ['Ich hole die aktuelle Uhrzeit direkt vom System.']);
  assert.match(s.answer, /^Samstag, 10\. Oktober 2026/);
});

test('no tools / tools before any text / text only after tools: no split', () => {
  const plain = run([text('Hallo!'), finish]).at(-1)!;
  assert.deepEqual(splitProgressNotes(plain), { answer: 'Hallo!', notes: [] });
  const toolFirst = run([tool('c1', 'running'), tool('c1', 'done'), text('Antwort.'), finish]).at(-1)!;
  assert.deepEqual(splitProgressNotes(toolFirst), { answer: 'Antwort.', notes: [] });
});

test('a turn that ends with a tool round keeps its last note as the answer (nothing disappears)', () => {
  const states = run([text('Kurz nachsehen…'), tool('c1', 'running'), tool('c1', 'done'), text('Hier ist die Antwort.'), tool('m1', 'running', 'memory'), tool('m1', 'done', 'memory'), finish]);
  const s = splitProgressNotes(states.at(-1)!);
  assert.equal(s.answer, 'Hier ist die Antwort.');
  assert.deepEqual(s.notes.map((n) => n.text), ['Kurz nachsehen…']);
  // while it still streams the answer is empty (the memory tool runs)
  assert.equal(splitProgressNotes(states.at(-3)!).answer, '');
});

test('components / code before a tool call stay in the answer', () => {
  const block = '```hui\n{"type":"choice","id":"x","question":"A oder B?","options":[{"label":"A"},{"label":"B"}]}\n```';
  const m = run([text(block), tool('c1', 'running'), tool('c1', 'done'), text('Fertig.'), finish]).at(-1)!;
  assert.deepEqual(splitProgressNotes(m), { answer: m.text, notes: [] });
  // mixed: the note leaves, the component stays before the final text
  const mixed = run([text('Moment…'), tool('c0', 'running'), text(block), tool('c1', 'running'), text('Fertig.'), finish]).at(-1)!;
  const s = splitProgressNotes(mixed);
  assert.deepEqual(s.notes.map((n) => n.text), ['Moment…']);
  assert.equal(s.answer, `${block}\n\nFertig.`);
});

test('history: assistant rows with tool_calls give the same split (texts are still joined in message.text)', () => {
  const rows: RemoteMessage[] = [
    { id: '1', role: 'user', content: 'Finde Kopfhörer', timestamp: 1000 },
    { id: '2', role: 'assistant', content: 'Ich lade kurz das UI-Format…', toolCalls: [{ id: 'c1', name: 'skill_view', arguments: '{"name":"hermes-ui"}' }], finishReason: 'tool_calls', timestamp: 1001 },
    { id: '3', role: 'tool', content: '{"ok":true}', toolCallId: 'c1', timestamp: 1002 },
    { id: '4', role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'web_search', arguments: '{"query":"kopfhörer"}' }], finishReason: 'tool_calls', timestamp: 1003 },
    { id: '5', role: 'tool', content: '[]', toolCallId: 'c2', timestamp: 1004 },
    { id: '6', role: 'assistant', content: 'Die Shortlist ist da.', toolCalls: [{ id: 'c3', name: 'web_search', arguments: '{"query":"preise"}' }, { id: 'c4', name: 'web_extract', arguments: '{"url":"https://example.com"}' }], finishReason: 'tool_calls', timestamp: 1005 },
    { id: '7', role: 'tool', content: '[]', toolCallId: 'c3', timestamp: 1006 },
    { id: '8', role: 'tool', content: '{}', toolCallId: 'c4', timestamp: 1007 },
    { id: '9', role: 'assistant', content: 'Meine Empfehlung: Modell A.', finishReason: 'stop', timestamp: 1008 },
  ];
  const [user, a] = mapRemoteMessages(rows);
  assert.equal(user.role, 'user');
  assert.equal(a.text, 'Ich lade kurz das UI-Format…\n\nDie Shortlist ist da.\n\nMeine Empfehlung: Modell A.');
  assert.deepEqual(a.tools.map((t) => t.textAt), [28, 28, 51, 51]);
  const s = splitProgressNotes(a);
  assert.equal(s.answer, 'Meine Empfehlung: Modell A.');
  assert.deepEqual(s.notes.map((n) => [n.toolId, n.text]), [
    ['c1', 'Ich lade kurz das UI-Format…'],
    ['c3', 'Die Shortlist ist da.'],
  ]);
  // drawer preview + notification: the final answer, not the first note
  assert.equal(previewOf([user, a]), 'Meine Empfehlung: Modell A.');
  assert.equal(notificationBody(a, true, 'Antwort da'), 'Meine Empfehlung: Modell A.');
  assert.equal(answerText(a), 'Meine Empfehlung: Modell A.');
});

test('recovery: the stored text replaces the live one → cut offsets follow the stored turn', () => {
  const live = run([text('Ich schaue nach…'), tool('c1', 'running'), tool('c1', 'done'), text('Teil')]).at(-1)!;
  const local: ChatMessage = { ...live, status: 'stopped', interrupted: 2000 };
  const rows: RemoteMessage[] = [
    { id: '2', role: 'assistant', content: 'Ich schaue nach…', toolCalls: [{ id: 'c1', name: 'web_search', arguments: '{}' }], finishReason: 'tool_calls', timestamp: 1001 },
    { id: '3', role: 'tool', content: '[]', toolCallId: 'c1', timestamp: 1002 },
    { id: '4', role: 'assistant', content: 'Die ganze Antwort.', finishReason: 'stop', timestamp: 1003 },
  ];
  const [remote] = mapRemoteMessages(rows);
  const rec = recoveredMessage(local, remote);
  assert.equal(rec.text, 'Ich schaue nach…\n\nDie ganze Antwort.');
  assert.equal(splitProgressNotes(rec).answer, 'Die ganze Antwort.');
  // inbox answer: final text only → no offsets, no split
  const list = applyInboxAnswer([{ id: 'u', role: 'user', text: 'q', tools: [], status: 'done', createdAt: 900 }, local], { id: 'x', content: 'Die ganze Antwort.', timestamp: 0 });
  const inbox = list?.[1];
  assert.ok(inbox);
  assert.equal(inbox.tools.every((t) => t.textAt === undefined), true);
  assert.equal(splitProgressNotes(inbox).answer, 'Die ganze Antwort.');
});

test('offsets past the text (edited / truncated) are ignored', () => {
  const m: ChatMessage = { id: 'a', role: 'assistant', text: 'kurz', tools: [{ id: 'c', name: 'x', label: 'x', status: 'done', startedAt: 1, textAt: 99 }], status: 'done', createdAt: 0 };
  assert.deepEqual(splitProgressNotes(m), { answer: 'kurz', notes: [] });
});

test('timeline: notes become status rows before the call they announce; detail shows the full text', () => {
  const de = { t: makeT('de', 'de-DE'), locale: 'de-DE' };
  const m = run([text('Ich lade kurz das UI-Format…'), tool('c1', 'running', 'terminal', 'ls'), tool('c1', 'done', 'terminal', 'ls'), text('Fertig.'), finish]).at(-1)!;
  const rows = buildTimeline(m, de.t, 5000);
  assert.deepEqual(rows.map((r) => r.kind), ['note', 'tool']);
  assert.equal(rows[0].title, 'Zwischenstand');
  assert.equal(rows[0].summary, 'Ich lade kurz das UI-Format…');
  // notes are not counted as steps
  assert.equal(timelineHeader(rows, de.t), '1 Werkzeug');
  assert.equal(rowDetail(m, rows[0].key, de)!.sections[0].body, 'Ich lade kurz das UI-Format…');
  // Settings → Antworten keeps them in the answer: no rows
  assert.deepEqual(buildTimeline(m, de.t, 5000, { notes: false }).map((r) => r.kind), ['tool']);
});

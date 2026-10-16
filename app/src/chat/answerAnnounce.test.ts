import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANNOUNCE_PREVIEW_MAX, answerAnnouncement, previewText } from './answerAnnounce.ts';
import { applyEvent, createAssistantMessage } from '../hermes/chatState.ts';
import type { ChatMessage, HermesEvent } from '../hermes/types';
import { createStatusTrack, stepStatuses } from '../voice/statusTrack.ts';
import { makeT } from '../i18n/core.ts';

const en = makeT('en', 'en-US');
const de = makeT('de', 'de-DE');

function run(events: HermesEvent[]): ChatMessage[] {
  let m = createAssistantMessage(1000);
  const states: ChatMessage[] = [m];
  events.forEach((e, i) => {
    m = applyEvent(m, e, 1000 + i * 10);
    states.push(m);
  });
  return states;
}
const text = (t: string): HermesEvent => ({ type: 'text', text: t });
const finish: HermesEvent = { type: 'finish', reason: 'stop' };

/** what AnswerAnnouncer would announce over a sequence of message lists (one entry per render) */
function announcements(renders: ChatMessage[][], t = en): string[] {
  const track = createStatusTrack<ChatMessage>();
  const out: string[] = [];
  for (const messages of renders) {
    const { finished } = stepStatuses(track, messages);
    const a = finished ? answerAnnouncement(finished, t) : '';
    if (a) out.push(a);
  }
  return out;
}

test('a streamed answer is announced ONCE when it finishes, never per token', () => {
  const states = run([text('The capital '), text('of France '), text('is **Paris**.'), finish]);
  const said = announcements(states.map((m) => [m]));
  assert.deepEqual(said, ['Answer ready: The capital of France is Paris.']);
  assert.deepEqual(announcements(states.map((m) => [m]), de), ['Antwort fertig: The capital of France is Paris.']);
});

test('opening a chat with finished answers announces nothing (no live transition)', () => {
  const done = run([text('Old answer.'), finish]).at(-1)!;
  assert.deepEqual(announcements([[done], [done]]), []);
});

test('stopped or failed turns are not announced as ready', () => {
  const states = run([text('Partial')]);
  const stopped: ChatMessage = { ...states.at(-1)!, status: 'stopped' };
  const failed: ChatMessage = { ...states.at(-1)!, status: 'error' };
  assert.deepEqual(announcements([[states.at(-1)!], [stopped]]), []);
  assert.deepEqual(announcements([[states.at(-1)!], [failed]]), []);
});

test('the announcement is a short plain-text preview (markdown and hui blocks removed)', () => {
  const long = `# Title\n\n${'word '.repeat(80)}`;
  const a = answerAnnouncement({ id: 'a1', role: 'assistant', status: 'done', text: long }, en);
  assert.ok(a.startsWith('Answer ready: Title.'));
  assert.ok(a.endsWith('…'));
  assert.ok(a.length <= 'Answer ready: '.length + ANNOUNCE_PREVIEW_MAX + 1);
  assert.ok(!a.includes('#'));
  // a hui-only answer: no prose, the block summary or the bare "ready"
  const hui = answerAnnouncement({ id: 'a2', role: 'assistant', status: 'done', text: '```hui\n{"type":"table","columns":["a"],"rows":[["1"],["2"]]}\n```' }, en);
  assert.ok(hui.startsWith('Answer ready'));
  assert.equal(answerAnnouncement({ id: 'u1', role: 'user', status: 'done', text: 'hi' }, en), '');
});

test('previewText cuts at a word boundary', () => {
  assert.equal(previewText('short text'), 'short text');
  assert.equal(previewText('alpha beta gamma delta', 12), 'alpha beta…');
  assert.equal(previewText('a  b\n\nc'), 'a b c');
});

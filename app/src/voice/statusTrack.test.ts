/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatusTrack, stepStatuses, type TrackedMessage } from './statusTrack.ts';

/** the previous useAutoRead logic: a Map over all messages rebuilt per update */
function reference() {
  let prev = new Map<string, string>();
  return (messages: readonly TrackedMessage[]) => {
    const next = new Map<string, string>();
    let finished: TrackedMessage | null = null;
    for (const m of messages) {
      next.set(m.id, m.status);
      if (m.role === 'assistant' && m.status === 'done' && prev.get(m.id) === 'streaming' && m.text.trim()) finished = m;
    }
    const last = messages[messages.length - 1];
    const lastWasKnown = !!last && prev.has(last.id);
    prev = next;
    return { finished, lastWasKnown };
  };
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

test('stepStatuses: same finished answer and "known" flag as rebuilding the map per update (random chat histories)', () => {
  const r = rng(5);
  for (let run = 0; run < 300; run++) {
    const ref = reference();
    const track = createStatusTrack<TrackedMessage>();
    let list: TrackedMessage[] = [];
    let nextId = 0;
    const dropped: TrackedMessage[] = [];
    const msg = (role: string, status: string, text = ''): TrackedMessage => ({ id: `m${nextId++}`, role, status, text });
    for (let step = 0; step < 60; step++) {
      const op = Math.floor(r() * 10);
      const lastIdx = list.length - 1;
      if (op === 0) list = [...list, msg('user', 'done', 'frage'), msg('assistant', 'streaming')];
      else if (op <= 3 && lastIdx >= 0) list = list.map((m, i) => (i === lastIdx ? { ...m, text: m.text + 'Wort ' } : m)); // streaming tick
      else if (op === 4 && lastIdx >= 0) list = list.map((m, i) => (i === lastIdx ? { ...m, status: r() < 0.8 ? 'done' : 'stopped' } : m));
      else if (op === 5 && lastIdx >= 0) list = list.slice(0, lastIdx); // retry removes the answer
      else if (op === 6) list = Array.from({ length: Math.floor(r() * 5) }, () => msg(r() < 0.5 ? 'user' : 'assistant', r() < 0.3 ? 'streaming' : 'done', 'x')); // other chat
      else if (op === 7 && list.length > 1) {
        const i = Math.floor(r() * list.length); // an earlier message changes (e.g. an approval, a late status)
        list = list.map((m, k) => (k === i ? { ...m, status: m.status === 'streaming' ? 'done' : m.status, text: m.text || 'spät' } : m));
      } else if (op === 8 && lastIdx >= 0) {
        dropped.push(list[lastIdx]);
        list = list.map((m, i) => (i === lastIdx ? { ...m, id: `m${nextId++}` } : m)); // replaced in place
      } else if (op === 9 && lastIdx >= 0 && dropped.length) {
        const back = dropped[Math.floor(r() * dropped.length)]; // an earlier message comes back in place (restore)
        if (!list.some((m) => m.id === back.id)) list = list.map((m, i) => (i === lastIdx ? back : m));
      } else list = [...list]; // same messages, new array
      const want = ref(list);
      const got = stepStatuses(track, list);
      assert.equal(got.finished, want.finished, `run ${run} step ${step}`);
      assert.equal(got.lastWasKnown, want.lastWasKnown, `run ${run} step ${step}`);
    }
  }
});

test('stepStatuses: a streaming tick does not rebuild the map', () => {
  const track = createStatusTrack<TrackedMessage>();
  const history: TrackedMessage[] = Array.from({ length: 300 }, (_, i) => ({ id: `h${i}`, role: i % 2 ? 'assistant' : 'user', text: 't', status: 'done' }));
  let answer: TrackedMessage = { id: 'a', role: 'assistant', text: '', status: 'streaming' };
  stepStatuses(track, [...history, answer]);
  const map = track.seen;
  for (let i = 0; i < 20; i++) {
    answer = { ...answer, text: answer.text + 'x' };
    assert.equal(stepStatuses(track, [...history, answer]).finished, null);
  }
  answer = { ...answer, status: 'done' };
  assert.equal(stepStatuses(track, [...history, answer]).finished, answer);
  assert.equal(track.seen, map); // updated in place
});

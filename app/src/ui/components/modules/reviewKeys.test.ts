// Regression tests (docs/reviews/gpt-parts/2-parsers-ui.md #7–#9): reader-side ids must stay exactly the
// validator's ids (persistence keys), stay unique, and never read Object.prototype members as state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode } from '../../../protocol/validate.ts';
import { normalizeMap } from './b/mapModel.ts';
import { normalizeTimer } from './d2/timerModel.ts';
import { INITIAL_STUDY_STATE, isDone, progressOf, toggleTask, type StudyTask } from './d3/studyplanModel.ts';
import { answerCurrent, boxOf, INITIAL_VOCAB_STATE, startRun, summarize, type VocabItem } from './d3/vocabModel.ts';

type Rec = Record<string, unknown>;

test('#7 sibling maps with a long shared id prefix keep distinct persistence ids', () => {
  const pre = 'm'.repeat(90);
  const stack = normalizeNode({
    type: 'stack',
    children: [
      { type: 'map', id: pre + 'A', markers: [{ lat: 1, lng: 1, title: 'a' }] },
      { type: 'map', id: pre + 'B', markers: [{ lat: 1, lng: 1, title: 'b' }] },
      { type: 'map', id: pre + 'A', markers: [{ lat: 1, lng: 1, title: 'c' }] },
    ],
  }) as unknown as Rec;
  const kids = stack.children as Rec[];
  const ids = kids.map((k) => normalizeMap(k).id);
  assert.deepEqual(ids, kids.map((k) => k.id));
  assert.equal(new Set(ids).size, 3, String(ids));
});

test('#8 multi-timer ids differing after char 40 get distinct clock keys', () => {
  const node = normalizeNode({ type: 'timer', timers: [{ id: 'x'.repeat(40) + 'a', seconds: 60 }, { id: 'x'.repeat(40) + 'b', seconds: 90 }] }) as unknown as Rec;
  const spec = normalizeTimer(node);
  assert.equal(spec.kind, 'multi');
  if (spec.kind === 'multi') assert.equal(new Set(spec.items.map((i) => i.key)).size, 2);
  // unvalidated duplicates are made unique too
  const raw = normalizeTimer({ type: 'timer', timers: [{ id: 'a', seconds: 5 }, { id: 'a', seconds: 6 }] });
  if (raw.kind === 'multi') assert.equal(new Set(raw.items.map((i) => i.key)).size, 2);
});

test('#9 prototype-named ids are not existing state (model-level, unvalidated ids)', () => {
  const task: StudyTask = { id: 'constructor', text: 'x' } as StudyTask;
  assert.equal(isDone(INITIAL_STUDY_STATE.done, 'constructor'), false);
  assert.equal(progressOf([task], INITIAL_STUDY_STATE.done).done, 0);
  const on = toggleTask(INITIAL_STUDY_STATE, 'constructor');
  assert.equal(isDone(on.done, 'constructor'), true);
  assert.equal(isDone(toggleTask(on, 'constructor').done, 'constructor'), false);

  const items = [{ id: 'constructor', term: 'a', translation: 'b' }, { id: 'toString', term: 'c', translation: 'd' }] as VocabItem[];
  assert.equal(boxOf(INITIAL_VOCAB_STATE, 'constructor'), 1);
  let s = startRun(items, INITIAL_VOCAB_STATE, 'cards' as never, 1);
  assert.ok(s.run);
  const first = s.run!.queue[0];
  s = answerCurrent(s, false);
  assert.equal(s.run!.results[first], false, 'the answer was recorded');
  const sum = summarize(items, { ...s.run!, results: { ...s.run!.results } });
  assert.equal(sum.correct, 0);
});

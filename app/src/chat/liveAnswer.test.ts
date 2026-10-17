/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A streaming answer re-renders per live tick only in its live part (MessageItem.tsx `LiveAnswer`,
 * hermes/liveMessages.ts, docs/PERF.md). Source guard (no React renderer in node:test): the frame (AssistantBody)
 * never subscribes to the live store and runs the text pipeline only for a finished answer; the live part subscribes
 * and runs it while the answer streams.
 */
const src = readFileSync(new URL('./MessageItem.tsx', import.meta.url), 'utf8');
const body = (name: string) => {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, name);
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end);
};

test('live answer: the frame does not subscribe and derives the text only when the answer is finished', () => {
  const frame = body('AssistantBody');
  assert.doesNotMatch(frame, /useLiveMessage\(/);
  assert.match(frame, /useAnswerText\(streaming \? null : message, notesInline, textState\)/);
  assert.match(frame, /<LiveAnswer\s/);
  assert.match(frame, /done=\{streaming \? null : answerText\}/);
  // the per-delta parts live below it
  assert.doesNotMatch(frame, /<SegmentView|<Reasoning |<WaitingIndicator|<ToolTimelinePanel|<RouteSkeleton/);
});

test('live answer: the live part subscribes, runs the pipeline while streaming and reports the perf commit', () => {
  const live = body('LiveAnswer');
  assert.match(live, /const message = useLiveMessage\(committed\);/);
  assert.match(live, /useAnswerText\(done \? null : message, notesInline, textState\)/);
  assert.match(live, /usePerfCommit\(isLast, message\.text\.length, streaming\)/);
  assert.match(live, /<SegmentView/);
});

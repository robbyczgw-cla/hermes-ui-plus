import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HuiNode, Segment } from '../../protocol/types';
import {
  QUESTION_MAX_CHARS,
  SHARE_MAX_BODY_HEIGHT,
  KEEP_SHARED_MS,
  clipBody,
  expiredShares,
  planShare,
  privacyNoteKey,
  questionBefore,
  shareActions,
  shareFileName,
  shareQuestion,
  type ShareEnv,
} from './shareModel.ts';

const md = (key: string, text: string): Segment => ({ key, kind: 'markdown', text });
const hui = (key: string, node: HuiNode | null, extra: Partial<Extract<Segment, { kind: 'hui' }>> = {}): Segment => ({ key, kind: 'hui', complete: true, raw: '{}', node, ...extra });
const html = (key: string, body: string): Segment => ({ key, kind: 'html', complete: true, html: body });
const node = (type: string, rest: Record<string, unknown> = {}) => ({ type, ...rest }) as unknown as HuiNode;

test('planShare: text and cards go in, in order; follow-up chips and blank text stay out', () => {
  const plan = planShare([
    md('a', 'Here are three options:'),
    hui('b', node('checklist', { items: [] })),
    md('c', '   \n '),
    hui('d', node('suggestions', { items: ['More?'] })),
    md('e', 'Pick one.'),
  ]);
  assert.deepEqual(
    plan.parts.map((p) => `${p.kind}:${p.key}`),
    ['markdown:a', 'hui:b', 'markdown:e'],
  );
  assert.equal(plan.widgets, 0);
  assert.equal(plan.empty, false);
});

test('planShare: the interactive state is not copied – the card part is the node itself (state comes from the node store)', () => {
  const n = node('quiz', { id: 'q1', questions: [] });
  const plan = planShare([hui('k', n)]);
  assert.equal(plan.parts[0].kind === 'hui' && plan.parts[0].node, n);
});

test('planShare: sandboxed HTML widgets are counted and become a placeholder at their place', () => {
  const plan = planShare([md('a', 'Calculator:'), html('w', '<div>calc</div>'), html('w2', '  '), md('b', 'Try 12*7=')]);
  assert.equal(plan.widgets, 1);
  assert.deepEqual(
    plan.parts.map((p) => `${p.kind}:${p.key}`),
    ['markdown:a', 'widget:w', 'markdown:b'],
  );
  assert.equal(plan.empty, false);
});

test('planShare: an answer that is only a widget has nothing to draw', () => {
  const plan = planShare([html('w', '<canvas></canvas>')]);
  assert.equal(plan.empty, true);
  assert.equal(plan.widgets, 1);
});

test('planShare: a block that failed to parse is left out, a readable fallback node stays', () => {
  const plan = planShare([hui('bad', null, { error: 'Unexpected token' }), hui('fb', node('list', { items: ['a'] }), { fallback: true })]);
  assert.deepEqual(plan.parts.map((p) => p.key), ['fb']);
  assert.equal(planShare([hui('bad', null)]).empty, true);
});

test('shareQuestion: one line, collapsed whitespace, null when empty', () => {
  assert.equal(shareQuestion('  How do I\n\n back up   my photos? '), 'How do I back up my photos?');
  assert.equal(shareQuestion(''), null);
  assert.equal(shareQuestion('  \n\t'), null);
  assert.equal(shareQuestion(null), null);
  assert.equal(shareQuestion(undefined), null);
});

test('shareQuestion: long questions end in an ellipsis without splitting an emoji', () => {
  const long = 'a'.repeat(QUESTION_MAX_CHARS + 50);
  const out = shareQuestion(long)!;
  assert.equal(Array.from(out).length, QUESTION_MAX_CHARS);
  assert.ok(out.endsWith('…'));
  const emoji = '🙂'.repeat(20);
  const cut = shareQuestion(emoji, 10)!;
  assert.equal(cut, '🙂'.repeat(9) + '…');
  assert.equal(shareQuestion('exactly ten', 11), 'exactly ten');
});

test('questionBefore: the nearest user message before the answer', () => {
  const msgs = [
    { id: 'u1', role: 'user', text: 'first' },
    { id: 'a1', role: 'assistant', text: 'x' },
    { id: 'u2', role: 'user', text: 'second' },
    { id: 'a2', role: 'assistant', text: 'y' },
    { id: 'a3', role: 'assistant', text: 'z' },
  ];
  assert.equal(questionBefore(msgs, 'a1'), 'first');
  assert.equal(questionBefore(msgs, 'a2'), 'second');
  assert.equal(questionBefore(msgs, 'a3'), 'second');
  assert.equal(questionBefore(msgs, 'missing'), null);
  assert.equal(questionBefore([{ id: 'a0', role: 'assistant', text: 'hi' }], 'a0'), null);
});

test('clipBody: full height up to the maximum, then the maximum plus a fade', () => {
  assert.deepEqual(clipBody(0), { height: 0, clipped: false });
  assert.deepEqual(clipBody(NaN), { height: 0, clipped: false });
  assert.deepEqual(clipBody(640.4), { height: 641, clipped: false });
  // a few px over is not worth a fade
  assert.deepEqual(clipBody(SHARE_MAX_BODY_HEIGHT + 10), { height: SHARE_MAX_BODY_HEIGHT + 10, clipped: false });
  assert.deepEqual(clipBody(SHARE_MAX_BODY_HEIGHT * 3), { height: SHARE_MAX_BODY_HEIGHT, clipped: true });
  assert.deepEqual(clipBody(900, 500), { height: 500, clipped: true });
});

test('shareFileName: local date and time, safe prefix', () => {
  const at = new Date(2026, 9, 6, 9, 5);
  assert.equal(shareFileName(at), 'hui-answer-2026-10-06-0905.png');
  assert.equal(shareFileName(at, 'Hermes UI'), 'hermes-ui-2026-10-06-0905.png');
  assert.equal(shareFileName(at, '../../x'), 'x-2026-10-06-0905.png');
  assert.equal(shareFileName(at, '***'), 'answer-2026-10-06-0905.png');
});

const env = (e: Partial<ShareEnv>): ShareEnv => ({ platform: 'web', desktop: false, canShareFiles: false, canCopyImage: false, ...e });

test('shareActions: native share sheet on phones, primary action last', () => {
  assert.deepEqual(shareActions(env({ platform: 'android' })), ['share']);
  assert.deepEqual(shareActions(env({ platform: 'ios', canCopyImage: true })), ['share']);
});

test('shareActions: browser = download, plus Web Share with files and clipboard where supported', () => {
  assert.deepEqual(shareActions(env({})), ['download']);
  assert.deepEqual(shareActions(env({ canShareFiles: true })), ['download', 'share']);
  assert.deepEqual(shareActions(env({ canShareFiles: true, canCopyImage: true })), ['copy', 'download', 'share']);
});

test('shareActions: desktop app = save to Downloads (+ copy), never the web share', () => {
  assert.deepEqual(shareActions(env({ desktop: true, canShareFiles: true })), ['save']);
  assert.deepEqual(shareActions(env({ desktop: true, canCopyImage: true })), ['copy', 'save']);
  assert.deepEqual(shareActions(env({ platform: 'other' })), []);
});

test('privacy line: share sheet wording on phones, "nothing is uploaded" elsewhere', () => {
  assert.equal(privacyNoteKey(env({ platform: 'android' })), 'privacyNative');
  assert.equal(privacyNoteKey(env({})), 'privacyLocal');
  assert.equal(privacyNoteKey(env({ desktop: true })), 'privacyLocal');
});

test('expiredShares: a shared PNG stays for KEEP_SHARED_MS (the receiving app may read it late), then may go', () => {
  const shared = new Map([
    ['file:///cache/a.png', 1_000],
    ['file:///cache/b.png', 1_000 + KEEP_SHARED_MS - 1],
  ]);
  assert.deepEqual(expiredShares(shared, 1_000 + KEEP_SHARED_MS - 1), []);
  assert.deepEqual(expiredShares(shared, 1_000 + KEEP_SHARED_MS), ['file:///cache/a.png']);
  assert.deepEqual(expiredShares(shared, 1_000 + 3 * KEEP_SHARED_MS), ['file:///cache/a.png', 'file:///cache/b.png']);
  assert.deepEqual(expiredShares(new Map(), 5), []);
});

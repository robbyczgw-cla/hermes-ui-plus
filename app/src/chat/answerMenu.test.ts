/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ToolEvent } from '../hermes/types.ts';
import { answerMenuItems, answerModelInfo, branchHistory, planBranch, planRetry, retryModel, usedWebSearch, type AnswerMenuState } from './answerMenu.ts';

const msg = (id: string, role: 'user' | 'assistant', extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, text: id, tools: [], status: 'done', createdAt: 1, ...extra });
const tool = (name: string, extra: Partial<ToolEvent> = {}): ToolEvent => ({ id: name, name, label: name, status: 'done', startedAt: 1, ...extra });

test('branch: Hermes forks only from the last answer with a session API, else seeds; others copy', () => {
  const base = { kind: 'hermes', isLast: true, hasRemoteSession: true };
  assert.equal(planBranch(base), 'fork');
  assert.equal(planBranch({ ...base, sessionsApi: true }), 'fork');
  assert.equal(planBranch({ ...base, isLast: false }), 'seed');
  assert.equal(planBranch({ ...base, sessionsApi: false }), 'seed');
  assert.equal(planBranch({ ...base, hasRemoteSession: false }), 'seed');
  for (const kind of ['claude', 'openai', 'demo']) {
    assert.equal(planBranch({ kind, isLast: true, hasRemoteSession: false }), 'copy');
    assert.equal(planBranch({ kind, isLast: false, hasRemoteSession: true }), 'copy');
  }
});

test('branch history: up to and including the answer, runtime fields dropped', () => {
  const list = [
    msg('u1', 'user'),
    msg('a1', 'assistant', { statusNote: 'x', approval: { runId: 'r', command: 'c', description: '', choices: [], timestamp: 1 } }),
    msg('u2', 'user'),
    msg('a2', 'assistant', { status: 'streaming' }),
  ];
  const h = branchHistory(list, 'a1')!;
  assert.deepEqual(h.map((m) => m.id), ['u1', 'a1']);
  assert.equal(h[1].statusNote, undefined);
  assert.equal(h[1].approval, undefined);
  assert.equal(branchHistory(list, 'a2')![3].status, 'stopped');
  assert.equal(branchHistory(list, 'nope'), null);
  // the source list is not touched
  assert.equal(list[1].statusNote, 'x');
});

test('web search detection: Hermes, MCP, provider tools, metrics, links', () => {
  assert.equal(usedWebSearch({ tools: [] }), false);
  assert.equal(usedWebSearch({ tools: [tool('terminal'), tool('read_file'), tool('session_search'), tool('search_files')] }), false);
  assert.equal(usedWebSearch({ tools: [tool('web_search')] }), true);
  assert.equal(usedWebSearch({ tools: [tool('web_extract')] }), true);
  assert.equal(usedWebSearch({ tools: [tool('browser_navigate')] }), true);
  assert.equal(usedWebSearch({ tools: [tool('mcp__web_search_plus__web_search')] }), true);
  assert.equal(usedWebSearch({ tools: [tool('X-Suche')] }), true);
  assert.equal(usedWebSearch({ tools: [tool('Webseite laden')] }), true);
  assert.equal(usedWebSearch({ tools: [tool('Suche', { detail: { tool: 'web_fetch' } })] }), true);
  assert.equal(usedWebSearch({ tools: [tool('custom', { detail: { links: [{ title: 'a', url: 'https://example.com' }] } })] }), true);
  assert.equal(usedWebSearch({ tools: [], metrics: { webSearchRequests: 2 } }), true);
});

test('retry planning: same / model / reformat / no-web per backend', () => {
  const note = 'Beantworte ohne Websuche/Web-Tools.';
  assert.deepEqual(planRetry('same', { kind: 'hermes', noWebNote: note }), { type: 'retry' });
  assert.deepEqual(planRetry('model', { kind: 'claude', noWebNote: note }), { type: 'pickModel' });
  assert.deepEqual(planRetry('longer', { kind: 'hermes', noWebNote: note }), { type: 'reformat', kind: 'longer' });
  assert.deepEqual(planRetry('shorter', { kind: 'demo', noWebNote: note }), { type: 'reformat', kind: 'shorter' });
  assert.deepEqual(planRetry('noWeb', { kind: 'hermes', noWebNote: note }), { type: 'retry', override: { note } });
  // picked model → one-turn override; "Standard" → profile model / Hermes default
  assert.equal(retryModel('claude', 'claude-opus-5-5', 'claude-sonnet-5-5'), 'claude-opus-5-5');
  assert.equal(retryModel('claude', undefined, 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(retryModel('hermes', undefined, undefined), 'hermes-agent');
  assert.equal(retryModel('openai', undefined, undefined), undefined);
});

test('header info: reported > selected; Hermes default; effort normalized, unknown omitted', () => {
  assert.deepEqual(answerModelInfo({ kind: 'hermes', reported: 'hermes-agent', serverDefault: 'gpt-6-sol', effort: 'default' }), { isDefault: true, model: 'gpt-6-sol' });
  assert.deepEqual(answerModelInfo({ kind: 'hermes' }), { isDefault: true });
  assert.deepEqual(answerModelInfo({ kind: 'hermes', selected: 'openrouter::x/y', effort: 'high' }), { model: 'openrouter::x/y', effort: 'high' });
  assert.deepEqual(answerModelInfo({ kind: 'claude', reported: 'claude-opus-5-5', selected: 'claude-sonnet-5-5', effort: 'medium' }), { model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(answerModelInfo({ kind: 'openai', selected: 'gpt-6-sol', effort: 'none' }), { model: 'gpt-6-sol', effort: 'off' });
  assert.deepEqual(answerModelInfo({ kind: 'openai', effort: 'weird' }), {});
});

test('menu items: order, last-answer retry, web item, report last', () => {
  const s: AnswerMenuState = {
    local: false, streaming: false, failed: false, isLast: true, busy: false, hasText: true,
    recovering: false, usedWeb: true, shareImage: true, reported: false, canBranch: true,
  };
  assert.deepEqual(answerMenuItems(s), ['branch', 'retry', 'noWeb', 'copy', 'copyMarkdown', 'share', 'shareImage', 'report']);
  assert.deepEqual(answerMenuItems({ ...s, isLast: false, usedWeb: false, shareImage: false }), ['branch', 'copy', 'copyMarkdown', 'share', 'report']);
  assert.deepEqual(answerMenuItems({ ...s, local: true, usedWeb: false, shareImage: false }), ['copy', 'copyMarkdown', 'share']);
  assert.deepEqual(answerMenuItems({ ...s, reported: true, usedWeb: false, shareImage: false, busy: true }), ['branch', 'copy', 'copyMarkdown', 'share', 'undoReport']);
  assert.deepEqual(answerMenuItems({ ...s, streaming: true }), []);
  // quick thread: "Mit Hermes weitermachen" first, no branch; not for a failed answer
  const q = { ...s, canBranch: false, canHandOff: true, usedWeb: false, shareImage: false };
  assert.deepEqual(answerMenuItems(q), ['handOff', 'retry', 'copy', 'copyMarkdown', 'share', 'report']);
  assert.deepEqual(answerMenuItems({ ...q, failed: true, hasText: false }), ['retry']);
});

test('menu items: share as image also for an answer that is only cards (no copyable text)', () => {
  const s: AnswerMenuState = {
    local: false, streaming: false, failed: false, isLast: false, busy: false, hasText: false,
    recovering: false, usedWeb: false, shareImage: true, reported: false, canBranch: false,
  };
  assert.deepEqual(answerMenuItems(s), ['shareImage', 'report']);
  assert.deepEqual(answerMenuItems({ ...s, streaming: true }), []);
  assert.deepEqual(answerMenuItems({ ...s, shareImage: false }), ['report']);
});

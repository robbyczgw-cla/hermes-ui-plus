/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages } from './sessions.ts';
import { MESSAGES_FIXTURE } from './sessions.fixtures.ts';
import { loadToolDetails, wantsLiveDetails } from './toolDetails.ts';
import { HERMES_MIDTURN_ROWS } from './webResults.fixtures.ts';
import type { ChatMessage } from './types';

const rows = parseMessages(MESSAGES_FIXTURE, 'x').messages;
const CALL = 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0';
const turn: ChatMessage = {
  id: 'a-1',
  role: 'assistant',
  text: 'Ich hole die aktuelle Uhrzeit direkt vom System.Samstag…',
  tools: [{ id: CALL, name: 'terminal', label: 'date', status: 'done', startedAt: 10, endedAt: 20 }],
  status: 'done',
  createdAt: 5,
};
const noSleep = async () => {};

test('loadToolDetails: enriches the turn and commits once', async () => {
  const commits: ChatMessage[][] = [];
  const ok = await loadToolDetails({
    messageId: 'a-1',
    fetchRows: async () => rows,
    alive: () => true,
    get: () => [turn],
    commit: (n) => commits.push(n),
    signal: new AbortController().signal,
    sleep: noSleep,
  });
  assert.equal(ok, true);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0][0].tools[0].detail?.input, { command: 'date' });
});

test('H6: a detail response arriving after unmount / cancel never commits the retired hook\'s transcript', async () => {
  let alive = true;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const commits: ChatMessage[][] = [];
  const ctrl = new AbortController();
  const job = loadToolDetails({
    messageId: 'a-1',
    fetchRows: async () => {
      await gate;
      return rows;
    },
    alive: () => alive,
    get: () => [turn],
    commit: (n) => commits.push(n),
    signal: ctrl.signal,
    sleep: noSleep,
  });
  // chat closed while the request is in flight (same session id: the old session-only guard did not catch it)
  alive = false;
  ctrl.abort();
  release();
  assert.equal(await job, false);
  assert.equal(commits.length, 0);
});

test('H6: cancelled during the initial delay → no request at all', async () => {
  const ctrl = new AbortController();
  let fetched = 0;
  ctrl.abort();
  const ok = await loadToolDetails({
    messageId: 'a-1',
    fetchRows: async () => {
      fetched++;
      return rows;
    },
    alive: () => true,
    get: () => [turn],
    commit: () => assert.fail('must not commit'),
    signal: ctrl.signal,
  });
  assert.equal(ok, false);
  assert.equal(fetched, 0);
});

// ---- mid-turn web details (live Hermes 0.22 rows, read while the answer was still running)

const midRows = parseMessages({ data: HERMES_MIDTURN_ROWS }, 'live').messages;
const midTurn = (): ChatMessage => ({
  id: 'a-live',
  role: 'assistant',
  text: '',
  status: 'streaming',
  createdAt: 1,
  tools: [
    { id: 'toolu_test11', name: 'tool_describe', label: 'Reading tool details', status: 'done', startedAt: 2, endedAt: 3 },
    { id: 'toolu_test12', name: 'web_search_plus', label: 'python 3.14 free threading', status: 'done', startedAt: 4, endedAt: 5 },
    { id: 'toolu_test13', name: 'web_extract_plus', label: 'web_extract_plus', status: 'running', startedAt: 6 },
  ],
});

test('wantsLiveDetails: only a finished web tool whose result is not here yet', () => {
  const msg = midTurn();
  const ev = (callId: string, name: string, status: 'running' | 'done' | 'error') => ({ type: 'tool' as const, callId, name, status });
  assert.equal(wantsLiveDetails(ev('toolu_test12', 'web_search_plus', 'done'), msg), true);
  assert.equal(wantsLiveDetails(ev('toolu_test12', 'web_search_plus', 'error'), msg), true);
  assert.equal(wantsLiveDetails(ev('toolu_test13', 'web_extract_plus', 'running'), msg), false);
  assert.equal(wantsLiveDetails(ev('toolu_test11', 'tool_describe', 'done'), msg), false); // not a web tool: end of turn
  assert.equal(wantsLiveDetails(ev('toolu_other', 'web_search_plus', 'done'), msg), false); // not in this message
  assert.equal(wantsLiveDetails({ type: 'text', text: 'x' }, msg), false);
  const filled = { ...msg, tools: msg.tools.map((t) => (t.id === 'toolu_test12' ? { ...t, detail: { output: 'x' } } : t)) };
  assert.equal(wantsLiveDetails(ev('toolu_test12', 'web_search_plus', 'done'), filled), false);
});

test('mid-turn: the stored rows fill the finished web search while the answer still streams', async () => {
  let list = [midTurn()];
  const ok = await loadToolDetails({
    messageId: 'a-live',
    fetchRows: async () => midRows,
    alive: () => true,
    get: () => list,
    commit: (n) => (list = n),
    signal: new AbortController().signal,
    sleep: noSleep,
  });
  assert.equal(ok, true);
  const m = list[0];
  assert.equal(m.status, 'streaming');
  assert.equal(m.text, '');
  const search = m.tools.find((t) => t.id === 'toolu_test12')!;
  assert.deepEqual(search.detail?.input, { query: 'python 3.14 free threading', count: 3 });
  assert.equal(search.detail?.web?.provider, 'keenable');
  assert.deepEqual(search.detail?.web?.fallbackFrom, ['searxng']);
  assert.equal(search.detail?.links?.length, 3);
  // the extract is still running: its stored call has no result row yet, nothing is made up
  const extract = m.tools.find((t) => t.id === 'toolu_test13')!;
  assert.equal(extract.status, 'running');
  assert.equal(extract.detail?.output, undefined);
});

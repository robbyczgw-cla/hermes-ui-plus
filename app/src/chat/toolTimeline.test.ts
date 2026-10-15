/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalChoiceLabel,
  buildTimeline,
  cachePercent,
  footerParts,
  knownDuration,
  liveStatus,
  formatElapsed,
  formatTokens,
  modelDisplay,
  prettyJson,
  rowDetail,
  timelineDone,
  smartApproved,
  timelineHeader,
  truncateText,
} from './toolTimeline.ts';
import { applyEvent, createAssistantMessage } from '../hermes/chatState.ts';
import { mapRemoteMessages } from '../hermes/sessionMapping.ts';
import { approvalKey, resolveApproval } from '../hermes/approvals.ts';
import type { ChatMessage, HermesEvent } from '../hermes/types.ts';
import { makeT } from '../i18n/core.ts';

const de = { t: makeT('de', 'de-DE'), locale: 'de-DE' };
const en = { t: makeT('en', 'en-US'), locale: 'en-US' };

test('formatElapsed', () => {
  assert.equal(formatElapsed(0, 'de-DE'), '0 ms');
  assert.equal(formatElapsed(850, 'de-DE'), '850 ms');
  assert.equal(formatElapsed(1000, 'de-DE'), '1,0 s');
  assert.equal(formatElapsed(14_240, 'de-DE'), '14,2 s');
  assert.equal(formatElapsed(59_970, 'de-DE'), '1 min 0 s');
  assert.equal(formatElapsed(125_000, 'de-DE'), '2 min 5 s');
  assert.equal(formatElapsed(-5, 'de-DE'), '0 ms');
});

test('formatTokens', () => {
  assert.equal(formatTokens(950, 'de-DE'), '950');
  assert.equal(formatTokens(1234, 'de-DE'), '1,2k');
  assert.equal(formatTokens(18_734, 'de-DE'), '18,7k');
  assert.equal(formatTokens(99_990, 'de-DE'), '100k');
  assert.equal(formatTokens(187_400, 'de-DE'), '187k');
  assert.equal(formatTokens(1_234_567, 'de-DE'), '1,2 M');
});

test('cachePercent', () => {
  assert.equal(cachePercent(undefined), null);
  assert.equal(cachePercent({ inputTokens: 100 }), null);
  assert.equal(cachePercent({ inputTokens: 1000, cacheReadTokens: 17_000, cacheWriteTokens: 500 }), 92);
  assert.equal(cachePercent({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
});

test('truncateText / prettyJson / labels', () => {
  assert.deepEqual(truncateText('abcdef', 3), { text: 'abc', truncated: true, total: 6 });
  assert.deepEqual(truncateText('ab', 3), { text: 'ab', truncated: false, total: 2 });
  assert.equal(prettyJson({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(prettyJson('raw'), 'raw');
  assert.equal(approvalChoiceLabel('session', de.t), 'Für diesen Auftrag erlaubt');
  assert.equal(approvalChoiceLabel('weird', de.t), 'weird');
  assert.equal(modelDisplay('hermes-agent'), 'Hermes');
  assert.equal(modelDisplay('kimi-k2'), 'kimi-k2');
});

function hermesTurn(): ChatMessage {
  let m = createAssistantMessage(10_000);
  const evs: [HermesEvent, number][] = [
    [{ type: 'route', route: { format: 'chart', component: 'line', confidence: 0.93, reason: 'Zeitreihe gewünscht', model: 'jev-latest', ms: 412 } }, 10_400],
    [{ type: 'start', completionId: 'chatcmpl-1', model: 'hermes-agent' }, 10_500],
    [{ type: 'reasoning', text: 'Ich brauche die Uhrzeit.' }, 10_600],
    [{ type: 'tool', callId: 'c1', name: 'terminal', status: 'running', label: 'date', emoji: '💻', raw: { tool: 'terminal', status: 'running' } }, 11_000],
    [{ type: 'tool', callId: 'c2', name: 'web_search', status: 'running', label: 'Wetter Wien', emoji: '🔍' }, 11_100],
    [{ type: 'status', kind: 'lifecycle', text: 'Warte auf Provider (1/3)' }, 11_200],
    [{ type: 'tool', callId: 'c1', name: 'terminal', status: 'done' }, 11_900],
    [{ type: 'approval', approval: { runId: 'chatcmpl-1', command: 'rm -rf /tmp/x', description: 'recursive delete', choices: ['once', 'deny'], timestamp: 1 } }, 12_000],
  ];
  for (const [e, t] of evs) m = applyEvent(m, e, t);
  return m;
}

test('hermes timeline: rows in time order with states, durations, summaries', () => {
  const m = hermesTurn();
  const rows = buildTimeline(m, de.t, 12_500);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.title, r.state]),
    [
      ['route', 'UI-Router', 'info'],
      ['thinking', 'Gedankengang', 'done'],
      ['tool', 'Terminal', 'done'],
      ['tool', 'Websuche', 'running'],
      ['status', 'Status', 'info'],
      ['approval', 'Wartet auf Freigabe', 'waiting'],
    ]
  );
  // confidence + router model only in the detail sheet
  assert.equal(rows[0].summary, 'chart · line');
  assert.equal(rows[0].sub, 'Zeitreihe gewünscht');
  assert.equal(rows[0].durationMs, 412);
  assert.equal(rows[0].offsetMs, 400);
  assert.equal(rows[1].summary, 'Ich brauche die Uhrzeit.');
  assert.equal(rows[2].summary, 'date');
  assert.equal(rows[2].durationMs, 900);
  assert.equal(rows[3].durationMs, 1400); // live: now - startedAt
  assert.equal(rows[4].summary, 'Warte auf Provider (1/3)');
  assert.equal(rows[5].summary, 'rm -rf /tmp/x');
  assert.equal(timelineHeader(rows, de.t), '2 Werkzeuge · 4 Schritte');
});

test('hermes timeline after approval answer + finish; footer', () => {
  let m = hermesTurn();
  m = resolveApproval(m, approvalKey(m.approval!), 'deny', 13_000);
  m = applyEvent(m, { type: 'text', text: 'Abgelehnt.' }, 13_200);
  m = applyEvent(m, { type: 'finish', reason: 'stop', usage: { promptTokens: 21_524, completionTokens: 312, totalTokens: 21_836 } }, 14_200);
  const rows = buildTimeline(m, de.t, 99_999);
  const ap = rows.find((r) => r.kind === 'approval')!;
  assert.equal(ap.title, 'Freigabe angefragt');
  assert.equal(ap.durationMs, 1000);
  const ans = rows.find((r) => r.kind === 'approval_answer')!;
  assert.deepEqual([ans.title, ans.state, ans.icon], ['Freigabe: Abgelehnt', 'error', '⛔']);
  // running tools were closed by finish
  assert.equal(rows.filter((r) => r.state === 'running').length, 0);
  assert.deepEqual(footerParts(m, de), ['2 Werkzeuge', '4,2 s', '21,5k in / 312 out']);
  // not verbose: duration stays, no token counts
  assert.deepEqual(footerParts(m, de, { tokens: false }), ['2 Werkzeuge', '4,2 s']);

  const toolSheet = rowDetail(m, 'tool:c1', de)!;
  assert.equal(toolSheet.title, 'Terminal');
  assert.ok(toolSheet.note?.includes('nur Name'));
  assert.ok(toolSheet.meta.some((x) => x.label === 'ID' && x.value === 'c1'));
  assert.ok(toolSheet.sections.some((x) => x.title.startsWith('Rohdaten') && x.body.includes('"running"')));
  const routeSheet = rowDetail(m, `step:${m.trace!.find((s) => s.kind === 'route')!.id}`, de)!;
  assert.ok(routeSheet.meta.some((x) => x.label === 'Router' && x.value === 'jev-latest'));
  assert.ok(routeSheet.sections.some((x) => x.title === 'Begründung'));
  const turn = rowDetail(m, 'turn', de)!;
  assert.ok(turn.meta.some((x) => x.label === 'Erstes Token' && x.value === '3,2 s'));
  assert.ok(turn.meta.some((x) => x.label === 'Stop-Grund' && x.value === 'stop'));
});

test('persisted message without trace still shows the route decision; reasoning not stored', () => {
  const m: ChatMessage = {
    id: 'a',
    role: 'assistant',
    text: 'x',
    tools: [],
    status: 'done',
    createdAt: 0,
    route: { format: 'text', confidence: 0.6, reason: 'fast path: smalltalk', model: 'heuristic-v1', ms: 2 },
    trace: [{ id: 'thinking-0', kind: 'thinking', at: 5, endedAt: 50, data: { from: 0, to: 40 } }],
  };
  const rows = buildTimeline(m, de.t);
  assert.deepEqual(rows.map((r) => r.kind), ['route', 'thinking']);
  assert.equal(rows[1].summary, 'Text nicht gespeichert');
});



test('english locale: labels, number formats and plurals', () => {
  assert.equal(formatElapsed(14_240, 'en-US'), '14.2 s');
  assert.equal(formatTokens(1234, 'en-US'), '1.2k');
  const rows = buildTimeline(hermesTurn(), en.t, 12_500);
  assert.deepEqual(rows.map((r) => r.title), ['UI router', 'Reasoning', 'Terminal', 'Web search', 'Status', 'Waiting for approval']);
  assert.equal(timelineHeader(rows, en.t), '2 tools · 4 steps');
});

test('liveStatus: latest running step (tool with argument), else the last step', () => {
  const row = (key: string, kind: string, title: string, state: string, summary?: string) => ({ key, kind, title, state, summary, icon: '', offsetMs: 0 }) as never;
  assert.equal(liveStatus([]), null);
  assert.equal(liveStatus([row('a', 'route', 'Router', 'info'), row('b', 'tool', 'Websuche', 'running', 'wetter wien'), row('c', 'status', 'Status', 'info')]), 'Websuche · wetter wien');
  assert.equal(liveStatus([row('a', 'route', 'Router', 'info'), row('b', 'tool', 'Terminal', 'done')]), 'Terminal');
});

test('timelineDone: ✓ only for a finished turn without failed steps (never while interrupted)', () => {
  const ok = [{ state: 'done' }] as Parameters<typeof timelineDone>[1];
  const failed = [{ state: 'error' }] as Parameters<typeof timelineDone>[1];
  assert.equal(timelineDone({ status: 'done' }, ok), true);
  assert.equal(timelineDone({ status: 'done' }, failed), false);
  assert.equal(timelineDone({ status: 'streaming' }, ok), false);
  assert.equal(timelineDone({ status: 'stopped' }, ok), false); // interrupted / recovering / stopped
  assert.equal(timelineDone({ status: 'error' }, ok), false);
});

test('N7: a finished tool without a measured duration shows no time (not "0 ms")', () => {
  const m: ChatMessage = {
    id: 'a1',
    role: 'assistant',
    text: 'x',
    createdAt: 1000,
    status: 'done',
    tools: [
      { id: 't1', name: 'web_extract_plus', label: 'https://example.com', status: 'done', startedAt: 2000, endedAt: 2000 },
      { id: 't2', name: 'web_search', label: 'q', status: 'done', startedAt: 3000, endedAt: 3600 },
    ],
  } as ChatMessage;
  const rows = buildTimeline(m, de.t, 9000).filter((r) => r.kind === 'tool');
  assert.equal(rows[0].durationMs, undefined);
  assert.equal(rows[1].durationMs, 600);
});

test('smartApproved: Hermes guardian auto-approval in a terminal result', () => {
  assert.equal(smartApproved({ output: '', exit_code: 0, error: null, approval: 'Command was flagged (overwrite system file via tee) and auto-approved by smart approval.' }), true);
  assert.equal(smartApproved({ output: 'x', exit_code: 0, error: null }), false);
  assert.equal(smartApproved({ approval: 'approved by user' }), false);
  assert.equal(smartApproved('auto-approved by smart approval'), false);
  assert.equal(smartApproved(undefined), false);
});

test('server chat from another device: no "0 ms" in the footer, detail sheet or thinking row', () => {
  assert.equal(knownDuration(1000, undefined), undefined);
  assert.equal(knownDuration(1000, 1000), undefined);
  assert.equal(knownDuration(1000, 900), undefined);
  assert.equal(knownDuration(1000, 1850), 850);
  // one stored assistant row: createdAt = endedAt = its timestamp, the real duration is unknown
  const [, a] = mapRemoteMessages([
    { id: '1', role: 'user', content: 'Hallo', timestamp: 5000 },
    { id: '2', role: 'assistant', content: '<think>kurz</think>Hallo!', finishReason: 'stop', timestamp: 5000 },
  ]);
  assert.equal(a.metrics?.endedAt, a.createdAt);
  assert.deepEqual(footerParts(a, de), []);
  const sheet = rowDetail(a, 'turn', de)!;
  assert.ok(!sheet.meta.some((x) => /ms$/.test(x.value)), JSON.stringify(sheet.meta));
  const thinking = buildTimeline(a, de.t, 99_999).find((r) => r.kind === 'thinking');
  assert.ok(thinking);
  assert.equal(thinking.durationMs, undefined);
  // with tools the count stays, only the duration goes
  const withTool = { ...a, tools: [{ id: 'c1', name: 'web_search', status: 'done' as const, startedAt: 5000, endedAt: 5000 }] };
  assert.deepEqual(footerParts(withTool as typeof a, de), ['1 Werkzeug']);
});

/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createAssistantMessage, finalize } from './chatState.ts';
import { mapFrame } from './events.ts';
import {
  DETAIL_MAX_BYTES,
  SMALL_MAX_BYTES,
  TRACE_MAX,
  capPayload,
  compactDetails,
  pushTrace,
  sanitize,
  thinkingRange,
} from './trace.ts';
import type { ChatMessage, HermesEvent } from './types.ts';
import { approvalKey, resolveApproval } from './approvals.ts';

function run(evs: HermesEvent[], t0 = 1000): ChatMessage {
  let m: ChatMessage = createAssistantMessage(t0);
  let t = t0;
  for (const e of evs) m = applyEvent(m, e, (t += 100));
  return m;
}

const frame = (event: string, data: object) => mapFrame({ event, data: JSON.stringify(data) });

test('hermes: tool frames keep raw payloads, route/status/approval become trace steps', () => {
  const evs: HermesEvent[] = [
    ...frame('hermes.ui.route', { format: 'chart', component: 'line', confidence: 0.93, reason: 'Zeitreihe', model: 'jev-latest', ms: 412 }),
    ...frame('message', { id: 'chatcmpl-1', model: 'hermes-agent', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
    ...frame('message', { choices: [{ index: 0, delta: { reasoning_content: 'Ich ' }, finish_reason: null }] }),
    ...frame('message', { choices: [{ index: 0, delta: { reasoning_content: 'prüfe.' }, finish_reason: null }] }),
    ...frame('hermes.tool.progress', { tool: 'terminal', emoji: '💻', label: 'date', toolCallId: 'c1', status: 'running' }),
    ...frame('hermes.status', { kind: 'lifecycle', text: 'Warte auf Provider' }),
    ...frame('hermes.status', { kind: 'lifecycle', text: 'Warte auf Provider' }),
    ...frame('hermes.tool.progress', { tool: 'terminal', toolCallId: 'c1', status: 'completed' }),
    ...frame('approval.request', { command: 'rm -rf /tmp/x', description: 'delete', run_id: 'chatcmpl-1', request_id: 'r', choices: ['once', 'deny'] }),
  ];
  let m = run(evs);
  m = resolveApproval(m, approvalKey(m.approval!), 'once', 2000);
  m = applyEvent(m, { type: 'text', text: 'Fertig' }, 2100);
  m = applyEvent(m, { type: 'finish', reason: 'stop', usage: { promptTokens: 21500, completionTokens: 40, totalTokens: 21540 } }, 2200);

  assert.deepEqual(
    m.trace?.map((s) => s.kind),
    ['route', 'thinking', 'status', 'approval', 'approval_answer']
  );
  const thinking = m.trace?.find((s) => s.kind === 'thinking');
  assert.deepEqual(thinkingRange(thinking!), { from: 0, to: 'Ich prüfe.'.length });
  assert.equal(m.trace?.find((s) => s.kind === 'approval_answer')?.text, 'once');
  assert.equal(m.tools[0].raw?.length, 2);
  assert.deepEqual(m.tools[0].raw?.[1], { tool: 'terminal', toolCallId: 'c1', status: 'completed' });
  assert.equal(m.metrics?.model, 'hermes-agent');
  assert.equal(m.metrics?.requests, 1);
  assert.equal(m.metrics?.firstTokenAt, 2100);
  assert.equal(m.metrics?.endedAt, 2200);
  assert.equal(m.metrics?.inputTokens, 21500);
  assert.equal(m.metrics?.outputTokens, 40);
});

test('hermes: interleaved reasoning opens a new thinking step after other events', () => {
  const m = run([
    { type: 'reasoning', text: 'a' },
    { type: 'tool', callId: 'c', name: 'x', status: 'running' },
    { type: 'status', kind: 'k', text: 's' },
    { type: 'reasoning', text: 'bc' },
  ]);
  const steps = m.trace!.filter((s) => s.kind === 'thinking').map((s) => thinkingRange(s));
  assert.deepEqual(steps, [{ from: 0, to: 1 }, { from: 1, to: 3 }]);
});

test('finalize stamps endedAt once', () => {
  const m0 = run([{ type: 'text', text: 'x' }]);
  const m1 = finalize(m0, 'stopped', undefined, 5000);
  assert.equal(m1.metrics?.endedAt, 5000);
  assert.equal(finalize(m1, 'error', 'e', 6000).metrics?.endedAt, 5000);
});

test('sanitize drops encrypted blobs and shortens long data', () => {
  const out = sanitize({ encrypted_content: 'x'.repeat(50), title: 'T', source: { data: 'y'.repeat(500) }, n: [1, 2] }) as Record<string, unknown>;
  assert.equal(out.encrypted_content, '<50 Zeichen verschlüsselt>');
  assert.equal(out.title, 'T');
  assert.deepEqual(out.source, { data: '<500 Zeichen Daten>' });
  assert.deepEqual(out.n, [1, 2]);
  assert.match(sanitize('z'.repeat(3000)) as string, /… \(\+1000 Zeichen\)$/);
});

test('capPayload keeps small values and truncates big ones to a string', () => {
  assert.deepEqual(capPayload({ a: 1 }), { a: 1 });
  const big = capPayload({ s: 'q'.repeat(10_000) });
  assert.equal(typeof big, 'string');
  assert.ok((big as string).length < DETAIL_MAX_BYTES + 60);
  assert.match(big as string, /\[gekürzt, \d+ Zeichen\]$/);
});

test('compactDetails caps tool payloads, links and trace for storage', () => {
  const huge = 'w'.repeat(20_000);
  let m: ChatMessage = {
    id: 'a',
    role: 'assistant',
    text: 't',
    status: 'done',
    createdAt: 0,
    tools: [
      {
        id: 't1',
        name: 'web_search',
        label: 'q',
        status: 'done',
        startedAt: 0,
        endedAt: 1,
        raw: Array.from({ length: 10 }, () => ({ huge })),
        detail: {
          tool: 'web_search',
          input: { query: 'q' },
          output: { huge },
          links: Array.from({ length: 30 }, (_, i) => ({ title: 'T'.repeat(400), url: `https://e${i}.com` })),
        },
      },
      { id: 't2', name: 'terminal', label: 'date', status: 'done', startedAt: 0 },
    ],
  };
  for (let i = 0; i < TRACE_MAX + 5; i++) m = pushTrace(m, 'status', i, { text: huge, data: { huge } });
  const c = compactDetails(m);
  const t = c.tools[0];
  assert.deepEqual(t.detail?.input, { query: 'q' });
  assert.equal(typeof t.detail?.output, 'string');
  assert.equal(t.detail?.links?.length, 20);
  assert.ok((t.detail?.links?.[0].title.length ?? 0) <= 160);
  assert.equal(t.raw?.length, 6);
  assert.ok(t.raw!.every((r) => typeof r === 'string' && r.length < SMALL_MAX_BYTES + 60));
  assert.equal(c.tools[1], m.tools[1]);
  assert.equal(c.trace?.length, TRACE_MAX);
  assert.ok((c.trace?.[0].text?.length ?? 0) <= 500);
  assert.ok(JSON.stringify(c).length < 120_000, String(JSON.stringify(c).length));
  // untouched message without details is returned as-is
  const plain: ChatMessage = { id: 'p', role: 'user', text: 'x', tools: [], status: 'done', createdAt: 0 };
  assert.equal(compactDetails(plain), plain);
});

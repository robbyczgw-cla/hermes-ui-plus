/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages } from './sessions.ts';
import { argsPreview, contentText, createUserTurnMatcher, enrichTurn, mapRemoteMessages, mergeAssistantDetails, needsDetails, resultSummary, sameUserText, sameUserTurn, splitThink, userTextCore } from './sessionMapping.ts';
import type { ChatMessage } from './types';
import { isFinalAnswer } from './recovery.ts';
import { MESSAGES_FIXTURE } from './sessions.fixtures.ts';

const rows = parseMessages(MESSAGES_FIXTURE, 'x').messages;
const CALL = 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0';

test('mapRemoteMessages: user/assistant turns, tool rows folded into the assistant message', () => {
  const m = mapRemoteMessages(rows);
  assert.deepEqual(
    m.map((x) => [x.role, x.id]),
    [
      ['user', 'hu-339193'],
      ['assistant', 'ha-339194'],
      ['user', 'hu-339195'],
      ['assistant', 'ha-339196'],
    ]
  );
  const a = m[3];
  assert.equal(a.text, 'Ich hole die aktuelle Uhrzeit direkt vom System.\n\nSamstag, 10. Oktober 2026, 21:05 Uhr.');
  assert.equal(a.status, 'done');
  assert.equal(a.finishReason, 'stop');
  assert.equal(a.tools.length, 1);
  const t = a.tools[0];
  assert.equal(t.id, CALL);
  assert.equal(t.name, 'terminal');
  assert.equal(t.label, 'date');
  assert.equal(t.status, 'done');
  assert.deepEqual(t.detail?.input, { command: 'date' });
  assert.deepEqual(t.detail?.output, { output: 'Sat Oct 10 19:05:54 UTC 2026', exit_code: 0, error: null });
  assert.equal(t.detail?.summary, 'Exit 0');
  assert.equal(t.startedAt, 1791659154128);
  assert.equal(t.endedAt, 1791659154190);
  assert.equal(a.reasoning, 'Der Nutzer fragt nach der aktuellen Uhrzeit.');
  assert.equal(a.trace?.[0].kind, 'thinking');
  assert.deepEqual(a.trace?.[0].data, { from: 0, to: a.reasoning!.length });
  assert.equal(m[0].createdAt, 1791659146217);
});

test('mapRemoteMessages skips hidden/system rows, _tools; failing tool → error; caps big results', () => {
  const big = 'x'.repeat(20000);
  const m = mapRemoteMessages(
    parseMessages(
      {
        data: [
          { id: 1, role: 'system', content: 'sys' },
          { id: 2, role: 'user', content: [{ type: 'text', text: 'Bild?' }, { type: 'image_url', image_url: { url: 'data:…' } }] },
          { id: 3, role: 'assistant', content: '', display_kind: 'hidden' },
          {
            id: 4,
            role: 'assistant',
            content: '<think>hmm</think>Antwort',
            tool_calls: [
              { id: 'a', function: { name: '_internal', arguments: '{}' } },
              { id: 'b', function: { name: 'terminal', arguments: '{"command":"false"}' } },
              { id: 'c', function: { name: 'read_file', arguments: '{"path":"/tmp/big"}' } },
            ],
          },
          { id: 5, role: 'tool', tool_call_id: 'b', content: '{"output":"","exit_code":1,"error":"boom\\nmore"}' },
          { id: 6, role: 'tool', tool_call_id: 'c', content: big },
        ],
      },
      'x'
    ).messages
  );
  assert.equal(m.length, 2);
  assert.equal(m[0].text, 'Bild?\n[Bild]');
  assert.equal(m[1].text, 'Antwort');
  assert.equal(m[1].reasoning, 'hmm');
  assert.deepEqual(m[1].tools.map((t) => t.id), ['b', 'c']);
  assert.equal(m[1].tools[0].status, 'error');
  assert.equal(m[1].tools[0].detail?.summary, 'boom');
  assert.ok(JSON.stringify(m[1].tools[1].detail?.output).length < 4200);
  assert.equal(m[1].tools[1].label, '/tmp/big');
});

test('helpers', () => {
  assert.equal(contentText(null), '');
  assert.deepEqual(splitThink('a <think>b</think> c'), { text: 'a  c', reasoning: 'b' });
  assert.equal(argsPreview('web_search', { query: 'wetter wien' }), 'wetter wien');
  assert.equal(argsPreview('x', {}), 'x');
  assert.deepEqual(resultSummary({ success: false }), { summary: 'Fehlgeschlagen', failed: true });
  assert.deepEqual(resultSummary('Error: nope'), { summary: 'Error: nope', failed: true });
  assert.deepEqual(resultSummary('fine'), { failed: false });
});

function liveTurn(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a-1',
    role: 'assistant',
    text: 'Ich hole die aktuelle Uhrzeit direkt vom System.Samstag…',
    tools: [{ id: CALL, name: 'terminal', label: 'date', status: 'done', startedAt: 10, endedAt: 20, emoji: '💻', raw: [{ status: 'running' }] }],
    status: 'done',
    createdAt: 5,
    ...over,
  };
}

test('enrichTurn matches by tool call id and keeps live fields', () => {
  const live = liveTurn();
  assert.equal(needsDetails(live), true);
  const e = enrichTurn(live, rows, 'irrelevant');
  assert.notEqual(e, live);
  assert.equal(e.text, live.text);
  assert.equal(e.tools[0].emoji, '💻');
  assert.deepEqual(e.tools[0].raw, [{ status: 'running' }]);
  assert.equal(e.tools[0].startedAt, 10);
  assert.deepEqual(e.tools[0].detail?.input, { command: 'date' });
  assert.equal(e.tools[0].detail?.summary, 'Exit 0');
  assert.equal(e.reasoning, 'Der Nutzer fragt nach der aktuellen Uhrzeit.');
  assert.equal(e.trace?.at(-1)?.kind, 'thinking');
  assert.equal(needsDetails(e), false);
  // idempotent
  assert.equal(enrichTurn(e, rows, 'irrelevant'), e);
});

test('enrichTurn falls back to name/order and to the user text; unchanged when nothing matches', () => {
  const other = liveTurn({ tools: [{ id: 'local-id', name: 'terminal', label: 'terminal', status: 'done', startedAt: 1 }] });
  const e = enrichTurn(other, rows, 'Wie spät ist es? Nutze ein Tool falls nötig');
  assert.equal(e.tools.length, 1);
  assert.equal(e.tools[0].id, 'local-id');
  assert.deepEqual(e.tools[0].detail?.input, { command: 'date' });
  assert.equal(e.tools[0].label, 'date');

  // tool progress disabled: no live tools → stored calls appended when the user text matches
  const none = liveTurn({ tools: [] });
  assert.equal(enrichTurn(none, rows, 'wie spät ist es?  nutze ein tool falls nötig').tools.length, 1);
  assert.equal(enrichTurn(none, rows, 'etwas anderes'), none);
  assert.equal(enrichTurn(other, rows, 'etwas anderes'), other);
  assert.equal(enrichTurn(other, [], 'x'), other);
});

test('mergeAssistantDetails keeps existing local details', () => {
  const remote = mapRemoteMessages(rows)[3];
  const local = liveTurn({ tools: [{ ...liveTurn().tools[0], detail: { input: { command: 'mine' }, output: 'o' } }], reasoning: 'own' });
  assert.equal(mergeAssistantDetails(local, remote), local);
});

test('userTextCore / sameUserTurn ignore attachment parts and markers', () => {
  assert.deepEqual(userTextCore('Was ist das?\n[Bild]'), { core: 'Was ist das?', attachments: true });
  assert.deepEqual(userTextCore('[2 Bilder]\n[Datei]'), { core: '', attachments: true });
  assert.deepEqual(userTextCore('Hi\n[Datei angehängt: a.pdf (application/pdf, 1 KB) – Pfad auf dem Server: /x]'), { core: 'Hi', attachments: true });
  assert.deepEqual(userTextCore('nur Text'), { core: 'nur Text', attachments: false });
  assert.equal(sameUserText('Was ist das?', 'Was ist das?\n[Bild]'), true);
  assert.equal(sameUserText('', '[Bild]'), false);
  assert.equal(sameUserTurn({ text: '', attachments: [{ id: 'x', kind: 'image', name: 'a', mimeType: 'image/jpeg', size: 1, uri: 'file:///a', status: 'ready' }] }, '[Bild]'), true);
  assert.equal(sameUserTurn({ text: '' }, '[Bild]'), false);
  assert.equal(sameUserTurn({ text: 'ok' }, 'okay'), false);
});

test('cached turn matching keeps attachment presence per message and handles changed text', () => {
  const match = createUserTurnMatcher();
  const attachment: NonNullable<ChatMessage['attachments']>[number] = {
    id: 'test-image', kind: 'image', name: 'test.jpg', mimeType: 'image/jpeg', size: 1,
    uri: 'file:///test.jpg', status: 'ready',
  };
  // Identical text is cached, but attachment presence belongs to the current message.
  assert.equal(match({ text: '' }, '[Bild]'), false);
  assert.equal(match({ text: '', attachments: [attachment] }, '[Bild]'), true);
  assert.equal(match({ text: '' }, '[Bild]'), false);
  const local = { text: 'A sufficiently long question about a chart' };
  assert.equal(match(local, '  A sufficiently LONG question about a chart\n[Bild]'), true);
  // a longer follow-up is a different turn (see 'user turn matching does not equate a prompt with a longer follow-up')
  assert.equal(match(local, 'A sufficiently long question about a chart with extra detail'), false);
  local.text = 'Another question';
  assert.equal(match(local, 'A sufficiently long question about a chart'), false);
  assert.equal(match(local, 'Another\n question'), true);
  assert.equal(match({ text: 'ok' }, 'okay'), false);
});

test('user turn matching does not equate a prompt with a longer follow-up', () => {
  const first = 'Please summarize the attached report';
  assert.equal(sameUserTurn({ text: first }, first + ' in Spanish'), false);
  assert.equal(sameUserText(first + ' in Spanish', first), false);
});

test('stored failed answers retain their error state, including empty failures', () => {
  for (const content of ['Partial answer', '']) {
    const mapped = mapRemoteMessages([{ id: 'test-failed', role: 'assistant', content, finishReason: 'error', timestamp: 1000 }]);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].status, 'error');
    assert.equal(isFinalAnswer(mapped[0]), false, 'a partial failure is not a recovered success');
    assert.equal(mapped[0].errorText?.key, 'backends.hermes.errors.agentFailed');
    assert.equal(mapped[0].text, content);
  }
});

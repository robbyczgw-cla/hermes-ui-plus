/// <reference types="node" />
/**
 * Regression (real device): the first paragraph of a finished Hermes answer was invisible – an empty gap of
 * its height between the tool timeline and the second block. Root cause was the FadeIn entrance of the
 * markdown block (ui/lib/fadeIn.ts). This test pins down that the data path is NOT involved: a long
 * reasoning phase, 13 tool calls and the first paragraph arriving in the same delta as the last reasoning
 * chunk keep the first paragraph in the message text, in the shown answer (no progress-note split), in the
 * first segment and in the first markdown block – at every streaming step and after `finish`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChatCore } from '../hermes/stream.ts';
import { applyEvent, createAssistantMessage } from '../hermes/chatState.ts';
import { splitProgressNotes } from '../hermes/progressNotes.ts';
import { createStreamParser } from '../protocol/streamParser.ts';
import { parseMarkdownIncremental, type MdParseState } from './markdown.ts';
import type { ChatMessage, HermesConn, HermesEvent } from '../hermes/types';
import type { Segment } from '../protocol/types';

const conn: HermesConn = { baseUrl: 'http://h.test:8645/v1/', apiKey: 'test-key-000', sessionKey: 'hermes-ui-test' };

const FIRST = 'Morgen, Dienstag 13. Oktober, ist in Example City vor allem Klassik und ein paar kleinere Abende. Quelle: Kulturserver plus Spielplan Schauspielhaus.';
const REST =
  '\n\n**Abends**\n- **19:30** Mozartfest – Kammerkonzert im Stefaniensaal\n- **20:00** Schauspielhaus – „Der Sturm“ (Restkarten)\n' +
  '- **20:15** Jazzkeller – Trio-Abend\n\n**Tipp**\nWer früh dran ist: die Generalprobe im Opernhaus ist öffentlich.\n\nQuellen: Kulturserver, Spielplan Schauspielhaus.';
const FINAL = FIRST + REST;

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', model: 'hermes-agent', choices: [{ index: 0, delta, ...extra }] })}\n\n`;
const named = (event: string, data: Record<string, unknown>) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** split `s` into pieces of the given sizes (cycled) */
function pieces(s: string, sizes: number[]): string[] {
  const out: string[] = [];
  for (let pos = 0, i = 0; pos < s.length; i++) {
    const n = sizes[i % sizes.length];
    out.push(s.slice(pos, pos + n));
    pos += n;
  }
  return out;
}

/** long reasoning, 13 tool rounds with status lines, then the answer; `firstSizes` splits the first paragraph */
function turnSse(firstSizes: number[]): string {
  let sse = chunk({ role: 'assistant', content: '' });
  const thought = 'Ich prüfe die Veranstaltungskalender und vergleiche die Spielpläne für morgen Abend. ';
  for (let i = 0; i < 300; i++) sse += chunk({ reasoning_content: thought });
  for (let n = 1; n <= 13; n++) {
    sse += named('hermes.status', { kind: 'status', text: `Schritt ${n}` });
    sse += named('hermes.tool.progress', { tool: n % 3 ? 'web_search' : 'web_extract', toolCallId: `call_${n}`, status: 'running', label: `Suche ${n}` });
    for (let i = 0; i < 20; i++) sse += chunk({ reasoning_content: thought });
    sse += named('hermes.tool.progress', { tool: n % 3 ? 'web_search' : 'web_extract', toolCallId: `call_${n}`, status: 'completed', label: `Suche ${n}` });
  }
  for (let i = 0; i < 200; i++) sse += chunk({ reasoning_content: thought });
  const first = pieces(FIRST, firstSizes);
  // the first content piece rides in the same delta as the last reasoning chunk
  sse += chunk({ reasoning_content: 'Fertig.', content: first[0] });
  for (const p of first.slice(1)) sse += chunk({ content: p });
  for (const p of pieces(REST, [7, 40, 3, 120])) sse += chunk({ content: p });
  sse += chunk({}, { finish_reason: 'stop' });
  sse += 'data: [DONE]\n\n';
  return sse;
}

function sseResponse(text: string, sizes: number[]): Response {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pos >= bytes.length) return c.close();
      const n = sizes[i++ % sizes.length];
      c.enqueue(bytes.slice(pos, pos + n));
      pos += n;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-hermes-session-id': 'sess-test' } });
}

/** what MessageItem derives per streaming update (notes split → segments → markdown blocks of the first segment) */
function makeView() {
  let parser = createStreamParser();
  let fed = '';
  let segs: Segment[] = [];
  let md: MdParseState | null = null;
  return (msg: ChatMessage) => {
    const shown = splitProgressNotes(msg).answer;
    if (!shown.startsWith(fed)) {
      parser = createStreamParser();
      fed = '';
    }
    if (shown.length > fed.length) {
      segs = parser.push(shown.slice(fed.length));
      fed = shown;
    }
    if (msg.status !== 'streaming') segs = parser.end();
    const first = segs.find((s) => s.kind === 'markdown');
    if (first && first.kind === 'markdown') md = parseMarkdownIncremental(first.text, md);
    return { shown, segs, blocks: md?.blocks ?? [] };
  };
}

for (const [name, firstSizes, netSizes] of [
  ['first paragraph in one delta, odd network chunks', [FIRST.length], [1, 7, 333, 4096]],
  ['first paragraph in many small deltas', [1, 2, 5, 9, 30], [64 * 1024]],
  ['first paragraph split mid-word, tiny network chunks', [13, 1, 50], [3, 1, 2]],
] as const) {
  test(`first answer paragraph survives reasoning + 13 tools + finish (${name})`, async () => {
    let msg = createAssistantMessage(1_000);
    let now = 1_000;
    const view = makeView();
    let sawText = false;
    const events: HermesEvent[] = [];
    await streamChatCore(async () => sseResponse(turnSse([...firstSizes]), [...netSizes]), {
      conn,
      text: 'Was ist morgen los?',
      sessionId: 'hui-test',
      onEvent: (e) => {
        events.push(e);
        msg = applyEvent(msg, e, (now += 5));
        const v = view(msg);
        if (msg.text) {
          sawText = true;
          // at every step: the shown answer, its first segment and first block start with the first paragraph
          assert.equal(v.shown, msg.text);
          const src = v.blocks[0]?.src.trim() ?? '';
          assert.ok(src.length > 0 && FIRST.startsWith(src), `first block lost: ${JSON.stringify(src.slice(0, 40))}`);
        }
      },
    });
    assert.ok(sawText);
    assert.equal(events.filter((e) => e.type === 'tool').length, 26);
    assert.equal(msg.status, 'done');
    assert.equal(msg.text, FINAL, 'no delta dropped (sse frame cap / appendCapped / reasoning+content in one delta)');
    assert.ok((msg.reasoning ?? '').length > 30_000);
    assert.equal(msg.tools.length, 13);
    // tools ran before any answer text → no interim notes, the whole text is the answer
    assert.ok(msg.tools.every((t) => t.textAt === 0));
    const split = splitProgressNotes(msg);
    assert.equal(split.notes.length, 0);
    assert.equal(split.answer, FINAL);
    const v = view(msg);
    assert.equal(v.segs.length, 1);
    assert.equal(v.segs[0].kind, 'markdown');
    assert.ok(v.blocks.length >= 3);
    assert.equal(v.blocks[0].type, 'paragraph');
    assert.equal(v.blocks[0].src.trim(), FIRST);
    assert.ok(v.blocks.slice(1).some((b) => b.src.includes('**Abends**')));
  });
}

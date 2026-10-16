/// <reference types="node" />
/**
 * Live resume end to end (E2E round 13 O1): the REAL useHermesChat hook + the real streaming core against a fake UI
 * bridge that records keyed turns like bridge/src/replay.mjs (Idempotency-Key, X-Hermes-UI-Resume-Offset, 409 codes).
 * React is a single-render stub whose effects run after "mount" (and are cleaned up at the end); the device modules are
 * stubbed like in useHermesChat.hook.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isHermesError, streamChatCore, type FetchLike, type StreamChatParams } from './stream.ts';
import { applyEvent, createAssistantMessage, createUserMessage } from './chatState.ts';
import { createSseParser } from './sse.ts';
import { mapFrame } from './events.ts';
import { stripMessage } from '../conversations/messages.ts';
import { isLive, type RunStatus } from './approvals.ts';
import type { ChatMessage, HermesConn } from './types';
import type { UseHermesChat, UseHermesChatOptions } from './useHermesChat';

const HOOK = fileURLToPath(new URL('./useHermesChat.ts', import.meta.url));
const enc = new TextEncoder();

// ---------------------------------------------------------------- one recorded turn (SSE bytes)

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-test-0001', object: 'chat.completion.chunk', model: 'hermes-agent', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;

const WORDS = Array.from({ length: 60 }, (_, i) => `Satz ${i + 1} über die Geschichte der Eisenbahn. `);
const TURN = enc.encode(
  [
    chunk({ role: 'assistant' }),
    chunk({ content: 'Entwurf…' }),
    `event: hermes.text.replace\ndata: ${JSON.stringify({ text: '# Eisenbahn\n\n' })}\n\n`,
    ...WORDS.map((w) => chunk({ content: w })),
    chunk({}, 'stop', { usage: { prompt_tokens: 21500, completion_tokens: 900, total_tokens: 22400 } }),
    'data: [DONE]\n\n',
  ].join(''),
);
const FINAL_TEXT = '# Eisenbahn\n\n' + WORDS.join('');

/** the answer as the app had it after `n` bytes (what a killed app persisted, in its stored form) */
function partialAfter(n: number, sendKey: string): ChatMessage {
  const parser = createSseParser();
  let m: ChatMessage = { ...createAssistantMessage(Date.now()), sendKey, resumable: true };
  for (const frame of parser.push(new TextDecoder().decode(TURN.slice(0, n)))) for (const ev of mapFrame(frame)) m = applyEvent(m, ev, Date.now());
  return stripMessage(m); // streaming → stopped without metrics.endedAt (resumeCutOff turns it into a recovering one)
}

// ---------------------------------------------------------------- fake UI bridge

type Rec = { avail: number; ended: boolean; unrecorded?: boolean; waiters: Set<() => void> };

function createFakeBridge(opts: { resume?: boolean } = {}) {
  const resume = opts.resume !== false;
  const recs = new Map<string, Rec>();
  const calls: { key?: string; offset?: string; messages: number }[] = [];
  /** `initial`: bytes a new turn has produced by the time its response starts */
  const state = { offline: false, started: 0, dropAt: null as number | null, offlineOnDrop: false, initial: 0 };
  const json = (status: number, code: string) =>
    new Response(JSON.stringify({ error: { message: code, code } }), { status, headers: { 'content-type': 'application/json' } });

  const stream = (rec: Rec, from: number, resumed?: number) => {
    let pos = from;
    let wake: (() => void) | null = null;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        for (;;) {
          if (state.dropAt !== null && pos >= state.dropAt) {
            state.dropAt = null;
            if (state.offlineOnDrop) state.offline = true;
            return c.error(new TypeError('Software caused connection abort'));
          }
          if (pos < rec.avail) {
            const end = Math.min(rec.avail, pos + 97, state.dropAt ?? Infinity);
            c.enqueue(TURN.slice(pos, end));
            pos = end;
            return;
          }
          if (rec.ended) return c.close();
          await new Promise<void>((r) => {
            wake = r;
            rec.waiters.add(r);
          });
        }
      },
      cancel() {
        if (wake) rec.waiters.delete(wake);
      },
    });
    const headers: Record<string, string> = { 'content-type': 'text/event-stream', 'x-hermes-session-id': 'hui-test' };
    if (resume) headers['x-hermes-ui-resume'] = '1';
    if (resumed !== undefined) headers['x-hermes-ui-resumed'] = String(resumed);
    return new Response(body, { status: 200, headers });
  };

  const fetch: FetchLike = async (_url, init) => {
    const key = init.headers['Idempotency-Key'];
    const offset = init.headers['X-Hermes-UI-Resume-Offset'];
    calls.push({ key, offset, messages: (JSON.parse(init.body ?? '{}').messages ?? []).length });
    if (state.offline) throw new TypeError('Network request failed');
    if (resume && key && offset !== undefined) {
      const rec = recs.get(key);
      if (!rec) return json(409, 'resume_unavailable') as never;
      if (rec.unrecorded) return json(409, 'turn_unrecorded') as never;
      if (Number(offset) > rec.avail) return json(409, 'resume_unavailable') as never;
      return stream(rec, Number(offset), Number(offset)) as never;
    }
    if (resume && key && recs.has(key)) return stream(recs.get(key)!, 0, 0) as never; // same key: no second turn
    state.started++;
    const rec: Rec = { avail: state.initial, ended: false, waiters: new Set() };
    if (key && resume) recs.set(key, rec);
    current = rec;
    return stream(rec, 0) as never;
  };

  let current: Rec | null = null;
  const bump = (rec: Rec) => {
    for (const w of [...rec.waiters]) w();
    rec.waiters.clear();
  };
  return {
    fetch,
    calls,
    state,
    /** a turn the bridge already runs (started before the app restart) with `avail` bytes so far */
    seed(key: string, avail: number, more: Partial<Rec> = {}) {
      const rec: Rec = { avail, ended: false, waiters: new Set(), ...more };
      recs.set(key, rec);
      current = rec;
    },
    /** the running turn produces bytes up to `n` (or all of them) */
    produce(n = TURN.length) {
      if (!current) return;
      current.avail = Math.min(TURN.length, Math.max(current.avail, n));
      bump(current);
    },
    end() {
      if (!current) return;
      current.avail = TURN.length;
      current.ended = true;
      bump(current);
    },
  };
}

// ---------------------------------------------------------------- hook harness

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function until(cond: () => boolean, what: string, ms = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

type Harness = {
  chat: UseHermesChat;
  messages: () => ChatMessage[];
  /** every transcript the hook rendered */
  renders: ChatMessage[][];
  statuses: string[];
  sessionFetches: number;
  foreground(): void;
  unmount(): void;
};

async function mountHook(
  conn: HermesConn,
  options: UseHermesChatOptions,
  deps: { fetch: FetchLike; storedSession?: () => unknown[]; runStatus?: (id: string) => RunStatus },
): Promise<Harness> {
  const cells: unknown[] = [];
  const renders: ChatMessage[][] = [];
  const statuses: string[] = [];
  const effects: (() => void | (() => void))[] = [];
  const cleanups: (() => void)[] = [];
  const appState = new Set<(s: string) => void>();
  let n = 0;
  let sessionFetches = 0;
  const react = {
    useRef: <T>(v: T) => ({ current: v }),
    useMemo: <T>(f: () => T) => f(),
    useCallback: <T>(f: T) => f,
    useEffect: (f: () => void | (() => void)) => void effects.push(f),
    useState: <T>(initial: T | (() => T)) => {
      const i = n++;
      cells[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const set = (v: T | ((p: T) => T)) => {
        cells[i] = typeof v === 'function' ? (v as (p: T) => T)(cells[i] as T) : v;
        if (i === 0) renders.push(cells[0] as ChatMessage[]);
        if (i === 1) statuses.push(cells[1] as string);
      };
      return [cells[i], set];
    },
  };
  const stubs: Record<string, Record<string, unknown>> = {
    react,
    'react-native': {
      AppState: {
        addEventListener: (_: string, fn: (s: string) => void) => {
          appState.add(fn);
          return { remove: () => appState.delete(fn) };
        },
      },
    },
    '../attachments/encodeHermes': { buildHermesContent: async (t: string) => t },
    '../attachments/store': { deleteAttachmentFiles: async () => {}, fileReader: {} },
    '../attachments/draft': { needsUpload: () => false, toSent: (a: unknown) => a },
    '../attachments/pendingUploads': { createPendingUploads: () => ({}), startUploadTask: () => {} },
    '../attachments/queuedFiles': { queuedFiles: { restore: async () => [], drop: async () => {}, stash: async () => {} } },
    '../attachments/upload': { uploadAttachment: async () => {} },
    '../attachments/types': { AttachmentError: class extends Error {} },
    './client': {
      isHermesError,
      // the real core against the fake bridge; short resume pauses so the test does not wait seconds
      streamChat: (p: StreamChatParams) => streamChatCore(deps.fetch, { ...p, resumeDelaysMs: [5, 10, 20] }),
      hermesSessions: () => ({
        messages: async () => {
          sessionFetches++;
          return { messages: deps.storedSession?.() ?? [] };
        },
      }),
      stopBridgeTurn: async () => {},
      fetchRunStatus: async (_c: unknown, id: string) => deps.runStatus?.(id) ?? { status: 'running' },
      answerApproval: async () => {},
    },
  };

  const js = ts.transpileModule(fs.readFileSync(HOOK, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const ast = ts.createSourceFile(HOOK, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names: string[] = [];
  const values: unknown[] = [];
  const cuts: [number, number][] = [];
  for (const s of ast.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    const mod: Record<string, unknown> =
      stubs[spec] ?? (await import(pathToFileURL(path.resolve(path.dirname(HOOK), spec.endsWith('.ts') ? spec : spec + '.ts')).href));
    const bindings = s.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        names.push(el.name.text);
        values.push(mod[(el.propertyName ?? el.name).text]);
      }
    }
    cuts.push([s.pos, s.end]);
  }
  let body = js;
  for (const [a, b] of cuts.reverse()) body = body.slice(0, a) + body.slice(b);
  body = body.replace(/^export /gm, '');
  const useHermesChat = new Function(...names, body + '\nreturn useHermesChat;')(...values) as (c: unknown, o: UseHermesChatOptions) => UseHermesChat;

  const chat = useHermesChat(conn, options);
  for (const f of effects) {
    const c = f();
    if (typeof c === 'function') cleanups.push(c);
  }
  return {
    chat,
    messages: () => cells[0] as ChatMessage[],
    renders,
    statuses,
    get sessionFetches() {
      return sessionFetches;
    },
    foreground: () => {
      for (const fn of [...appState]) fn('active');
    },
    unmount: () => {
      for (const c of cleanups.reverse()) c();
    },
  };
}

const BRIDGE: HermesConn = { baseUrl: 'https://example.com/v1', apiKey: 'dummy_test_token', bridge: true };
const last = (h: Harness) => h.messages()[h.messages().length - 1];
const doneAnswer = (h: Harness) => last(h)?.role === 'assistant' && last(h).status === 'done';

/** every rendered answer text extends the previous one and is a prefix of the final text: nothing doubled, nothing lost */
function assertMonotonic(h: Harness, from: string) {
  let prev = from;
  for (const list of h.renders) {
    const a = list[list.length - 1];
    if (a?.role !== 'assistant' || !a.text || a.text === 'Entwurf…') continue; // the draft before the text.replace
    assert.ok(FINAL_TEXT.startsWith(a.text), `rendered text is a prefix of the answer: …${a.text.slice(-40)}`);
    assert.ok(a.text.length >= prev.length, `never shorter than before (${a.text.length} < ${prev.length})`);
    prev = a.text;
  }
}

// ---------------------------------------------------------------- tests

test('O1: drop mid-stream (airplane mode) → the answer resumes live at its byte offset, no recovery', async () => {
  const bridge = createFakeBridge();
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test' }, { fetch: bridge.fetch });
  try {
    bridge.state.dropAt = 900;
    bridge.state.offlineOnDrop = true;
    bridge.state.initial = 1500;
    assert.equal(h.chat.send('Erzähl mir von der Eisenbahn'), true);
    await until(() => last(h)?.reconnecting !== undefined, 'the "reconnecting" note');
    const cut = last(h);
    assert.equal(cut.status, 'streaming', 'still the running turn, not "loading the answer"');
    assert.equal(cut.interrupted, undefined);
    await new Promise((r) => setTimeout(r, 60)); // a few offline attempts
    const offlineCalls = bridge.calls.length;
    assert.ok(offlineCalls > 2, 'it kept trying while offline');
    bridge.state.offline = false;
    await until(() => last(h)?.reconnecting === undefined && last(h).text.length > cut.text.length, 'streaming again');
    bridge.end();
    await until(() => doneAnswer(h), 'the finished answer');
    const a = last(h);
    assert.equal(a.text, FINAL_TEXT, 'exactly the answer: nothing doubled or missing');
    assert.equal(a.recoveredAt, undefined, 'no "loaded later"');
    assert.equal(a.metrics?.inputTokens, 21500, 'usage from the stream');
    assert.equal(bridge.state.started, 1, 'one Hermes turn');
    const resumes = bridge.calls.filter((c) => c.offset !== undefined);
    assert.ok(resumes.every((c) => c.offset === '900' && c.messages === 0), 'every re-attach at the byte the app had, without the message');
    assert.equal(h.sessionFetches, 0, 'no stored-session polling');
    assertMonotonic(h, '');
  } finally {
    h.unmount();
  }
});

test('O1: app restart with a persisted unfinished answer → re-attached live, replayed without flicker or duplicates', async () => {
  const key = 'turn-test-restart';
  const bridge = createFakeBridge();
  const partial = partialAfter(1200, key);
  bridge.seed(key, 1700); // the bridge kept the turn running while the app was gone
  const user = createUserMessage('Erzähl mir von der Eisenbahn', Date.now() - 20_000);
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, { fetch: bridge.fetch });
  try {
    await until(() => last(h).status === 'streaming', 'streaming again after the restart');
    assert.equal(last(h).interrupted, undefined);
    await until(() => last(h).text.length > partial.text.length, 'the replay took over the bubble');
    bridge.end();
    await until(() => doneAnswer(h), 'the finished answer');
    const a = last(h);
    assert.equal(a.id, partial.id, 'the same message');
    assert.equal(a.text, FINAL_TEXT);
    assert.equal(a.recoveredAt, undefined, 'live, not "loaded later"');
    assert.equal(a.metrics?.outputTokens, 900);
    assert.equal(bridge.state.started, 0, 'no new Hermes turn');
    assert.deepEqual(bridge.calls.map((c) => [c.key, c.offset, c.messages]), [[key, '0', 0]]);
    assert.equal(h.sessionFetches, 0);
    assertMonotonic(h, partial.text);
  } finally {
    h.unmount();
  }
});

test('O1: turn already ended while the app was gone → replayed from the recording, done with usage', async () => {
  const key = 'turn-test-ended';
  const bridge = createFakeBridge();
  const partial = partialAfter(800, key);
  bridge.seed(key, TURN.length, { ended: true });
  const user = createUserMessage('Erzähl mir von der Eisenbahn', Date.now() - 60_000);
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, { fetch: bridge.fetch });
  try {
    await until(() => doneAnswer(h), 'the replayed answer');
    const a = last(h);
    assert.equal(a.text, FINAL_TEXT);
    assert.equal(a.recoveredAt, undefined);
    assert.equal(a.metrics?.inputTokens, 21500);
    assert.equal(a.finishReason, 'stop');
    assert.equal(h.sessionFetches, 0);
    assertMonotonic(h, partial.text);
  } finally {
    h.unmount();
  }
});

test('O1: recording dropped (409 turn_unrecorded) → the stored-session recovery, token counts from the run status', async () => {
  const key = 'turn-test-unrecorded';
  const bridge = createFakeBridge();
  const partial = { ...partialAfter(800, key), completionId: 'chatcmpl-test-0001' };
  bridge.seed(key, TURN.length, { ended: true, unrecorded: true });
  const userAt = Date.now() - 60_000;
  const user = createUserMessage('Erzähl mir von der Eisenbahn', userAt);
  const stored = () => [
    { id: '1', role: 'user', content: 'Erzähl mir von der Eisenbahn', timestamp: userAt + 500 },
    { id: '2', role: 'assistant', content: FINAL_TEXT, finishReason: 'stop', timestamp: userAt + 30_000 },
  ];
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, {
    fetch: bridge.fetch,
    storedSession: stored,
    runStatus: () => ({ status: 'completed', usage: { promptTokens: 21000, completionTokens: 850, totalTokens: 21850 } }),
  });
  try {
    await until(() => doneAnswer(h), 'the recovered answer');
    const a = last(h);
    assert.equal(a.text, FINAL_TEXT);
    assert.ok(a.recoveredAt !== undefined, '"loaded later"');
    assert.equal(a.resumable, undefined, 'the refused re-attach is not tried again');
    assert.deepEqual(bridge.calls.map((c) => c.offset), ['0'], 'one re-attach, then the session');
    assert.equal(bridge.state.started, 0, 'never a second turn');
    await until(() => last(h).metrics?.inputTokens !== undefined, 'token counts from the run status');
    assert.equal(last(h).metrics?.outputTokens, 850);
    assert.equal(last(h).usage?.totalTokens, 21850);
  } finally {
    h.unmount();
  }
});

test('O1: re-attach while offline after a restart: retried, and the foreground tries at once', async () => {
  const key = 'turn-test-offline';
  const bridge = createFakeBridge();
  const partial = partialAfter(1000, key);
  bridge.seed(key, 1400);
  bridge.state.offline = true;
  const user = createUserMessage('Erzähl mir von der Eisenbahn', Date.now() - 20_000);
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, { fetch: bridge.fetch });
  try {
    await until(() => bridge.calls.length >= 1, 'the first attempt');
    assert.ok(last(h).interrupted !== undefined, 'still "loading the answer" while offline');
    bridge.state.offline = false;
    h.foreground();
    await until(() => last(h).status === 'streaming', 'streaming after the foreground', 600); // the next timed attempt would be 1 s later
    bridge.end();
    await until(() => doneAnswer(h), 'the finished answer');
    assert.equal(last(h).text, FINAL_TEXT);
    assert.equal(bridge.state.started, 0);
  } finally {
    h.unmount();
  }
});

test('O1: a new send while a re-attach still waits for the bridge cancels it', async () => {
  const key = 'turn-test-cancel';
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const bridge = createFakeBridge();
  bridge.seed(key, 1400);
  const slow: FetchLike = async (url, init) => {
    if (init.headers['X-Hermes-UI-Resume-Offset'] !== undefined) {
      await Promise.race([gate, new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))]);
    }
    return bridge.fetch(url, init);
  };
  const partial = partialAfter(1000, key);
  const user = createUserMessage('Erzähl mir von der Eisenbahn', Date.now() - 20_000);
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, { fetch: slow });
  try {
    await new Promise((r) => setTimeout(r, 20)); // the re-attach request is pending
    assert.equal(bridge.calls.length, 0);
    assert.equal(h.chat.send('Neue Frage'), true, 'the send is not blocked by the pending re-attach');
    release();
    await settle();
    assert.equal(h.messages().filter((m) => m.role === 'user').length, 2);
  } finally {
    h.unmount();
  }
});

test('direct Hermes (no bridge): a lost stream is an error as before, no re-attach', async () => {
  const server = createFakeBridge({ resume: false });
  const h = await mountHook({ baseUrl: 'https://example.com/v1', apiKey: 'dummy_test_token' }, { sessionId: 'hui-test' }, { fetch: server.fetch });
  try {
    server.state.dropAt = 900;
    server.state.initial = 1500;
    h.chat.send('Erzähl mir von der Eisenbahn');
    await until(() => last(h).status === 'error', 'the error bubble');
    assert.equal(server.calls.length, 1, 'no resume request');
    assert.equal(last(h).resumable, undefined);
  } finally {
    h.unmount();
  }
});

test('bridge without resume (BRIDGE_RESUME=off): interrupted → stored-session recovery as before', async () => {
  const server = createFakeBridge({ resume: false });
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test' }, { fetch: server.fetch, storedSession: () => [] });
  try {
    server.state.dropAt = 900;
    server.state.initial = 1500;
    h.chat.send('Erzähl mir von der Eisenbahn');
    await until(() => last(h).interrupted !== undefined, 'recovering');
    assert.equal(last(h).status, 'stopped');
    assert.equal(server.calls.length, 1, 'no resume request');
    assert.equal(last(h).resumable, undefined);
  } finally {
    h.unmount();
  }
});

test('chat closed while a re-attach waits for the bridge: the answer stays recovering and re-attachable', async () => {
  const key = 'turn-test-close';
  const bridge = createFakeBridge();
  bridge.seed(key, 1400);
  const hang: FetchLike = (_url, init) =>
    new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const persisted: ChatMessage[][] = [];
  const user = createUserMessage('Erzähl mir von der Eisenbahn', Date.now() - 20_000);
  const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partialAfter(1000, key)], onTurnEnd: (m) => persisted.push(m) }, { fetch: hang });
  await new Promise((r) => setTimeout(r, 20)); // the re-attach request hangs
  h.unmount();
  await settle();
  const a = last(h);
  assert.equal(a.status, 'stopped');
  assert.ok(a.interrupted !== undefined, 'still recovering');
  assert.equal(a.resumable, true, 'the next open re-attaches again');
  assert.equal(a.metrics?.endedAt, undefined);
});


for (const age of [120_000, 360_000]) {
  test(`approval replay after ${age / 1000}s preserves its deadline`, async () => {
    const now = Date.now();
    const requestedAt = now - age;
    const user = createUserMessage('Run the test command', requestedAt - 1000);
    const partial: ChatMessage = { ...createAssistantMessage(requestedAt - 1000), status: 'stopped', sendKey: 'turn-test-approval-replay', resumable: true };
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: approval.request\ndata: ' + JSON.stringify({ run_id: 'run-test', request_id: 'req-test', command: 'echo test', timestamp: requestedAt / 1000 }) + '\n\n'));
      },
    });
    const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream', 'x-hermes-ui-resume': '1' } }) as never,
    });
    try {
      await until(() => !!last(h).approval, 'the replayed approval');
      const approval = last(h).approval!;
      assert.equal(approval.deadlineAt, requestedAt + 300_000, 'replaying never grants another five minutes');
      assert.equal(isLive(approval, Date.now()), age < 300_000, 'an expired recorded request cannot become live');
    } finally {
      h.unmount();
    }
  });
}

for (const age of [120_000, 360_000]) for (const skew of [-300_000, 300_000]) {
  test(`approval replay keeps its deadline with ${skew / 1000}s server skew and ${age / 1000}s age`, async () => {
    const now = Date.now();
    const requestedAt = now - age;
    const startedAt = requestedAt - 1000;
    const user = createUserMessage('Run the test command', startedAt);
    const partial: ChatMessage = { ...createAssistantMessage(startedAt), status: 'stopped', sendKey: 'turn-test-approval-clock', resumable: true };
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: approval.request\ndata: ' + JSON.stringify({ run_id: 'run-test', request_id: 'req-test', command: 'echo test', timestamp: (requestedAt + skew) / 1000 }) + '\n\n'));
      },
    });
    const h = await mountHook(BRIDGE, { sessionId: 'hui-test', initialMessages: [user, partial] }, {
      fetch: async () => new Response(body, { headers: {
        'content-type': 'text/event-stream', 'x-hermes-ui-resume': '1', 'x-hermes-ui-resumed': '0',
        // A reverse proxy may replace Date with its own clock; replay clock metadata stays upstream-based.
        date: new Date(now).toUTCString(), 'x-hermes-ui-server-time': String(now + skew),
      } }) as never,
    });
    try {
      await until(() => !!last(h).approval, 'the replayed approval');
      const approval = last(h).approval!;
      assert.ok(Math.abs(approval.deadlineAt! - (requestedAt + 300_000)) < 1200, 'use the replay clock independently of a proxy-replaced Date');
      assert.equal(isLive(approval, Date.now()), age < 300_000);
    } finally {
      h.unmount();
    }
  });
}

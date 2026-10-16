/// <reference types="node" />
/**
 * A long answer that finishes while the app is in the background (Android; e2e check `background`): no frames come
 * (the rAF-aligned stream flush never runs) and no JS timers fire (they stop with the keep-alive service: the repo's
 * debounce and the 2.5 s partial save stay pending). The REAL useHermesChat + sessionOptions + usePersistOnNewMessage
 * over the real conversation controller / repo (testkit/hookHost.ts): the complete answer is in storage, `done`,
 * written once – before the "Antwort ist da" notification. A stop in the background stores the stopped answer and
 * announces nothing.
 */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createNoticeDelivery, onAnswerReady } from '../background/noticeState.ts';
import { turnRegistry } from '../background/turnRegistry.ts';
import { createController } from '../conversations/controller.ts';
import { createRepo, msgsKey } from '../conversations/repo.ts';
import { createIndexStore } from '../conversations/store.ts';
import type { UseConversation } from '../conversations/ConversationsProvider.tsx';
import { isHermesError } from '../hermes/stream.ts';
import type { ChatMessage } from '../hermes/types.ts';
import type { UseHermesChat, UseHermesChatOptions } from '../hermes/useHermesChat.ts';
import { createHookHost, loadTsModule } from '../testkit/hookHost.ts';
import { MemoryKv } from '../testkit/rn.ts';
import type { LiveTurn } from './useSessionPersistence.ts';

const HOOK = fileURLToPath(new URL('../hermes/useHermesChat.ts', import.meta.url));
const SESSION = fileURLToPath(new URL('./useSessionPersistence.ts', import.meta.url));

/** ~1340 chars, like the e2e "slow background" answer */
const FULL = Array.from({ length: 48 }, (_, i) => `Line ${String(i).padStart(2, '0')}: streamed words.`).join('\n');
const CHUNKS = FULL.match(/[\s\S]{1,12}/g)!;
/** the app goes to the background after this many chunks (~90 %) */
const BG_AT = Math.floor(CHUNKS.length * 0.9);

type StreamParams = { onAccepted(a: { resumable: boolean }): void; onEvent(ev: unknown): void; signal: AbortSignal };
type G = { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };

const settle = async () => {
  for (let k = 0; k < 60; k++) await Promise.resolve();
};

async function boot() {
  // a timer runs only when the test ticks: in the background nothing ticks (= JS timers paused, keep-alive gone)
  mock.timers.enable({ apis: ['setTimeout'] });
  // frames come only when the test runs them (foreground); in the background none
  const frames: (() => void)[] = [];
  let framesRequested = 0;
  (globalThis as G).requestAnimationFrame = (fn: () => void) => {
    framesRequested++;
    return frames.push(fn);
  };
  (globalThis as G).cancelAnimationFrame = () => {};

  const listeners = new Set<(s: string) => void>();
  const appState = {
    currentState: 'active',
    addEventListener: (_e: string, fn: (s: string) => void) => {
      listeners.add(fn);
      return { remove: () => void listeners.delete(fn) };
    },
  };
  const go = (s: string) => {
    appState.currentState = s;
    for (const fn of [...listeners]) fn(s);
  };
  const rn = { AppState: appState, Platform: { OS: 'android' } };

  const host = createHookHost();
  const streams: { params: StreamParams; done: (r: unknown) => void }[] = [];
  const hookStubs: Record<string, Record<string, unknown>> = {
    react: host.react,
    'react-native': rn,
    '../attachments/encodeHermes': { buildHermesContent: async (t: string) => t },
    '../attachments/store': { deleteAttachmentFiles: async () => {}, fileReader: {} },
    '../attachments/draft': { needsUpload: () => false, toSent: (a: unknown) => a },
    '../attachments/pendingUploads': { createPendingUploads: () => ({}), startUploadTask: () => {} },
    '../attachments/queuedFiles': { queuedFiles: { restore: async () => [], drop: async () => {}, stash: async () => {} } },
    '../attachments/upload': { uploadAttachment: async () => {} },
    '../attachments/types': { AttachmentError: class extends Error {} },
    './client': {
      isHermesError,
      hermesSessions: () => ({ messages: async () => ({ messages: [] }) }),
      streamChat: (params: StreamParams) => new Promise((done) => streams.push({ params, done })),
      stopBridgeTurn: async () => {},
      fetchRunStatus: async () => ({ status: 'completed' }),
      answerApproval: async () => {},
    },
  };
  const { useHermesChat } = (await loadTsModule(HOOK, hookStubs)) as { useHermesChat: (c: unknown, o: UseHermesChatOptions) => UseHermesChat };
  const { sessionOptions, usePersistOnNewMessage } = (await loadTsModule(SESSION, { react: host.react, 'react-native': rn })) as {
    sessionOptions: (c: UseConversation) => UseHermesChatOptions;
    usePersistOnNewMessage: (c: UseConversation, m: ChatMessage[], live?: LiveTurn) => void;
  };

  // storage: every transcript write with its content
  const kv = new MemoryKv();
  const writes: ChatMessage[][] = [];
  const setItem = kv.setItem;
  kv.setItem = (k: string, v: string) => {
    if (k.startsWith(msgsKey(''))) writes.push((JSON.parse(v) as { messages: ChatMessage[] }).messages);
    return setItem(k, v);
  };
  const repo = createRepo(kv);
  const store = createIndexStore();
  const controller = createController(store, repo);
  store.subscribe(() => repo.saveIndex(store.get()));
  // ConversationsProvider: flushes the repo right after the chat's own background save
  appState.addEventListener('change', (s) => {
    if (s !== 'active') void Promise.resolve().then(() => repo.flush());
  });
  const id = controller.create({ id: 'p-test', kind: 'hermes' }).id;
  const fns = {
    ready: true,
    messages: [] as ChatMessage[],
    save: (m: ChatMessage[], o?: { keepOrder?: boolean }) => controller.save(id, m, o),
    saveNow: (m: ChatMessage[]) => controller.saveNow(id, m),
    flush: () => controller.flush(),
    setSessionId: (sid: string) => controller.setSessionId(id, sid),
    setModel: () => {},
    setModelOptions: () => {},
    setModelLock: () => {},
  };
  const Session = () => {
    const conv: UseConversation = { ...fns, meta: controller.get(id) };
    const chat = useHermesChat({ baseUrl: 'https://example.com/v1', apiKey: 'dummy_test_token', bridge: true }, sessionOptions(conv));
    usePersistOnNewMessage(conv, chat.messages, { stop: chat.stop, label: 'Hermes' });
    return chat;
  };

  let chat = host.render(Session);
  /** promises settle, React commits what changed (as it does in the background too: commits need no frames) */
  const commit = async () => {
    await settle();
    while (host.dirty()) {
      chat = host.rerender();
      await settle();
    }
  };
  /** the stored answer right now */
  const stored = () => {
    const raw = kv.data.get(msgsKey(id));
    const list = raw ? (JSON.parse(raw) as { messages: ChatMessage[] }).messages : [];
    const last = list[list.length - 1];
    return last?.role === 'assistant' ? { status: last.status, text: last.text } : null;
  };
  // BackgroundTurnHost's delivery: the app is in the background → system notification "Antwort ist da"
  const ready: { status?: string; text?: string; message: string }[] = [];
  const deliver = createNoticeDelivery({
    context: () => ({ appActive: appState.currentState === 'active', openConversationId: id, chatFocused: true, nearBottom: true }),
    enabled: () => true,
    now: () => Date.now(),
    banner: () => assert.fail('no banner in the background'),
    notify: (ev) => ready.push({ ...stored(), message: ev.message.text }),
  });
  const offReady = onAnswerReady((ev) => void deliver(ev));

  /** send, stream the first ~90 % in the foreground (frames + timers run), then HOME */
  const streamThenBackground = async () => {
    assert.equal(chat.send('e2e slow background'), true);
    await commit();
    assert.equal(streams.length, 1, 'one turn request');
    const s = streams[0];
    s.params.onAccepted({ resumable: false });
    s.params.onEvent({ type: 'start', completionId: 'run-test-0001' });
    for (const c of CHUNKS.slice(0, BG_AT)) {
      s.params.onEvent({ type: 'text', text: c });
      mock.timers.tick(40);
      for (const f of frames.splice(0)) f();
      await commit();
    }
    assert.ok(framesRequested > 0, 'the foreground stream updates on frames');
    go('background');
    await commit();
    // more than one stream interval passes in the background: the next update asks for a frame (that never comes)
    // instead of waiting on a timer
    const until = Date.now() + 50;
    while (Date.now() < until) {
      /* wall clock only: timers are mocked */
    }
    // the precondition the e2e run showed: the partial answer is stored as `stopped`
    assert.equal(stored()?.status, 'stopped');
    assert.ok(FULL.startsWith(stored()!.text) && stored()!.text.length < FULL.length, 'a partial answer is stored on background');
    return s;
  };

  const writesOf = (text: string, status: string) => writes.filter((w) => w[w.length - 1]?.text === text && w[w.length - 1]?.status === status).length;

  const dispose = () => {
    host.unmount();
    offReady();
    turnRegistry.reset();
    mock.timers.reset();
    delete (globalThis as G).requestAnimationFrame;
    delete (globalThis as G).cancelAnimationFrame;
  };
  return { chat: () => chat, commit, stored, ready, frames, streamThenBackground, writesOf, writes, id, dispose };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

test('an answer finishing in the background (no frames, no timers) is stored complete and done, once, before "Answer ready"', async () => {
  const b = await boot();
  cleanup = b.dispose;
  const s = await b.streamThenBackground();
  // the rest arrives in the background: frames are requested but never come, no timer fires
  for (const c of CHUNKS.slice(BG_AT)) s.params.onEvent({ type: 'text', text: c });
  s.params.onEvent({ type: 'finish', reason: 'stop' });
  s.done({ sessionId: 'hui-test', completionId: 'run-test-0001', text: FULL, aborted: false });
  await b.commit();

  assert.ok(b.frames.length > 0, 'background updates waited for a frame that never came');
  assert.deepEqual(b.stored(), { status: 'done', text: FULL }, 'the complete answer is in storage while still in the background');
  assert.equal(b.writesOf(FULL, 'done'), 1, 'the final answer is written exactly once');
  const last = b.writes[b.writes.length - 1];
  assert.equal(last[last.length - 1].text, FULL, 'no older state is written after it');
  assert.deepEqual(b.ready, [{ status: 'done', text: FULL, message: FULL }], 'notification "Answer ready" once, after the final write');
  assert.equal(turnRegistry.isRunning(b.id), false);
  assert.equal(turnRegistry.saving(), 0, 'the keep-alive hold is released');
});

test('Stop in the background stores the stopped answer at once and announces nothing', async () => {
  const b = await boot();
  cleanup = b.dispose;
  const s = await b.streamThenBackground();
  const more = CHUNKS.slice(BG_AT, BG_AT + 3);
  for (const c of more) s.params.onEvent({ type: 'text', text: c });
  const shown = CHUNKS.slice(0, BG_AT).join('') + more.join('');
  b.chat().stop(); // notification "Stopp"
  assert.equal(s.params.signal.aborted, true);
  s.done({ sessionId: 'hui-test', completionId: 'run-test-0001', text: shown, aborted: true });
  await b.commit();

  assert.deepEqual(b.stored(), { status: 'stopped', text: shown });
  assert.equal(b.writesOf(shown, 'stopped'), 1, 'the stopped answer is written exactly once');
  assert.deepEqual(b.ready, [], 'a stopped answer is no "Answer ready"');
  assert.equal(turnRegistry.saving(), 0);
});

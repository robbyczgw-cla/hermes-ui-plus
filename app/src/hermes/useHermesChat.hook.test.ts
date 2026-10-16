/// <reference types="node" />
/**
 * Behaviour of the REAL useHermesChat hook under node:test: the source is transpiled (testkit/hookHost.ts), React is
 * replaced by a single-render stub (refs and callbacks persist, setters only record), and the modules that need a device
 * (react-native, attachment files, uploads, the HTTP client) are replaced by deferred fakes. Everything else
 * (pendingSend, chatState, recovery, idempotency, …) is the real code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadTsModule } from '../testkit/hookHost.ts';
import { isHermesError } from './stream.ts';
import type { ChatMessage } from './types';
import type { UseHermesChat, UseHermesChatOptions } from './useHermesChat';

const HOOK = fileURLToPath(new URL('./useHermesChat.ts', import.meta.url));

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

type Harness = {
  chat: UseHermesChat;
  /** the hook's `messages` state as last set */
  messages: () => ChatMessage[];
  sessionChecks: Deferred<{ messages: unknown[] }>[];
  restores: Deferred<unknown[]>[];
  streams: { params: unknown; done: Deferred<unknown> }[];
};

async function mountHook(options: UseHermesChatOptions): Promise<Harness> {
  const sessionChecks: Harness['sessionChecks'] = [];
  const restores: Harness['restores'] = [];
  const streams: Harness['streams'] = [];
  const cells: unknown[] = [];
  let n = 0;
  const react = {
    useRef: <T>(v: T) => ({ current: v }),
    useMemo: <T>(f: () => T) => f(),
    useCallback: <T>(f: T) => f,
    useEffect: () => {},
    useState: <T>(initial: T | (() => T)) => {
      const i = n++;
      cells[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const set = (v: T | ((p: T) => T)) => {
        cells[i] = typeof v === 'function' ? (v as (p: T) => T)(cells[i] as T) : v;
      };
      return [cells[i], set];
    },
  };
  const stubs: Record<string, Record<string, unknown>> = {
    react,
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    '../attachments/encodeHermes': { buildHermesContent: async (t: string) => t },
    '../attachments/store': { deleteAttachmentFiles: async () => {}, fileReader: {} },
    '../attachments/draft': { needsUpload: () => false, toSent: (a: unknown) => a },
    '../attachments/pendingUploads': {
      createPendingUploads: (atts: unknown[]) => ({ state: () => 'ready', snapshot: () => atts, cancel: () => [] }),
      startUploadTask: () => {},
    },
    '../attachments/queuedFiles': {
      queuedFiles: {
        restore: () => {
          const d = deferred<unknown[]>();
          restores.push(d);
          return d.promise;
        },
        drop: async () => {},
        stash: async () => {},
      },
    },
    '../attachments/upload': { uploadAttachment: async () => {} },
    '../attachments/types': { AttachmentError: class extends Error {} },
  };
  stubs['./client'] = {
    isHermesError,
    hermesSessions: () => ({
      messages: () => {
        const d = deferred<{ messages: unknown[] }>();
        sessionChecks.push(d);
        return d.promise;
      },
    }),
    streamChat: (params: unknown) => {
      const done = deferred<unknown>();
      streams.push({ params, done });
      return done.promise;
    },
    stopBridgeTurn: async () => {},
    fetchRunStatus: async () => ({ status: 'completed' }),
    answerApproval: async () => {},
  };

  const { useHermesChat } = (await loadTsModule(HOOK, stubs)) as { useHermesChat: (c: unknown, o: UseHermesChatOptions) => UseHermesChat };

  const chat = useHermesChat({ baseUrl: 'https://example.com/v1', apiKey: 'dummy_test_token', bridge: true }, options);
  assert.equal(cells[0], chat.messages, 'the first state cell is the transcript');
  return { chat, messages: () => cells[0] as ChatMessage[], sessionChecks, restores, streams };
}

const queued: ChatMessage = { id: 'q', role: 'user', text: 'queued', tools: [], status: 'done', createdAt: 1, sendQueued: true, sendKey: 'turn-test-0000' };

test('Sol F07: two rapid "Erneut senden" taps on one queued message start one check and one turn', async () => {
  const h = await mountHook({ sessionId: 'hui-test', initialMessages: [queued] });
  const queuedSend = h.chat.queuedSend!;
  queuedSend.resend('q');
  queuedSend.resend('q'); // the second tap lands before the first one's state update is rendered
  for (const d of h.sessionChecks) d.resolve({ messages: [] });
  await settle();
  for (const d of h.restores) d.resolve([]);
  await settle();
  assert.equal(h.sessionChecks.length, 1, 'one stored-session check');
  assert.equal(h.streams.length, 1, 'one turn request');
  assert.deepEqual(
    h.messages().map((m) => m.role),
    ['user', 'assistant']
  );
  for (const s of h.streams) s.done.resolve({ aborted: true });
  await settle();
});

test('Sol F08: cancelling the only pending (uploading) message persists the empty transcript', async () => {
  const persisted: ChatMessage[][] = [];
  const h = await mountHook({ sessionId: 'hui-test', onTurnEnd: (m) => persisted.push(m), persistNow: async (m) => void persisted.push(m) });
  const att = { id: 'att', kind: 'file', name: 'a.txt', mimeType: 'text/plain', size: 1, uri: 'file:///tmp/fake', status: 'uploading' };
  const uploads = { state: () => 'uploading', snapshot: () => [att], attach: () => {}, cancel: () => [], retry: () => {}, remove: () => undefined };
  assert.equal(h.chat.send('pending text', [att] as never, uploads as never), true);
  assert.equal(h.messages().length, 1); // the bubble, stored as queued by the persistence effect
  h.chat.stop(); // = cancel: nothing was sent yet
  assert.equal(h.messages().length, 0);
  assert.deepEqual(persisted.at(-1), [], 'the removal reaches storage, also when nothing is left');
});

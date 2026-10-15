/**
 * useHermesChat-compatible hook for the quick thread of one connection, so ChatView, the message renderer and the
 * hui parser are shared. Each send goes to the bridge (or the demo's canned backend) with the last complete turns
 * (≤ 6 messages, core.ts buildQuickHistory). The thread is local: loaded from / saved to quick/store.ts, entries
 * older than 24 h drop out (on send, on a timer and when the app comes back).
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Attachment } from '../attachments/types';
import { applyEvent, createAssistantMessage, createUserMessage, errorTextOf, finalize, newId } from '../hermes/chatState';
import { describeError, type FetchLike } from '../hermes/stream';
import { createThrottle, streamIntervalFor } from '../hermes/throttle';
import type { ChatMessage, ChatStatus } from '../hermes/types';
import type { UseHermesChat } from '../hermes/useHermesChat';
import type { TKey, Vars } from '../i18n';
import { buildQuickHistory, nextExpiry, pruneExpired, quickFailureOf, quickStampOf, waitParts, type QuickBackend, type QuickModel } from './core';
import { runDemoQuick, type DemoLang } from './demo';
import { onThreadCleared, saveThread } from './store';
import { streamQuickCore } from './stream';

const nativeFetch = expoFetch as unknown as FetchLike;

export type UseQuickChatOptions = {
  profileId: string;
  backend: QuickBackend;
  /** the thread as loaded from storage (read on mount) */
  initialMessages: ChatMessage[];
  /** picked model (Settings → Schnellfrage), read at send time; undefined = server default */
  model?: QuickModel;
  /** model name for the meta line when the stream does not report one */
  fallbackModel?: string | null;
  lang?: DemoLang;
  /** 404 feature_off: the plugin went away – hide ⚡ (the question goes back to the chat composer) */
  onFeatureOff?: (question: string) => void;
};

type ErrorText = { key: TKey; params?: Vars };

/** what the answer shows for a failed quick request (keys of the `quick` namespace or the shared Hermes errors) */
function quickErrorText(e: unknown): ErrorText | undefined {
  const f = quickFailureOf(e);
  if (f.kind === 'rate_limited') {
    if (f.retryAfter === undefined) return { key: 'quick.errors.rateLimited' };
    const w = waitParts(f.retryAfter);
    return { key: w.unit === 's' ? 'quick.errors.rateLimitedS' : w.unit === 'min' ? 'quick.errors.rateLimitedMin' : 'quick.errors.rateLimitedH', params: { value: w.value } };
  }
  if (f.kind === 'feature_off') return { key: 'quick.errors.off' };
  if (f.kind === 'model_rejected') return { key: 'quick.errors.modelRejected' };
  return errorTextOf(e);
}

export function useQuickChat(o: UseQuickChatOptions): UseHermesChat {
  const [messages, setMessages] = useState<ChatMessage[]>(o.initialMessages);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [sessionId] = useState(() => newId('quick'));
  const [error, setError] = useState<string | undefined>(undefined);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const optsRef = useRef(o);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    optsRef.current = o;
  });

  // the throttle reads the latest list when it fires (never during render)
  // eslint-disable-next-line react-hooks/refs -- false positive: the closures run when the throttle fires
  const [throttle] = useState(() => {
    const flush = () => setMessages(messagesRef.current);
    const interval = () => streamIntervalFor(messagesRef.current);
    return createThrottle(flush, interval);
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      throttle.cancel();
      abortRef.current?.abort();
    };
  }, [throttle]);

  const commit = useCallback(
    (list: ChatMessage[], persist: boolean) => {
      messagesRef.current = list;
      throttle.cancel();
      setMessages(list);
      if (persist) saveThread(optsRef.current.profileId, list);
    },
    [throttle],
  );

  // 24 h expiry while the thread is open: at the next expiry and when the app comes back to the foreground
  const prune = useCallback(() => {
    if (abortRef.current) return;
    const next = pruneExpired(messagesRef.current, Date.now());
    if (next !== messagesRef.current) commit([...next], true);
  }, [commit]);
  useEffect(() => {
    const at = nextExpiry(messages);
    if (at === undefined || status === 'streaming') return;
    const t = setTimeout(prune, Math.min(Math.max(at - Date.now(), 0) + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [messages, status, prune]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') prune();
    });
    return () => sub.remove();
  }, [prune]);
  // "Schnellfragen löschen" in the settings
  useEffect(
    () =>
      onThreadCleared((id) => {
        if (id !== optsRef.current.profileId) return;
        abortRef.current?.abort();
        abortRef.current = null;
        messagesRef.current = [];
        setMessages([]);
        setStatus('idle');
      }),
    [],
  );

  const updateLast = useCallback(
    (fn: (m: ChatMessage) => ChatMessage) => {
      const list = messagesRef.current;
      if (!list.length) return;
      const next = list.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      messagesRef.current = next;
      throttle.call();
    },
    [throttle],
  );

  const run = useCallback(
    async (question: string, earlier: ChatMessage[]) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus('streaming');
      setError(undefined);
      const current = () => abortRef.current === ctrl;
      const opts = optsRef.current;
      let failure: string | undefined;
      const history = buildQuickHistory(earlier, question);
      try {
        if (!history) throw Object.assign(new Error('too long'), { quickText: { key: 'quick.errors.tooLong' as TKey } });
        const onEvent = (ev: Parameters<typeof applyEvent>[1]) => {
          if (current()) updateLast((m) => applyEvent(m, ev, Date.now()));
        };
        let aborted: boolean;
        if (opts.backend.kind === 'demo') {
          aborted = (await runDemoQuick({ history, lang: opts.lang, signal: ctrl.signal, onEvent })).aborted;
        } else {
          aborted = (await streamQuickCore(nativeFetch, { conn: opts.backend.conn, history, model: opts.model, lang: opts.lang, signal: ctrl.signal, onEvent })).aborted;
        }
        if (!current()) return;
        const fallbackModel = opts.model?.model ?? opts.fallbackModel;
        if (aborted) updateLast((m) => finalize(m, 'stopped', undefined, Date.now()));
        else {
          updateLast((m) => {
            const done = m.status === 'streaming' ? finalize(m, 'done', undefined, Date.now()) : m;
            return done.status === 'done' ? { ...done, quick: quickStampOf(done, fallbackModel) } : done;
          });
          const last = messagesRef.current[messagesRef.current.length - 1];
          if (last?.status === 'error') failure = last.error ?? 'error';
        }
      } catch (e) {
        if (!current()) return;
        failure = describeError(e);
        const text = (e as { quickText?: ErrorText }).quickText ?? quickErrorText(e);
        updateLast((m) => finalize(m, 'error', failure, Date.now(), text));
        if (quickFailureOf(e).kind === 'feature_off') opts.onFeatureOff?.(question);
      } finally {
        if (current()) {
          abortRef.current = null;
          throttle.cancel();
          commit(messagesRef.current, true);
          setError(failure);
          setStatus(failure ? 'error' : 'idle');
        }
      }
    },
    [throttle, updateLast, commit],
  );

  const send = useCallback(
    (text: string, _attachments: Attachment[] = []) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current || !mountedRef.current) return false;
      const now = Date.now();
      const earlier = [...pruneExpired(messagesRef.current, now)];
      messagesRef.current = [...earlier, createUserMessage(trimmed, now), createAssistantMessage(now)];
      setMessages(messagesRef.current);
      void run(trimmed, earlier);
      return true;
    },
    [run],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (abortRef.current || !mountedRef.current) return false;
    const list = messagesRef.current;
    let i = list.length - 1;
    if (list[i]?.role === 'assistant') i--;
    const user = list[i];
    if (!user || user.role !== 'user') return false;
    const earlier = list.slice(0, i);
    messagesRef.current = [...list.slice(0, i + 1), createAssistantMessage(Date.now())];
    setMessages(messagesRef.current);
    void run(user.text, earlier);
    return true;
  }, [run]);

  const newSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    commit([], true);
    setStatus('idle');
  }, [commit]);

  const replaceMessages = useCallback(
    (list: ChatMessage[]) => {
      if (abortRef.current) return false;
      commit(list, true);
      return true;
    },
    [commit],
  );

  const respondApproval = useCallback(async () => {}, []);

  return { messages, send, stop, retry, newSession, status, sessionId, error, approval: null, respondApproval, replaceMessages };
}

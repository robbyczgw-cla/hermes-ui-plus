// useHermesChat-compatible hook for the offline demo (`kind: 'demo'`, `demo://local`). Same state
// transitions as useHermesChat (hermes/chatState.ts), events from the local replay (transport.ts). Live cards work
// like with Hermes: `liveOutgoing` hands over this device's card edits, which the scripted answer gets as `live`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment } from '../../attachments/types';
import { applyEvent, createAssistantMessage, createUserMessage, errorTextOf, finalize, newId } from '../../hermes/chatState';
import { createThrottle, streamIntervalFor } from '../../hermes/throttle';
import type { ApprovalChoice, ApprovalRequest, ChatMessage, ChatStatus } from '../../hermes/types';
import type { UseHermesChat, UseHermesChatOptions } from '../../hermes/useHermesChat';
import { useLocale } from '../../i18n';
import { hasBatches, withLiveOnLastUser } from '../../live/outgoing';
import type { DemoBotRole, DemoStep } from './kit';
import { runDemoTurn } from './transport';

/** a demo bot's turn that continues from its stored history (Scout's waiting approval, onboarding/demo/bots.ts) */
export type DemoResume = { id: string; name: string; steps: DemoStep[] };

export type UseDemoChat = UseHermesChat & {
  /** append an answer with this id and replay `steps` into it (no user message); false while a turn runs */
  resume(r: DemoResume): boolean;
};

export function useDemoChat(
  options: UseHermesChatOptions = {},
  extra: { bot?: string; role?: DemoBotRole; onApprovalAnswer?: (runId: string, choice: ApprovalChoice | 'timeout') => void } = {},
): UseDemoChat {
  const [messages, setMessages] = useState<ChatMessage[]>(options.initialMessages ?? []);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [sessionId, setSessionId] = useState<string>(() => options.sessionId ?? newId('demo'));
  const [error, setError] = useState<string | undefined>(undefined);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const { lang } = useLocale();
  const langRef = useRef(lang);
  langRef.current = lang;
  const botRef = useRef(extra);
  botRef.current = extra;

  const messagesRef = useRef<ChatMessage[]>(messages);
  const sessionRef = useRef(sessionId);
  const optsRef = useRef(options);
  const abortRef = useRef<AbortController | null>(null);
  const approvalRef = useRef<{ runId: string; resolve: (c: ApprovalChoice | 'timeout') => void } | null>(null);
  // false after unmount: late sends (undo-window commits of a chat the user left) are refused
  const mountedRef = useRef(true);
  useEffect(() => {
    optsRef.current = options;
  });

  const throttle = useMemo(() => createThrottle(() => setMessages(messagesRef.current), options.updateIntervalMs ?? (() => streamIntervalFor(messagesRef.current))), [options.updateIntervalMs]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      throttle.cancel();
      abortRef.current?.abort();
    };
  }, [throttle]);

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
    async (text: string, script?: { name: string; steps: DemoStep[] }) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus('streaming');
      setError(undefined);
      const sid = sessionRef.current;
      const current = () => abortRef.current === ctrl;
      const users = messagesRef.current.filter((m) => m.role === 'user');
      const turn = users.length;
      // earlier user messages, newest first (the current one is the last): lets "Shorter" / "As a table" find the answer they reshape
      const priorUserTexts = users.slice(0, -1).map((m) => m.text).reverse();
      // live-card edits of this device go along with the message and are "accepted" at once (no server): they move onto
      // the user message like a real turn (live/outgoing.ts), so the fold and the "sent along" line see them
      const live = script ? null : (optsRef.current.liveOutgoing?.(text) ?? null);
      if (hasBatches(live)) {
        messagesRef.current = withLiveOnLastUser(messagesRef.current, live.batches);
        setMessages(messagesRef.current);
        live.onAccepted();
      }
      let failure: string | undefined;
      try {
        const r = await runDemoTurn({
          text,
          sessionId: sid,
          turn,
          history: priorUserTexts,
          live: hasBatches(live) ? live.batches : undefined,
          lang: langRef.current,
          bot: botRef.current.bot,
          role: botRef.current.role,
          script,
          signal: ctrl.signal,
          onEvent: (ev) => {
            if (!current()) return;
            if (ev.type === 'approval') setApproval(ev.approval);
            updateLast((m) => applyEvent(m, ev, Date.now()));
          },
          waitForApproval: (runId) =>
            new Promise((resolve) => {
              approvalRef.current = {
                runId,
                resolve: (c) => {
                  botRef.current.onApprovalAnswer?.(runId, c);
                  resolve(c);
                },
              };
            }),
        });
        if (!current()) return;
        if (r.aborted) updateLast((m) => finalize(m, 'stopped', undefined, Date.now()));
        else {
          updateLast((m) => (m.status === 'streaming' ? finalize(m, 'done', undefined, Date.now()) : m));
          const last = messagesRef.current[messagesRef.current.length - 1];
          if (last?.status === 'error') failure = last.error ?? 'Fehler';
        }
      } catch (e) {
        if (!current()) return;
        failure = e instanceof Error ? e.message : String(e);
        const key = errorTextOf(e);
        updateLast((m) => finalize(m, 'error', failure, Date.now(), key));
      } finally {
        if (current()) {
          abortRef.current = null;
          approvalRef.current = null;
          setApproval(null);
          throttle.cancel();
          setMessages(messagesRef.current);
          setError(failure);
          setStatus(failure ? 'error' : 'idle');
          optsRef.current.onTurnEnd?.(messagesRef.current, sid);
        }
      }
    },
    [throttle, updateLast],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      const trimmed = text.trim();
      if ((!trimmed && !attachments.length) || abortRef.current || !mountedRef.current) return false;
      const now = Date.now();
      messagesRef.current = [...messagesRef.current, createUserMessage(trimmed, now, attachments), createAssistantMessage(now)];
      setMessages(messagesRef.current);
      void run(trimmed || 'Anhang');
      return true;
    },
    [run],
  );

  const resume = useCallback(
    (r: DemoResume) => {
      if (abortRef.current || !mountedRef.current) return false;
      messagesRef.current = [...messagesRef.current, { ...createAssistantMessage(Date.now()), id: r.id }];
      setMessages(messagesRef.current);
      void run('', { name: r.name, steps: r.steps });
      return true;
    },
    [run],
  );

  const stop = useCallback(() => {
    approvalRef.current?.resolve('timeout');
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (abortRef.current || !mountedRef.current) return false;
    const list = messagesRef.current;
    let i = list.length - 1;
    if (list[i]?.role === 'assistant') i--;
    const user = list[i];
    if (!user || user.role !== 'user') return false;
    messagesRef.current = [...list.slice(0, i + 1), createAssistantMessage(Date.now())];
    setMessages(messagesRef.current);
    void run(user.text);
    return true;
  }, [run]);

  const newSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const id = newId('demo');
    sessionRef.current = id;
    messagesRef.current = [];
    setMessages([]);
    setSessionId(id);
    setStatus('idle');
    setApproval(null);
    optsRef.current.onSessionChange?.(id);
  }, []);

  const respondApproval = useCallback(async (choice: ApprovalChoice) => {
    const pending = approvalRef.current;
    if (!pending) return;
    approvalRef.current = null;
    setApproval(null);
    pending.resolve(choice);
  }, []);

  const replaceMessages = useCallback(
    (list: ChatMessage[]) => {
      if (abortRef.current) return false;
      throttle.cancel();
      messagesRef.current = list;
      setMessages(list);
      return true;
    },
    [throttle],
  );

  return { messages, send, stop, retry, newSession, status, sessionId, error, approval, respondApproval, replaceMessages, resume };
}

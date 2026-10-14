import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { emitAnswerReady } from '../background/noticeState';
import { turnRegistry } from '../background/turnRegistry';
import type { UseConversation } from '../conversations';
import { createThrottledSaver } from '../conversations/partialSave';
import type { ChatMessage } from '../hermes/types';
import type { UseHermesChatOptions } from '../hermes/useHermesChat';
import { hasPendingSend } from '../hermes/pendingSend';

/** a streaming answer is persisted at most this often (plus on background / unmount / turn end) */
const PARTIAL_SAVE_MS = 2500;

/**
 * Wiring between a chat hook (useHermesChat / useClaudeChat) and its stored conversation:
 * restore `sessionId` + transcript, persist at the end of every turn (also when the session is
 * unmounted mid-stream: the hook aborts and reports `stopped`) and right after a user message
 * was added (crash safety; `save()` is throttled and skips unchanged lists).
 */
export function sessionOptions(conv: UseConversation): UseHermesChatOptions {
  return {
    sessionId: conv.meta?.hermesSessionId,
    initialMessages: conv.messages,
    onTurnEnd: (messages, sid) => {
      conv.save(messages);
      if (sid && sid !== conv.meta?.hermesSessionId) conv.setSessionId(sid);
      // "Antwort ist da" (background/noticeState): live turn end or a recovered answer; de-duplicated by message id
      const last = messages[messages.length - 1];
      if (conv.meta?.id && last && isFresh(last, Date.now())) emitAnswerReady({ conversationId: conv.meta.id, message: last, late: last.recoveredAt !== undefined });
    },
    // a new chat's session id is stored before the first answer: a killed app (or a lost stream) can still match
    // the stored Hermes session / the live inbox event to THIS conversation instead of creating a new one
    onTurnStart: (sid) => {
      if (sid && sid !== conv.meta?.hermesSessionId) conv.setSessionId(sid);
    },
  };
}

/**
 * Persist the live transcript: at once when a message is added, every ~2.5 s while an answer streams and
 * when the app goes to the background. A killed app thus keeps the partial answer (restored as `stopped`).
 */
export function usePersistOnNewMessage(conv: UseConversation, messages: ChatMessage[], live?: LiveTurn) {
  useTurnActivity(conv.meta?.id, messages, live);

  // `conv.save` is bound to one conversation id: a pending partial save never lands in another chat
  const save = conv.save;
  const s = useMemo(() => createThrottledSaver(save, PARTIAL_SAVE_MS), [save]);

  const n = messages.length;
  const lastN = useRef<number | null>(null);
  // the turn ended / was interrupted: persist right away (a reload a moment later must not lose it)
  const lastStatus = messages[n - 1]?.status;
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!n) return;
    const statusChanged = prevStatus.current !== undefined && prevStatus.current !== lastStatus;
    prevStatus.current = lastStatus;
    if (lastN.current !== n || statusChanged) {
      lastN.current = n;
      s.now(messages);
    } else {
      s.update(messages);
    }
  }, [n, messages, s, lastStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // the provider flushes the repo right after this (microtask), so the save reaches storage
      if (state !== 'active') s.flush();
    });
    return () => {
      sub.remove();
      s.flush();
      s.dispose();
    };
  }, [s]);
}

/** what the shell needs to know about a session's running turn (notification text, "Stopp") */
export type LiveTurn = { stop?: () => void; label?: string; profileId?: string };

/** a just-finished answer (not an old message re-reported by enrichment / reload) */
function isFresh(m: ChatMessage, now: number): boolean {
  const at = m.recoveredAt ?? m.metrics?.endedAt ?? m.createdAt;
  return at >= now - 2 * 60_000;
}

/**
 * Report the conversation's running turn to the app-wide registry (background/turnRegistry): the shell keeps the
 * session mounted while it runs (chat switch, drawer, settings), the drawer shows "läuft", the Android foreground
 * service runs. Ends with the turn or when the session unmounts.
 */
function useTurnActivity(conversationId: string | undefined, messages: ChatMessage[], live?: LiveTurn) {
  const last = messages[messages.length - 1];
  // a message waiting for its uploads counts too: its session stays mounted, the uploads keep going
  const running = (!!last && last.role === 'assistant' && last.status === 'streaming') || hasPendingSend(messages);
  const stop = live?.stop;
  const label = live?.label ?? '';
  const profileId = live?.profileId;
  useEffect(() => {
    if (!conversationId || !running) return;
    turnRegistry.begin({ conversationId, label, profileId, startedAt: Date.now(), stop });
  }, [conversationId, running, label, profileId, stop]);
  useEffect(() => {
    if (!conversationId || running) return;
    turnRegistry.end(conversationId);
  }, [conversationId, running]);
  useEffect(
    () => () => {
      if (conversationId) turnRegistry.end(conversationId);
    },
    [conversationId],
  );
}

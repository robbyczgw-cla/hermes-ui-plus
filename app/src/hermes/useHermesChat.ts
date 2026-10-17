/**
 * useHermesChat – chat state + streaming for one Hermes session.
 *
 * - session continuation: a client-generated session id is sent on EVERY request, only the new user
 *   message is in the body (server keeps the history; docs/HERMES-API.md)
 * - React updates are throttled (~30 fps) so long streams do not jank; the stream itself is applied
 *   to a ref immediately. A tick that only grows the streaming answer's text / reasoning goes to the live text store
 *   (liveMessages.ts: only the answer's live part re-renders); the list state is committed at the turn's boundaries
 * - per-chat `modelOptions` (reasoning effort / fast) are sent as body `model_options`
 * - after a turn that used tools, the stored session messages are fetched once and the turn's
 *   ToolEvents get the real arguments/results (+ reasoning) – `fetchToolDetails`, default on;
 *   switched off automatically for servers without the session API (support.ts)
 * - a stream lost AFTER Hermes accepted the turn (network switch, airplane mode, app in the background) is not a failed
 *   answer. Behind the UI bridge it continues live: the stream re-attaches at its byte offset while it lasts (stream.ts,
 *   note "Verbindung unterbrochen – verbinde neu…"; foreground / inbox reconnect retry at once), and an answer that
 *   is still unfinished after that or after an app restart re-attaches to the bridge's recording (reattach.ts). Only
 *   when the bridge refuses (`resume_unavailable` / `turn_unrecorded`) or without a bridge does the message wait
 *   ("Verbindung unterbrochen – Antwort wird nachgeladen…") for the live inbox (`applyInbox`) or the stored session
 *   (polled with backoff, on foreground / `recoverNow`) – recovery.ts
 * - "Send" while attachment uploads still run (`send(text, atts, pending)`): the user message shows at once with
 *   per-attachment progress, the turn starts by itself when every upload is done; a failed upload offers retry /
 *   remove on the bubble; stop() / newSession() / unmount cancel it (pendingSend.ts, attachments/pendingUploads.ts).
 *   It counts as a running turn meanwhile (no second send, the session stays mounted when the chat is switched).
 *   Persisted meanwhile (app killed, reload) it comes back as a queued message (`sendQueued`): never sent by itself;
 *   "Erneut senden" checks the stored Hermes session first (the turn may have started before the kill), then uploads
 *   what is missing and starts the turn; "Verwerfen" removes it (`queuedSend`, pendingSend.ts queuedReduce)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { buildHermesContent } from '../attachments/encodeHermes';
import { deleteAttachmentFiles, fileReader } from '../attachments/store';
import { needsUpload, toSent } from '../attachments/draft';
import { createPendingUploads, startUploadTask, type PendingUploads, type UploadTask } from '../attachments/pendingUploads';
import { queuedFiles } from '../attachments/queuedFiles';
import { AttachmentError, type Attachment, type AttachmentTarget } from '../attachments/types';
import { uploadAttachment } from '../attachments/upload';
import {
  ackSend,
  adoptQueued,
  checkQueued,
  dropPending,
  isQueued,
  patchPendingAttachments,
  pendingIsEmpty,
  QUEUED_INITIAL,
  queuedReduce,
  releasePending,
  unackedUser,
  type QueuedEvent,
  type QueuedState,
} from './pendingSend';
import { answerApproval, fetchRunStatus, hermesSessions, stopBridgeTurn, streamChat, isHermesError } from './client';
import type { HermesChatOptions } from './capabilities';
import { mapRemoteMessages, needsDetails } from './sessionMapping';
import { loadToolDetails } from './toolDetails';
import { createCoalescedCheck } from './coalesce';
import { isNotFoundError, isUnsupportedError } from './sessions';
import { sessionsSupported, setSessionsSupported } from './support';
import { applyEvent, createAssistantMessage, createUserMessage, errorTextOf, finalize, newId } from './chatState';
import { abortableDelay, autoRetryDelayMs, hasVisibleOutput, retryAfterErrorText } from './retryPolicy';
import { applyRemoteAnswer, createRecovery, isRecoverable, markInterrupted, needsRunUsage, resumeCutOff, resumeRecovering, withRunUsage, type InboxAnswer } from './recovery';
import { adoptReplay, canReattach, covers, failedReattach, MAX_REATTACHES, REATTACH_SWAP_MS, replayBase, resumedStreaming, withoutResumable, type ReattachOutcome } from './reattach';
import { approvalMayHaveArrived, keyedHermesError, type StreamChatResult } from './stream';
import { branchSeedText, withContextSeed, withTurnNote, type TurnOverride } from './turnOverride';
import { createThrottle, streamIntervalFor } from './throttle';
import { liveMessages, liveOnlyTick } from './liveMessages';
import { PERF, perfDelta, perfFlush, perfMark, perfNow, perfSpan, perfTurnEnd, perfTurnStart } from '../perf/probe';
import { checkTicket, takeTicket } from './turnTicket';
import { answerInSession, newSendKey, reusableSendKey, sendKeyAfterFailure } from './idempotency';
import { serverRootOf } from './bots';
import {
  allPending,
  applyRunStatus,
  approvalKey,
  APPROVAL_EXPIRED_CODE,
  createExpiryTimer,
  dismissApproval as dismissApprovalIn,
  expireAll,
  expireApprovals,
  findApproval,
  pendingOf,
  resolveApproval,
  restoreCandidates,
  withDeadline,
} from './approvals';
import type {
  ApprovalChoice,
  ApprovalRequest,
  ChatMessage,
  ChatStatus,
  HermesConn,
  HermesEvent,
} from './types';

/** longest wait for the transcript write before a turn request (storage stuck: send anyway, the debounced save follows) */
const PERSIST_BEFORE_SEND_MS = 1500;

/** resolves when `fn()` settled or after `ms`, never rejects */
function settleWithin(fn: () => Promise<unknown> | undefined, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    Promise.resolve()
      .then(fn)
      .then(done, done);
  });
}

export type UseHermesChatOptions = {
  /** continue an existing session (e.g. restored from storage); default: fresh generated id */
  sessionId?: string;
  /** restore transcript for `sessionId` */
  initialMessages?: ChatMessage[];
  /** called when a turn ends (done/error/stopped) and when the session is reset – persist here */
  onTurnEnd?: (messages: ChatMessage[], sessionId: string) => void;
  /** called when the session id changes (newSession) */
  onSessionChange?: (sessionId: string) => void;
  /** called when a turn is sent – persist the session id now, so a killed app still finds the session */
  onTurnStart?: (sessionId: string) => void;
  /**
   * write the transcript to storage now (not debounced) and resolve once written. Called with the unacknowledged user
   * message before its turn request starts and again when the server accepted it (durable send, pendingSend.ts).
   */
  persistNow?: (messages: ChatMessage[]) => Promise<void>;
  /** UI update interval during streaming, default 33 ms (~30 fps) */
  updateIntervalMs?: number;
  // ---- additions (sessions workstream) ----
  /** per-chat reasoning/fast options, read at send time (may change between turns) */
  modelOptions?: HermesChatOptions;
  /** follow-up suggestions wanted (pref showFollowups), read at send time; `false` tells Hermes to skip them. Default on */
  followups?: boolean;
  /** fetch tool arguments/results from the stored session after a turn with tools (default true) */
  fetchToolDetails?: boolean;
  /** server `approvals.timeout` (s) if advertised (capabilities); else the event's / 300 s */
  approvalTimeoutSeconds?: number;
  /**
   * Branched chat ("In neuem Chat fortsetzen" from an earlier answer): the first `branchSeed` messages are local
   * copies the (fresh) Hermes session does not know. Until a turn was accepted, the sent message carries them as a
   * context block (turnOverride.ts); `onBranchSeedUsed` then clears the flag. Read at send time.
   */
  branchSeed?: number;
  onBranchSeedUsed?: () => void;
};

/** Bubble actions of a user message that waits for its uploads (`sendPending`). */
export type PendingSendActions = {
  messageId: string;
  /** start a failed upload again */
  retry(attachmentId: string): void;
  /** send without this attachment (a message left empty is cancelled) */
  remove(attachmentId: string): void;
  /** do not send: uploads stop, the message goes; returns its text (e.g. back into an empty composer) */
  cancel(): string;
};

/** Bubble actions of user messages queued when the app stopped (`sendQueued`, never sent by themselves). */
export type QueuedSendActions = {
  /** restore UI state of one queued message (pendingSend.ts queuedReduce) */
  state(messageId: string): QueuedState;
  /** check Hermes (already sent? → shown as sent), else upload what is missing and start the turn */
  resend(messageId: string): void;
  /** remove it and its files; returns its text (back into the composer) */
  discard(messageId: string): string;
};

export type UseHermesChat = {
  messages: ChatMessage[];
  /**
   * send a new user message, optionally with attachments. Returns false when the send was ignored
   * (empty, a turn is still running, or the chat was already unmounted) – the caller keeps its draft.
   * `pending` (Hermes): uploads of `attachments` still running – shown at once, the turn starts when they are done.
   */
  send: (text: string, attachments?: Attachment[], pending?: PendingUploads) => boolean;
  /** the user message waiting for its uploads, if any (Hermes only) */
  pendingSend?: PendingSendActions | null;
  /** messages queued when the app stopped (Hermes only) */
  queuedSend?: QueuedSendActions;
  /** abort the running turn (keeps the partial answer, status `stopped`) */
  stop: () => void;
  /**
   * re-run the last user message (drops the last assistant message); false when ignored. `override`: one-turn
   * model / hidden note / web search off (answer menu "Erneut versuchen ▸", turnOverride.ts)
   */
  retry: (override?: TurnOverride) => boolean;
  /** start a fresh session (new id, empty transcript) */
  newSession: () => void;
  status: ChatStatus;
  sessionId: string;
  /** error of the last failed turn */
  error: string | undefined;
  /** first pending approval (head of `approvals`), if any */
  approval: ApprovalRequest | null;
  /** answer the head approval (see respondApprovalFor) */
  respondApproval: (choice: ApprovalChoice) => Promise<void>;
  // ---- approval queue (Hermes; optional for the other backends) ----
  /** every pending approval of this chat, oldest first (expired ones stay until dismissed / the run ends) */
  approvals?: ApprovalRequest[];
  /**
   * answer one request. Rejects with a HermesError (`approval_expired`: deadline passed – nothing was sent;
   * `approval_not_pending` / `approval_not_active` / 404; network …). Success: removed + history row.
   */
  respondApprovalFor?: (approval: ApprovalRequest, choice: ApprovalChoice) => Promise<void>;
  /** hide an expired / gone request (no answer is sent; history row expired / cancelled) */
  dismissApproval?: (approval: ApprovalRequest) => void;
  /**
   * check GET /v1/runs/{completionId} of the open / interrupted turns now and rebuild pending approvals
   * (also runs on mount, foreground, inbox reconnect and after a lost stream). `runId` limits it to one run.
   */
  checkApprovals?: (runId?: string) => Promise<void>;
  /** notification tap (openPendingApproval): check now and bring the card of `runId` to the front */
  openApproval?: (runId?: string) => void;
  /** last openApproval request (the card stack reveals + focuses it) */
  approvalFocus?: { runId?: string; at: number } | null;
  /**
   * Replace the transcript (e.g. a refreshed Hermes session from another device/platform). Ignored
   * (returns false) while a turn is streaming. Optional so other backends sharing this type need not implement it.
   */
  replaceMessages?: (messages: ChatMessage[]) => boolean;
  /**
   * Live inbox event of this chat's session: completes an interrupted answer in place (true), never appends.
   * Hermes only (optional for the other backends sharing this type).
   */
  applyInbox?: (ev: InboxAnswer) => boolean;
  /** check the stored session for an interrupted answer now (inbox reconnected) */
  recoverNow?: () => void;
  /**
   * "Fortsetzen" after a cut / failed / stopped answer (direct backends, background/cut.ts): re-sends history +
   * the partial answer with a hidden continue instruction and appends the continuation to the SAME message.
   * false when ignored (running, nothing to continue). Optional: Hermes recovers server-side instead.
   */
  continueTurn?: () => boolean;
};

export function newSessionId(): string {
  return newId('hui');
}

export function useHermesChat(conn: HermesConn, options: UseHermesChatOptions = {}): UseHermesChat {
  // an answer persisted mid-stream (app killed) is completed from the stored session (recovery.ts)
  const [messages, setMessagesState] = useState<ChatMessage[]>(() => resumeCutOff(options.initialMessages ?? []));
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [sessionId, setSessionId] = useState<string>(() => options.sessionId ?? newSessionId());
  const [error, setError] = useState<string | undefined>(undefined);

  // source of truth for the stream (state is a throttled mirror)
  const messagesRef = useRef<ChatMessage[]>(messages);
  /** the list React state last got, when, and the streaming answer it keeps a live store entry for (liveMessages.ts) */
  const committedRef = useRef<{ list: ChatMessage[]; at: number; liveId: string | null }>({ list: messages, at: 0, liveId: null });
  /** every state update of the list: the live store entry follows it */
  const setMessages = useCallback((list: ChatMessage[]) => {
    const c = committedRef.current;
    c.list = list;
    c.at = Date.now();
    // after unmount (a late settle of the aborted turn) no entry is created: a remount must not find a stale one
    c.liveId = mountedRef.current ? liveMessages.commit(c.liveId, list) : null;
    setMessagesState(list);
  }, []);
  const sessionRef = useRef(sessionId);
  const connRef = useRef(conn);
  const optsRef = useRef(options);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  // stop() was pressed: an aborted stream is `stopped`, not interrupted
  const userStopRef = useRef(false);
  /** bumped by stop() and newSession(): async continuations (retry's recovery check) check their ticket (turnTicket.ts) */
  const turnGenRef = useRef(0);
  /**
   * A stream lost after Hermes accepted the turn is recoverable behind the UI bridge (it keeps the run going and
   * reports the answer via the live inbox) when the session API is there. Direct Hermes interrupts the agent itself
   * when the connection drops (docs/HERMES-API.md) → a normal error there.
   */
  // set after mount (checkApprovals is defined below `run`, which needs it after a lost stream)
  const checkApprovalsRef = useRef<(runId?: string) => Promise<void>>(async () => {});
  const canRecover = () => !!connRef.current.bridge && sessionsSupported(connRef.current) !== false;
  // false after unmount: a late send (e.g. an undo-window commit of a chat the user left) is refused
  const mountedRef = useRef(true);
  /** the send waiting for its uploads (sendPending message), see send() */
  const pendingRef = useRef<{ message: ChatMessage; text: string; uploads: PendingUploads } | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSendActions | null>(null);
  /** restore UI state of queued messages by id (absent = QUEUED_INITIAL) */
  const queuedRef = useRef(new Map<string, QueuedState>());
  const [queuedVersion, setQueuedVersion] = useState(0);
  /** "try now" listeners of a re-attaching stream (stream.ts `wake`): app in the foreground, inbox reconnected */
  const wakeRef = useRef(new Set<() => void>());
  /** live re-attaches per message id (reattach.ts MAX_REATTACHES) */
  const reattachesRef = useRef(new Map<string, number>());
  /** a re-attach whose request has not been answered yet: a new send cancels it (the user must never wait for it) */
  const attachingRef = useRef<AbortController | null>(null);
  /** set below `run`: re-attach a recovering message (the recovery driver is created before it) */
  const reattachRef = useRef<(m: ChatMessage) => Promise<ReattachOutcome>>(async () => 'retry');
  /** completion ids whose run status was already asked for token counts */
  const usageAskedRef = useRef(new Set<string>());
  connRef.current = conn;
  optsRef.current = options;

  const throttle = useMemo(
    () =>
      createThrottle(() => {
        perfFlush();
        const next = messagesRef.current;
        const c = committedRef.current;
        // only the streaming answer's text / reasoning grew: its live part re-renders, not the chat and the list
        if (liveOnlyTick(c.list, next, Date.now() - c.at)) liveMessages.publish(next[next.length - 1]);
        else setMessages(next);
      }, options.updateIntervalMs ?? (() => streamIntervalFor(messagesRef.current))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      throttle.cancel();
      liveMessages.drop(committedRef.current.liveId);
      committedRef.current.liveId = null;
      abortRef.current?.abort();
      // chat closed / deleted while its uploads ran (a switch keeps the session mounted: it counts as running). The
      // files stay: the stored transcript keeps the message as queued (re-send later); deleting the chat removes them
      const p = pendingRef.current;
      pendingRef.current = null;
      p?.uploads.cancel();
    };
  }, [throttle]);

  const wake = useCallback((fn: () => void) => {
    wakeRef.current.add(fn);
    return () => {
      wakeRef.current.delete(fn);
    };
  }, []);
  const wakeStreams = () => {
    for (const fn of [...wakeRef.current]) fn();
  };

  const updateLast = useCallback(
    (fn: (m: ChatMessage) => ChatMessage) => {
      const list = messagesRef.current;
      if (list.length === 0) return;
      const next = list.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      messagesRef.current = next;
      throttle.call();
    },
    [throttle]
  );

  /** recovery wrote a new transcript (completed or given-up answer): show + persist */
  const commitRecovered = useCallback(
    (list: ChatMessage[]) => {
      messagesRef.current = list;
      if (runningRef.current) {
        throttle.call(); // a newer turn is running: it persists at its end
        return;
      }
      throttle.cancel();
      setMessages(list);
      const last = list[list.length - 1];
      const failed = last?.role === 'assistant' && last.status === 'error' ? (last.error ?? 'Fehler') : undefined;
      setError(failed);
      setStatus(failed ? 'error' : 'idle');
      optsRef.current.onTurnEnd?.(list, sessionRef.current);
      void fillRunUsage(list);
    },
    [throttle]
  );

  /** an answer filled in later lacks the stream's usage chunk: take the token counts from its run status, if any */
  const fillRunUsage = async (list: ChatMessage[]) => {
    let m: ChatMessage | undefined;
    for (let i = list.length - 1; i >= 0 && !m; i--) if (needsRunUsage(list[i])) m = list[i];
    if (!m?.completionId || usageAskedRef.current.has(m.completionId)) return;
    usageAskedRef.current.add(m.completionId);
    let usage;
    try {
      usage = (await fetchRunStatus(connRef.current, m.completionId)).usage;
    } catch {
      return; // offline / older server: the footer shows the time only
    }
    if (!usage || !mountedRef.current) return;
    const at = messagesRef.current.findIndex((x) => x.id === m.id);
    if (at < 0 || !needsRunUsage(messagesRef.current[at])) return;
    const next = messagesRef.current.slice();
    next[at] = withRunUsage(next[at], usage);
    messagesRef.current = next;
    if (runningRef.current) {
      throttle.call(); // the running turn persists at its end
      return;
    }
    throttle.cancel();
    setMessages(next);
    optsRef.current.onTurnEnd?.(next, sessionRef.current);
  };

  /** the stored Hermes session, mapped; null = no session API; throws when the fetch failed (refs only: stable) */
  const fetchStoredSession = async (): Promise<ChatMessage[] | null> => {
    const c = connRef.current;
    const sid = sessionRef.current;
    if (sessionsSupported(c) === false) return null;
    try {
      const page = await hermesSessions(c, 12000).messages(sid, { order: 'latest', limit: 120 });
      setSessionsSupported(c, true);
      return sessionRef.current === sid ? mapRemoteMessages(page.messages) : [];
    } catch (e) {
      if (isUnsupportedError(e)) {
        setSessionsSupported(c, false);
        return null;
      }
      if (isNotFoundError(e)) return []; // not stored yet
      throw e;
    }
  };

  const recovery = useMemo(
    () =>
      createRecovery({
        get: () => messagesRef.current,
        commit: (list) => {
          if (mountedRef.current) commitRecovered(list);
        },
        // the bridge's push watcher reads the same Hermes session API: without it no inbox event will come
        inboxAvailable: () => canRecover(),
        runStatus: async (m) => {
          if (!m.completionId) return null;
          try {
            return (await fetchRunStatus(connRef.current, m.completionId)).status;
          } catch {
            return null;
          }
        },
        fetchRemote: () => fetchStoredSession(),
        canReattach: (m) => {
          const list = messagesRef.current;
          return (
            !!connRef.current.bridge &&
            mountedRef.current &&
            !runningRef.current &&
            (reattachesRef.current.get(m.id) ?? 0) < MAX_REATTACHES &&
            canReattach(list, list.findIndex((x) => x.id === m.id))
          );
        },
        reattach: (m) => reattachRef.current(m),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    recovery.start(); // a restored interrupted answer
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      wakeStreams(); // a stream re-attaching: try now
      recovery.poke();
    });
    return () => {
      sub.remove();
      recovery.dispose();
    };
  }, [recovery]);


  /** a stream event for the last message: approvals get their deadline (advertised timeout) when they arrive */
  const stamped = (ev: HermesEvent, now: number): HermesEvent =>
    ev.type === 'approval'
      ? { ...ev, approval: withDeadline(ev.approval, { receivedAt: now, advertisedTimeoutS: optsRef.current.approvalTimeoutSeconds, restored: ev.approval.restored ? { serverNowMs: ev.approval.serverNowMs } : undefined }) }
      : ev;

  /** a resumable stream of the last message was lost (re-attaching) or continues: the "verbinde neu" note */
  const markConnection = (state: 'lost' | 'resumed') =>
    updateLast((m) => {
      if (m.role !== 'assistant' || m.status !== 'streaming') return m;
      if (state === 'lost') return { ...m, reconnecting: Date.now() };
      const { reconnecting: _r, ...rest } = m;
      return rest;
    });

  /**
   * The outcome of the streamed turn in the last message (`current()` holds): its result, or what it threw.
   * `accepted`: the server took the turn. Returns the failure text (error bubble) and whether it is being recovered.
   */
  const settleTurn = (outcome: { result: StreamChatResult } | { error: unknown }, accepted: boolean, idempotencyKey?: string): { failure?: string; interrupted: boolean } => {
    if ('result' in outcome) {
      if (outcome.result.aborted) {
        // the chat was closed mid-turn (not stop()): the bridge keeps the run going → recover when reopened
        if (!userStopRef.current && !mountedRef.current && accepted && connRef.current.bridge) {
          updateLast((m) => markInterrupted(m, Date.now()));
          return { interrupted: true };
        }
        updateLast((m) => finalize(m, 'stopped', undefined, Date.now()));
        return { interrupted: false };
      }
      // finish event normally already set done/error; make sure nothing stays "streaming"
      updateLast((m) => (m.status === 'streaming' ? finalize(m, 'done', undefined, Date.now()) : m));
      const last = messagesRef.current[messagesRef.current.length - 1];
      return { failure: last?.status === 'error' ? (last.error ?? 'Fehler') : undefined, interrupted: false };
    }
    const e = outcome.error;
    if (isHermesError(e) && e.kind === 'aborted') {
      updateLast((m) => finalize(m, 'stopped', undefined, Date.now()));
      return { interrupted: false };
    }
    if (isHermesError(e) && answerInSession(e) && canRecover()) {
      // connection lost after Hermes took the turn: it keeps running server-side → wait for the answer (or re-attach
      // later: the bridge refused only when `resumeCode` says so). turn_unrecorded: a retry whose earlier attempt ran on
      // the bridge without a recording – same, never twice
      const refused = !!e.resumeCode;
      updateLast((m) => {
        const next = markInterrupted(m, Date.now());
        return refused ? withoutResumable(next) : next;
      });
      return { interrupted: true };
    }
    const failure = e instanceof Error ? e.message : String(e);
    const key = retryAfterErrorText(e) ?? errorTextOf(e);
    // the bridge refused this key for good: the next "Erneut" needs a fresh one (idempotency.ts)
    const nextKey = idempotencyKey ? sendKeyAfterFailure(idempotencyKey, isHermesError(e) ? e.code : undefined) : undefined;
    updateLast((m) => {
      const done = finalize(m, 'error', failure, Date.now(), key);
      return nextKey && done.role === 'assistant' && done.sendKey === idempotencyKey ? { ...done, sendKey: nextKey } : done;
    });
    return { failure, interrupted: false };
  };

  /** the running turn of `sid` is over (`current()` holds): show + persist, then recovery / tool details */
  const endTurn = (sid: string, failure: string | undefined, interrupted: boolean) => {
    // ended before the server took it (error / stop): a sent message with a failed answer ("Erneut" re-uses the key)
    messagesRef.current = ackSend(messagesRef.current);
    runningRef.current = false;
    abortRef.current = null;
    throttle.cancel();
    perfTurnEnd();
    setMessages(messagesRef.current);
    setError(failure);
    setStatus(failure ? 'error' : 'idle');
    optsRef.current.onTurnEnd?.(messagesRef.current, sid);
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (interrupted) {
      if (mountedRef.current) {
        recovery.start();
        void checkApprovalsRef.current();
      }
    } else if (!failure && last && optsRef.current.fetchToolDetails !== false && needsDetails(last)) {
      void loadDetails(last.id, sid);
    }
  };

  const run = useCallback(
    async (text: string, attachments: Attachment[] = [], override?: TurnOverride, sendKey?: string) => {
      perfTurnStart();
      runningRef.current = true;
      userStopRef.current = false;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus('streaming');
      setError(undefined);
      const sid = sessionRef.current;
      optsRef.current.onTurnStart?.(sid);
      let accepted = false;
      let interrupted = false;

      // false after newSession(): this turn's results must not touch the new session's state
      const current = () => abortRef.current === ctrl;
      let failure: string | undefined;
      // branched chat: the copied turns go along as context until Hermes accepted a turn of the new session
      const seedN = optsRef.current.branchSeed ?? 0;
      const seed = seedN > 0 ? branchSeedText(messagesRef.current.slice(0, Math.min(seedN, messagesRef.current.length - 2))) : '';
      const sendText = withTurnNote(withContextSeed(seed, text), override?.note);
      const turnConn = override?.model ? { ...connRef.current, model: override.model } : connRef.current;
      // Idempotency-Key of this send (also for the automatic 429/503 retry below: the bridge only keeps a turn Hermes took)
      const idempotencyKey = sendKey ?? newSendKey();
      updateLast((m) => (m.role === 'assistant' ? { ...m, sendKey: idempotencyKey } : m));
      try {
        // durable send (pendingSend.ts): the user message is in storage – queued, with its key – before the request
        // starts, so a kill before the server took the turn restores it as "Nicht gesendet" instead of losing it
        const persist = optsRef.current.persistNow;
        if (persist && messagesRef.current.some((m) => m.sendUnacked)) {
          await settleWithin(() => persist(messagesRef.current), PERSIST_BEFORE_SEND_MS);
          perfMark('persisted');
          if (!current()) return;
        }
        // attachments → OpenAI content parts (images inline, bridge files as path references);
        // an AttachmentError (file gone, too large) lands in the catch below as a turn error
        const content = attachments.length
          ? await buildHermesContent(sendText, attachments, { reader: fileReader, bridge: !!connRef.current.bridge })
          : sendText;
        if (!current()) return;
        let result: Awaited<ReturnType<typeof streamChat>>;
        for (let attempt = 0; ; attempt++) {
          try {
            result = await streamChat({
              conn: turnConn,
              text: sendText,
              content,
              sessionId: sid,
              signal: ctrl.signal,
              modelOptions: optsRef.current.modelOptions,
              followups: optsRef.current.followups,
              idempotencyKey,
              wake,
              onConnection: (state) => {
                if (current()) markConnection(state);
              },
              onAccepted: ({ resumable }) => {
                perfMark('headers');
                accepted = true;
                if (seed) optsRef.current.onBranchSeedUsed?.();
                // the bridge recorded the turn: a stream lost for longer (or an app restart) re-attaches live later
                if (resumable && current()) updateLast((m) => (m.role === 'assistant' ? { ...m, resumable: true } : m));
                // the server has the turn: a normal sent message from now on (a kill now recovers its answer)
                if (current() && messagesRef.current.some((m) => m.sendUnacked)) {
                  messagesRef.current = ackSend(messagesRef.current);
                  throttle.call();
                  const persist = optsRef.current.persistNow;
                  if (persist) void settleWithin(() => persist(messagesRef.current), PERSIST_BEFORE_SEND_MS);
                }
              },
              onEvent: (ev) => {
                if (abortRef.current !== ctrl) return;
                const now = Date.now();
                const e = stamped(ev, now);
                if (e.type === 'text') perfDelta(e.text.length);
                const t0 = PERF ? perfNow() : 0;
                updateLast((m) => applyEvent(m, e, now));
                if (PERF) perfSpan('state.update', t0);
              },
            });
            break;
          } catch (e) {
            // 429 / 503 with a short Retry-After before any output → wait and retry once
            const last = messagesRef.current[messagesRef.current.length - 1];
            const delay = current() ? autoRetryDelayMs(e, { attempt, streamed: hasVisibleOutput(last) }) : null;
            if (delay === null) throw e;
            await abortableDelay(delay, ctrl.signal);
            if (ctrl.signal.aborted) throw keyedHermesError('aborted', 'backends.hermes.errors.aborted');
            if (!current()) return;
          }
        }
        // !current(): superseded by newSession()
        if (current()) ({ failure, interrupted } = settleTurn({ result }, accepted));
      } catch (e) {
        if (current()) ({ failure, interrupted } = settleTurn({ error: e }, accepted, idempotencyKey));
      } finally {
        if (current()) endTurn(sid, failure, interrupted);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [throttle, updateLast]
  );

  /**
   * Re-attach the recovering last answer `target` to the bridge's recording of its turn (reattach.ts): the turn is
   * replayed from byte 0 into a fresh copy that takes over the bubble once it covers it, then continues live.
   * Resolves as soon as the outcome is known (`live` once the bridge answered with the stream); the turn itself runs on.
   */
  const reattach = (target: ChatMessage): Promise<ReattachOutcome> => {
    const list = messagesRef.current;
    if (runningRef.current) return Promise.resolve('retry');
    if (!mountedRef.current || !connRef.current.bridge || !target.sendKey || !canReattach(list, list.findIndex((m) => m.id === target.id))) {
      return Promise.resolve('gone');
    }
    const key = target.sendKey;
    return new Promise<ReattachOutcome>((tell) => {
      runningRef.current = true;
      userStopRef.current = false;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      attachingRef.current = ctrl;
      const sid = sessionRef.current;
      const current = () => abortRef.current === ctrl;
      let accepted = false;
      let failure: string | undefined;
      let interrupted = false;
      /** the replayed copy until it takes over the bubble (null afterwards) */
      let replay: ChatMessage | null = replayBase(target);
      let swapAt = Infinity;
      const shown = () => messagesRef.current[messagesRef.current.length - 1];
      const takeOver = () => {
        const r = replay;
        replay = null;
        if (r) updateLast((m) => (m.id === r.id ? adoptReplay(m, r) : m));
      };
      void (async () => {
        try {
          const result = await streamChat({
            conn: connRef.current,
            text: '',
            sessionId: sid,
            signal: ctrl.signal,
            idempotencyKey: key,
            resumeFrom: 0,
            wake,
            onConnection: (state) => {
              if (current()) markConnection(state);
            },
            onAccepted: () => {
              accepted = true;
              if (attachingRef.current === ctrl) attachingRef.current = null;
              reattachesRef.current.set(target.id, (reattachesRef.current.get(target.id) ?? 0) + 1);
              swapAt = Date.now() + REATTACH_SWAP_MS;
              if (current()) {
                // streaming again: no "loading the answer" note, the composer offers Stop
                updateLast((m) => (m.id === target.id ? resumedStreaming(m) : m));
                setStatus('streaming');
                setError(undefined);
              }
              tell('live');
            },
            onEvent: (ev) => {
              if (abortRef.current !== ctrl) return;
              const now = Date.now();
              const e = stamped(ev, now);
              if (!replay) return updateLast((m) => applyEvent(m, e, now));
              replay = applyEvent(replay, e, now);
              const last = shown();
              if (ev.type === 'finish' || ev.type === 'error' || now >= swapAt || (last && covers(replay, last))) takeOver();
            },
          });
          if (current() && !accepted) {
            tell('retry'); // aborted before the bridge answered (chat closed): the bubble stays recovering
          } else if (current()) {
            const last = shown();
            if (!result.aborted || (replay && last && covers(replay, last))) takeOver();
            replay = null;
            ({ failure, interrupted } = settleTurn({ result }, accepted));
          }
        } catch (e) {
          if (current() && !accepted) {
            // the bridge did not continue the turn: the bubble stays as it was (recovering)
            const outcome = isHermesError(e) ? failedReattach(e) : 'retry';
            if (outcome === 'gone') updateLast((m) => (m.id === target.id ? withoutResumable(m) : m));
            tell(outcome);
          } else if (current()) {
            const last = shown();
            if (replay && last && covers(replay, last)) takeOver();
            replay = null;
            ({ failure, interrupted } = settleTurn({ error: e }, accepted));
          }
        } finally {
          if (attachingRef.current === ctrl) attachingRef.current = null;
          if (current()) {
            if (accepted) endTurn(sid, failure, interrupted);
            else {
              runningRef.current = false;
              abortRef.current = null;
              throttle.cancel();
              setMessages(messagesRef.current);
              optsRef.current.onTurnEnd?.(messagesRef.current, sid); // e.g. `resumable` dropped
            }
          }
          tell('retry'); // superseded / aborted before the answer (no-op once told)
        }
      })();
    });
  };
  reattachRef.current = reattach;

  /** a re-attach still waiting for the bridge's answer gives way to a new send (the answer stays recovering) */
  const cancelAttach = () => {
    const ctrl = attachingRef.current;
    if (!ctrl) return;
    attachingRef.current = null;
    if (abortRef.current === ctrl) {
      abortRef.current = null;
      runningRef.current = false;
    }
    ctrl.abort();
  };

  /** running tool-detail jobs: aborted on unmount / new session (a retired hook must never apply them) */
  const detailJobs = useRef(new Set<AbortController>());
  useEffect(() => {
    const jobs = detailJobs.current;
    return () => {
      for (const j of jobs) j.abort();
      jobs.clear();
    };
  }, []);

  /** after a turn with tools: fill ToolEvent.detail (+ reasoning) from the stored session (toolDetails.ts) */
  const loadDetails = async (messageId: string, sid: string) => {
    const c = connRef.current;
    if (sessionsSupported(c) === false) return;
    const client = hermesSessions(c, 10000);
    const ctrl = new AbortController();
    detailJobs.current.add(ctrl);
    try {
      await loadToolDetails({
        messageId,
        signal: ctrl.signal,
        alive: () => mountedRef.current && sessionRef.current === sid,
        fetchRows: async () => {
          const rows = (await client.messages(sid, { order: 'latest', limit: 80 })).messages;
          setSessionsSupported(c, true);
          return rows;
        },
        onError: (e) => {
          if (isUnsupportedError(e)) setSessionsSupported(c, false);
        },
        get: () => messagesRef.current,
        commit: (next) => {
          messagesRef.current = next;
          if (runningRef.current) {
            throttle.call(); // the running turn persists at its end
          } else {
            throttle.cancel();
            setMessages(next);
            optsRef.current.onTurnEnd?.(next, sid);
          }
        },
      });
    } finally {
      detailJobs.current.delete(ctrl);
    }
  };

  /** cancel the send waiting for its uploads (stop, ×, newSession); returns its text */
  const cancelPending = useCallback(
    (): string => {
      const p = pendingRef.current;
      if (!p) return '';
      pendingRef.current = null;
      const gone = p.uploads.cancel();
      void deleteAttachmentFiles(gone);
      void queuedFiles.drop(gone.map((a) => a.id));
      messagesRef.current = dropPending(messagesRef.current, p.message.id);
      runningRef.current = false;
      throttle.cancel();
      setMessages(messagesRef.current);
      setPendingSend(null);
      setStatus('idle');
      // the bubble was stored as queued: persist its removal explicitly (an empty list is not saved by the
      // new-message effect, so the cancelled first message of a chat would come back on restart, Sol F08)
      optsRef.current.onTurnEnd?.(messagesRef.current, sessionRef.current);
      return p.text;
    },
    [throttle, setPendingSend]
  );

  const send = useCallback(
    /** `sendKey`: Idempotency-Key of an earlier attempt of this message ("Erneut senden" of a queued message) */
    (text: string, attachments: Attachment[] = [], pending?: PendingUploads, sendKey?: string) => {
      const t = text.trim();
      if (t || attachments.length) cancelAttach();
      if ((!t && !attachments.length) || runningRef.current || !mountedRef.current) return false;
      const now = Date.now();
      // the key of this message's turn; the message is stored (queued, with it) before the request starts
      const key = sendKey ?? newSendKey();
      if (pending && pending.state() !== 'ready') {
        // uploads still running: the bubble now, the turn once they are done
        const message: ChatMessage = { ...createUserMessage(t, now, pending.snapshot()), sendPending: true };
        pendingRef.current = { message, text: t, uploads: pending };
        // web: the bytes outlive a reload while the message waits (stored as queued, attachments/queuedFiles.ts)
        void queuedFiles.stash(message.attachments ?? []);
        messagesRef.current = [...messagesRef.current, message];
        runningRef.current = true; // no second send / retry meanwhile
        throttle.cancel();
        setMessages(messagesRef.current);
        setError(undefined);
        setStatus('streaming'); // the composer offers Stop (= cancel)
        const own = () => pendingRef.current?.uploads === pending;
        const actions: PendingSendActions = {
          messageId: message.id,
          retry: (id) => {
            if (own()) pending.retry(id);
          },
          remove: (id) => {
            if (!own()) return;
            const gone = pending.remove(id);
            if (gone) {
              void deleteAttachmentFiles([gone]);
              void queuedFiles.drop([gone.id]);
            }
            if (own() && pendingIsEmpty(t, pending.snapshot())) cancelPending();
          },
          cancel: () => (own() ? cancelPending() : ''),
        };
        setPendingSend(actions);
        pending.attach({
          onChange: (atts) => {
            const p = pendingRef.current;
            if (!p || p.uploads !== pending) return;
            const r = patchPendingAttachments(messagesRef.current, p.message, atts);
            p.message = r.message;
            messagesRef.current = r.list;
            throttle.call();
          },
          onReady: (sent) => {
            const p = pendingRef.current;
            if (!p || p.uploads !== pending) return;
            pendingRef.current = null;
            setPendingSend(null);
            void queuedFiles.drop((p.message.attachments ?? []).map((a) => a.id));
            if (pendingIsEmpty(t, sent)) {
              // every attachment was removed and there is no text: nothing to send
              messagesRef.current = dropPending(messagesRef.current, p.message.id);
              runningRef.current = false;
              throttle.cancel();
              setMessages(messagesRef.current);
              setStatus('idle');
              optsRef.current.onTurnEnd?.(messagesRef.current, sessionRef.current); // as in cancelPending
              return;
            }
            messagesRef.current = releasePending(messagesRef.current, p.message, sent, Date.now(), key);
            throttle.cancel();
            setMessages(messagesRef.current);
            void run(t, sent, undefined, key);
          },
        });
        return true;
      }
      const atts = pending ? pending.snapshot().map(toSent) : attachments;
      messagesRef.current = [...messagesRef.current, unackedUser(createUserMessage(t, now, atts), key), createAssistantMessage(now)];
      throttle.cancel();
      setMessages(messagesRef.current);
      void run(t, atts, undefined, key);
      return true;
    },
    [run, throttle, cancelPending, setPendingSend]
  );

  /** UI bridge: the bridge keeps a run alive when the connection drops, so a deliberate stop must tell it */
  const stopOnBridge = useCallback(() => {
    if (abortRef.current && connRef.current.bridge) void stopBridgeTurn(connRef.current, sessionRef.current).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    if (pendingRef.current) {
      cancelPending(); // waiting for uploads: nothing was sent yet
      return;
    }
    userStopRef.current = true;
    turnGenRef.current++;
    stopOnBridge();
    abortRef.current?.abort();
  }, [stopOnBridge, cancelPending]);

  const retry = useCallback((override?: TurnOverride) => {
    if (runningRef.current || !mountedRef.current) return false;
    const list = messagesRef.current;
    // last user message (a queued one at the end is not sent: re-sending the turn before it would drop it)
    let ui = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') {
        if (isQueued(list[i])) return false;
        ui = i;
        break;
      }
    }
    if (ui === -1) return false;
    const text = list[ui].text;
    // bridge files keep their remoteRef (the bridge keeps uploads for 7 days)
    const attachments = list[ui].attachments ?? [];
    const answer = list[ui + 1];
    // a send that failed before any answer arrived may still have reached the bridge: same key → never a second turn
    const sendKey = reusableSendKey(answer, override);
    const resend = () => {
      // keep everything up to and including that user message, add a fresh assistant placeholder
      messagesRef.current = [...messagesRef.current.slice(0, ui + 1), createAssistantMessage(Date.now())];
      throttle.cancel();
      setMessages(messagesRef.current);
      void run(text, attachments, override, sendKey);
    };
    if (!isRecoverable(answer) || sessionsSupported(connRef.current) === false) {
      resend();
      return true;
    }
    // the stream of this turn was lost after Hermes took it: it may have finished meanwhile → never send it twice
    runningRef.current = true;
    setStatus('streaming');
    // newSession() / stop() while the check runs: never resend into (or touch the state of) what came after
    const ticket = takeTicket(sessionRef.current, turnGenRef.current);
    void recovery.checkTurn(answer.id).then((res) => {
      const state = checkTicket(ticket, sessionRef.current, turnGenRef.current);
      if (state === 'superseded') return; // the new session owns runningRef / status now
      runningRef.current = false;
      if (!mountedRef.current) return;
      if (state === 'stopped') {
        setStatus('idle');
        return;
      }
      const cur = messagesRef.current[ui + 1];
      const still = cur?.id === answer.id && isRecoverable(cur);
      if (res.kind === 'recovered') commitRecovered(res.list);
      else if (!still) commitRecovered(messagesRef.current); // completed meanwhile (inbox / transcript sync)
      else if (res.kind === 'resend') resend();
      else {
        // the original run may still be going (or the check failed): wait for its answer, never send it twice
        const next = messagesRef.current.slice();
        next[ui + 1] = resumeRecovering(cur, Date.now());
        commitRecovered(next);
        recovery.start();
      }
    });
    return true;
  }, [run, throttle, recovery, commitRecovered]);

  const newSession = useCallback(() => {
    cancelPending();
    turnGenRef.current++;
    stopOnBridge();
    abortRef.current?.abort();
    abortRef.current = null; // marks the running turn (if any) as superseded
    throttle.cancel();
    for (const j of detailJobs.current) j.abort();
    const id = newSessionId();
    sessionRef.current = id;
    messagesRef.current = [];
    runningRef.current = false;
    setSessionId(id);
    setMessages([]);
    setError(undefined);
    setStatus('idle');
    optsRef.current.onSessionChange?.(id);
  }, [throttle, stopOnBridge, cancelPending]);

  const replaceMessages = useCallback(
    (list: ChatMessage[]) => {
      if (runningRef.current) return false;
      throttle.cancel();
      messagesRef.current = list;
      setMessages(list);
      return true;
    },
    [throttle]
  );

  // ---------------------------------------------------------------- approvals (queue, expiry, restore)

  /** change the transcript outside a stream event (answer, expiry, restore): show + persist (or let the run persist) */
  const patchMessages = useCallback(
    (fn: (list: ChatMessage[]) => ChatMessage[]) => {
      const prev = messagesRef.current;
      const next = fn(prev);
      if (next === prev) return;
      messagesRef.current = next;
      if (runningRef.current) {
        throttle.call(); // the running turn persists at its end
        return;
      }
      throttle.cancel();
      setMessages(next);
      optsRef.current.onTurnEnd?.(next, sessionRef.current);
    },
    [throttle]
  );

  // ---------------------------------------------------------------- queued after a restart (sendQueued)

  const stepQueued = useCallback((id: string, e: QueuedEvent): QueuedState => {
    const prev = queuedRef.current.get(id) ?? QUEUED_INITIAL;
    const next = queuedReduce(prev, e);
    if (next !== prev) {
      queuedRef.current.set(id, next);
      setQueuedVersion((v) => v + 1);
    }
    return next;
  }, []);
  const forgetQueued = useCallback((id: string) => {
    if (queuedRef.current.delete(id)) setQueuedVersion((v) => v + 1);
  }, []);

  /**
   * "Erneut senden": never blind. The stored Hermes session is checked first (killed after the turn started but
   * before the transcript was saved → shown as sent, its answer recovered); otherwise the queued copy becomes a live
   * pending send: missing uploads start again, the turn starts when they are done (send()).
   */
  const resendQueued = useCallback(
    async (id: string) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (!m || !isQueued(m) || !mountedRef.current) return;
      // claim: only the call that moves it from queued to checking owns this resend. A second tap before the
      // re-render gets the unchanged `checking` state back and must not start another check / send (Sol F07)
      const claimed = queuedRef.current.get(id) ?? QUEUED_INITIAL;
      if (claimed.phase !== 'queued' || stepQueued(id, { type: 'resend', busy: runningRef.current }).phase !== 'checking') return;
      runningRef.current = true; // no send / retry / transcript replace while this runs
      const sid = sessionRef.current;
      const gen = turnGenRef.current;
      const alive = () => mountedRef.current && sessionRef.current === sid && turnGenRef.current === gen;
      let remote: ChatMessage[] | null | 'error';
      try {
        remote = await fetchStoredSession();
      } catch {
        remote = 'error';
      }
      if (!alive()) {
        if (mountedRef.current && sessionRef.current === sid) runningRef.current = false;
        forgetQueued(id);
        return;
      }
      const st = stepQueued(id, { type: 'checked', result: checkQueued(messagesRef.current, id, remote) });
      if (st.phase !== 'sending') {
        runningRef.current = false;
        if (st.phase !== 'adopted') return; // check failed: stays queued, the bubble says why
        forgetQueued(id);
        void queuedFiles.drop((m.attachments ?? []).map((a) => a.id));
        let next = adoptQueued(messagesRef.current, id, Date.now());
        const at = next.findIndex((x) => x.id === id) + 1;
        if (Array.isArray(remote)) next = applyRemoteAnswer(next, remote, at) ?? next;
        commitRecovered(next);
        recovery.start();
        return;
      }
      const cur = messagesRef.current.find((x) => x.id === id) ?? m;
      const atts = await queuedFiles.restore(cur.attachments ?? []);
      forgetQueued(id);
      if (!alive()) {
        if (mountedRef.current && sessionRef.current === sid) runningRef.current = false;
        return;
      }
      const c = connRef.current;
      const target: AttachmentTarget = { kind: 'hermes', bridge: !!c.bridge };
      // uploads are a bridge route: server root, never under a bot's /p/<bot> prefix (hermes/bots.ts)
      const bridge = c.bridge ? { baseUrl: serverRootOf(c.baseUrl), apiKey: c.apiKey } : null;
      const start = (a: Attachment): UploadTask =>
        startUploadTask(a, (x, o) => (bridge ? uploadAttachment(x, bridge, o) : Promise.reject(new AttachmentError('no_bridge', { key: 'attachments.upload.noBridge' }, x.id))));
      const tasks = new Map<string, UploadTask>();
      for (const a of atts) if (a.status !== 'error' && needsUpload(a, target)) tasks.set(a.id, start(a));
      const pending = createPendingUploads(atts, tasks, { target, start });
      // the queued copy goes; send() appends the live message (fresh id + time: the turn starts now)
      const before = messagesRef.current;
      messagesRef.current = before.filter((x) => x.id !== id);
      runningRef.current = false;
      // the same Idempotency-Key as the attempt the app was killed in: a turn the bridge already started is re-attached
      if (!send(cur.text, atts, pending, cur.sendKey)) {
        pending.cancel();
        messagesRef.current = before;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stepQueued, forgetQueued, commitRecovered, recovery, send]
  );

  const discardQueued = useCallback(
    (id: string): string => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (!m || !isQueued(m)) return '';
      if (stepQueued(id, { type: 'discard' }).phase !== 'discarded') return '';
      forgetQueued(id);
      const atts = m.attachments ?? [];
      void deleteAttachmentFiles(atts);
      void queuedFiles.drop(atts.map((a) => a.id));
      patchMessages((list) => list.filter((x) => x.id !== id));
      return m.text;
    },
    [stepQueued, forgetQueued, patchMessages]
  );

  const queuedSend = useMemo<QueuedSendActions>(
    () => ({
      state: (id) => queuedRef.current.get(id) ?? QUEUED_INITIAL,
      resend: (id) => void resendQueued(id),
      discard: discardQueued,
    }),
    // a new object per state change: the bubbles re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resendQueued, discardQueued, queuedVersion]
  );

  const patchApproval = useCallback(
    (key: string, fn: (m: ChatMessage) => ChatMessage) =>
      patchMessages((list) => {
        const idx = findApproval(list, key);
        if (idx < 0) return list;
        const m = fn(list[idx]);
        if (m === list[idx]) return list;
        const next = list.slice();
        next[idx] = m;
        return next;
      }),
    [patchMessages]
  );

  // one timer for the earliest deadline: the card turns "Abgelaufen – abgelehnt", history row `expired`
  const expiryRef = useRef<ReturnType<typeof createExpiryTimer> | null>(null);
  useEffect(() => {
    const timer = createExpiryTimer((now) => patchMessages((list) => expireAll(list, now)));
    expiryRef.current = timer;
    timer.update(messagesRef.current);
    return () => {
      timer.dispose();
      expiryRef.current = null;
    };
  }, [patchMessages]);
  useEffect(() => expiryRef.current?.update(messages), [messages]);

  /** one pass over the candidates (or the run `runId`) – serialised and coalesced by `checkApprovals` */
  const checkApprovalsOnce = useCallback(async (runId?: string) => {
    if (!mountedRef.current) return;
    const sid = sessionRef.current;
    const list = messagesRef.current;
    const idxs = runId
      ? list.flatMap((m, i) => (m.role === 'assistant' && m.completionId === runId ? [i] : []))
      : restoreCandidates(list, Date.now());
    for (const i of idxs) {
      const id = list[i].id;
      const completionId = list[i].completionId;
      if (!completionId) continue;
      let st;
      try {
        st = await fetchRunStatus(connRef.current, completionId);
      } catch {
        continue; // offline / older server: try again on the next foreground / reconnect
      }
      if (!mountedRef.current || sessionRef.current !== sid) return;
      const now = Date.now();
      patchMessages((cur) => {
        const at = cur.findIndex((m) => m.id === id);
        if (at < 0) return cur;
        // a live stream reports the end itself; a run that "ended" while we stream is a stale status
        if (cur[at].status === 'streaming' && st.status !== 'waiting_for_approval') return cur;
        const m = applyRunStatus(cur[at], st, now, optsRef.current.approvalTimeoutSeconds);
        if (m === cur[at]) return cur;
        const next = cur.slice();
        next[at] = m;
        return next;
      });
    }
  }, [patchMessages]);
  // a check requested while one runs (notification tap, resolved event, foreground) runs right after it (M3)
  const checkApprovals = useMemo(() => {
    const request = createCoalescedCheck((runId) => checkApprovalsOnce(runId));
    return (runId?: string) => (mountedRef.current ? request(runId) : Promise.resolve());
  }, [checkApprovalsOnce]);
  useEffect(() => {
    checkApprovalsRef.current = checkApprovals;
  }, [checkApprovals]);

  // chat open (also after an app restart) and foreground: a pending approval comes back as a live card
  useEffect(() => {
    void checkApprovals();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkApprovals();
    });
    return () => sub.remove();
  }, [checkApprovals]);

  const recoverNow = useCallback(() => {
    wakeStreams(); // the inbox is back = the network is: a re-attaching stream tries now
    recovery.poke();
    void checkApprovals();
  }, [recovery, checkApprovals]);

  const [approvalFocus, setApprovalFocus] = useState<{ runId?: string; at: number } | null>(null);
  const openApproval = useCallback(
    (runId?: string) => {
      setApprovalFocus({ runId, at: Date.now() });
      void checkApprovals(runId);
    },
    [checkApprovals]
  );

  const approvals = useMemo(() => allPending(messages), [messages]);
  const approval: ApprovalRequest | null = approvals.find((a) => !a.expired) ?? approvals[0] ?? null;

  // approval key → choice of an attempt that failed in transit (may have reached Hermes)
  const inTransit = useRef(new Map<string, ApprovalChoice>());
  const respondFor = useCallback(
    async (ap: ApprovalRequest, choice: ApprovalChoice) => {
      const key = approvalKey(ap);
      const idx = findApproval(messagesRef.current, key);
      const current = idx < 0 ? undefined : pendingOf(messagesRef.current[idx]).find((a) => approvalKey(a) === key);
      try {
        // a retry of the same choice after a dropped attempt: "not pending" means the first one arrived
        await answerApproval(connRef.current, current, choice, Date.now(), { retryOf: inTransit.current.get(key) });
      } catch (e) {
        if (approvalMayHaveArrived(e)) inTransit.current.set(key, choice);
        else inTransit.current.delete(key);
        // late tap: nothing was sent; make sure the card shows "abgelaufen"
        if (isHermesError(e) && e.code === APPROVAL_EXPIRED_CODE) patchApproval(key, (m) => expireApprovals(m, Date.now()));
        throw e;
      }
      inTransit.current.delete(key);
      patchApproval(key, (m) => resolveApproval(m, key, choice, Date.now()));
    },
    [patchApproval]
  );

  const respond = useCallback(
    async (choice: ApprovalChoice) => {
      const head = allPending(messagesRef.current).find((a) => !a.expired);
      if (!head) return;
      await respondFor(head, choice);
    },
    [respondFor]
  );

  const dismissApproval = useCallback(
    (ap: ApprovalRequest) => {
      const key = approvalKey(ap);
      patchApproval(key, (m) => dismissApprovalIn(m, key, Date.now()));
    },
    [patchApproval]
  );

  return {
    messages,
    send,
    pendingSend,
    queuedSend,
    stop,
    retry,
    newSession,
    status,
    sessionId,
    error,
    approval,
    respondApproval: respond,
    approvals,
    respondApprovalFor: respondFor,
    dismissApproval,
    checkApprovals,
    openApproval,
    approvalFocus,
    replaceMessages,
    applyInbox: recovery.inbox,
    recoverNow,
  };
}

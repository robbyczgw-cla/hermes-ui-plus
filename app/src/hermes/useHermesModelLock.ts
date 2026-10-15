/**
 * useHermesModelLock – locks a chat's picked model on its Hermes session (Hermes v0.22 `session_model_lock`,
 * rules in modelLock.ts). Runs when the pick changes and again after each turn until Hermes has the session.
 * Silent: failures only mean "try later" or "this server cannot", never an error in the chat.
 */
import { useEffect, useRef } from 'react';
import { hermesSessions } from './client';
import { hasFeature, type HermesCapabilities } from './capabilities';
import { modelLockOutcome, modelLockTarget, sessionStored, type ModelLockState } from './modelLock';
import { serverKey } from './support';
import type { ChatMessage, ChatStatus } from './types';

/** servers / bridges without the lock route (404 / 405), per connection, for this app run */
const unsupported = new Set<string>();

export function useHermesModelLock(p: {
  conn: { baseUrl: string; apiKey: string };
  caps: HermesCapabilities | null;
  sessionId: string;
  /** the chat's own model pick (conversation meta) */
  model: string | undefined;
  lock: ModelLockState | undefined;
  messages: readonly ChatMessage[];
  status: ChatStatus;
  /** the chat is known to the server already (listed by the session sync) */
  fromServer: boolean;
  onLock: (lock: ModelLockState) => void;
}): void {
  const key = serverKey(p.conn);
  const stored = sessionStored(p.messages, p.fromServer);
  const target = modelLockTarget({
    supported: hasFeature(p.caps, 'session_model_lock') && !unsupported.has(key),
    model: p.model,
    lock: p.lock,
    stored,
  });
  const onLockRef = useRef(p.onLock);
  onLockRef.current = p.onLock;
  const inflight = useRef<string | null>(null);
  const { baseUrl, apiKey } = p.conn;
  const { sessionId, status } = p;

  useEffect(() => {
    if (!target) return;
    const job = `${sessionId}\n${target}`;
    if (inflight.current === job) return;
    inflight.current = job;
    // bound to the conversation of this moment (the result never lands on another chat)
    const onLock = onLockRef.current;
    void hermesSessions({ baseUrl, apiKey }, 15000)
      .lockModel(sessionId, target)
      .then(
        () => modelLockOutcome(target, undefined, Date.now()),
        (e: unknown) => modelLockOutcome(target, e, Date.now()),
      )
      .then((outcome) => {
        if (inflight.current === job) inflight.current = null;
        if (outcome.kind === 'unsupported') unsupported.add(serverKey({ baseUrl, apiKey }));
        else if (outcome.kind === 'done') onLock(outcome.state); // store write: fine after unmount too
      });
    // `status`: a session that was not stored yet is tried again after the next turn
  }, [target, sessionId, baseUrl, apiKey, status]);
}

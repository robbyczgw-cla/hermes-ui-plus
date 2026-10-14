// Hand-off of an onboarding starter prompt ("Fertig" screen) to the chat. OnboardingHost creates a
// conversation for the chosen profile and queues the prompt for that conversation id; the session
// component of that conversation sends it once after mount:
//
//   const chat = useXyzChat(conn, sessionOptions(conv));
//   useStarterPrompt(conv.meta?.id, chat.send);
//
// Module state (no React context) so the chat shell needs no provider. One prompt at a time; it is
// dropped after 60 s if no session picked it up (e.g. the user navigated elsewhere).
import { useEffect, useRef } from 'react';

type Pending = { conversationId: string; prompt: string; at: number };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const TTL_MS = 60_000;

/** Queue `prompt` to be sent as the first message of `conversationId`. */
export function queueStarterPrompt(conversationId: string, prompt: string): void {
  const text = prompt.trim();
  if (!conversationId || !text) return;
  pending = { conversationId, prompt: text, at: Date.now() };
  for (const l of Array.from(listeners)) l();
}

/** Take (and clear) the queued prompt if it belongs to `conversationId`. */
export function takeStarterPrompt(conversationId: string | undefined): string | null {
  if (!pending || !conversationId || pending.conversationId !== conversationId) return null;
  const p = pending;
  pending = null;
  return Date.now() - p.at <= TTL_MS ? p.prompt : null;
}

export function subscribeStarterPrompt(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Sends a queued starter prompt for this conversation once (on mount, or when it is queued later). */
export function useStarterPrompt(conversationId: string | undefined, send: (text: string) => void): void {
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const check = () => {
      const p = takeStarterPrompt(conversationId);
      // next tick: let the session finish mounting (transcript restored) before the first send
      if (p) setTimeout(() => sendRef.current(p), 0);
    };
    check();
    return subscribeStarterPrompt(check);
  }, [conversationId]);
}
